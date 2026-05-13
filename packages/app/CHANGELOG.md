# @nexpress/app

## 0.1.5

### Patch Changes

- fa0b461: Extend the `fixed` versioning group in `.changeset/config.json` to cover every publishable `@nexpress/*` package (29 packages: core, admin, app, auth-pages, blocks, cli, editor, next, oauth-providers, rate-limiter-redis, theme, theme-default/docs/magazine/portfolio, plugin-sdk, all `plugin-*` and `plugin-block-*`, wp-import, xliff). Previously only seven were grouped, which meant new packages joining the family (`@nexpress/app@0.1.1` was the first to surface this) could land on npm at a version that didn't match the scaffold's pinned range (`^0.1.3` against an app at `0.1.1`).

  With fixed-versioning across the full set, every member of the family bumps in lockstep on every release — the SCAFFOLDED_NEXPRESS_RANGE assumption ("everything on the same `0.1.x`") becomes self-enforcing, and new packages joining the group automatically start at the family's current version instead of falling behind.

  Adds a release-wide noise floor (variant-less packages produce empty CHANGELOG entries on bump). The tradeoff is intentional: alignment > minimal version churn at 0.x.
  - @nexpress/admin@0.1.5
  - @nexpress/auth-pages@0.1.5
  - @nexpress/blocks@0.1.5
  - @nexpress/core@0.1.5
  - @nexpress/editor@0.1.5
  - @nexpress/next@0.1.5
  - @nexpress/plugin-sdk@0.1.5
  - @nexpress/theme@0.1.5
  - @nexpress/theme-default@0.1.5
  - @nexpress/theme-docs@0.1.5
  - @nexpress/theme-magazine@0.1.5
  - @nexpress/theme-portfolio@0.1.5

## 0.1.1

### Patch Changes

- f82c8fa: Move 125 API route implementations from `apps/web/src/app/api/**/route.ts` into `@nexpress/app/src/api/**/route.ts`. The apps/web side becomes thin re-export wrappers that preserve Next.js's route-segment-config constraint (`dynamic` / `runtime` / etc. consts stay local; HTTP method handlers re-export). Scaffolded sites that consume `@nexpress/app` inherit the real implementations directly — no duplication.

  Adds `@types/react-dom` to `@nexpress/app` so consumers can typecheck the streaming preview-blocks route through `transpilePackages`. Expands `_consumer-stubs/lib/init-core.ts` to mirror the production `nexpressConfig` shape (`site` is non-optional, `jobs.stuckThreshold` is the per-state object).

- 4cc7f81: Move the root layout (`<html lang>` + RTL handling) and the three special routes (`/feed.xml`, `/sitemap.xml`, `/robots.txt`) from `apps/web/src/app` into `@nexpress/app/src/root/`. apps/web keeps thin re-export wrappers. The layout no longer imports a relative `./globals.css` — consumers own their stylesheet at the wrapper layer, which keeps the framework layout free of consumer-bound paths.

  Adds `./root/layout` and `./root/*` subpath exports to `@nexpress/app`.
