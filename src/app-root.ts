import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sanitizeHtml } from '@emeli/sanitize';
import type { MailPort, Folder, MessageBody } from '@emeli/core';
import type { MessageListItem } from '@emeli/ui-message-list';
import rowThemeCss from '@emeli/theme-terracotta/message-row?raw';
import { createMailPort } from './mail/provider.js';
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
    }
    header.bar {
      display: flex;
      gap: var(--emeli-space-xs, 0.5rem);
      align-items: center;
      padding: var(--emeli-space-xs, 0.5rem) var(--emeli-space-sm, 1rem);
      border-block-end: 1px solid var(--emeli-color-border, #e5e5e5);
      background: var(--emeli-color-surface, #f7f7f7);
    }
    .brand {
      font-weight: var(--emeli-font-weight-bold, 700);
      color: var(--emeli-color-brand, #c0491f);
      margin-inline-end: auto;
    }
    .folder {
      all: unset;
      cursor: pointer;
      padding: 0.3rem 0.7rem;
      border-radius: var(--emeli-radius-sm, 0.5rem);
      color: var(--emeli-color-text-secondary, #555);
      white-space: nowrap;
    }
    .folder[aria-current='true'] {
      background: var(--emeli-color-surface-sunken, #eee);
      color: var(--emeli-color-text-primary, #111);
      font-weight: var(--emeli-font-weight-medium, 500);
    }
    .panes {
      display: grid;
      grid-template-columns: 1fr;
      min-block-size: 0;
    }
    .list {
      overflow: auto;
      border-inline-end: 1px solid var(--emeli-color-border, #e5e5e5);
    }
    .reader {
      overflow: auto;
      padding: var(--emeli-space-sm, 1rem);
    }
    .reader h1 {
      font-size: var(--emeli-font-size-lg, 1.125rem);
      margin: 0 0 0.25rem;
    }
    .reader .from {
      color: var(--emeli-color-text-secondary, #555);
      font-size: var(--emeli-font-size-sm, 0.875rem);
      margin-block-end: var(--emeli-space-sm, 1rem);
    }
    .empty {
      display: grid;
      place-items: center;
      color: var(--emeli-color-text-tertiary, #888);
      padding: var(--emeli-space-xl, 3rem);
    }
    @media (min-width: 900px) {
      .panes {
        grid-template-columns: 24rem 1fr;
      }
      .list {
        overflow: auto;
      }
    }
  `;

  private port: MailPort = createMailPort();
  private rawBody: MessageBody | undefined;

  @state() private folders: readonly Folder[] = [];
  @state() private activeFolder = 'inbox';
  @state() private items: readonly MessageListItem[] = [];
  @state() private selectedId: string | undefined;
  @state() private bodyHtml = '';
  @state() private bodyBlocked = 0;
  @state() private bodyAllowRemote = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.init();
  }

  protected override updated(): void {
    const list = this.renderRoot.querySelector('emeli-message-list');
    const shadow = list?.shadowRoot;
    if (shadow !== null && shadow !== undefined && !shadow.adoptedStyleSheets.includes(rowThemeSheet)) {
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, rowThemeSheet];
    }
  }

  private async init(): Promise<void> {
    const folders = await this.port.listFolders();
    if (folders.ok) this.folders = folders.value;
    await this.loadFolder(this.activeFolder);
  }

  private async loadFolder(id: string): Promise<void> {
    this.activeFolder = id;
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

  private get selectedItem(): MessageListItem | undefined {
    return this.items.find((i) => i.id === this.selectedId);
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
        <span class="brand">emeli</span>
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
      </header>
      <div class="panes">
        <div class="list">
          <emeli-message-list
            .messages=${this.items}
            .selectedId=${this.selectedId}
            @emeli-select=${(e: CustomEvent<{ id: string }>) => this.open(e.detail.id)}
          ></emeli-message-list>
        </div>
        <div class="reader">${this.renderReader()}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'emeli-app': EmeliApp;
  }
}
