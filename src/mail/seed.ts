import type { InMemorySeed } from '@emeli/core';

const hoursAgo = (h: number): number => 1_770_000_000_000 - h * 3_600_000;

/**
 * Sample data so the shell runs end-to-end before a live provider is wired.
 * Includes an HTML body with a remote image to exercise the sanitizer's
 * tracking-pixel block and the reader's consent banner.
 */
export const demoSeed: InMemorySeed = {
  folders: [
    { id: 'inbox', name: 'Inbox', kind: 'inbox', unreadCount: 0 },
    { id: 'sent', name: 'Sent', kind: 'sent', unreadCount: 0 },
    { id: 'drafts', name: 'Drafts', kind: 'drafts', unreadCount: 0 },
    { id: 'archive', name: 'Archive', kind: 'archive', unreadCount: 0 },
  ],
  messages: [
    {
      id: 'm1',
      folderId: 'inbox',
      from: { email: 'ada@analytical.dev', name: 'Ada Lovelace' },
      to: [{ email: 'me@emeli.local' }],
      subject: 'Analytical engine — Note G',
      snippet: 'The engine can arrange and combine numeric quantities…',
      date: hoursAgo(1),
      unread: true,
      flagged: false,
      hasAttachments: false,
    },
    {
      id: 'm2',
      folderId: 'inbox',
      from: { email: 'newsletter@weekly.example', name: 'Weekly Digest' },
      to: [{ email: 'me@emeli.local' }],
      subject: 'Your week in review',
      snippet: 'Top stories, curated for you — open to read more.',
      date: hoursAgo(6),
      unread: true,
      flagged: true,
      hasAttachments: false,
    },
    {
      id: 'm3',
      folderId: 'inbox',
      from: { email: 'grace@navy.example', name: 'Grace Hopper' },
      to: [{ email: 'me@emeli.local' }],
      subject: 'Re: the nanosecond',
      snippet: 'A nanosecond is about eleven inches of wire. Here is why…',
      date: hoursAgo(30),
      unread: false,
      flagged: false,
      hasAttachments: true,
    },
  ],
  bodies: {
    m1: {
      html:
        '<h2>Note G</h2><p>The <b>Analytical Engine</b> weaves algebraic patterns ' +
        'just as the Jacquard loom weaves flowers and leaves.</p>' +
        '<blockquote>It might act upon other things besides number.</blockquote>' +
        '<p>Yours, Ada.</p>',
    },
    m2: {
      html:
        '<p>Good morning!</p>' +
        '<p><img src="https://tracker.example/pixel.gif?u=me" width="1" height="1"> ' +
        'Here are your <a href="https://weekly.example/read">top stories</a>.</p>' +
        '<p><img src="https://weekly.example/banner.png" alt="banner" width="480"></p>',
    },
    m3: {
      text: 'A nanosecond is about eleven inches of wire — the distance light travels.',
    },
  },
};
