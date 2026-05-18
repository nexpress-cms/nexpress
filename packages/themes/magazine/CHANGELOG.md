# @nexpress/theme-magazine

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/blocks@0.3.3
  - @nexpress/next@0.3.3
  - @nexpress/theme@0.3.3
  - @nexpress/editor@0.3.3

## 0.3.2

### Patch Changes

- ad4fcba: Extract the magazine + portfolio "list front" fetch into a shared `fetchFrontListPosts({ kind?, limit? })` helper on `@nexpress/next` (server-side helpers — `@nexpress/theme`'s ambient `@nexpress/core` declaration deliberately excludes `findDocuments`). Both themes now scope their home-page fetch by kind (`"article"` for magazine, `"project"` for portfolio), so multi-theme installs no longer surface cross-kind posts in the front layout. Theme behavior is unchanged on single-active-theme installs (today's common case).
- 4d6ebeb: Add CSS for the two visible-bug surfaces flagged when the `className ↔ CSS coverage` test (#801) gate landed:
  - **Magazine `magazine.hero-feature` page-builder block** — the registered hero block (carousel + grid layouts) had no CSS, so operators who added it from the page builder saw unstyled markup. Adds full styling for the header, CTA, carousel track (with scroll-snap), grid tiles (responsive auto-fit), and card category labels — matching magazine's editorial serif palette.
  - **Portfolio `/work/:slug` project-detail template** — public-facing project detail rendered with no CSS. Adds hero image (16:9 cover), display-serif title + body excerpt, optional client/role/year meta `<dl>`, and a max-width content body with full-bleed image override.

  Lint baseline trimmed by 17 entries (11 magazine + 6 portfolio). The gate continues to fail if new unstyled classes appear.

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [ad4fcba]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/next@0.3.2
  - @nexpress/blocks@0.3.2
  - @nexpress/theme@0.3.2
  - @nexpress/editor@0.3.2

## 0.3.1

### Patch Changes

- 4067401: feat(admin, core, themes): editor sidebar group icons + descriptions (8/14)

  Adds visual hierarchy to sidebar group cards introduced in
  #757. Operators currently see plain text titles ("Publish",
  "Author", "Taxonomy") — scanning ~6 groups visually is
  slower than necessary. Each group now renders with a Lucide
  icon next to the title and an optional one-line description
  beneath when open.

  ## Type contract
  - `NpAdminGroupMeta` — `{ icon?: string, description?: string }`.
  - `NpCollectionConfig.admin.groupMeta?: Record<string, NpAdminGroupMeta>`.
  - `NpThemeCollectionRequirement.groupMeta?: Record<string, NpAdminGroupMeta>`
    — themes contribute icons for their own groups; merge unions
    across themes (last-write-wins per key).

  ## Built-in posts groups
  - Publish → Calendar
  - Lead → Layout
  - Author → User
  - Taxonomy → Tag
  - SEO → Search
  - Hierarchy → FolderTree

  ## Theme contributions
  - **theme-magazine** Magazine → Newspaper
  - **theme-portfolio** Portfolio → Briefcase
  - **theme-docs** Docs → BookOpen

  ## Admin client

  `SidebarGroupCard` gains `icon` + `description` props. The
  header layout reflows: icon → title + description (truncated
  when long) → chevron. `GROUP_ICONS` registry mirrors the
  existing `COLLECTION_ICONS` pattern in `admin-shell`. Unknown
  names fall back to no icon (silent — no warning).

  ## What's queued for the next 6 PRs
  - **PR 9 (CRITICAL)**: `admin.condition` is currently stripped
    in `toClientCollectionConfig` so the editor never sees it
    on the client. Kind-based field hiding (the entire PR 1
    promise) doesn't work in the browser today — server-side
    validation works because the pipeline has the original
    config. Needs a serializable condition predicate language
    (e.g. `{ when: "kind", equals: "doc" }`) so both server +
    client can evaluate.
  - PR 10: Empty state when every sidebar group is hidden
  - PR 11: Main column field grouping (symmetry)
  - PR 12: SEO field `maxLength` hints
  - PR 13: Container-nested field condition evaluation
  - PR 14: Nested-group error aggregation in toast + auto-expand

  ## Test plan
  - [x] core 452/452
  - [x] All themes build + typecheck clean
  - [x] admin build + typecheck clean
  - [ ] Browser: sidebar groups render with icons + descriptions

- 1eb6255: feat(admin, core, themes): progressive disclosure in the document editor

  The bundled-themes prebake stacks every theme's contributed
  fields on `posts` — magazine, portfolio, docs all add columns
  the operator may never need on a given post. The previous edit
  view dumped them all into one "Publishing" sidebar Card,
  forcing the operator to scroll through ~20 controls per post.

  This redesign shapes the sidebar around what the operator is
  actually authoring:

  ## Field grouping
  - New `admin.group?: string` on `NpFieldBase` — sidebar fields
    with the same `group` label render together in their own
    collapsible-style Card. Default group = `"Publish"`.
  - Group order in the rendered sidebar follows the first-seen
    order of fields in the collection's `fields` array, so
    operators control layout by ordering.

  ## Kind-aware conditional visibility
  - `admin.condition` was already typed but unread; the edit view
    now honors it. The renderer subscribes to live form values
    via `form.watch()` and re-evaluates conditions on change.
  - Built-in `posts` fields tagged:
    - `parent` / `order`: only when `kind === "doc"` (hierarchy)
    - `wpOriginalAuthor`: only when populated (no value → hidden)
  - Theme-contributed fields tagged:
    - **theme-magazine** `featured`: hidden for `kind === "doc"`
    - **theme-portfolio** `heroImage`, `client`, `year`, `role`,
      `discipline`, `span`, `coverVariant`, `coverFigure`,
      `badge`: hidden for `kind === "doc"`, grouped under
      "Portfolio"
    - **theme-docs** `lede`, `stableSince`: only when
      `kind === "doc"`, grouped under "Docs"

  ## "Show all fields" escape hatch
  - Sidebar header shows a toggle when at least one field is
    hidden by an active condition. Flipping it reveals every
    field including ones the kind filter is suppressing.
  - Toggle state persists per-collection via `localStorage`.

  ## Theme requirement contract change

  `NpThemeFieldRequirement` gains an optional `admin` block
  forwarded onto the synthesised field's `admin` slot:

  ```ts
  admin?: {
    group?: string;
    condition?: (data, siblingData) => boolean;
    position?: "main" | "sidebar";
  }
  ```

  Themes use these to bucket their contributed fields into
  sidebar groups and gate visibility by kind.

  ## Schema drift cleanup

  `apps/web/drizzle/0004_smart_valkyrie.sql` drops the orphan
  `np_c_authors` table. The magazine theme stopped declaring
  `requires.collections.authors` in #747 but the migration to
  drop the leftover table was never generated. This PR's
  schema:gen pass surfaced the drift; the auto-generated
  migration cleans it up. No data loss (table never populated).

  ## What does NOT change
  - Main column rendering is unchanged — title + body flow as
    before.
  - 2-column layout preserved.
  - No field-level data loss: hidden fields keep their stored
    values; `condition` is view-only.
  - Theme swap behavior unchanged: switching themes doesn't
    remove fields from the schema, only hides irrelevant ones
    from the editor.

  ## Tests
  - `core` 442/442
  - `web` 85/85 (builtin-themes-union gate covers field-merge)
  - All themes + admin + app build + typecheck clean

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

- 6f46b5a: chore(theme-magazine): use np_users for bylines instead of a separate authors collection

  The magazine theme used to declare its own `authors` collection
  (`name` + `bio`, `createIfAbsent: true`) and point
  `posts.author` at it. That table mirrored what `np_users`
  already provides — every staff/editor user has `name`, and is
  referenceable by id — and ran on the bundled-themes prebake
  path, so every scaffolded site got an empty `np_c_authors`
  table whether magazine was active or not.

  Magazine now matches the built-in `posts` collection in
  `@nexpress/app`: `author` is `relationTo: "users"`. Bylines
  resolve through `np_users` directly. The byline render path
  in `archives.tsx` / `post-feature.tsx` / `post-card.tsx` was
  already shape-agnostic (`author.name` works on either row), so
  no template change is needed.

  **Author archive at `/author/:id`** — the route stays, but now
  queries `np_users` via the new `getUserById` helper exported
  from `@nexpress/core/auth` (mirrored at the package root). The
  "author bio" sub-line on the archive header is dropped — bio
  is not part of the `np_users` schema. Sites that want guest
  authors without admin accounts can re-add an authors collection
  on their own; the framework no longer ships one by default.

  New on `@nexpress/core`:
  - `getUserById(id): Promise<NpUserBasic | null>` — minimal
    `{ id, name, email }` projection. The supported entry point
    for theme code that needs to render a byline from
    `posts.author: relationTo("users")`. Available from both
    the package root and `@nexpress/core/auth`.

  Migration: sites that activated magazine before this release
  have an `np_c_authors` table in their database. Drizzle won't
  drop it (the framework only adds via `createIfAbsent`); operators
  can drop it manually if it's empty. Magazine no longer reads
  that table.

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
  - @nexpress/next@0.3.1
  - @nexpress/theme@0.3.1
  - @nexpress/blocks@0.3.1
  - @nexpress/editor@0.3.1

## 0.3.0

### Minor Changes

- 68c42cf: Theme-magazine redesign — editorial magazine identity (The Northbound
  Review).

  Visual surface overhauled to a print-magazine register: full-width
  dateline strip at the top with date + volume / issue label and
  secondary chrome links; double-rule masthead with a Newsreader
  display-italic title, small-caps ornamental rules flanking an "Est."
  ornament, and an italic tagline; primary section nav under a single
  hairline rule; cover-story 2-col lead (5/6 hero cover with a Roman-
  numeral figure overlay and caption, body block with kicker rule +
  italic display title + italic deck + byline rule with a "Read →"
  link); "In this issue" 3-up secondary row with story-cover gradients;
  dispatches + archive split (1-col timed dispatch list + 2-col archive
  grid with square thumbnails); deep-ink full-bleed subscribe band with
  double-rule top/bottom; three-column colophon footer (brand mark +
  italic colophon paragraph / sections / colophon links) above a
  hairline meta row.

  `impl.tokens` overlay updates the identity — cream `#f6f1e7` surface,
  deep ink `#1a1411` foreground, terracotta `#b04a26` primary; Newsreader
  display-italic + body, Hanken Grotesk for chrome (mono slot points
  at it so kicker / byline / nav letter-spacing works at all sizes).

  `impl.seedContent` ships fourteen demo posts laid out for the index
  template's zones — 1 lead (`featured: true`) + 3 secondary + 4
  timed dispatches + 6 archive items — plus six categories (Features /
  Dispatches / Profiles / Essays / Reporting / Photography) and primary
  - footer navigation. Posts attach to the seeding admin user;
    diversifying authors across the seed set needs the seedContent
    contract to grow per-author wiring (queued as a follow-up).

  `i18n.{en,ko}` adds three new keys the masthead reads via `t()`:
  `magazine.title`, `magazine.ornament`, `magazine.tagline`. Operators
  that rename the publication override these in their site-level UI
  string bundle (last-writer-wins on key collision).

  Component-level changes:
  - `header.tsx`: now emits the dateline strip + masthead with
    ornaments + display-italic logo + section nav, all in one slot
    output (returns a Fragment of `<div className="np-magazine-
dateline">` + `<header>`). Volume / issue derived from the year
    so the masthead stays editorially accurate without an admin step.
  - `footer.tsx`: restructured to a 3-col colophon (brand block /
    sections / colophon) above a hairline meta row. Reads from
    `footer` + `footerColophon` nav locations; falls back to a short
    stub when neither is wired.
  - `post-list.tsx`: full rewrite — renders the lead / 3-up /
    dispatches+archive / subscribe zones inline rather than via
    `MagazinePostCard`. `MagazinePostCard` is kept for sites that
    embed it elsewhere.
  - `post-feature.tsx`: adds `deck` field support + centered byline
    with reading time. Drop cap on the first paragraph remains
    CSS-driven.
  - `MagazinePostCardDoc` gains `readingTime`, `featured`, and
    `categories` as optional fields the new template reads.

  `np-magazine-*` class prefix preserved across all surfaces so theme
  swaps don't leave residue.

### Patch Changes

- 23a77a3: Restore RTL-safety gate on the magazine theme + relax the
  brittle tagline assertion that drifted in #735.

  CI's integration job (restored on push) caught two real
  violations that slipped through when #735 (magazine redesign)
  landed:
  - The drop-cap on the first paragraph of a feature article used
    `float: left` and the byline link used `margin-left: auto`,
    plus the secondary-row reset used physical `padding-left/
right`. The repo's RTL-safety gate at
    `apps/web/tests/theme-magazine-portfolio.integration.test.ts`
    forbids physical-direction CSS — RTL locales would mis-align
    the drop-cap, byline, and row gutters. Migrated to logical
    equivalents (`float: inline-start`, `margin-inline-start`,
    `padding-inline`). No visual change in LTR sites; RTL sites
    now mirror correctly.
  - `apps/web/tests/i18n-strings.integration.test.ts` pinned the
    exact magazine tagline (`"Stories, essays, and reports"`)
    which #735 swapped for the "Long-form reporting on craft…"
    copy. The test is now structural — it asserts the bundle
    resolves to a non-empty string per locale and the two locales
    differ. Tagline content can evolve without churning the test
    suite.

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
- Updated dependencies [f36c0f2]
- Updated dependencies [bb1bd30]
- Updated dependencies [41df9e4]
- Updated dependencies [f10d5b7]
  - @nexpress/core@0.3.0
  - @nexpress/editor@0.3.0
  - @nexpress/theme@0.3.0
  - @nexpress/next@0.3.0
  - @nexpress/blocks@0.3.0

## 0.2.2

### Patch Changes

- e733d47: Replace `pnpm nexpress theme:install <pkg>` with a friendlier two-piece flow: framework-side auto-merge of theme requirements at config-resolution time, plus a single `pnpm nexpress theme add <pkg>` command for installation + registration.

  **`@nexpress/core`** — `defineConfig` now walks every theme on `config.themes` and unions each theme's `manifest.requires.collections` into the resolved `collections` array. For each existing collection slug, the theme's declared fields are appended to that collection's `fields` (operator-authored fields with the same name always win, so the merge is non-destructive). For slugs that don't yet exist AND the theme set `createIfAbsent: true`, a minimal collection is synthesised. The merge is exposed as `mergeThemeRequirements(collections, themes)` for tooling that wants to introspect the resolved shape without going through `defineConfig`.

  **`@nexpress/cli` (`@nexpress/cli-nexpress`)** — new `nexpress theme add <pkg>` command: runs `pnpm/yarn/npm add`, AST-patches `nexpress.config.ts` via two new marker pairs (`@nexpress:themes-imports-start/-end` + `@nexpress:themes-list-start/-end`), and probes the installed package's export shape to confirm it ships a `<name>Theme` named export. `--apply` chains `db:generate` + `db:migrate`; `--dry-run` prints the plan; `--yes` skips the prompt. The legacy `theme:install` command and its AST-patcher (`extract-collection`, `patch-collection`, `generate-collection`) are removed — the auto-merge replaces every reason to touch operator collection files. `theme:uninstall` keeps working unchanged.

  **`@nexpress/admin`** — Themes page guidance no longer suggests `theme:install`. When `checkThemeRequirements` still flags missing fields after the auto-merge (only possible when an operator-declared field has a conflicting TYPE), the hint surfaces the conflicting types and points at `src/collections/*.ts`. Otherwise the hint is the plain `pnpm db:generate && pnpm db:migrate` reminder.

  **`create-nexpress`** — scaffolded `nexpress.config.ts` ships with the new `@nexpress:themes-imports-*` and `@nexpress:themes-list-*` markers so future `theme add` invocations have anchors out of the box.

  **`@nexpress/theme-magazine` / `@nexpress/theme-portfolio`** — their `requires.collections.posts.*Image` upload fields now declare `relationTo: "media"` explicitly. Without it `mergeThemeRequirements` silently skipped the field (no scalar relation target), so the column never landed in the generated schema and the theme's hero/cover slot rendered against an empty value. The merge layer keeps the warning for any other upload requirement missing `relationTo` to surface the same gap in third-party themes.

  Operator-visible migration:

  ```bash
  # Before
  pnpm nexpress theme:install @nexpress/theme-magazine     # ran AST patches on src/collections/*.ts
  pnpm db:migrate

  # After
  pnpm nexpress theme add @nexpress/theme-magazine         # only edits nexpress.config.ts
  pnpm db:generate && pnpm db:migrate                       # (or `theme add --apply` to chain)
  ```

- e733d47: Lazy-import `next/headers` inside the request-scoped function body of `DefaultHeader` and `MagazineHeader` instead of at module top level. Next's `package.json` exports map declares `./headers` as a Next-build-context-only specifier — outside a Next bundle (e.g. when `pnpm nexpress theme:install <pkg>` dynamically imports a theme to read its `requires` field) the resolution fails with `ERR_MODULE_NOT_FOUND` at module load and the CLI can't read anything from the theme.

  Moving the import into the function body keeps the theme module's top-level evaluation Next-free, so CLI tooling can introspect themes without booting a Next bundle. The request-scoped behavior is identical — `headers()` only executes inside a Next render anyway.

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/next@0.2.2
  - @nexpress/theme@0.2.2
  - @nexpress/editor@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/core@0.2.1
- @nexpress/editor@0.2.1
- @nexpress/next@0.2.1
- @nexpress/theme@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/editor@0.2.0
- @nexpress/next@0.2.0
- @nexpress/theme@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/core@0.1.6
- @nexpress/editor@0.1.6
- @nexpress/next@0.1.6
- @nexpress/theme@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/core@0.1.5
- @nexpress/editor@0.1.5
- @nexpress/next@0.1.5
- @nexpress/theme@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/blocks@0.1.3
  - @nexpress/next@0.1.3
  - @nexpress/theme@0.1.3
  - @nexpress/editor@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [7d87406]
  - @nexpress/next@0.1.2
  - @nexpress/core@0.1.2
  - @nexpress/blocks@0.1.2
  - @nexpress/editor@0.1.2
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
  - @nexpress/editor@0.1.1
  - @nexpress/next@0.1.1
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

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
  - @nexpress/next@0.1.0
  - @nexpress/blocks@0.1.0
  - @nexpress/editor@0.1.0
  - @nexpress/theme@0.1.0
