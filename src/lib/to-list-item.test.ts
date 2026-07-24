import { describe, expect, it } from 'bun:test';
import { toListItem, textToHtml } from './to-list-item.js';
import type { MessageHeader } from '@emeli/core';

const header: MessageHeader = {
  id: 'm1',
  folderId: 'inbox',
  from: { email: 'ada@x.dev', name: 'Ada' },
  to: [],
  subject: 'Hi',
  snippet: 'preview',
  date: 123,
  unread: true,
  flagged: false,
  hasAttachments: false,
};

describe('toListItem', () => {
  it('prefers the sender name, falls back to email', () => {
    expect(toListItem(header).sender).toBe('Ada');
    expect(toListItem({ ...header, from: { email: 'x@y.z' } }).sender).toBe('x@y.z');
  });
  it('maps date to time and carries state', () => {
    const item = toListItem(header);
    expect(item.time).toBe(123);
    expect(item.unread).toBe(true);
  });
});

describe('textToHtml', () => {
  it('escapes and wraps plain text', () => {
    expect(textToHtml('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
  });
});
