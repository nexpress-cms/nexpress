# NexPress

NexPress is a self-hosted CMS for Next.js: Admin, typed Postgres content,
themes, and deploy checks in one scaffold.

No black-box backend. The app stays yours.

[Live demo](https://nexpress-hosted-demo.vercel.app) ·
[Get started](#quick-start) ·
[Docs](#docs)

> **Status — pre-1.0 (`v0.3.x`).** Public APIs follow the
> [stability contract](./AGENTS.md#stability-v01). Breaking changes during
> `0.x` ship as minor bumps with searchable changelog entries.

## Why NexPress

- **Own the app.** `create-nexpress` gives you a normal Next.js project, not a
  hosted black box.
- **Content lives in Postgres.** Collections are typed, migrated, searchable,
  and rendered through your app.
- **Admin is included.** Pages, posts, media, users, members, jobs, themes,
  plugins, imports, and settings ship in the scaffold.
- **Themes feel real on first boot.** Built-in themes seed matching demo
  content instead of generic placeholder pages.
- **Deployment is checked before it hurts.** Doctor and deploy-plan scripts
  validate env, storage, jobs, migrations, and host assumptions.

## Quick Start

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm run setup
pnpm dev
```

Site: `http://localhost:3000`
Admin: `http://localhost:3000/admin`

The first Admin visit creates the initial account, site settings, active theme,
and optional demo content.

Before deploy:

```bash
pnpm run deploy:plan -- --target vercel --brief --no-color
pnpm db:migrate
pnpm run ops:preflight -- --target vercel --brief --no-color
pnpm run ops:release -- check --target vercel --json
```

For the fastest hosted path, push the scaffold to GitHub and import it from
[Vercel New Project](https://vercel.com/new?utm_source=nexpress&utm_campaign=oss).
Vercel deployments require S3-compatible media storage.

> Use `pnpm run setup` / `pnpm run doctor`, not `pnpm setup` / `pnpm doctor`.
> pnpm built-ins shadow scripts with those names.

## Built-In Themes

| Theme | Best for | Fresh-site feel |
| --- | --- | --- |
| `@nexpress/theme-default` | Publications, blogs, teams | Writing index, featured essays, About, newsletter |
| `@nexpress/theme-docs` | Product docs, handbooks | Docs landing, sidebar hierarchy, quickstart copy |
| `@nexpress/theme-magazine` | Editorial sites | Masthead, cover story, archive, bylines |
| `@nexpress/theme-portfolio` | Studios, agencies | Work grid, projects, studio page, journal |

Switch themes from Admin → Appearance or configure them in
`src/nexpress.config.ts`.

## Extend

| Surface | Path |
| --- | --- |
| Site config | `src/nexpress.config.ts` |
| Collections | `src/collections/*.ts` |
| Theme authoring | [docs/theme-authoring.md](./docs/theme-authoring.md) |
| Plugin authoring | [docs/plugin-quickstart.md](./docs/plugin-quickstart.md) |
| Deployment | [docs/deployment.md](./docs/deployment.md) |
| Site customization | [docs/site-customization.md](./docs/site-customization.md) |

Scaffolded runtime files are thin wrappers around `@nexpress/app`. You can
unwrap a file when a project needs to own it; otherwise framework updates flow
through package upgrades.

## Monorepo

For framework development:

```bash
git clone https://github.com/nexpress-cms/nexpress.git
cd nexpress
pnpm install
pnpm build
docker compose -f docker/docker-compose.yml up -d
cp .env.example apps/web/.env
pnpm --filter @nexpress/web run setup
pnpm dev
```

Main packages:

```text
packages/core       pipeline, auth, jobs, media, plugins
packages/app        shared Next.js routes, scripts, config helpers
packages/admin      Admin UI
packages/editor     Lexical editor and SSR renderer
packages/blocks     page-builder blocks
packages/theme      theme token CSS generation
packages/cli        create-nexpress
packages/themes/*   built-in themes
packages/plugins/*  reference plugins
apps/web            private reference app
```

## Docs

- [Architecture and agent notes](./AGENTS.md)
- [Contributing](./CONTRIBUTING.md)
- [Testing](./docs/testing.md)
- [Releasing](./docs/releasing.md)
- [Operations](./docs/operations.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [All docs](./docs/README.md)

Security issues should be reported privately. See [SECURITY.md](./SECURITY.md).

## License

MIT © 2026 Nexpress
