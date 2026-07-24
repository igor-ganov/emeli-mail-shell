# emeli-mail-shell

The **desktop shell** for [Emeli-mail](https://github.com/igor-ganov/emeli-mail):
a Tauri (Rust) window around an Astro + Lit UI that composes the whole client
from the headless components — folders · message list · reader — over a
`MailPort`.

Today it runs against the in-memory fake from
[`@emeli/core`](https://github.com/igor-ganov/emeli-mail-core) seeded with demo
mail, so the full slice works before a live provider is wired. Swapping in the
[Yahoo adapter](https://github.com/igor-ganov/emeli-mail-provider-yahoo) is a
one-line change in `src/mail/provider.ts` once OAuth credentials are configured.

## What it demonstrates

- Three-pane composition of `@emeli/ui-message-list`, `@emeli/ui-message-row`
  and `@emeli/ui-message-body`, themed by `@emeli/theme-terracotta`.
- Reading a body **safely**: `@emeli/sanitize` strips the HTML and the sandboxed
  body renderer shows it with remote content blocked — the demo newsletter's
  tracking pixel and banner are blocked, with a "Load remote content" consent
  banner.
- Secure token storage in the Rust shell (`secure_store`/`secure_load`/
  `secure_delete` IPC commands, backed by the OS keychain via `keyring`).

## Run

Frontend only (fast, no Rust):

```sh
bun install
bun run dev          # http://localhost:4321
```

Full desktop app (needs Rust ≥ 1.80 and the Tauri prerequisites):

```sh
bun run tauri:dev    # dev window
bun run tauri:build  # packaged binary
```

## Layout

```
src/
  app.ts             client entry (tokens + theme + components + app-root)
  app-root.ts        <emeli-app> — the three-pane composition
  mail/provider.ts   the active MailPort (in-memory fake today)
  mail/seed.ts       demo data (incl. a body with remote tracking content)
  lib/to-list-item.ts  pure header→list-item mapping (unit-tested)
  pages/index.astro  the shell page
src-tauri/           the Rust shell (window, IPC, secure storage)
```

> This is an application, not a library — it consumes its sibling `@emeli/*`
> repos via local `file:` links, so it is verified locally rather than in
> isolated CI.

MIT © igor-ganov
