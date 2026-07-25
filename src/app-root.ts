import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sanitizeHtml } from '@emeli/sanitize';
import type { MailPort, Folder, MessageBody } from '@emeli/core';
import type { MessageListItem } from '@emeli/ui-message-list';
import type { SendDetail } from '@emeli/ui-compose';
import rowThemeCss from '@emeli/theme-terracotta/message-row?raw';
import {
  createDemoPort,
  isTauri,
  getYahooAccount,
  signInYahoo,
  getSignInError,
  getDiagnosticsLog,
  portForAccount,
} from './mail/provider.js';
import { toListItem, textToHtml } from './lib/to-list-item.js';

// The rows live inside <emeli-message-list>'s shadow root, so document-level
// theme CSS (which uses ::part) cannot reach them across the nested boundary.
// Tokens inherit through shadow, but the theme rules must be adopted where the
// rows are direct children — the list's shadow root. (Custom-property values
// still cascade in from :root.)
const rowThemeSheet = new CSSStyleSheet();
rowThemeSheet.replaceSync(rowThemeCss);

/**
 * `<emeli-app>` — the three-pane composition: folders · message list · reader.
 * It owns a `MailPort` (the in-memory fake today) and wires the headless
 * components together; the reader renders bodies through the sanitizer into the
 * sandboxed body component, with a remote-content consent flow.
 */
@customElement('emeli-app')
export class EmeliApp extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      block-size: 100dvh;
      grid-template-rows: auto 1fr;
      grid-template-columns: 1fr;
      font-family: var(--emeli-font-sans, system-ui);
      color: var(--emeli-color-text-primary, #111);
      background: var(--emeli-color-background, #fff);
      overflow: hidden;
    }
    header.bar {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.5rem 0.75rem;
      border-block-end: 1px solid var(--emeli-color-border, #e5e5e5);
      background: var(--emeli-color-surface, #f7f7f7);
    }
    .bar-top {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-inline-size: 0;
    }
    .brand {
      font-weight: var(--emeli-font-weight-bold, 700);
      color: var(--emeli-color-brand, #c0491f);
      margin-inline-end: auto;
      font-size: 1.05rem;
    }
    .folders {
      display: flex;
      gap: 0.25rem;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .folders::-webkit-scrollbar {
      display: none;
    }
    .folder {
      all: unset;
      flex: 0 0 auto;
      cursor: pointer;
      padding: 0.3rem 0.7rem;
      border-radius: var(--emeli-radius-full, 999px);
      color: var(--emeli-color-text-secondary, #555);
      white-space: nowrap;
      font-size: 0.9rem;
    }
    .folder[aria-current='true'] {
      background: var(--emeli-color-surface-sunken, #eee);
      color: var(--emeli-color-text-primary, #111);
      font-weight: var(--emeli-font-weight-medium, 500);
    }
    .compose,
    .signin {
      all: unset;
      cursor: pointer;
      white-space: nowrap;
      flex: 0 0 auto;
      padding: 0.35rem 0.8rem;
      border-radius: var(--emeli-radius-sm, 0.5rem);
      font-weight: var(--emeli-font-weight-medium, 500);
      font-size: 0.9rem;
    }
    .compose {
      background: var(--emeli-color-brand, #c0491f);
      color: var(--emeli-color-on-brand, #fff);
    }
    .signin {
      border: 1px solid var(--emeli-color-brand, #c0491f);
      color: var(--emeli-color-brand, #c0491f);
    }
    .signin[disabled] {
      opacity: 0.6;
      cursor: default;
    }
    .account {
      color: var(--emeli-color-text-secondary, #555);
      font-size: 0.8rem;
      max-inline-size: 40vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 0 1 auto;
    }
    .log-open {
      all: unset;
      cursor: pointer;
      white-space: nowrap;
      flex: 0 0 auto;
      padding: 0.35rem 0.6rem;
      border-radius: var(--emeli-radius-sm, 0.5rem);
      border: 1px solid var(--emeli-color-border, #ccc);
      color: var(--emeli-color-text-secondary, #555);
      font-size: 0.85rem;
    }
    .log-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: grid;
      place-items: center;
      padding: 1rem;
      z-index: 10;
    }
    .log-panel {
      background: var(--emeli-color-background, #fff);
      color: var(--emeli-color-text-primary, #111);
      border-radius: var(--emeli-radius-md, 0.75rem);
      padding: 0.75rem;
      inline-size: min(100%, 40rem);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .log-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .log-actions strong {
      margin-inline-end: auto;
    }
    .log-btn {
      all: unset;
      cursor: pointer;
      padding: 0.3rem 0.8rem;
      border-radius: var(--emeli-radius-sm, 0.5rem);
      background: var(--emeli-color-brand, #c0491f);
      color: var(--emeli-color-on-brand, #fff);
      font-size: 0.85rem;
    }
    .log-text {
      inline-size: 100%;
      block-size: 50vh;
      box-sizing: border-box;
      font-family: var(--emeli-font-mono, monospace);
      font-size: 0.78rem;
      border: 1px solid var(--emeli-color-border, #ccc);
      border-radius: var(--emeli-radius-sm, 0.5rem);
      padding: 0.5rem;
      resize: none;
      background: var(--emeli-color-surface, #f7f7f7);
      color: inherit;
    }
    emeli-compose {
      display: block;
      max-inline-size: 42rem;
    }
    emeli-compose::part(field) {
      margin-block-end: var(--emeli-space-sm, 1rem);
    }
    emeli-compose::part(label) {
      font-size: var(--emeli-font-size-sm, 0.875rem);
      color: var(--emeli-color-text-secondary, #555);
    }
    emeli-compose::part(input),
    emeli-compose::part(textarea) {
      padding: 0.45rem;
      border: 1px solid var(--emeli-color-border, #ccc);
      border-radius: var(--emeli-radius-sm, 0.5rem);
      background: var(--emeli-color-surface-elevated, #fff);
      color: inherit;
    }
    emeli-compose::part(actions) {
      display: flex;
      gap: var(--emeli-space-xs, 0.5rem);
      margin-block-start: var(--emeli-space-sm, 1rem);
    }
    emeli-compose::part(send) {
      padding: 0.45rem 1rem;
      border-radius: var(--emeli-radius-sm, 0.5rem);
      background: var(--emeli-color-brand, #c0491f);
      color: var(--emeli-color-on-brand, #fff);
    }
    emeli-compose::part(cancel) {
      padding: 0.45rem 1rem;
      border-radius: var(--emeli-radius-sm, 0.5rem);
      border: 1px solid var(--emeli-color-border, #ccc);
    }
    emeli-compose::part(errors) {
      color: var(--emeli-color-danger, #c0392b);
      font-size: var(--emeli-font-size-sm, 0.875rem);
    }
    .panes {
      display: grid;
      grid-template-columns: 1fr;
      min-block-size: 0;
      min-inline-size: 0;
    }
    .list {
      overflow: auto;
      min-inline-size: 0;
    }
    .reader {
      overflow: auto;
      padding: var(--emeli-space-sm, 1rem);
      min-inline-size: 0;
    }
    .reader h1 {
      font-size: var(--emeli-font-size-lg, 1.125rem);
      margin: 0 0 0.25rem;
      overflow-wrap: anywhere;
    }
    .reader .from {
      color: var(--emeli-color-text-secondary, #555);
      font-size: var(--emeli-font-size-sm, 0.875rem);
      margin-block-end: var(--emeli-space-sm, 1rem);
      overflow-wrap: anywhere;
    }
    .back {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--emeli-color-brand, #c0491f);
      font-weight: var(--emeli-font-weight-medium, 500);
      margin-block-end: 0.75rem;
    }
    .empty {
      display: grid;
      place-items: center;
      color: var(--emeli-color-text-tertiary, #888);
      padding: var(--emeli-space-xl, 3rem);
      block-size: 100%;
    }

    /* Mobile drill-down: one pane at a time, switched by data-view. */
    :host([data-view='list']) .reader {
      display: none;
    }
    :host([data-view='reader']) .list {
      display: none;
    }

    @media (min-width: 900px) {
      .panes {
        grid-template-columns: 24rem 1fr;
      }
      .list {
        border-inline-end: 1px solid var(--emeli-color-border, #e5e5e5);
      }
      /* Both panes always visible on wide screens. */
      :host([data-view='list']) .reader,
      :host([data-view='reader']) .list {
        display: block;
      }
      .back {
        display: none;
      }
    }
  `;

  private port: MailPort = createDemoPort();
  private rawBody: MessageBody | undefined;

  @state() private folders: readonly Folder[] = [];
  @state() private activeFolder = 'inbox';
  @state() private items: readonly MessageListItem[] = [];
  @state() private selectedId: string | undefined;
  @state() private bodyHtml = '';
  @state() private bodyBlocked = 0;
  @state() private bodyAllowRemote = false;
  @state() private composing = false;
  @state() private sending = false;
  @state() private account: string | undefined;
  @state() private signingIn = false;
  /** Which pane is active on a narrow (mobile) screen. */
  @state() private view: 'list' | 'reader' = 'list';
  @state() private signInError: string | undefined;
  @state() private showLog = false;
  @state() private logText = '';

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('data-view', 'list');
    document.addEventListener('visibilitychange', this.onVisible);
    void this.init();
  }

  override disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    super.disconnectedCallback();
  }

  protected override updated(): void {
    this.setAttribute('data-view', this.view);
    const list = this.renderRoot.querySelector('emeli-message-list');
    const shadow = list?.shadowRoot;
    if (shadow !== null && shadow !== undefined && !shadow.adoptedStyleSheets.includes(rowThemeSheet)) {
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, rowThemeSheet];
    }
  }

  private back = (): void => {
    this.view = 'list';
    this.composing = false;
    this.selectedId = undefined;
  };

  private async init(): Promise<void> {
    const account = await getYahooAccount();
    if (account !== undefined) {
      this.account = account;
      this.port = portForAccount(account);
    }
    const folders = await this.port.listFolders();
    if (folders.ok) this.folders = folders.value;
    await this.loadFolder(this.activeFolder);
  }

  private useAccount = async (email: string): Promise<void> => {
    this.account = email;
    this.port = portForAccount(email);
    await this.loadFolder('inbox');
  };

  private signIn = async (): Promise<void> => {
    this.signingIn = true;
    this.signInError = undefined;
    try {
      const email = await signInYahoo();
      if (email !== '') {
        await this.useAccount(email); // desktop: completed inline
        return;
      }
      await this.pollForSignIn(); // mobile: browser opened, deep-link completes
    } catch (cause) {
      this.signInError = String(cause).replace(/^Error:\s*/, '');
    } finally {
      this.signingIn = false;
    }
  };

  /** Poll for the deep-link handler to finish the mobile sign-in. */
  private async pollForSignIn(): Promise<void> {
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const account = await getYahooAccount();
      if (account !== undefined && account !== '') {
        await this.useAccount(account);
        return;
      }
      const error = await getSignInError();
      if (error !== undefined) {
        this.signInError = error;
        return;
      }
    }
    this.signInError = 'Timed out waiting for sign-in.';
  }

  /** When the app returns to the foreground, pick up a completed sign-in. */
  private onVisible = (): void => {
    if (document.hidden || this.account !== undefined) return;
    void (async () => {
      const account = await getYahooAccount();
      if (account !== undefined && account !== '') {
        await this.useAccount(account);
        return;
      }
      const error = await getSignInError();
      if (error !== undefined) this.signInError = error;
    })();
  };

  private async loadFolder(id: string): Promise<void> {
    this.activeFolder = id;
    this.view = 'list';
    this.selectedId = undefined;
    this.rawBody = undefined;
    this.bodyHtml = '';
    this.bodyBlocked = 0;
    const page = await this.port.listMessages({ folderId: id, limit: 100 });
    if (page.ok) this.items = page.value.items.map(toListItem);
  }

  private renderBody(body: MessageBody, allowRemote: boolean): void {
    const source = body.html ?? (body.text !== undefined ? textToHtml(body.text) : '');
    const { html: clean, blockedRemote } = sanitizeHtml(source, { allowRemote });
    this.bodyHtml = clean;
    this.bodyBlocked = blockedRemote;
    this.bodyAllowRemote = allowRemote;
  }

  private async open(id: string): Promise<void> {
    this.selectedId = id;
    this.view = 'reader';
    const body = await this.port.getBody(id);
    if (body.ok) {
      this.rawBody = body.value;
      this.renderBody(body.value, false);
    } else {
      this.rawBody = undefined;
      this.bodyHtml = '';
      this.bodyBlocked = 0;
    }
    await this.port.markRead(id, true);
    await this.loadFolderKeepingSelection(this.activeFolder, id);
  }

  private async loadFolderKeepingSelection(folderId: string, keep: string): Promise<void> {
    const page = await this.port.listMessages({ folderId, limit: 100 });
    if (page.ok) this.items = page.value.items.map(toListItem);
    this.selectedId = keep;
  }

  private loadRemote = (): void => {
    if (this.rawBody !== undefined) this.renderBody(this.rawBody, true);
  };

  private startCompose = (): void => {
    this.composing = true;
    this.view = 'reader';
  };

  private cancelCompose = (): void => {
    this.composing = false;
    this.view = 'list';
  };

  private onSend = async (event: CustomEvent<SendDetail>): Promise<void> => {
    this.sending = true;
    const receipt = await this.port.send(event.detail.draft);
    this.sending = false;
    this.composing = false;
    if (receipt.ok) await this.loadFolder('sent');
    else this.view = 'list';
  };

  private get selectedItem(): MessageListItem | undefined {
    return this.items.find((i) => i.id === this.selectedId);
  }

  private openLog = async (): Promise<void> => {
    this.logText = await getDiagnosticsLog();
    this.showLog = true;
  };

  private closeLog = (): void => {
    this.showLog = false;
  };

  private copyLog = (): void => {
    void navigator.clipboard?.writeText(this.logText);
  };

  private renderLog() {
    if (!this.showLog) return nothing;
    return html`
      <div class="log-overlay" @click=${this.closeLog}>
        <div class="log-panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="log-actions">
            <strong>Diagnostics log</strong>
            <button class="log-btn" @click=${this.copyLog}>Copy</button>
            <button class="log-btn" @click=${this.closeLog}>Close</button>
          </div>
          <textarea class="log-text" readonly .value=${this.logText || '(empty)'}></textarea>
        </div>
      </div>
    `;
  }

  private renderAccount() {
    if (this.account !== undefined) {
      return html`<span class="account" title="Signed in">${this.account}</span>`;
    }
    if (!isTauri()) return nothing;
    return html`
      <button
        class="signin"
        ?disabled=${this.signingIn}
        title=${this.signInError ?? ''}
        @click=${this.signIn}
      >
        ${this.signingIn ? 'Signing in…' : this.signInError !== undefined ? 'Sign-in unavailable' : 'Sign in with Yahoo'}
      </button>
    `;
  }

  private renderCompose() {
    return html`
      <emeli-compose
        .sending=${this.sending}
        @emeli-send=${this.onSend}
        @emeli-cancel=${this.cancelCompose}
      ></emeli-compose>
    `;
  }

  private renderReader() {
    const item = this.selectedItem;
    if (item === undefined) return html`<div class="empty">Select a message to read</div>`;
    return html`
      <h1>${item.subject}</h1>
      <div class="from">${item.sender}</div>
      <emeli-message-body
        .html=${this.bodyHtml}
        .blockedRemote=${this.bodyBlocked}
        .allowRemote=${this.bodyAllowRemote}
        @emeli-load-remote=${this.loadRemote}
      ></emeli-message-body>
    `;
  }

  override render() {
    return html`
      <header class="bar">
        <div class="bar-top">
          <span class="brand">emeli</span>
          ${isTauri()
            ? html`<button class="log-open" @click=${this.openLog} title="Diagnostics log">Log</button>`
            : nothing}
          <button class="compose" @click=${this.startCompose}>Compose</button>
          ${this.renderAccount()}
        </div>
        <div class="folders">
          ${this.folders.map(
            (f) => html`
              <button
                class="folder"
                aria-current=${f.id === this.activeFolder ? 'true' : 'false'}
                @click=${() => this.loadFolder(f.id)}
              >
                ${f.name}${f.unreadCount > 0 ? html` (${f.unreadCount})` : nothing}
              </button>
            `,
          )}
        </div>
      </header>
      <div class="panes">
        <div class="list">
          <emeli-message-list
            .messages=${this.items}
            .selectedId=${this.selectedId}
            @emeli-select=${(e: CustomEvent<{ id: string }>) => this.open(e.detail.id)}
          ></emeli-message-list>
        </div>
        <div class="reader">
          <button class="back" @click=${this.back}>← Back</button>
          ${this.composing ? this.renderCompose() : this.renderReader()}
        </div>
      </div>
      ${this.renderLog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'emeli-app': EmeliApp;
  }
}
