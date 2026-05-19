# create-nexpress

Scaffolder CLI for [NexPress](https://github.com/nexpress-cms/nexpress) — the
Next.js-based CMS.

## Usage

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
cp .env.example .env
pnpm build
pnpm dev
```

Every scaffold ships the four built-in themes (`default`, `magazine`,
`portfolio`, `docs`) along with example collections and plugins. The
active theme and whether to seed sample content are picked in the
first-boot admin setup wizard at [`/admin/setup`](http://localhost:3000/admin/setup),
not at scaffold time.

The site runs at [`localhost:3000`](http://localhost:3000) and the admin
panel is at [`localhost:3000/admin`](http://localhost:3000/admin).

## What you get

A Next.js 15 App Router project with:

- `src/collections/` — example collections (posts, pages) using
  `defineCollection()`
- `src/nexpress.config.ts` — site config (storage, auth, plugins)
- `src/db/generated/` — Drizzle schema generated from collections
- `src/app/(site)` — public site routes with the catch-all `[[...slug]]`
- `src/app/(admin)/admin` — login + protected admin shell
- `src/app/api/` — REST endpoints (rate-limited, CSRF-enforced via `proxy.ts`)
- `docker/docker-compose.yml` — Postgres 16 on port 5433
- `.env.example` — every env var the project actually reads

## Prerequisites

- Node ≥ 20
- pnpm ≥ 10
- Docker (for the bundled Postgres) **or** any Postgres ≥ 14 reachable
  via `DATABASE_URL`

## Next steps after scaffolding

- Seed the first admin: `pnpm seed:admin` (set `NP_ADMIN_EMAIL`, `NP_ADMIN_NAME`, `NP_ADMIN_PASSWORD`)
- Add a collection: edit `src/collections/<name>.ts`, run `pnpm db:generate && pnpm db:migrate`
- Read [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md) — architecture overview
- Read [docs/](https://github.com/nexpress-cms/nexpress/tree/main/docs) — deployment, jobs, observability, theming

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [Issues](https://github.com/nexpress-cms/nexpress/issues)

## License

MIT
