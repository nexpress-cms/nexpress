---
"@nexpress/app": patch
---

`pnpm run setup --cli` (and the auto-CLI mode that kicks in on SSH / headless Linux) now reads the existing `.env` for its prompt defaults instead of hardcoding `localhost:5433`. Without this, a scaffold whose `.env` declares `NEXPRESS_DB_PORT=<unique>` (the per-project port `create-nexpress` writes since 0.1.x) would still see the CLI suggest `:5433` — operator hits Enter to accept, the saved `.env` overwrites the unique port with the hardcoded default, then `docker compose up -d db` (reading the freshly-overwritten file) binds the wrong port and `pnpm db:migrate` fails to connect.

HTTP mode has always read `.env` through `getFormDefaults()` at form-render time; CLI mode now uses the same call so both prompts default to whatever the operator's `.env` currently says. `process.env.DATABASE_URL` / `process.env.TEST_DATABASE_URL` still win when a shell env override is set, matching the pre-existing precedence.

Side effect: `TEST_DATABASE_URL` is now preserved across CLI-mode reruns. Previously the line was silently dropped on rewrite because CLI mode never collected it.
