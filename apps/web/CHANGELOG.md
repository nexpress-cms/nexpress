# @nexpress/web

## 0.0.6

### Patch Changes

- Updated dependencies [fa0b461]
  - @nexpress/app@0.1.5
  - @nexpress/admin@0.1.5
  - @nexpress/auth-pages@0.1.5
  - @nexpress/blocks@0.1.5
  - @nexpress/core@0.1.5
  - @nexpress/editor@0.1.5
  - @nexpress/next@0.1.5
  - @nexpress/plugin-block-callout@0.1.5
  - @nexpress/plugin-block-embed@0.1.5
  - @nexpress/plugin-block-latest-posts@0.1.5
  - @nexpress/plugin-block-newsletter@0.1.5
  - @nexpress/plugin-block-pricing@0.1.5
  - @nexpress/plugin-block-stats@0.1.5
  - @nexpress/plugin-forum@0.1.5
  - @nexpress/plugin-oauth-github@0.1.5
  - @nexpress/plugin-oauth-google@0.1.5
  - @nexpress/plugin-reading-time@0.1.5
  - @nexpress/plugin-sdk@0.1.5
  - @nexpress/plugin-seo-audit@0.1.5
  - @nexpress/theme@0.1.5
  - @nexpress/theme-default@0.1.5
  - @nexpress/theme-docs@0.1.5
  - @nexpress/theme-magazine@0.1.5
  - @nexpress/theme-portfolio@0.1.5
  - @nexpress/wp-import@0.1.5
  - @nexpress/xliff@0.1.5

## 0.0.5

### Patch Changes

- f82c8fa: Move 125 API route implementations from `apps/web/src/app/api/**/route.ts` into `@nexpress/app/src/api/**/route.ts`. The apps/web side becomes thin re-export wrappers that preserve Next.js's route-segment-config constraint (`dynamic` / `runtime` / etc. consts stay local; HTTP method handlers re-export). Scaffolded sites that consume `@nexpress/app` inherit the real implementations directly — no duplication.

  Adds `@types/react-dom` to `@nexpress/app` so consumers can typecheck the streaming preview-blocks route through `transpilePackages`. Expands `_consumer-stubs/lib/init-core.ts` to mirror the production `nexpressConfig` shape (`site` is non-optional, `jobs.stuckThreshold` is the per-state object).

- 4cc7f81: Move the root layout (`<html lang>` + RTL handling) and the three special routes (`/feed.xml`, `/sitemap.xml`, `/robots.txt`) from `apps/web/src/app` into `@nexpress/app/src/root/`. apps/web keeps thin re-export wrappers. The layout no longer imports a relative `./globals.css` — consumers own their stylesheet at the wrapper layer, which keeps the framework layout free of consumer-bound paths.

  Adds `./root/layout` and `./root/*` subpath exports to `@nexpress/app`.

- Updated dependencies [f82c8fa]
- Updated dependencies [4cc7f81]
  - @nexpress/app@0.1.1

## 0.0.4

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/admin@0.1.3
  - @nexpress/auth-pages@0.1.3
  - @nexpress/blocks@0.1.3
  - @nexpress/next@0.1.3
  - @nexpress/plugin-sdk@0.1.3
  - @nexpress/plugin-forum@0.1.3
  - @nexpress/plugin-oauth-github@0.1.3
  - @nexpress/plugin-oauth-google@0.1.3
  - @nexpress/theme@0.1.3
  - @nexpress/theme-default@0.1.3
  - @nexpress/theme-docs@0.1.3
  - @nexpress/theme-magazine@0.1.3
  - @nexpress/theme-portfolio@0.1.3
  - @nexpress/wp-import@0.1.3
  - @nexpress/xliff@0.1.3
  - @nexpress/plugin-block-callout@0.1.4
  - @nexpress/plugin-block-embed@0.1.4
  - @nexpress/plugin-block-latest-posts@0.1.4
  - @nexpress/plugin-block-newsletter@0.1.4
  - @nexpress/plugin-block-pricing@0.1.4
  - @nexpress/plugin-block-stats@0.1.4
  - @nexpress/plugin-reading-time@0.1.3
  - @nexpress/plugin-seo-audit@0.1.3
  - @nexpress/editor@0.1.3

## 0.0.3

### Patch Changes

- Updated dependencies [7d87406]
  - @nexpress/next@0.1.2
  - @nexpress/auth-pages@0.1.2
  - @nexpress/plugin-forum@0.1.2
  - @nexpress/theme-default@0.1.2
  - @nexpress/theme-docs@0.1.2
  - @nexpress/theme-magazine@0.1.2
  - @nexpress/theme-portfolio@0.1.2
  - @nexpress/core@0.1.2
  - @nexpress/admin@0.1.2
  - @nexpress/blocks@0.1.2
  - @nexpress/editor@0.1.2
  - @nexpress/theme@0.1.2
  - @nexpress/plugin-sdk@0.1.2
  - @nexpress/plugin-oauth-github@0.1.2
  - @nexpress/plugin-oauth-google@0.1.2
  - @nexpress/wp-import@0.1.2
  - @nexpress/xliff@0.1.2
  - @nexpress/plugin-block-callout@0.1.3
  - @nexpress/plugin-block-embed@0.1.3
  - @nexpress/plugin-block-latest-posts@0.1.3
  - @nexpress/plugin-block-newsletter@0.1.3
  - @nexpress/plugin-block-pricing@0.1.3
  - @nexpress/plugin-block-stats@0.1.3
  - @nexpress/plugin-reading-time@0.1.2
  - @nexpress/plugin-seo-audit@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [6029918]
  - @nexpress/plugin-block-callout@0.1.2
  - @nexpress/plugin-block-embed@0.1.2
  - @nexpress/plugin-block-latest-posts@0.1.2
  - @nexpress/plugin-block-newsletter@0.1.2
  - @nexpress/plugin-block-pricing@0.1.2
  - @nexpress/plugin-block-stats@0.1.2

## 0.0.1

### Patch Changes

- Updated dependencies [e062ed7]
  - @nexpress/core@0.1.1
  - @nexpress/admin@0.1.1
  - @nexpress/blocks@0.1.1
  - @nexpress/editor@0.1.1
  - @nexpress/next@0.1.1
  - @nexpress/plugin-sdk@0.1.1
  - @nexpress/theme@0.1.1
  - @nexpress/theme-default@0.1.1
  - @nexpress/theme-docs@0.1.1
  - @nexpress/theme-magazine@0.1.1
  - @nexpress/theme-portfolio@0.1.1
  - @nexpress/auth-pages@0.1.1
  - @nexpress/plugin-block-callout@0.1.1
  - @nexpress/plugin-block-embed@0.1.1
  - @nexpress/plugin-block-latest-posts@0.1.1
  - @nexpress/plugin-block-newsletter@0.1.1
  - @nexpress/plugin-block-pricing@0.1.1
  - @nexpress/plugin-block-stats@0.1.1
  - @nexpress/plugin-forum@0.1.1
  - @nexpress/plugin-oauth-github@0.1.1
  - @nexpress/plugin-oauth-google@0.1.1
  - @nexpress/plugin-reading-time@0.1.1
  - @nexpress/plugin-seo-audit@0.1.1
  - @nexpress/wp-import@0.1.1
  - @nexpress/xliff@0.1.1
