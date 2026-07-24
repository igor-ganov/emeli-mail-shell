import type { MessageHeader } from '@emeli/core';
import type { MessageListItem } from '@emeli/ui-message-list';

/** Map a core message header onto the list component's item shape. Pure. */
export const toListItem = (h: MessageHeader): MessageListItem => ({
  id: h.id,
  sender: h.from.name ?? h.from.email,
  subject: h.subject,
  snippet: h.snippet,
  time: h.date,
  unread: h.unread,
  flagged: h.flagged,
});

/** Escape plain text into a minimal HTML paragraph for the body renderer. */
export const textToHtml = (text: string): string => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped}</p>`;
};
