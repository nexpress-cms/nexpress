---
"@nexpress/app": patch
---

fix(setup): align `pnpm run setup` default DB name with docker-compose in the monorepo

The shared `setup-server` wizard derives the default Postgres
database name from the current directory name. Running it from
the monorepo's `apps/web` gave `web`, which mismatched the
repo's checked-in `docker/docker-compose.yml`
(POSTGRES_DB=nexpress) and `.env.example`
(DATABASE_URL=…/nexpress) — operators following the README
landed on a "database does not exist" error after running
`docker compose up -d db`.

Fix: `setup-server` now honors a `NP_SETUP_DB_NAME` env-var
override before falling through to the directory-name
derivation. The monorepo's `apps/web/scripts/setup-server.ts`
wrapper sets it to `nexpress` so the wizard default matches
the rest of the dev stack.

Scaffolded projects are unaffected: their CLI-emitted setup
wrapper doesn't set `NP_SETUP_DB_NAME`, so the derivation
still produces `<project_name>` — matching the CLI-templated
`docker/docker-compose.yml` (both derive from the same
`config.projectName`).
