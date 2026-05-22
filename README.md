# NexPress

Next.js-based open-source CMS for developers building content-managed
sites. Self-hostable on a single Postgres + a Next.js app; horizontally
scalable when you flip on S3 + an upstream rate limiter.

> **Status — pre-1.0 (`v0.3.x`).** Public APIs are committed per
> [the Stability section in `AGENTS.md`](./AGENTS.md#stability-v01).
> Breaking changes during `0.x` ride a minor bump and ship with a
> CHANGELOG line you can search for.

---

## Two ways to use NexPress

NexPress is published as a set of npm packages plus a scaffolder. Most
people only need the scaffolder; the monorepo is only for working on
the framework itself.

### Track A — Build a site (`npx create-nexpress`)

For everyone running a NexPress site: bloggers, agencies adding NexPress
to a client project, theme authors, plugin authors.

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm run setup    # browser env wizard — DB, NP_SECRET, storage, migrations
pnpm dev
```

Site at `localhost:3000`, admin at `localhost:3000/admin`. The first
`/admin` visit on an empty DB runs a 2-step wizard for the admin account,
site name, and optional sample content.

Before deploying the site, run `pnpm run deploy:plan -- --target vercel`
from the scaffolded project for a host-specific checklist, then run
`pnpm run doctor:prod -- --target vercel` as the readiness gate. Doctor
checks the production env shape, storage choice, job-worker settings,
Postgres reachability, and migration state before traffic hits the app.
For the fastest hosted path, push the scaffold to GitHub and import it
from [Vercel New Project](https://vercel.com/new?utm_source=nexpress&utm_campaign=oss);
Vercel deployments require S3-compatible media storage.

**What you can customise without touching the monorepo** — full guide in
[`docs/site-customization.md`](./docs/site-customization.md):

| Surface | How |
| --- | --- |
| Site identity, auth secret, DB URL | `src/nexpress.config.ts` + `.env` |
| New collection (Type-safe Drizzle + Zod) | Drop a `src/collections/<name>.ts`, append to `defineConfig({ collections })` |
| Active theme | `themes` array in `nexpress.config.ts` + admin → Appearance |
| Install a theme | `pnpm nexpress theme add @scope/theme-foo` (auto-wires `nexpress.config.ts` + `--apply` chains migrations) |
| Author a theme | Separate npm package — see [`docs/theme-authoring.md`](./docs/theme-authoring.md) |
| Install a plugin | `pnpm nexpress plugin add @scope/plugin-foo` (auto-wires `nexpress.config.ts`) |
| Author a plugin | Separate npm package — see [`docs/plugin-quickstart.md`](./docs/plugin-quickstart.md) |
| Customise a built-in (collection, lib helper, script) | Unwrap the matching `src/` file — that file becomes yours from then on |
| CSS / Tailwind tokens | `src/app/globals.css` + theme tokens |
| Deploy | [`docs/deployment.md`](./docs/deployment.md) — Docker, Vercel, Fly.io |

Stuck on first install? `pnpm run doctor` runs a read-only diagnosis
(Node / pnpm versions, `.env` presence, env-var shape checks, Postgres
reachability, migrations applied, storage dir).

> `pnpm run setup` / `pnpm run doctor`, not `pnpm setup` / `pnpm doctor`
> — pnpm built-ins shadow scripts of the same name; always invoke ours
> with `pnpm run <name>`.

### Track B — Contribute to the framework (monorepo)

For working on `@nexpress/core` / `@nexpress/admin` / `@nexpress/app`
(routes, lib, scripts, middleware) / `@nexpress/blocks` / `@nexpress/editor`
themselves — anything not addressable from Track A.

```bash
git clone https://github.com/nexpress-cms/nexpress.git
cd nexpress
pnpm install
pnpm build          # workspace packages resolve from dist/ — build once after fresh clone
docker compose -f docker/docker-compose.yml up -d   # Postgres :5433 + Mailpit
cp .env.example apps/web/.env
pnpm --filter @nexpress/web run setup
pnpm dev            # next dev for apps/web + tsup --watch on every package
```

`apps/web` is the reference site that loads every package as a workspace
dependency — edits to `packages/admin/src/...` show up live in
`localhost:3000/admin`.

Required reading before deeper work:
- [`AGENTS.md`](./AGENTS.md) — single architecture entry point (long-form,
  current-state)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branching, changeset workflow,
  release rules
- [`docs/testing.md`](./docs/testing.md) — unit vs. integration vs. e2e
- [`docs/releasing.md`](./docs/releasing.md) — version bumps + publish flow

Stuck on first boot? See
[`docs/troubleshooting.md`](./docs/troubleshooting.md) for common
errors (port collisions, missing migrations, etc.) and fixes.

---

## How the two tracks share code

Track A scaffold's `src/` is intentionally tiny — every runtime file
under `scripts/`, `src/lib/`, `src/app/`, `src/proxy.ts`, etc. is a
**thin re-export** from `@nexpress/app`. The framework lives in
`@nexpress/app` (and its sibling packages); scaffolds carry only
site-bound config + the wrappers Next.js needs in physical locations
under `src/app/...`.

This means:
- A Track A operator who edits `src/nexpress.config.ts` never has to
  rebuild the framework.
- A Track A operator who *unwraps* a wrapper (e.g. opens
  `src/lib/init-core.ts` and replaces the `export * from
  "@nexpress/app/lib/init-core"` with their own implementation) opts
  out of further framework updates for that file — exactly the seam
  between Track A and Track B.
- A Track B contributor's edits to `@nexpress/app` flow back to every
  Track A site on the next `pnpm install`.

---

## Features (highlights)

Authoring & content
- Type-safe collections via `defineCollection({ slug, fields, hooks, access })`
- Lexical rich-text editor (client + SSR-safe renderer)
- Block-based page builder with 8 default blocks + DnD
- Media library (sharp), local + S3 adapters
- Revisions, autosave, scheduled publishing
- Postgres full-text search per collection

Multi-tenant & locale — multi-site, i18n (locale-keyed docs, per-site string
overrides), RTL.

Community — threaded comments, reactions, follows, mentions, member-side
moderation, staff queue, reports, audit log, bans, role grants, email
digests, pluggable spam/profanity/reputation adapters.

Auth — JWT + Argon2, OAuth (GitHub, Google, extensible), member verify +
password reset, capability-based authz (`can(user, "content.publish")`).

SEO — sitemap + sitemap-index + Atom feed + JSON-LD builders (Article /
DiscussionForumPosting / Person / WebSite).

Operations — pg-boss jobs (multi-node safe), health + readiness probes,
pluggable logger/error-reporter, boot-time safety checks, admin Jobs
surface, full runbook in [`docs/operations.md`](./docs/operations.md).

Migration — [`@nexpress/wp-import`](./packages/wp-import) for WordPress
(WXR XML → Lexical incl. Gutenberg fences, media dedup, taxonomies,
comments, custom post types, audit log, resume marker).

Tooling — `create-nexpress` scaffolder, shadcn-style admin (Radix +
Tailwind v4), theme engine (CSS custom properties), Docker-ready.

---

## Architecture

```
packages/
├── core         server-only domain: pipeline, auth, jobs, media, plugins
├── editor       Lexical (client + SSR renderer split)
├── blocks       block registry + 8 defaults + DnD editor
├── admin        admin UI primitives + views
├── theme        CSS generation from design tokens
├── plugin-sdk   definePlugin() + manifest types
├── next         Next.js integration (createBootstrap, ensureFor, revalidate*)
├── app          single-source impls of admin/site/api routes + lib + scripts +
│                proxy middleware + config helpers (shared between apps/web
│                and every scaffolded site)
├── wp-import    WordPress (WXR) importer
├── xliff        XLIFF i18n export/import
├── cli          create-nexpress scaffolder
├── plugins/*    reference plugins (reading-time, seo-audit, forum, oauth-*)
└── themes/*     reference themes (default, magazine, portfolio, docs)
apps/
└── web          private Next.js reference app
```

Long-form discussion of subsystem boundaries, hooks, the bootstrap
intent enum, the principal model, the rate-limiter, and the v0.1
stability contract lives in [`AGENTS.md`](./AGENTS.md).

---

## Documentation

| Category | Guide |
| --- | --- |
| **Track A — site customisation** | [docs/site-customization.md](./docs/site-customization.md) |
| **Track A — author a theme** | [docs/theme-authoring.md](./docs/theme-authoring.md) |
| **Track A — author a plugin** | [docs/plugin-quickstart.md](./docs/plugin-quickstart.md) |
| **Production deployment** | [docs/deployment.md](./docs/deployment.md) |
| **Operations runbook** | [docs/operations.md](./docs/operations.md) |
| Background jobs | [docs/jobs.md](./docs/jobs.md) |
| Caching strategy | [docs/caching.md](./docs/caching.md) |
| Observability | [docs/observability.md](./docs/observability.md) |
| Multi-site | [docs/multi-site.md](./docs/multi-site.md) |
| i18n | [docs/i18n.md](./docs/i18n.md) |
| Community | [docs/community.md](./docs/community.md) |
| Email | [docs/email.md](./docs/email.md) |
| Scheduled publishing | [docs/scheduled-publishing.md](./docs/scheduled-publishing.md) |
| WordPress import | [docs/wordpress-import-guide.md](./docs/wordpress-import-guide.md) |
| Plugin admin surface | [docs/plugin-admin.md](./docs/plugin-admin.md) |
| Plugin render hooks | [docs/plugin-render.md](./docs/plugin-render.md) |
| Plugin manifest | [docs/plugin-manifest.md](./docs/plugin-manifest.md) |
| Plugin capabilities | [docs/plugin-capabilities.md](./docs/plugin-capabilities.md) |
| API error codes | [docs/api-error-codes.md](./docs/api-error-codes.md) |
| Agent / LLM integration | [docs/agent-integration.md](./docs/agent-integration.md) |
| Architecture (long form) | [AGENTS.md](./AGENTS.md) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Releasing | [docs/releasing.md](./docs/releasing.md) |
| Testing setup | [docs/testing.md](./docs/testing.md) |

Frozen design docs (historical reference, not maintained):
[`docs/design/`](./docs/design/).

Security issues should be reported privately — see
[SECURITY.md](./SECURITY.md).

---

## Tech stack

| Layer     | Technology                                       |
| --------- | ------------------------------------------------ |
| Framework | Next.js 16 (App Router, Turbopack)               |
| Language  | TypeScript (strict, `NodeNext`)                  |
| Database  | PostgreSQL 16 + Drizzle ORM                      |
| Editor    | Lexical                                          |
| UI        | React 19 + Tailwind v4 + Radix UI + @dnd-kit     |
| Auth      | JWT (jose) + Argon2 (`@node-rs/argon2`)          |
| Jobs      | pg-boss                                          |
| Media     | sharp + S3 (`@aws-sdk/client-s3`) or local       |
| Email     | Pluggable (default no-op, SMTP via nodemailer)   |
| Build     | pnpm 10.33+ + Turborepo + tsup                   |
| Deploy    | Docker (Next standalone) / Vercel / Fly.io       |

---

## License

MIT © 2026 Nexpress
