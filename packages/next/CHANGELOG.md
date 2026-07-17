# @nexpress/next

## 0.4.1

### Patch Changes

- @nexpress/blocks@0.4.1
- @nexpress/core@0.4.1
- @nexpress/theme@0.4.1

## 0.4.0

### Minor Changes

- 922c708: Unify collection storage, runtime, generated, Admin, REST, OpenAPI, and
  import/export document shapes behind an exact definition-derived contract.
  Collection reads now hydrate ordered child and hasMany rows, updates preserve
  omitted fields, `_status` is request-only, and malformed persistence or hook
  results fail closed with doctor and live-health diagnostics. Collection
  lifecycle after-hooks now run exactly once with the same hydrated document
  contract as plugin lifecycle hooks.

  Canonical slugs, bounded JSON write values, complete relation inventories, and
  safe unambiguous pagination/locale filters now fail at their earliest runtime
  boundary as part of the same contract.

- fdd684d: Add a definition-aware block content contract that validates registered prop
  schemas and container rules before Admin/app saves, previews, pattern
  registration, and rendering. Plugin doctor now reports invalid pattern content
  while preserving unknown plugin blocks and stale props as warnings. The
  Magazine story items and Portfolio image-grid items now use their actual nested
  array schemas. Docs API-table defaults now match its structured Admin schema.

### Patch Changes

- 8693411: Add a closed revision snapshot and API wire contract across persistence,
  autosave, restore, Admin decoding, OpenAPI, and doctor diagnostics. Revision
  versions remain monotonic after pruning, concurrent autosaves allocate versions
  atomically, and document deletion removes its revision history.
- 3adebdb: Unify staff and member authentication around exact identity, JWT, API wire, credential, runtime configuration, and one-row browser-session contracts. Runtime authentication now recognizes `NP_SECRET` as its only signing-key environment variable and fails closed for malformed JWT, lockout, invitation, reset, verification, or OAuth-state settings. Refresh compare-and-swap rotates access and refresh hashes, logout revokes the pair through either live token's shared session id, password replacement and whole-identity revocation commit atomically, single-use credentials reject concurrent replay, OAuth state cookies share the signed token lifetime, and doctor validates runtime configuration plus persisted auth/session rows.
- fdcbfd3: Unify process bootstrap behind the exact `read`, `plugins`, `worker`, and
  `write` intents. Startup is race-safe, retryable, and fail-closed; terminal
  shutdown drains every owned resource in dependency order. Framework-only raw
  singleton wiring moves from the core root to `@nexpress/core/bootstrap`, while
  apps, workers, standalone scripts, generated code, and scaffolds use the same
  `createBootstrap()` contract.
- 1ff06a7: Unify cache invalidation behind one exact, awaitable runtime contract. App
  writes, collection and scheduled-publish workers, plugin cache APIs, Next path
  and tag invalidation, CDN purge adapters, Admin Health, ops execution, and
  cached theme/plugin fetch options now validate and report the same bounded
  request and result shapes. Bootstrap may own an injected CDN adapter and closes
  its optional lifecycle hook during terminal shutdown.
- 21d4748: Unify logger and error-reporter adapters under one exact runtime contract.
  Validate environment intent, adapter kinds, event/context shapes, async void
  results, child loggers, and shutdown hooks; contain adapter failures and expose
  them through Admin Health, doctor, and production readiness. Custom adapters
  now declare `kind`, scaffolds share one `src/lib/observability.ts` definition
  across web/worker/scripts, and worker shutdown flushes both adapters.
- c10eb69: Complete the remaining plugin definition contracts: validate page templates,
  ICU translations, config schema/version/migrations, and lifecycle callbacks;
  run teardown and clean every source-owned contribution during reload or failed
  setup; expose template/translation inventories and conflicts in plugin doctor;
  remove the never-implemented custom-field registry; and align scaffolds,
  bundled examples, and author documentation.
- 4cef9c8: Unify rate-limit runtime intent, adapter registration, requests, decisions,
  proxy injection, Redis replies, shutdown, startup safety, and doctor diagnostics
  behind one fail-closed contract.

  Custom adapters must now expose a canonical lowercase `kind` and return the
  required positive `retryAfterSeconds` field on every decision.

- a678bb5: Unify search requests, adapter candidates, public results, current-site and
  visibility scope, cache keys, reindex responses, OpenAPI, themes, bootstrap
  lifecycle, and live health behind one exact bounded Core contract. Malformed
  external results and dispatch failures are contained, diagnosed, and fall back
  to the built-in Postgres path before they can reach caches or callers.
- b44257f: Unify page metadata, JSON-LD, sitemap/index entries, Atom entries, and theme
  SEO callback results behind one exact, bounded runtime contract. Collection
  URL resolvers and theme sitemap/feed/robots hooks now fail before malformed
  values reach crawler responses or caches, while Theme and Next consume Core's
  canonical types directly.
- 3eb1af7: Unify local, S3, and custom storage under one exact runtime and object
  contract. Validate configuration, safe keys, metadata, adapter kinds and
  results across bootstrap, media, health, doctor, setup, and ops; add the
  `@nexpress/core/storage` entry, custom bootstrap injection, and adapter
  teardown. Custom adapters now declare `kind`, return exact Web stream, URL,
  boolean, and void results, and may expose `shutdown()`.
- ba9f730: Treat `NP_REPLICAS>1` as a production multi-node signal in boot safety,
  doctor, and admin readiness checks so local storage and in-memory rate-limit
  risks are surfaced consistently before deploy.
- 23c1f69: Unify REST errors behind one bounded client-safe envelope, fixed framework code/status mapping, fail-closed Next response boundary, and reusable OpenAPI error contract.
- cef1583: Unify background job names, built-in and custom payloads, pg-boss rows,
  schedules, worker heartbeats, logs, Admin API responses, ops reporting, and
  doctor diagnostics behind one fail-closed runtime contract.
- c0a7da6: Complete the multi-site runtime contract with persisted request-role projection,
  capability-based site authorization, exact site and membership validation,
  fail-closed doctor diagnostics, and atomic deletion across every site-scoped table
  and collection-owned revision/media-reference row. Server helpers are also
  available from the new `@nexpress/core/sites` domain subpath.
- bedb705: Add one exact navigation tree contract across theme seeds, Admin and API
  writes, backup import/export, OpenAPI, persisted reads, caches, and public
  rendering. Stored and resolved navigation types are now distinct, malformed
  rows fail closed, and the client-safe navigation validators are public.
- 2dce282: Add a complete theme definition contract across module evaluation, config
  resolution, core registration, Next bootstrap, and CLI installation. Theme
  metadata, requirements, settings, routes, templates, tokens, translations,
  blocks, patterns, member/SEO contributions, and seed content now fail early
  with precise locations instead of being filtered or deferred until render.
- 81b3fb5: Validate plugin block definitions and prop schemas during definition and bootstrap, reject same-plugin duplicate types, report malformed and conflicting blocks in plugin doctor, and align the CLI scaffold and bundled block examples with the shared contract.
- f6fa9d1: Validate plugin page route patterns and handlers during definition and boot, fully dispatch raw-path `locale: "none"` routes, report malformed and duplicate routes in plugin doctor, and add a typed public page-route scaffold.
- 5522c32: Validate plugin page-builder pattern metadata, recursive block trees, block
  references, source assignment, duplicate ids, and cross-plugin ownership across
  the SDK, bootstrap, shared registry, and plugin doctor; derive pattern inventory
  metadata and align the block scaffold plus bundled callout example.
- Updated dependencies [bae7088]
- Updated dependencies [257e70f]
- Updated dependencies [7d31c88]
- Updated dependencies [8693411]
- Updated dependencies [3adebdb]
- Updated dependencies [fdcbfd3]
- Updated dependencies [1ff06a7]
- Updated dependencies [922c708]
- Updated dependencies [ab83768]
- Updated dependencies [080fcbf]
- Updated dependencies [257b120]
- Updated dependencies [773bd1a]
- Updated dependencies [21d4748]
- Updated dependencies [c10eb69]
- Updated dependencies [4cef9c8]
- Updated dependencies [a678bb5]
- Updated dependencies [b44257f]
- Updated dependencies [3eb1af7]
- Updated dependencies [27a4f0e]
- Updated dependencies [9eea115]
- Updated dependencies [2e35374]
- Updated dependencies [f3dee13]
- Updated dependencies [ba9f730]
- Updated dependencies [e58c4c8]
- Updated dependencies [f7ee76e]
- Updated dependencies [23c1f69]
- Updated dependencies [fdd684d]
- Updated dependencies [f8ef45e]
- Updated dependencies [cef1583]
- Updated dependencies [3396b1c]
- Updated dependencies [c0a7da6]
- Updated dependencies [bedb705]
- Updated dependencies [91867cc]
- Updated dependencies [3d45e43]
- Updated dependencies [2dce282]
- Updated dependencies [75e6c34]
- Updated dependencies [e0a2092]
- Updated dependencies [8cb026a]
- Updated dependencies [81b3fb5]
- Updated dependencies [f6fa9d1]
- Updated dependencies [5522c32]
- Updated dependencies [0944d13]
- Updated dependencies [ccad4ed]
- Updated dependencies [763ce4a]
  - @nexpress/blocks@0.4.0
  - @nexpress/core@0.4.0
  - @nexpress/theme@0.4.0

## 0.3.26

### Patch Changes

- Updated dependencies [64c6c7e]
- Updated dependencies [11e3007]
- Updated dependencies [61d3c2e]
- Updated dependencies [1b3fa11]
- Updated dependencies [e81ebaa]
- Updated dependencies [192270e]
  - @nexpress/core@0.3.26
  - @nexpress/blocks@0.3.26
  - @nexpress/theme@0.3.26

## 0.3.25

### Patch Changes

- a9b2a81: Tighten public cache revalidation: scheduled-publish triggers now invalidate
  collection caches immediately, collection writes emit `nx:collection:<slug>` for
  cached theme/plugin routes, and the remote admin ops action allowlist includes a
  dry-run/approval-gated `cache.revalidate` action.
- Updated dependencies [d48a1c8]
- Updated dependencies [2b72360]
- Updated dependencies [a96907c]
- Updated dependencies [2c95312]
  - @nexpress/core@0.3.25
  - @nexpress/blocks@0.3.25
  - @nexpress/theme@0.3.25

## 0.3.24

### Patch Changes

- b8cce91: Add a CDN purge bridge so hosts can forward collection, theme, site, navigation, setup, and plugin config invalidation hints to a downstream CDN.
  - @nexpress/blocks@0.3.24
  - @nexpress/core@0.3.24
  - @nexpress/theme@0.3.24

## 0.3.23

### Patch Changes

- @nexpress/blocks@0.3.23
- @nexpress/core@0.3.23
- @nexpress/theme@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies [7a28472]
- Updated dependencies [31f1868]
  - @nexpress/core@0.3.22
  - @nexpress/blocks@0.3.22
  - @nexpress/theme@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies [edfc9ae]
- Updated dependencies [b5b9074]
  - @nexpress/core@0.3.21
  - @nexpress/blocks@0.3.21
  - @nexpress/theme@0.3.21

## 0.3.20

### Patch Changes

- @nexpress/blocks@0.3.20
- @nexpress/core@0.3.20
- @nexpress/theme@0.3.20

## 0.3.19

### Patch Changes

- @nexpress/blocks@0.3.19
- @nexpress/core@0.3.19
- @nexpress/theme@0.3.19

## 0.3.18

### Patch Changes

- @nexpress/blocks@0.3.18
- @nexpress/core@0.3.18
- @nexpress/theme@0.3.18

## 0.3.17

### Patch Changes

- Updated dependencies [6d55e54]
  - @nexpress/blocks@0.3.17
  - @nexpress/theme@0.3.17
  - @nexpress/core@0.3.17

## 0.3.16

### Patch Changes

- @nexpress/blocks@0.3.16
- @nexpress/core@0.3.16
- @nexpress/theme@0.3.16

## 0.3.15

### Patch Changes

- Updated dependencies [da32271]
  - @nexpress/theme@0.3.15
  - @nexpress/blocks@0.3.15
  - @nexpress/core@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/blocks@0.3.14
  - @nexpress/theme@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/blocks@0.3.13
- @nexpress/core@0.3.13
- @nexpress/theme@0.3.13

## 0.3.12

### Patch Changes

- @nexpress/blocks@0.3.12
- @nexpress/theme@0.3.12
- @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/blocks@0.3.11
- @nexpress/core@0.3.11
- @nexpress/theme@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/theme@0.3.10
  - @nexpress/blocks@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/blocks@0.3.9
- @nexpress/core@0.3.9
- @nexpress/theme@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/blocks@0.3.8
  - @nexpress/theme@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/blocks@0.3.7
- @nexpress/core@0.3.7
- @nexpress/theme@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/blocks@0.3.6
- @nexpress/core@0.3.6
- @nexpress/theme@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/blocks@0.3.5
- @nexpress/core@0.3.5
- @nexpress/theme@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/blocks@0.3.4
  - @nexpress/theme@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/blocks@0.3.3
  - @nexpress/theme@0.3.3

## 0.3.2

### Patch Changes

- ad4fcba: Extract the magazine + portfolio "list front" fetch into a shared `fetchFrontListPosts({ kind?, limit? })` helper on `@nexpress/next` (server-side helpers — `@nexpress/theme`'s ambient `@nexpress/core` declaration deliberately excludes `findDocuments`). Both themes now scope their home-page fetch by kind (`"article"` for magazine, `"project"` for portfolio), so multi-theme installs no longer surface cross-kind posts in the front layout. Theme behavior is unchanged on single-active-theme installs (today's common case).
- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/blocks@0.3.2
  - @nexpress/theme@0.3.2

## 0.3.1

### Patch Changes

- 712c11c: fix(core, admin, themes): serializable condition predicates — fixes broken client-side field hiding (9/14)

  ## The bug

  PR 1 (#756) wired `admin.condition` in the admin editor's
  `passesCondition` helper, but `packages/next/src/client-safe.ts`
  already stripped `admin.condition` from the collection config
  before it reached the client component (Next.js can't serialize
  functions across the RSC boundary). The browser never saw the
  condition function, so the kind-based field hiding **never
  worked client-side** — every operator editing any post saw
  every field regardless of kind.

  Server-side validation (PR 4 #759) was unaffected because the
  pipeline uses the original (un-stripped) config.

  ## Fix

  New `NpFieldConditionExpr` discriminated-union type — a
  serializable JSON predicate that survives RSC serialization:

  ```ts
  condition: { when: "kind", equals: "doc" }
  condition: { when: "kind", notEquals: "doc" }
  condition: { when: "kind", in: ["doc", "page"] }
  condition: { when: "kind", notIn: ["doc"] }
  condition: { when: "wpOriginalAuthor", exists: true }
  condition: { all: [...] }                              // AND
  condition: { any: [...] }                              // OR
  ```

  `evaluateFieldCondition(condition, data)` (exported from
  `@nexpress/core`) handles both the function form (server-only)
  and the expression form (works both env), so the admin client +
  server pipeline run the same evaluator against the same data.

  `admin.condition` type widens to
  `NpFieldCondition | NpFieldConditionExpr` — both accepted, but
  **the expression form is required for client-side hiding to
  work**. Function-form conditions still run server-side (pipeline
  validation drops `required` for hidden fields, sitemap walks
  honor them) but are silently stripped client-side.

  `toClientCollectionConfig` now strips only function-form
  conditions; expression-form passes through verbatim.

  ## Migration of in-tree conditions

  All built-in / theme conditions migrate from function form:
  - `posts.parent` / `posts.order`: `{ when: "kind", equals: "doc" }`
  - `posts.wpOriginalAuthor`: `{ when: "wpOriginalAuthor", exists: true }`
  - `theme-magazine.featured`: `{ when: "kind", notEquals: "doc" }`
  - `theme-portfolio.*` (9 fields): `{ when: "kind", notEquals: "doc" }`
  - `theme-docs.lede` / `stableSince`: `{ when: "kind", equals: "doc" }`

  ## Edge handling
  - **Function condition that throws** → fails open (field visible).
  - **Malformed expression** (unknown shape) → fails open.
  - **`exists: true`** → false for `undefined`, `null`, `""`, `[]`.
  - **`all` / `any`** compose nested expressions for AND / OR logic.

  ## Tests

  `validation.test.ts` adds 9 cases covering function form, every
  expression operator, malformed shape, and `collectHiddenFieldNames`
  recursing through expression conditions. Core 452 → 461.

  ## What this unlocks

  The kind-based hiding the entire editor sequence (#756-#762) was
  designed around now actually works in the browser. Operators
  editing `kind="article"` posts won't see docs / portfolio
  fields; operators editing `kind="doc"` won't see magazine /
  portfolio fields.

- d76a0c9: fix(core, next, app): active-theme gate for theme-contributed fields in the admin editor

  Magazine-active sites surfaced Portfolio's sidebar group cards on
  the post editor — the bundled-themes prebake merges every built-in
  theme's `requires.collections.<slug>.fields` into the resolved
  config, but only collections / kinds / blocks / patterns were
  gated by the active theme. Theme-contributed FIELDS slipped
  through, so an operator on Magazine saw "Portfolio" sidebar
  chrome anyway.
  - `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>`
    on every theme-contributed field (same convention as the
    collection-level and per-kind tags). Operator-declared fields
    carry no origin; they always pass the gate.
  - `toClientCollectionConfig(config, activeThemeId)` takes a new
    optional argument and filters out fields whose `_themeOrigin`
    doesn't match. Recurses into `row` / `collapsible` containers;
    drops empty containers after gating.
  - The admin's edit + create pages resolve the active theme via
    `getCachedActiveTheme()` and pass the id through.

  Bump kind: patch on all three. The `_themeOrigin` field on
  `NpFieldBase.admin` is internal-by-convention (never set from
  operator config); the optional arg on `toClientCollectionConfig`
  is additive.

  Tests:
  - `merge-requirements.test.ts` — new case asserts `_themeOrigin`
    lands on every theme-contributed field across two themes.
  - `client-safe.test.ts` — new suite covering the gate, container
    recursion, empty-container drop, and operator-field pass-through.

- Updated dependencies [07c763b]
- Updated dependencies [4067401]
- Updated dependencies [3de8716]
- Updated dependencies [1eb6255]
- Updated dependencies [712c11c]
- Updated dependencies [d76a0c9]
- Updated dependencies [d76a0c9]
- Updated dependencies [4d38283]
- Updated dependencies [88bd29b]
- Updated dependencies [48ce0d1]
- Updated dependencies [6f46b5a]
- Updated dependencies [17c90d6]
  - @nexpress/core@0.3.1
  - @nexpress/theme@0.3.1
  - @nexpress/blocks@0.3.1

## 0.3.0

### Patch Changes

- 41df9e4: Theme polish bundle:
  - **`@nexpress/next`** ships a new `getCachedSite()` (+
    `siteCacheTag`) so themes can read the operator's site name
    from the `np_sites` row without each one wiring its own DB
    query. Same `unstable_cache` pattern as the other cached
    helpers; tag is `np:site:<siteId>`.
  - **`@nexpress/theme-default`** and **`@nexpress/theme-docs`**
    now read the site name from `getCachedSite()` for the
    masthead logo, footer brand, and footer copyright. Operators
    who rename their site in the Setup wizard or in admin no
    longer see "NexPress" baked into the chrome. Empty / missing
    rows fall back to the literal `"NexPress"` so a degraded DB
    doesn't leave the header blank.
  - **`@nexpress/theme-magazine`** adds optional
    `leadIssueNumber` to its settings schema. When unset, the
    cover-story figure falls back to an ISO-style week-of-year so
    a fresh install ships with a sensibly rotating counter
    (previously hardcoded to `47`).
  - **`@nexpress/theme-portfolio`** restores typecheck on `main`:
    - `socialLinks` added to `portfolioSettingsSchema` (the
      template was rendering it but the schema didn't declare it
      — a regression from #736's self-review).
    - `publishedAt` added to `PortfolioProjectDoc` so the year
      fallback in the project-index template compiles.
    - Removes `gridColumns` / `cardAspect` / `galleryGutter` /
      `hoverStyle` from settings + shell (orphaned by the #736
      redesign — the redesigned card grid uses hardcoded
      per-span `aspect-ratio` and dropped the per-card hover-
      variant data attribute). The auto-form drops these
      sections automatically.

  The portfolio settings drop is the only intentionally-breaking
  piece here. Operators who had values saved against
  `gridColumns` / `cardAspect` / `galleryGutter` / `hoverStyle`
  will see them silently ignored on the next save; the strings
  weren't doing anything since #736 anyway.

- Updated dependencies [ab3afa7]
- Updated dependencies [bb1bd30]
- Updated dependencies [f10d5b7]
  - @nexpress/core@0.3.0
  - @nexpress/theme@0.3.0
  - @nexpress/blocks@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/theme@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/core@0.2.1
- @nexpress/theme@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/theme@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/core@0.1.6
- @nexpress/theme@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/core@0.1.5
- @nexpress/theme@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/blocks@0.1.3
  - @nexpress/theme@0.1.3

## 0.1.2

### Patch Changes

- 7d87406: Restore `nexpress-cms/nexpress` in `@nexpress/next`'s `package.json` `homepage` / `repository.url` / `bugs.url`. The dependabot PR #655 (next 15 → 16 bump) was opened before the org rename PR (#647) and merged after; squash-merging the stale branch silently reset these three fields back to `hahabsw/nexpress`. Sigstore provenance verification rejected the publish with E422 because the URL didn't match the workflow's source repo.
  - @nexpress/core@0.1.2
  - @nexpress/blocks@0.1.2
  - @nexpress/theme@0.1.2

## 0.1.1

### Patch Changes

- e062ed7: **0.1.1 — post-launch cleanup + first-time UX.**

  Bundles every change since the v0.1.0 first publish into one patch
  release. The npm registry stays on the 0.1.x track; 0.2.0 was
  attempted (and the version-PR landed locally) but the CI publish
  failed end-to-end due to npm 10 not supporting Trusted Publishing
  (npm 11.5.1+ required) — fixed in the release workflow, but the
  0.2.0 bump itself was premature for the size of changes shipped.

  ### `@nexpress/core`
  - `getPluginConfig` read/write asymmetry fixed (#664). `setPlugin`
    writes to `np_settings` for any pluginId; `getPluginConfig` now
    reads it back regardless of whether the plugin is registered.

  ### `@nexpress/admin`
  - Empty-state CTA on `/admin/collections/<slug>` (#666). Truly-empty
    collections render a "Create your first \<singular>" card instead
    of the generic "No documents found" line.
  - Dashboard welcome card → 5-step setup checklist (#666). Tracks
    site name set / first post published / theme chosen / production
    domain set.
  - Topbar user-menu trigger now has `aria-label="Open user menu"`
    (#664) so the e2e selector matches a stable accessible name.

  ### `@nexpress/theme-magazine`, `@nexpress/theme-portfolio`
  - `padding-inline-start` instead of `padding-left` on mobile sub-nav
    lists (#664). Makes RTL locales render with the correct leading
    edge.

  ### Internal (no operator-facing change)
  - Drizzle migration history squashed to a single `0000_init.sql`
    (#646). New installs run one migration to reach the v0.1 schema.
  - Repository transferred from `hahabsw/nexpress` to
    `nexpress-cms/nexpress` (#647). `repository.url` metadata updated
    across every published package.
  - Release workflow: `publish: pnpm run release` restored + npm 11+
    installed before publish so Trusted Publishing actually
    authenticates (#670). The v0.2.0 attempt's E404 was npm 10 not
    supporting the OIDC TP token, not a TP-config mistake.
  - CI noise reduction: docs / changesets / community-file paths
    no longer trigger main-push CI; E2E gated to PRs only.

- Updated dependencies [e062ed7]
  - @nexpress/core@0.1.1
  - @nexpress/blocks@0.1.1
  - @nexpress/theme@0.1.1

## 0.1.0

### Minor Changes

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.

### Patch Changes

- 952483c: Phase 22.2 — surface known-unsafe configurations at boot via the
  structured logger.

  `@nexpress/core` adds `verifyStartupSafety(input)` (re-exported from
  the package root) — a pure function that takes the resolved storage
  adapter id, the auth secret, `NODE_ENV`, and the `NP_MULTI_NODE` flag,
  and emits warnings through `getScopedLogger({ subsystem: "boot" })`
  for the two operationally-bitten cases:
  - `LocalStorageAdapter` running with `NP_MULTI_NODE=true` (or `=1`),
    which silently drops uploads as nodes diverge on the local
    `./uploads` dir.
  - `NODE_ENV=production` with `NP_SECRET` unset or shorter than 32
    characters, which lets sessions be forged with a weak key.

  `@nexpress/next` calls the helper once per process from
  `createBootstrap()`'s `ensureServices`, so any app using the standard
  bootstrap (apps/web, scaffolded sites) picks the warnings up
  automatically. Operators with `setLogger(...)` already in place get
  the warnings in their structured-log pipeline; others see them on
  stdout via the default `consoleLogger`.

  Returns the list of emitted warning ids so tests can assert on them;
  nothing in production reads the return value.

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
