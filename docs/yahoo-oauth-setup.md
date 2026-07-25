# Connecting a real Yahoo account

**End users do nothing but click "Sign in with Yahoo" in the app.** The app opens
the Yahoo login window, captures the redirect itself, and stores the token in the
OS keychain — no `.env`, no pasted URLs, no per-user config. The `client_id` is a
public app-level constant baked into the shell (`src-tauri/src/yahoo.rs`).

The rest of this document is **one-time developer setup** (registering the Yahoo
app) plus a caveat that decides whether OAuth is usable yet.

## The caveat (read this)

Yahoo's **IMAP/SMTP mail scope (`mail-r`/`mail-w`) is gated behind a review**.
A brand-new self-serve app can be created instantly, but the *mail* permission
is not granted automatically — Yahoo runs an approval process aimed at email
providers/products. So OAuth alone may not unlock IMAP until Yahoo approves the
app, which can take time (or be declined for a personal app).

For a **personal client that works today**, an **App Password** is the supported,
no-approval path: Yahoo lets you mint a per-app password that authenticates IMAP
and SMTP directly. Same mailbox, same servers — just a password instead of an
OAuth bearer.

Recommendation: do **Path B (App Password)** to get Emeli reading/sending your
real mail now; pursue **Path A (OAuth)** in parallel if you want the full OAuth
flow (and for the other providers later).

---

## Path A — OAuth 2.0

1. Go to **developer.yahoo.com** → sign in → **Create an App**
   (https://developer.yahoo.com/apps/create/).
2. Fill in:
   - **Application Name**: e.g. `Emeli Mail`
   - **Application Type**: **Installed Application** (desktop) — or Web if you
     have an https callback.
   - **Redirect URI(s) / Callback Domain**: use **`oob`** (out-of-band) for a
     desktop app with no public https server. Yahoo then shows the auth code on
     a page for you to paste back into Emeli.
   - **API Permissions**: enable **Mail → Read** (and **Write** if you want to
     send). This is the permission that triggers Yahoo's review.
3. Create the app. Copy the **Client ID (Consumer Key)** — the long `dj0y…`
   value — and the short **App ID**. Both are **public**; a native app is a
   **public client** and uses **PKCE**, so there is **no client secret** to hide.
4. Put the Client ID in `.env`. If mail scope needs approval, follow Yahoo's
   prompt to request it.

> Yahoo supports/requires **PKCE for public clients**: Emeli generates a
> `code_verifier`/`code_challenge` per sign-in and exchanges the code with the
> verifier — no secret in the client. If Yahoo registered your app as a
> *confidential* client (issued a secret anyway), keep that secret in a Worker
> that performs the code→token exchange and set `EMELI_TOKEN_PROXY_URL`.

Endpoints Emeli uses (already wired in `@emeli/provider-yahoo`):
- Authorize: `https://api.login.yahoo.com/oauth2/request_auth`
- Token: `https://api.login.yahoo.com/oauth2/get_token`
- Revoke: `https://api.login.yahoo.com/oauth2/revoke`

The flow Emeli will run: open the authorize URL in your browser → you approve →
Yahoo shows a code → you paste it into Emeli → Emeli exchanges it for
access+refresh tokens → the refresh token is stored in the OS keychain (never in
the WebView).

## Path B — App Password (fastest)

1. Go to **Yahoo Account Security** (login.yahoo.com/account/security).
2. Turn on 2-step verification if it isn't already.
3. **Generate app password** → name it `Emeli` → copy the 16-character password.
4. Put it in `.env` as `YAHOO_APP_PASSWORD`. Emeli authenticates IMAP/SMTP with
   it directly — no approval needed.

---

## Giving Emeli the values

Copy `.env.example` → `.env` (git-ignored) and fill it in **on disk**. With the
public-client/PKCE design there is no client secret at all; the Client ID and
App ID are public. If you use an **App Password** (Path B), that one *is* a
credential — keep it only in `.env`, never in chat.

```sh
cp .env.example .env   # then edit .env
```

Once `.env` is filled, tell me and I'll wire the live IMAP/SMTP transport (in the
Rust shell — the WebView can't open raw TLS sockets) and swap the in-memory fake
for the real Yahoo port behind the same `MailPort`.
