# @nexpress/app

## 0.2.0

### Minor Changes

- d536c4c: Single source of truth between `apps/web` and the `create-nexpress` scaffold. Every runtime file the two used to ship in parallel — scripts, collections, configs, lib, proxy middleware, framework CSS, i18n config — now lives once in `@nexpress/app`, and both sides import thin wrappers. Editing the framework no longer requires touching the scaffold; drift becomes structurally impossible.

  **Files now centralised in `@nexpress/app`**:
  - `@nexpress/app/scripts/*` — 9 setup/dev/seed/migrate/worker/doctor entries (site-dep variants take their site config as args via wrapper).
  - `@nexpress/app/collections/*` — built-in posts/pages/categories/tags definitions.
  - `@nexpress/app/config/*` — `createNextConfig`, `createDrizzleConfig`, `createPostcssConfig` helpers + `tsconfig.base.json`.
  - `@nexpress/app/config-defaults` — `defaultCollections`, `defaultThemes`, `defaultI18n`, `storageFromEnv()`.
  - `@nexpress/app/lib/*` — 19 framework lib modules (init-core, system-health, seed-content, dashboard-stats, manifest, custom-routes, auth-routes, token-ttl, site-authz, etc.). Only `bootstrap.ts` stays site-bound (5-line `createBootstrap(config)` shim) since it has to wire the consumer's `nexpress.config` and generated schema.
  - `@nexpress/app/proxy` — Next 16 middleware (CSRF, rate-limit, security headers, i18n routing). 308-line body; sites re-export `proxy` + literal `config`.
  - `@nexpress/app/i18n-config` — locale list + `isLocale` guard.
  - `@nexpress/app/styles/globals.css` — Tailwind `@layer` bodies, framework tokens, `@source inline()` rules for AuthCard. Sites `@import` this and only add their own `@source` paths.

  **Scaffold output is now scaffolding-only.** Audited a fresh `node packages/cli/dist/index.js np-x` — every file >15 lines is either a codegen stub (`documents.ts`), the site-bound bootstrap shim, or genuinely site-specific (README/package.json/nexpress.config.ts/docker-compose.yml). Scripts/configs/collections/lib/proxy/i18n.config are all ≤ 11 line wrappers; the substantive `globals.css` is now 9 lines (1 `@import "tailwindcss"` + 1 `@import "@nexpress/app/styles/globals.css"` + 4 site `@source` lines + comments).

  **Deleted from the scaffold template directory** (no longer needed):
  - `packages/cli/templates/scripts/` (9 files)
  - `packages/cli/templates/collections/` (4 files)
  - `packages/cli/templates/config/{drizzle,next,next-env,postcss,tsconfig}.{ts,mjs,json,d.ts}` (5 files; kept `gitignore` + `vercel.json`)
  - `packages/cli/templates/snapshot/src/lib/*` substance — now wrapper mirror via sync-snapshot

  **Net diff**: 271 files changed, +833 / −12,456. Lib + proxy + globals.css alone account for ~3700 lines of duplication eliminated.

  Operators who want to customise a built-in (collection, script, config helper, lib module) unwrap the wrapper in their scaffolded site — the framework keeps shipping the canonical version; the site diverges from that point on.

### Patch Changes

- @nexpress/admin@0.2.0
- @nexpress/auth-pages@0.2.0
- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/editor@0.2.0
- @nexpress/next@0.2.0
- @nexpress/plugin-sdk@0.2.0
- @nexpress/theme@0.2.0
- @nexpress/theme-default@0.2.0
- @nexpress/theme-docs@0.2.0
- @nexpress/theme-magazine@0.2.0
- @nexpress/theme-portfolio@0.2.0

## 0.1.6

### Patch Changes

- 6fae726: Fix the "Setup already completed" 409 loop on the first-boot Admin Setup wizard. The route's chain — admin `INSERT` → `updateSite` → `seedAll` → token sign — was not wrapped in a transaction. If `updateSite` or `seedAll` threw (e.g. validation or seed-time error), the admin row was already committed and every retry hit `adminCount > 0` and returned 409 with the umbrella "Setup already completed" message. Server log showed the diagnostic shape: `POST /api/admin/setup 400 (309ms)` → `POST /api/admin/setup 409 (11ms)` — the 400 came from a post-INSERT throw, the 409s from the partial commit.

  Two changes:
  - **Best-effort `updateSite` + `seedAll`** in `route.ts`. Both are now individually try/caught; the admin row stays committed (so the wizard finishes) and the failures surface as `warnings[]` on the success response. Operator can fix data afterwards from Admin → Settings / Collections.
  - **`NpValidationError.fields[]` surfaced in `setup-client.tsx`**. The client previously showed only the umbrella `error.message` ("Invalid input") even though the response carries the actual offending fields. Reads like `Invalid input (password: Password must be at least 12 characters)` now instead of a screen that says nothing.

- 6fae726: Three more first-boot regressions surfaced during PR #717 verification:
  1. **`/admin` → 500 with `JWSSignatureVerificationFailed`** when a stale `np-session` cookie (signed by a previous project's `NP_SECRET`) is still in the browser. The protected admin layout called `verifyTokenFull(...)` without a try/catch, so the JWS error bubbled all the way to the page response. Operators trying to recover from a re-scaffold against the same `localhost:3000` had no path back to `/admin/setup`. Wrap the verify in try/catch and treat any throw as "no valid session" — the existing branch then routes the visitor to `/admin/setup` (no admin yet) or `/admin/login`.
  2. **Built-in themes not surfacing in admin → Appearance.** PR #717 added `@nexpress/theme-default / -docs / -magazine / -portfolio` as scaffold deps but `nexpress.config.ts` had no `themes:` array, so the registry stayed empty even though the packs were installed. Mirrors `apps/web/src/nexpress.config.ts` — emit the four imports + `themes: [...]` from `nexpressConfigTemplate`.
  3. **Silent seed failures.** `seedAll` was best-effort wrapped in PR #717, but the warning only landed in the HTTP response — the operator typically never sees it (the wizard's success path immediately routes to `/admin`). Log the full thrown stack on the server console as well so a missing FK / failed collection-hook validation is visible in the dev terminal where the operator is already looking. Same for `updateSite`.

- 6fae726: Two more first-boot regressions surfaced when verifying the admin setup wizard end-to-end on a fresh scaffold:
  1. **`Site "default" not found` 400 on admin setup.** `np_sites` is created by migrations but the default row isn't seeded — `ensureDefaultSite()` exists in `@nexpress/core` but nothing in bootstrap actually calls it. The wizard's `updateSite(NP_DEFAULT_SITE_ID, …)` therefore threw on first call. Added an explicit `await ensureDefaultSite()` inside the setup route before the admin INSERT. (Wiring it into `ensureFor` more broadly is the cleaner long-term fix and stays in the queue.)
  2. **Built-in theme packs missing from scaffolds.** Scaffold `package.json` only carried `@nexpress/theme` (the engine), not `@nexpress/theme-default / -docs / -magazine / -portfolio`. Result: admin's Appearance → Themes was empty, and there were no theme assets to register at boot. Added all four as direct deps in `getProjectFiles`. They join the fixed-versioning group automatically (since they're `@nexpress/*` and on npm at 0.1.5).
  - @nexpress/admin@0.1.6
  - @nexpress/auth-pages@0.1.6
  - @nexpress/blocks@0.1.6
  - @nexpress/core@0.1.6
  - @nexpress/editor@0.1.6
  - @nexpress/next@0.1.6
  - @nexpress/plugin-sdk@0.1.6
  - @nexpress/theme@0.1.6
  - @nexpress/theme-default@0.1.6
  - @nexpress/theme-docs@0.1.6
  - @nexpress/theme-magazine@0.1.6
  - @nexpress/theme-portfolio@0.1.6

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
