// apps/web writes its .env to the monorepo root (where .env.example
// lives). Scaffolded projects use their own project-local .env.
process.env.NP_SETUP_ENV_PATH ??= "../../.env";
// Force the wizard's DB-name default to `nexpress` — the dir-name
// derivation in the shared setup-server would otherwise default
// to `web` (the apps/web directory name), mismatching the repo's
// checked-in `docker/docker-compose.yml` (POSTGRES_DB=nexpress)
// and `.env.example` (DATABASE_URL=…/nexpress). Scaffolded
// projects DON'T set NP_SETUP_DB_NAME; their wizard derives the
// DB name from their own project dir, matching the CLI's
// docker-compose template (both use the same projectName).
process.env.NP_SETUP_DB_NAME ??= "nexpress";
await import("@nexpress/app/scripts/setup-server");
