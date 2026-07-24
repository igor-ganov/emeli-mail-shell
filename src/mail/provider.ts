import { createInMemoryPort } from '@emeli/core';
import type { MailPort } from '@emeli/core';
import { demoSeed } from './seed.js';

/**
 * The active MailPort. Today it is the in-memory fake seeded with demo data;
 * swapping in the Yahoo adapter (once OAuth credentials are configured) is a
 * one-line change here — nothing else in the UI depends on the provider.
 */
export const createMailPort = (): MailPort => createInMemoryPort(demoSeed, { now: () => Date.now() });
