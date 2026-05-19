---
"create-nexpress": patch
---

Fixes two first-boot bugs in scaffolded projects.

**1. `docker compose up -d` bound the wrong port.** Compose's `--env-file` defaults to the directory containing the compose file — `docker/` in the scaffold layout — NOT the project root where `.env` lives. So `${NEXPRESS_DB_PORT}` in the compose template never resolved from `.env`, the fallback `5433` was always used, and the resulting container disagreed with the scaffold's `DATABASE_URL` / `NEXPRESS_DB_PORT=<unique>` (and with the setup wizard's prompt, which DOES read root `.env` correctly). Operators hit a confusing port-collision cascade.

Fix: at scaffold time, substitute the compose template's `${NEXPRESS_DB_PORT:-5433}` with the project-specific dbPort (`${NEXPRESS_DB_PORT:-<dbPort>}`). Now `docker compose -f docker/docker-compose.yml up -d db` binds the same port the setup wizard / `DATABASE_URL` expect, even when the env-file lookup misses. Operator can still override via shell env or `--env-file .env`.

**2. `pnpm run seed:content` exited with `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`.** The scaffold's `scripts/seed-content.ts` imported `ensureFor` from `../src/lib/init-core` — a thin re-export of `@nexpress/app/lib/init-core`. The published `@nexpress/app` dist chunks reference `@/lib/bootstrap` (a consumer-supplied tsconfig path alias). `tsx` applies tsconfig.paths to TS files in the consumer's source, but NOT to `.js` files inside `node_modules`. Node's default resolver parsed `@/lib` as a scoped package, found nothing, and exited.

Fix: scaffold's `seed-content.ts` now bootstraps via `createBootstrap` from `@nexpress/next` directly, with `seedAll` imported from `@nexpress/app/lib/seed-content` (which has no `@/`-aliased imports). The chain skirts `init-core` entirely. The resulting bootstrap functions are equivalent to what `init-core` / consumer's `src/lib/bootstrap.ts` would produce. Next.js routes that consume `@nexpress/app/lib/init-core` are unaffected — Next's bundler resolves `@/lib/*` at build time.
