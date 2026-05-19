---
"create-nexpress": patch
---

Fixes two first-boot bugs in scaffolded projects.

**1. `docker compose up -d` bound the wrong port.** Compose's `--env-file` defaults to the directory containing the compose file — `docker/` in the scaffold layout — NOT the project root where `.env` lives. So `${NEXPRESS_DB_PORT}` in the compose template never resolved from `.env`, the fallback `5433` was always used, and the resulting container disagreed with the scaffold's `DATABASE_URL` / `NEXPRESS_DB_PORT=<unique>` (and with the setup wizard's prompt, which DOES read root `.env` correctly). Operators hit a confusing port-collision cascade.

Fix: at scaffold time, substitute the compose template's `${NEXPRESS_DB_PORT:-5433}` with the project-specific dbPort (`${NEXPRESS_DB_PORT:-<dbPort>}`). Now `docker compose -f docker/docker-compose.yml up -d db` binds the same port the setup wizard / `DATABASE_URL` expect, even when the env-file lookup misses. Operator can still override via shell env or `--env-file .env`.

**2. `pnpm run seed:content` AND `pnpm run worker` exited with `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`.** Both scripts transited through `@nexpress/app/lib/init-core` (seed-content via `../src/lib/init-core`, worker via `@/lib/init-core`). The published `@nexpress/app` dist chunks reference `@/lib/bootstrap` (a consumer-supplied tsconfig path alias). `tsx` applies tsconfig.paths to TS files in the consumer's source, but NOT to `.js` files inside `node_modules`. Node's default resolver parsed `@/lib` as a scoped package, found nothing, and exited.

Fix: both scripts now bootstrap via `createBootstrap` from `@nexpress/next` directly. `seed-content.ts` imports `seedAll` from `@nexpress/app/lib/seed-content` (which has no `@/`-aliased imports); `worker.ts` defines a small inline `ensureFor` (mirroring what `init-core`'s `ensureFor` would do for the "plugins" intent the worker needs) and feeds it to `runWorker`. The chain skirts `init-core` entirely. Next.js routes that consume `@nexpress/app/lib/init-core` are unaffected — Next's bundler resolves `@/lib/*` at build time; only tsx-run scripts hit this.

A repo-wide sweep confirmed the only two tsx-script consumers of the broken chain are these two. The other scaffold scripts (`setup-server`, `run-migrations`, `seed-admin`, `dev-notice`, `doctor`, `postinstall-notice`, `generate-schema`) all stay clean. Other published packages (`@nexpress/admin`, `@nexpress/next`, `@nexpress/auth-pages`, `@nexpress/blocks`, `@nexpress/editor`, `@nexpress/theme*`, `@nexpress/plugin-forum`) have no `@/`-aliased runtime imports in their published dist — only `@nexpress/app` does.
