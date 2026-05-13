---
"create-nexpress": patch
---

Two fixes that unblock the README quickstart against the previous publish (0.1.10):

1. **`pg` as a direct dependency.** PR #709's migration runner does `import pg from "pg"`. Under pnpm 10's strict hoisting the nested copy from `@nexpress/core` isn't visible at the scaffold's top level, so a clean `npx create-nexpress my-site && pnpm install && pnpm setup` died with `ERR_MODULE_NOT_FOUND: Cannot find package 'pg'`. Pinned to a top-level dep (apps/web mirrored for dogfooding).

2. **`docker-compose.yml`'s `POSTGRES_DB` now matches the scaffold's `DATABASE_URL`.** Previously the compose db service initialized `nexpress` while the generated `.env` pointed at `<project_name>` — README's quickstart (`docker compose up -d db && pnpm setup`) dies on the first migration with `database "<project_name>" does not exist`. `dockerComposeTemplate` now receives the project config and substitutes `POSTGRES_DB: <derived_db_name>` so `docker compose up` creates the right DB on first boot.

Verified locally end-to-end: fresh scaffold, `pnpm install`, `docker compose up -d db`, `pnpm setup` reaches the migration step with the right DB present.
