---
"@nexpress/app": patch
---

`pnpm doctor` now uses the same friendly error decoder as the setup wizard's "Test connection" when the Postgres reachability check fails. Previously the doctor printed the raw `pg` driver message (e.g. `password authentication failed for user "nexpress"`) with a fixed canned hint (`Confirm \`docker compose up -d db\` is running…`). Now it surfaces the wizard-grade guidance:

- sqlstate `3D000` — the exact `psql -c 'CREATE DATABASE "<name>"'` recipe.
- sqlstate `28P01` / `28000` — the "different Postgres on this port" diagnosis PLUS a free-port scan that appends `Detected free port: <N>. Set NEXPRESS_DB_PORT=<N>...` (added in #841 / `findFreePort`).
- `ECONNREFUSED` — the exact `docker compose -f docker/docker-compose.yml up -d db` command.
- Anything else falls through to the raw driver string.

Concretely, `messageForConnectionError` + `findFreePort` from the wizard now drive the doctor's `checkDatabase` error path, so operators running `pnpm doctor` after a failed first-boot get the same rich, actionable output the wizard already shows on its Test connection button.

No API surface change. Pure error-formatting reuse.
