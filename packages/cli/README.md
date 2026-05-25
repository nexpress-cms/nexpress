# create-nexpress

Scaffolder CLI for [NexPress](https://github.com/nexpress-cms/nexpress) — the
Next.js-based CMS.

## Usage

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm run setup    # browser env wizard: DB, NP_SECRET, storage, migrations
pnpm dev
```

Every scaffold ships the four built-in themes (`default`, `magazine`,
`portfolio`, `docs`) along with example collections and plugins. The
active theme and whether to seed sample content are picked in the
first-boot admin setup wizard at [`/admin/setup`](http://localhost:3000/admin/setup),
not at scaffold time.

`create-nexpress` writes both `.env.example` and `.env` for you. Use the
setup wizard to confirm the DB connection, generate or accept the auth
secret, run migrations, create the first admin, pick a theme, and optionally
seed starter content.

The site runs at [`localhost:3000`](http://localhost:3000) and the admin
panel is at [`localhost:3000/admin`](http://localhost:3000/admin).

## What you get

A Next.js 16 App Router project with:

- `src/collections/` — example collections (posts, pages) using
  `defineCollection()`
- `src/nexpress.config.ts` — site config (storage, auth, plugins)
- `src/db/generated/` — Drizzle schema generated from collections
- `src/app/(site)` — public site routes with the catch-all `[[...slug]]`
- `src/app/(admin)/admin` — login + protected admin shell
- `src/app/api/` — REST endpoints (rate-limited, CSRF-enforced via `proxy.ts`)
- `docker/docker-compose.yml` — Postgres 16 plus Mailpit, with a
  project-specific host port to avoid collisions between scaffolds
- `.env.example` / `.env` — every env var the project actually reads

## Prerequisites

- Node ≥ 20
- pnpm ≥ 10
- Docker (for the bundled Postgres) **or** any Postgres ≥ 14 reachable
  via `DATABASE_URL`

## Next steps after scaffolding

- Run the first-boot wizard: `pnpm run setup`
- Start the site: `pnpm dev`, then open `/admin`
- Publish your first page or post from the admin
- Generate a host-specific deploy checklist: `pnpm run deploy:plan -- --target vercel`
- Check production readiness before hosting: `pnpm run doctor:prod -- --target vercel`
- Get ordered remediation when readiness fails: `pnpm run doctor:prod -- --target vercel --json --fix-plan`
- Keep CI logs compact: `pnpm run doctor:prod -- --target vercel --brief --no-color`
- Deploy on Vercel: push your scaffold to GitHub, then import it from
  [Vercel New Project](https://vercel.com/new?utm_source=nexpress&utm_campaign=oss)
- Add a collection: edit `src/collections/<name>.ts`, run `pnpm db:generate && pnpm db:migrate`
- Read [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md) — architecture overview
- Read [deployment.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/deployment.md) — Docker, Vercel, Fly.io, Render, Railway

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [Issues](https://github.com/nexpress-cms/nexpress/issues)

## License

MIT
