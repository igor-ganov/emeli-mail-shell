#!/usr/bin/env bun
/**
 * Live Yahoo sign-in + inbox read — the end-to-end proof of the OAuth/IMAP path,
 * runnable without the full Tauri app. It uses the public-client PKCE flow from
 * @emeli/provider-yahoo and reads mail over IMAP with XOAUTH2.
 *
 * Run: `bun run login:yahoo` (from the shell dir; reads .env).
 * You open the printed URL, sign in, then paste the redirected URL back.
 */
import { ImapFlow } from 'imapflow';
import {
  createPkce,
  buildAuthorizeUrl,
  buildTokenForm,
  parseTokenResponse,
} from '@emeli/provider-yahoo';
import type { OAuthConfig } from '@emeli/provider-yahoo';

const env = process.env;
const need = (key: string): string => {
  const value = env[key];
  if (value === undefined || value === '') throw new Error(`missing ${key} in .env`);
  return value;
};

const config: OAuthConfig = {
  clientId: need('YAHOO_CLIENT_ID'),
  redirectUri: need('YAHOO_REDIRECT_URI'),
  authorizeUrl: 'https://api.login.yahoo.com/oauth2/request_auth',
  tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
  scopes: (env['YAHOO_SCOPES'] ?? 'mail-r').split(/\s+/),
};
const email = need('EMELI_ACCOUNT_EMAIL');

// 1) Authorize with PKCE.
const pkce = await createPkce();
const state = crypto.randomUUID();
const authUrl = buildAuthorizeUrl(config, { state, codeChallenge: pkce.challenge });

console.log('\n── Emeli · Yahoo sign-in ────────────────────────────────');
console.log('\n1) Open this URL, sign in, and approve access:\n');
console.log(authUrl);
console.log(
  `\n2) Your browser will fail to load ${config.redirectUri}?... — that is expected.\n` +
    '   Copy the full URL from the address bar (it contains ?code=...).',
);
const pasted = prompt('\n   Paste the redirected URL here: ') ?? '';

const returned = new URL(pasted.trim());
const code = returned.searchParams.get('code');
if (returned.searchParams.get('state') !== state) throw new Error('state mismatch (possible CSRF)');
if (code === null) throw new Error('no ?code= in the pasted URL');

// 2) Exchange the code (+ PKCE verifier, no secret) for tokens.
const response = await fetch(config.tokenUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(buildTokenForm(config, code, pkce.verifier)),
});
const json: unknown = await response.json();
const token = parseTokenResponse(json as Record<string, unknown>, Date.now());
if (token === undefined) {
  console.error('\n✗ Token exchange failed:', JSON.stringify(json));
  process.exit(1);
}
console.log('\n✓ Access token acquired. Connecting to IMAP…\n');

// 3) Read the inbox over IMAP with XOAUTH2.
const client = new ImapFlow({
  host: need('YAHOO_IMAP_HOST'),
  port: Number(env['YAHOO_IMAP_PORT'] ?? 993),
  secure: true,
  auth: { user: email, accessToken: token.accessToken },
  logger: false,
});

await client.connect();
const lock = await client.getMailboxLock('INBOX');
try {
  const total = typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
  const from = Math.max(1, total - 9);
  console.log(`Inbox — ${total} messages, showing latest ${Math.min(10, total)}:\n`);
  for await (const msg of client.fetch(`${from}:*`, { envelope: true, flags: true })) {
    const subject = msg.envelope?.subject ?? '(no subject)';
    const sender = msg.envelope?.from?.[0]?.address ?? '';
    const dot = msg.flags?.has('\\Seen') === true ? ' ' : '•';
    console.log(`  ${dot} ${sender.padEnd(28).slice(0, 28)}  ${subject}`);
  }
} finally {
  lock.release();
  await client.logout();
}
console.log('\n✓ Done — this is your real Yahoo inbox.\n');
