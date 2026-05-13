# tmp-np-dock-53207

Scaffolded with create-nexpress.

## Getting started

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm run setup          # browser env wizard (DB / NP_SECRET / storage / migrations)
pnpm dev
```

> `pnpm run setup`, not `pnpm setup` — `pnpm setup`, `pnpm doctor`,
> and `pnpm init` are all pnpm built-ins that shadow our package
> scripts of the same name. Invoke ours with `pnpm run <name>`.

#### Headless / SSH / CI?

`pnpm run setup` auto-detects an SSH session or headless Linux and
falls back to terminal prompts. To force it:

```bash
pnpm run setup -- --cli              # terminal prompts, no browser
pnpm run setup -- --non-interactive  # read everything from env vars
```

Non-interactive mode reads `DATABASE_URL` (required), and optional
`NP_SECRET` (auto-generated if absent), `SITE_URL`,
`NP_STORAGE_ADAPTER`, `NP_S3_*`, `NP_SETUP_RUN_MIGRATIONS` (set to
`false` to write only `.env` without running migrations).

### Stuck? Run the doctor.

```bash
pnpm run doctor
```

A read-only diagnosis of the runtime: Node / pnpm versions, `.env`
presence, required env vars, Postgres reachability, whether
migrations are applied. Green `✓` / yellow `⚠` / red `✗` with a
one-line hint for each non-OK line.

Before deploying, run the production-readiness pass:

```bash
pnpm run doctor:prod
```

Tightens the dev defaults: `NP_SECRET` < 32 chars becomes an error,
`http://` SITE_URL warns, missing `NP_ENABLE_JOBS` warns,
`local` storage on a multi-node platform errors. Wire this into
your release pipeline so a bad config fails CI before it ships.

The first time you visit `http://localhost:3000/admin` on an empty
DB, a 2-step wizard collects your admin account, site name, and
optional sample content — no manual `pnpm seed:admin` needed.

### Manual flow (no wizard)

```bash
cp .env.example .env    # then edit DATABASE_URL / NP_SECRET / SITE_URL
pnpm db:generate        # regen collection schema and SQL migrations
pnpm db:migrate         # apply migrations
pnpm seed:admin         # create first admin (interactive)
pnpm dev
```

## Options

- Example content: Yes
- Docker setup: Yes

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin
- OpenAPI spec: http://localhost:3000/api/openapi.json

## Background jobs (pg-boss)

Optional. Enable when you want async content hooks, scheduled pruning, or
image post-processing.

```bash
# in .env
NP_ENABLE_JOBS=1

# in a second terminal
pnpm worker
```

With jobs off, `enqueueJob` is a no-op — simpler dev, fewer moving parts.

## Deploy

See [docs/deployment.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md)
for full Docker / Vercel / Fly.io recipes plus multi-node notes.

### Vercel

`vercel.json` is included with a cron entry for `/api/internal/publish-scheduled`
(scheduled publishing). On Vercel:

1. Push the repo and import it in the Vercel dashboard.
2. Set env vars: `DATABASE_URL`, `NP_SECRET`, `SITE_URL`,
   `NP_ENABLE_JOBS=1`.
3. Add `CRON_SECRET` in the Vercel env, then set
   `NP_SCHEDULER_TOKEN` to the same value — Vercel signs cron requests
   with `Authorization: Bearer $CRON_SECRET`, and the scheduler route
   verifies against `NP_SCHEDULER_TOKEN`.
4. Storage: Vercel filesystem is ephemeral — set
   `NP_STORAGE_ADAPTER=s3` plus `NP_S3_*`.

If you don't use scheduled publishing, the cron entry is a no-op (the
endpoint short-circuits when `NP_SCHEDULER_TOKEN` is unset).
