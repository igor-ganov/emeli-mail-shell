import { invoke } from '@tauri-apps/api/core';
import { createInMemoryPort } from '@emeli/core';
import type { MailPort } from '@emeli/core';
import { demoSeed } from './seed.js';
import { createYahooPort } from './yahoo-port.js';

/**
 * Provider selection. In the browser (and before sign-in) the client runs on
 * the in-memory fake seeded with demo mail. Inside the Tauri app, once a Yahoo
 * account is signed in, the live Yahoo port takes over — behind the same
 * `MailPort`, so the UI is unchanged.
 */
export const createDemoPort = (): MailPort =>
  createInMemoryPort(demoSeed, { now: () => Date.now() });

export const isTauri = (): boolean => Reflect.has(globalThis, '__TAURI_INTERNALS__');

/** The signed-in Yahoo account, if the shell has one stored. */
export const getYahooAccount = async (): Promise<string | undefined> => {
  if (!isTauri()) return undefined;
  const email = await invoke<string | null>('yahoo_account');
  return email ?? undefined;
};

/**
 * Launch the in-app Yahoo sign-in. On desktop this resolves to the account
 * email; on mobile it opens the system browser and resolves to an empty string
 * (the deep-link handler completes sign-in — poll `getYahooAccount`).
 */
export const signInYahoo = async (): Promise<string> => {
  const account = await invoke<{ email: string }>('yahoo_sign_in');
  return account.email;
};

/** The last mobile sign-in error recorded by the deep-link handler, if any. */
export const getSignInError = async (): Promise<string | undefined> => {
  if (!isTauri()) return undefined;
  const error = await invoke<string | null>('yahoo_signin_error');
  return error ?? undefined;
};

/** The diagnostics log (for the user to share). */
export const getDiagnosticsLog = async (): Promise<string> => {
  if (!isTauri()) return '';
  return invoke<string>('yahoo_log');
};

export const portForAccount = (email: string): MailPort => createYahooPort(email);
