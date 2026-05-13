// apps/web writes its .env to the monorepo root (where .env.example
// lives). Scaffolded projects use their own project-local .env.
process.env.NP_SETUP_ENV_PATH ??= "../../.env";
await import("@nexpress/app/scripts/setup-server");
