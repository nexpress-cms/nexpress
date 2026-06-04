# @nexpress/next

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
