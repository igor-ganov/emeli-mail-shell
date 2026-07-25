/**
 * A `MailPort` backed by the live Yahoo account, over Tauri IPC. Reading the
 * inbox is real (IMAP XOAUTH2 in the Rust shell); bodies and send are stubbed
 * until the matching IMAP/SMTP commands land. Runs only inside the Tauri app.
 */
import { invoke } from '@tauri-apps/api/core';
import { ok, err, mailError } from '@emeli/core';
import type { MailPort, MailResult, Folder, MessageHeader, Page, MessageQuery } from '@emeli/core';

type HeaderJson = {
  readonly uid: string;
  readonly sender: string;
  readonly subject: string;
  readonly snippet: string;
  readonly date: number;
  readonly unread: boolean;
  readonly flagged: boolean;
};

const toHeader = (h: HeaderJson): MessageHeader => ({
  id: h.uid,
  folderId: 'inbox',
  from: { email: h.sender, name: h.sender },
  to: [],
  subject: h.subject,
  snippet: h.snippet,
  date: h.date,
  unread: h.unread,
  flagged: h.flagged,
  hasAttachments: false,
});

const inboxFolder: Folder = { id: 'inbox', name: 'Inbox', kind: 'inbox', unreadCount: 0 };

const notYet = (what: string): MailResult<never> =>
  Promise.resolve(err(mailError('unsupported', `${what} is not wired for live Yahoo yet`)));

export const createYahooPort = (email: string): MailPort => ({
  listFolders: async () => ok([inboxFolder]),

  listMessages: async (query: MessageQuery): MailResult<Page<MessageHeader>> => {
    if (query.folderId !== 'inbox') return ok({ items: [] });
    try {
      const rows = await invoke<readonly HeaderJson[]>('yahoo_inbox', { email, limit: query.limit });
      return ok({ items: rows.map(toHeader) });
    } catch (cause) {
      return err(mailError('network', String(cause)));
    }
  },

  getBody: () => notYet('reading the body'),
  markRead: () => notYet('marking read'),
  setFlag: () => notYet('flagging'),
  send: () => notYet('sending'),

  watch: () => ({
    async *[Symbol.asyncIterator]() {
      // No live push yet; the UI polls via listMessages.
    },
  }),
});
