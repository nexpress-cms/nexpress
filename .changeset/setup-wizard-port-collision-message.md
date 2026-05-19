---
"@nexpress/app": patch
---

Setup wizard's "Test connection" surfaces friendlier guidance for two more pg connection failure modes that previously fell through to the raw driver string:

- sqlstate `28P01` / `28000` (auth rejected) — almost always means a different Postgres instance is bound to the host port, so the scaffold's `docker compose up -d db` would have silently no-op'd against the existing container. The message now names this as the likely cause and offers two remediations: stop the conflicting service, or pick a free port via `NEXPRESS_DB_PORT` in `.env`.
- `ECONNREFUSED` — the message now points at the exact `docker compose ... up -d db` command instead of leaving the raw "connect ECONNREFUSED" string.

`3D000` (database does not exist) handling is unchanged. Internal split: `messageForConnectionError` moved into a new `scripts/setup-server-errors.ts` sibling so it's importable from unit tests without booting the wizard's HTTP server (mirroring `setup-server-validate.ts`).
