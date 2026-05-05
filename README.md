# NexPress

Next.js-based open-source CMS for developers building content-managed
sites. Self-hostable on a single Postgres + a Next.js app; horizontally
scalable when you flip on S3 + an upstream rate limiter.

<!-- badges -->

> **Status — pre-1.0 (`v0.1.0`).** Public APIs are committed per
> [the Stability section in `AGENTS.md`](./AGENTS.md#stability-v01).
> Breaking changes during `0.x` ride a minor bump and ship with a
> CHANGELOG line you can search for.

## Features

### Core authoring
- Type-safe collections via `defineCollection({ slug, fields, hooks, access })` — Drizzle schema + Zod validators are generated from the same definition.
- Lexical rich-text editor (client + server-safe SSR renderer)
- Block-based page builder with 8 default blocks + drag & drop
- Media library with image processing (sharp), local + S3 adapters
- Revisions, autosave, and scheduled publishing
- Full-text search via Postgres `tsvector` (per-collection)

### Multi-tenant + locale
- **Multi-site** (Phase 15) — one install can host many tenants, each with its own content, settings, members, and admin
- **i18n** (Phase 12) — locale-keyed documents, per-site string overrides, translator workflow with [`@nexpress/xliff`](packages/xliff) export/import
- **Right-to-left** locale support

### Community
- Threaded comments with nested replies, edit history, hidden/deleted states
- Reactions (configurable kind set), follows, mentions
- Member-side moderation (hide / restore / delete by author) and staff moderation queue
- Reports + audit log + per-site bans + per-site moderator role grants
- Pluggable spam, profanity, and reputation adapters
- Email digests (daily/weekly) with notification preferences

### Auth
- JWT sessions (Argon2 password hashing) with `tokenVersion` invalidation
- OAuth providers: GitHub, Google ([`@nexpress/plugin-oauth-github`](packages/plugins/oauth-github), [`@nexpress/plugin-oauth-google`](packages/plugins/oauth-google)) — extensible via `registerOAuthProvider`
- Member email verification + password reset flow
- Capability-based authorization (`can(user, "content.publish")` etc.)

### Migration in
- **WordPress import** ([`@nexpress/wp-import`](packages/wp-import)) — WXR XML, HTML → Lexical conversion (incl. Gutenberg block fences), media download + dedup, taxonomies, comments, custom post types, audit log, resume marker

### SEO
- Sitemap + sitemap-index XML
- Atom feed
- JSON-LD builders (Article / DiscussionForumPosting / Person / WebSite)
- Per-site SEO settings (default OG / Twitter / robots)

### Operations
- Background jobs via pg-boss (multi-node safe via Postgres advisory locks)
- Health probe + readiness probe (DB / storage / queue round-trip)
- Pluggable structured logger + error reporter (pino, Sentry, Datadog, …)
- Boot-time safety checks (multi-node + LocalStorageAdapter, weak prod secret)
- Admin Jobs surface — manual enqueue, pause / resume, archive, worker-health widget
- Operations runbook ([`docs/operations.md`](docs/operations.md))

### Plugin SDK
- `definePlugin({ manifest, hooks, actions, routes, scheduled })` — npm-package + rebuild model
- Catch-all routes at `/api/plugins/<id>/<...>` (rate-limited at framework level)
- Reference plugins shipped: [`reading-time`](packages/plugins/reading-time), [`seo-audit`](packages/plugins/seo-audit), [`forum`](packages/plugins/forum), `oauth-github`, `oauth-google`

### Tooling
- `create-nexpress` CLI scaffolder
- shadcn-style admin UI (Radix UI + Tailwind v4)
- Theme engine — CSS custom properties from design tokens
- Docker-ready (Next.js standalone output)

## Quick Start

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm run setup    # browser env wizard — DB connection, NP_SECRET, storage
pnpm dev
```

> `pnpm run setup`, not `pnpm setup` — `pnpm setup`, `pnpm doctor`,
> and `pnpm init` are all pnpm built-ins that shadow our package
> scripts of the same name. Always invoke ours with `pnpm run <name>`.

The site runs at `localhost:3000` and the admin panel is at
`localhost:3000/admin`. The first time you visit `/admin` on an empty
DB, a 2-step wizard collects your admin account, site name, and
optional sample content — no `pnpm seed:admin` env vars needed.

> Prefer to do it by hand? `cp .env.example .env`, edit it yourself,
> then `pnpm db:generate && pnpm db:migrate && pnpm dev`.

### Stuck? Run the doctor.

```bash
pnpm run doctor
```

A read-only diagnosis: Node / pnpm versions, `.env` presence, the
required env vars (with shape checks), Postgres reachability,
whether migrations are applied, and the local-storage directory.
Prints a green `✓` per check, a yellow `⚠` for soft issues, a red
`✗` per blocker plus a one-line hint for each.

## Architecture

```
packages/
├── core         — Server-only: collections, pipeline, auth, jobs,
│                  media, plugins, observability, SEO, i18n, sites,
│                  community
├── editor       — Lexical rich-text (client + SSR renderer split)
├── blocks       — Block registry + 8 defaults + DnD editor
├── admin        — UI primitives + admin views
├── theme        — CSS generation from design tokens
├── plugin-sdk   — definePlugin() + manifest types
├── next         — Next.js integration (createBootstrap, ensureFor,
│                  revalidateCollection, auth helpers)
├── wp-import    — WordPress (WXR) importer
├── xliff        — XLIFF i18n export/import
├── cli          — create-nexpress scaffolder
├── plugins/*    — Reference plugins (reading-time, seo-audit, forum,
│                  oauth-github, oauth-google)
└── themes/*     — Reference themes (default, minimal, magazine,
                   portfolio)
apps/
└── web          — Next.js 15 reference app (private)
```

## Documentation

The single live "architecture" entry point is
[`AGENTS.md`](./AGENTS.md) at the repo root — a working contributor
should orient there before diving into a subsystem.

Subsystem guides live under [`docs/`](./docs/) and are kept current
with the code:

| Topic | Guide |
| --- | --- |
| Architecture overview | [AGENTS.md](./AGENTS.md) |
| Stability promise | [AGENTS.md § Stability (v0.1)](./AGENTS.md#stability-v01) |
| Production deployment | [docs/deployment.md](./docs/deployment.md) |
| Operations runbook | [docs/operations.md](./docs/operations.md) |
| Background jobs | [docs/jobs.md](./docs/jobs.md) |
| Caching strategy | [docs/caching.md](./docs/caching.md) |
| Observability | [docs/observability.md](./docs/observability.md) |
| Releasing | [docs/releasing.md](./docs/releasing.md) |
| Multi-site | [docs/multi-site.md](./docs/multi-site.md) |
| i18n | [docs/i18n.md](./docs/i18n.md) |
| Email | [docs/email.md](./docs/email.md) |
| Community | [docs/community.md](./docs/community.md) |
| Theme authoring | [docs/theme-authoring.md](./docs/theme-authoring.md) |
| Plugin admin surface | [docs/plugin-admin.md](./docs/plugin-admin.md) |
| Plugin render hooks | [docs/plugin-render.md](./docs/plugin-render.md) |
| WordPress import | [docs/wordpress-import-guide.md](./docs/wordpress-import-guide.md) |
| Scheduled publishing | [docs/scheduled-publishing.md](./docs/scheduled-publishing.md) |
| API error codes | [docs/api-error-codes.md](./docs/api-error-codes.md) |
| Agent / LLM integration | [docs/agent-integration.md](./docs/agent-integration.md) |
| Testing setup | [docs/testing.md](./docs/testing.md) |

Security issues should be reported privately; see
[SECURITY.md](./SECURITY.md).

## Tech Stack

| Layer     | Technology                                       |
| --------- | ------------------------------------------------ |
| Framework | Next.js 15 (App Router)                          |
| Language  | TypeScript (strict, `NodeNext` module resolution) |
| Database  | PostgreSQL 16 + Drizzle ORM                      |
| Editor    | Lexical                                           |
| UI        | React 19 + Tailwind CSS v4 + Radix UI            |
| Block DnD | @dnd-kit                                          |
| Auth      | JWT (jose) + Argon2 (`@node-rs/argon2`)          |
| Jobs      | pg-boss                                           |
| Media     | sharp + S3 (`@aws-sdk/client-s3`) or local       |
| Email     | Pluggable (default no-op, SMTP via nodemailer)   |
| Build     | pnpm (10.33+) + Turborepo + tsup                 |
| Deploy    | Docker (Next standalone) / Vercel / Fly.io       |

## Plugin Development

Author plugins with `definePlugin()` from
[`@nexpress/plugin-sdk`](packages/plugin-sdk):

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "A sample NexPress plugin.",
    author: { name: "Your Name" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["hooks:content"],
    agent: {
      description: "Logs a message after content creation.",
      category: "utility",
    },
  },
  hooks: {
    "content:afterCreate": async (ctx) => {
      ctx.ctx.log.info("Document created!");
    },
  },
});
```

Hook names: `content:beforeSave`, `content:afterSave`,
`content:beforeDelete`, `content:afterDelete`, plus `member:*` and
`media:*` events. Custom routes are mounted at
`/api/plugins/<id>/<...>`. See
[docs/plugin-render.md](./docs/plugin-render.md) and
[docs/plugin-admin.md](./docs/plugin-admin.md).

## Project Structure (scaffolded site)

```
my-site/
├── src/
│   ├── collections/        — defineCollection() entries
│   ├── db/generated/       — codegen output (do not edit)
│   ├── nexpress.config.ts  — site config (storage, auth, plugins, themes)
│   ├── app/
│   │   ├── (site)/         — public routes; catch-all [[...slug]]
│   │   ├── (admin)/admin/  — login + protected admin shell
│   │   └── api/            — REST endpoints
│   └── lib/init-core.ts    — bootstrap singletons
├── scripts/
│   └── seed-admin.ts
├── docker/
│   └── docker-compose.yml  — Postgres 16 on :5433
├── public/uploads/         — local-storage adapter root
└── package.json
```

## Scripts (monorepo)

| Script             | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `pnpm build`       | Build every package's `dist/`                                   |
| `pnpm dev`         | Turbo watch — `tsup --watch` per package + `next dev`           |
| `pnpm lint`        | Root ESLint (type-aware rules)                                  |
| `pnpm typecheck`   | Per-package `tsc --noEmit` via Turbo                            |
| `pnpm test`        | Vitest unit suite (no DB needed)                                |
| `pnpm test:integration` | Vitest integration suite (gated on `TEST_DATABASE_URL`)    |
| `pnpm changeset`   | Record a user-facing change for the next release                |
| `pnpm db:generate` | Drizzle migrations from current schema                          |
| `pnpm db:migrate`  | Apply migrations against `DATABASE_URL`                         |
| `pnpm format`      | Prettier write                                                  |
| `pnpm clean`       | Remove `dist/` + `node_modules`                                 |

## Monorepo Notes

- Run `pnpm build` once before `pnpm dev` in a fresh clone — workspace packages resolve from `dist/`.
- `moduleResolution: NodeNext`: relative imports in `.ts` files must use `.js` extensions.
- `@nexpress/core` is **server-only**. Importing from a client component breaks the build.
- `pnpm lint` (ESLint) and `pnpm typecheck` (`tsc --noEmit`) are different by design.
- The eight published `@nexpress/*` framework packages bump together via the changesets `fixed` group; reference plugins / themes / `create-nexpress` / `wp-import` / `xliff` version independently.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, branching,
versioning policy (standard semver under `0.x` with breaking changes
called out in the changeset summary), and the changeset workflow.

Bug reports and feature ideas welcome on the
[issue tracker](https://github.com/hahabsw/nexpress/issues).

## License

MIT © 2026 Nexpress
