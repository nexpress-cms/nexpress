# @nexpress/app

## 0.3.0

### Patch Changes

- 36187da: Add `/api/newsletter` framework stub.

  Themes ship a footer subscribe form that POSTs `{ email }` to
  `/api/newsletter`. Before this change the route existed in no
  package, so the form's success path always hit a 404 and rendered
  "Newsletter endpoint not configured." — operator UX was "open
  the file and write something" before the form's golden path
  worked at all.

  The new stub:
  - Lives at `@nexpress/app/api/newsletter/route` and is wired into
    `apps/web/src/app/api/newsletter/route.ts` like the other app
    routes.
  - Accepts `POST { email: string }`, validates RFC 5321-ish shape
    - 254-char ceiling, and returns `{ subscribed: true }` on
      success. Bad input surfaces a `VALIDATION_ERROR` 400 with the
      per-field message the form already knows how to render.
  - Does NOT deliver mail or persist anywhere — it only logs the
    address in dev so an operator notices the stub is wired and
    needs to be replaced with a real provider call (Buttondown,
    ConvertKit, Resend, Mailchimp, …). The route's JSDoc carries
    the replacement recipe.

  Production deployments should overwrite the app's route file
  with the operator's actual provider integration; the stub stays
  shipped from `@nexpress/app` for fresh installs and dev.

  Proxy wiring:
  - `/api/newsletter` is added to `CSRF_EXEMPT_PATTERNS` in
    `packages/app/src/proxy/index.ts`. Anonymous visitors have no
    `np-csrf` cookie, so gating the submit on CSRF would 403 every
    fresh visitor — same reason `/api/admin/setup` is exempt.
  - A dedicated rate-limit rule (5 req/min/IP) is the floor against
    subscribe-spam in lieu of the CSRF gate. Operators with their
    own provider may want to tighten or loosen this in their app
    copy of the proxy.

- ab3afa7: Bundled-themes prebake: built-in theme swaps no longer need a migration.

  **Background** — scaffolded sites already ship `themes: [...defaultThemes]`, and `defineConfig` already runs `mergeThemeRequirements` over every entry. The union of every built-in's `requires.collections` therefore lands in the merged schema at boot, and the first `pnpm db:generate && pnpm db:migrate` materialises every column any built-in needs. What was missing was (a) a CI gate that asserts the union is conflict-free, and (b) an admin UI that hides theme-synthesised collections whose owning theme isn't active. Without (b), the docs-only operator sees Magazine's `authors` slug in the sidebar despite never picking Magazine.

  **`@nexpress/core`** — `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>` on collections it synthesises via a theme's `requires.collections.<slug>.createIfAbsent: true`. Collections the operator declared (or that two themes both declare via `createIfAbsent`) carry no origin tag — they're owned by the operator. `NpCollectionConfig.admin._themeOrigin` is a new optional string field; never set it by hand from operator config.

  **`@nexpress/app`** — the protected admin layout reads `_themeOrigin` and filters out collections whose origin theme is not the active one. Operator-declared collections always pass; theme-synthesised collections appear in the sidebar only while their owning theme is active. The collection's database table remains in place across swaps, so re-activating the theme re-surfaces any previously captured rows.

  A CI gate (`apps/web/tests/builtin-themes-union.unit.test.ts`) asserts that the union of every built-in's `requires` produces zero theme-vs-theme field conflicts against the default collections array. Future built-ins that collide with an existing one fail this test before reaching `main`.

  Field-level visibility (e.g. hiding Magazine's `posts.featured` while running Docs) is intentionally NOT filtered today — the column stays on the edit view so any data captured under another theme remains addressable. Promote this to a separate follow-up once the data-preservation UX is settled.

- bb1bd30: Theme-aware first-boot seed + setup-wizard theme picker.

  **Why** — the framework's `seedAll` shipped one set of "Welcome to NexPress" pages + framework-themed posts. For a magazine site that's the wrong visual; for a portfolio site that's the wrong visual; for docs that's very wrong. With the bundled-themes prebake landed, the missing piece is letting each theme ship its own demo content so the first-boot view actually matches what the operator picked.

  **`@nexpress/theme`** — new `NpThemeImpl.seedContent?` slot on the theme contract. Shape: `{ tags?, categories?, pages?, posts?, navigation? }` (see `NpThemeSeedContent`). Each slot is independent — a theme that overrides only `posts` keeps the framework's generic pages and seeds the posts on top. Static data only; themes declare WHAT to seed, not HOW (the framework's seeder owns the `saveDocument` call so access control / hooks / validation always run). Asset URLs in block props bake into the seeded pages exactly as authored.

  **`@nexpress/app`** — `seedAll(actor, theme?)` accepts an optional theme. When `theme.impl.seedContent` is set, each per-slot seeder takes the theme's samples; unset slots fall through to today's hardcoded framework content (same content as v0.1 today). The single-arg form `seedAll(actor)` still works for the existing `seed:content` script. Internal sample types switched to the public `NpThemeSeedPage` / `NpThemeSeedPost` / `NpThemeSeedTerm`.

  **Setup wizard** — `/api/admin/setup` accepts an optional `themeId` in the body. When provided, the handler calls `setActiveThemeId(themeId, …)` inside the same `withCurrentSite` block as `seedAll` so the activation lands atomically with the seed. Unknown ids fail with a `NpValidationError` before the user write, so a stale tab can't silently fall back to the default. The wizard UI renders a text-only picker (name + one-line description) in step 2; the bundled-themes prebake makes the pick non-binding so the description ends with "you can change this from Appearance."

  **`create-nexpress`** — new `--theme <id>` (and `--theme=<id>`) flag plus an interactive picker that runs when neither `--theme` nor `--yes` is set. The chosen id is written to the scaffold's `.env` as `NP_ADMIN_THEME=<id>`; the setup wizard reads that env var and forwards it as the picker's initial selection. The CLI's static option list is hardcoded (mirrors `defaultThemes`) so it doesn't depend on workspace packages that aren't installed yet at scaffold time.

  What this does NOT do — the four built-in themes don't ship `seedContent` data yet. Each theme drops in its own demo content with its respective design refactor; today the operator picks a theme and gets the framework default seed. The plumbing exists end-to-end so theme refactor PRs only have to author the static data.

- f10d5b7: Add `NpThemeSeedContent.documents` — seed arbitrary collections
  beyond pages/posts.

  Themes that bundle their own collections (a magazine theme's
  `authors`, a docs theme's `glossary`, a portfolio's `clients`)
  previously had no way to ship matching demo data. The two
  first-class slots (`pages`, `posts`) covered the common case but
  left every other collection blank after first-boot — operators
  had to hand-author the first row themselves.

  The new slot is keyed by collection slug:

  ```ts
  seedContent: {
    documents: {
      authors: [
        { slug: "ada", title: "Ada Lovelace", data: { bio: "…" } },
      ],
      glossary: [
        { slug: "lexical", title: "Lexical", data: { definition: "…" } },
      ],
    },
  }
  ```

  Each `NpThemeSeedDocument` is `{ slug, title, status?,
publishedAt?, data? }`. The `data` payload is merged onto the
  document; the pipeline's Zod validation strips fields the
  collection doesn't declare, so themes don't have to gate on each
  operator's exact field list.

  Seeder behavior matches the existing pages/posts slots:
  - Idempotent per collection — skipped when the collection has
    any row.
  - Unknown collection slugs (theme references a collection the
    operator hasn't activated) are logged at warn level and
    reported as `unknown: true` in `SeedAllResult.documents[slug]`,
    rather than aborting the wizard.
  - `author: actor.id` is auto-injected for collections that
    declare an `author` field, so themes don't have to know the
    operator's user id.

  The setup wizard's response gains a `seeded.documents` map
  keyed by collection slug. `NpThemeSeedDocument` joins the v0.1
  stable seed-content surface (adding optional fields is
  non-breaking).

  Closes follow-up HIGH #2 from the theme redesign track.

- Updated dependencies [ab3afa7]
- Updated dependencies [9ae3da3]
- Updated dependencies [5449b6b]
- Updated dependencies [23a77a3]
- Updated dependencies [f36c0f2]
- Updated dependencies [bb1bd30]
- Updated dependencies [0c096f1]
- Updated dependencies [5faaede]
- Updated dependencies [44010a8]
- Updated dependencies [68c42cf]
- Updated dependencies [41df9e4]
- Updated dependencies [83d140f]
- Updated dependencies [f10d5b7]
  - @nexpress/core@0.3.0
  - @nexpress/theme-docs@0.3.0
  - @nexpress/theme-magazine@0.3.0
  - @nexpress/editor@0.3.0
  - @nexpress/theme@0.3.0
  - @nexpress/theme-default@0.3.0
  - @nexpress/theme-portfolio@0.3.0
  - @nexpress/next@0.3.0
  - @nexpress/admin@0.3.0
  - @nexpress/auth-pages@0.3.0
  - @nexpress/blocks@0.3.0
  - @nexpress/plugin-sdk@0.3.0
  - @nexpress/plugin-forum@0.3.0
  - @nexpress/plugin-oauth-github@0.3.0
  - @nexpress/plugin-oauth-google@0.3.0
  - @nexpress/plugin-block-callout@0.3.0
  - @nexpress/plugin-block-embed@0.3.0
  - @nexpress/plugin-block-latest-posts@0.3.0
  - @nexpress/plugin-block-newsletter@0.3.0
  - @nexpress/plugin-block-pricing@0.3.0
  - @nexpress/plugin-block-stats@0.3.0
  - @nexpress/plugin-reading-time@0.3.0
  - @nexpress/plugin-seo-audit@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e733d47]
- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/admin@0.2.2
  - @nexpress/theme-magazine@0.2.2
  - @nexpress/theme-portfolio@0.2.2
  - @nexpress/theme-default@0.2.2
  - @nexpress/auth-pages@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/next@0.2.2
  - @nexpress/plugin-sdk@0.2.2
  - @nexpress/plugin-forum@0.2.2
  - @nexpress/plugin-oauth-github@0.2.2
  - @nexpress/plugin-oauth-google@0.2.2
  - @nexpress/theme@0.2.2
  - @nexpress/theme-docs@0.2.2
  - @nexpress/plugin-block-callout@0.2.2
  - @nexpress/plugin-block-embed@0.2.2
  - @nexpress/plugin-block-latest-posts@0.2.2
  - @nexpress/plugin-block-newsletter@0.2.2
  - @nexpress/plugin-block-pricing@0.2.2
  - @nexpress/plugin-block-stats@0.2.2
  - @nexpress/plugin-reading-time@0.2.2
  - @nexpress/plugin-seo-audit@0.2.2
  - @nexpress/editor@0.2.2

## 0.2.1

### Patch Changes

- 3e6505d: Build `scripts/*` and `lib/*` as ESM `.js` artifacts under `dist/` instead of publishing them as raw `.ts` source. `0.2.0` shipped these subpaths as raw `.ts` and the `exports` map pointed at `*.ts` targets behind wildcard patterns — `tsx`'s ESM hook (which scaffolded sites use to run `pnpm setup` / `pnpm dev`) doesn't apply Node export pattern wildcards over `.ts` targets, so every scaffolded site died on `pnpm install` with:

  ```
  ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './scripts/postinstall-notice' is not defined by "exports" in node_modules/@nexpress/app/package.json
  ```

  (0.2.0 was broken-for-everyone — scaffolds couldn't reach `pnpm install` postinstall, never mind `pnpm dev`.)

  Root fix is to stop relying on `tsx`'s loader to transpile our published source. `tsup` now builds every subpath we want consumers to import — `scripts/_load-env`, `scripts/setup-server`, `scripts/doctor`, every `lib/*` — into `dist/scripts/*.js` and `dist/lib/*.js`. The `exports` map points at `dist/...` so Node's native ESM resolver handles the path; tsx, Next.js's bundler, and any other consumer get a plain `.js` file with sibling `.d.ts`. The whole class of "wildcard + .ts target" fragility disappears.

  What stays raw (`./src/*.tsx` via `exports`):
  - `admin/*`, `site/*`, `member/*`, `root/*`, `api/*` — consumed exclusively by Next.js through `transpilePackages`. Next's bundler handles `.tsx` natively, so a second `tsup` build would only duplicate work and risk diverging from Next's expected shape.

  The CI gap that allowed 0.2.0 to ship: `scaffold-smoke` only ran `tsc --noEmit` against a fresh scaffold. `tsc` resolves export wildcards over `.ts` targets fine — the runtime regression was invisible at typecheck time. Tracked separately as a CI follow-up; for now this fix has been verified by packing tarballs and running `pnpm install` + `tsx ./scripts/postinstall-notice.ts` in a scaffolded project, both of which were the explicit failures in 0.2.0.
  - @nexpress/admin@0.2.1
  - @nexpress/auth-pages@0.2.1
  - @nexpress/blocks@0.2.1
  - @nexpress/core@0.2.1
  - @nexpress/editor@0.2.1
  - @nexpress/next@0.2.1
  - @nexpress/plugin-sdk@0.2.1
  - @nexpress/theme@0.2.1
  - @nexpress/theme-default@0.2.1
  - @nexpress/theme-docs@0.2.1
  - @nexpress/theme-magazine@0.2.1
  - @nexpress/theme-portfolio@0.2.1

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
