# @nexpress/theme-docs

## 0.5.0

### Patch Changes

- Updated dependencies [cace33b]
- Updated dependencies [3969569]
- Updated dependencies [3d6d276]
- Updated dependencies [df355e8]
- Updated dependencies [258a9b7]
- Updated dependencies [1dadf0c]
- Updated dependencies [1909079]
- Updated dependencies [d4e109e]
- Updated dependencies [a5898f2]
- Updated dependencies [1d9ef80]
- Updated dependencies [839f2f9]
- Updated dependencies [7d0f4fb]
- Updated dependencies [66c7f66]
- Updated dependencies [305ba8a]
- Updated dependencies [c6d72b8]
- Updated dependencies [7ec1b9c]
- Updated dependencies [b9d699d]
  - @nexpress/core@0.5.0
  - @nexpress/blocks@0.5.0
  - @nexpress/next@0.5.0
  - @nexpress/theme@0.5.0
  - @nexpress/editor@0.5.0

## 0.4.1

### Patch Changes

- @nexpress/blocks@0.4.1
- @nexpress/core@0.4.1
- @nexpress/editor@0.4.1
- @nexpress/next@0.4.1
- @nexpress/theme@0.4.1

## 0.4.0

### Patch Changes

- bae7088: Require explicit translation intent on textual block props and round-trip declared nested block, array, and rich-text content through validated XLIFF units.
- a678bb5: Unify search requests, adapter candidates, public results, current-site and
  visibility scope, cache keys, reindex responses, OpenAPI, themes, bootstrap
  lifecycle, and live health behind one exact bounded Core contract. Malformed
  external results and dispatch failures are contained, diagnosed, and fall back
  to the built-in Postgres path before they can reach caches or callers.
- fdd684d: Add a definition-aware block content contract that validates registered prop
  schemas and container rules before Admin/app saves, previews, pattern
  registration, and rendering. Plugin doctor now reports invalid pattern content
  while preserving unknown plugin blocks and stale props as warnings. The
  Magazine story items and Portfolio image-grid items now use their actual nested
  array schemas. Docs API-table defaults now match its structured Admin schema.
- 75e6c34: Give every content, auth, media, and render hook one exact typed data contract.
  Normalize content lifecycle payloads around document state, source, and
  principal; normalize media upload results; reject malformed dispatch data and
  unknown hook names at the core boundary; and diagnose values returned from
  fire-and-forget lifecycle handlers.
- ccad4ed: Replace the unused `render:afterPage` hook with one typed `render:beforePage`
  contribution contract, require function-based hook handlers, reject invalid
  hook registrations and render results, and restore the Analytics Lite
  body-end collector on public pages.
- 763ce4a: Promote rich-text content to a stable NexPress-owned v1 envelope. Validate the
  wire format before collection writes; share the type guard, validator, version,
  and empty-document factory through the client-safe fields subpath; and align
  editor state, generated types, SSR, search, media and mention extraction,
  translation interchange, WordPress import, Admin, themes, and example plugins.
- Updated dependencies [bae7088]
- Updated dependencies [257e70f]
- Updated dependencies [3deb01e]
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
  - @nexpress/editor@0.4.0
  - @nexpress/theme@0.4.0
  - @nexpress/next@0.4.0

## 0.3.26

### Patch Changes

- Updated dependencies [64c6c7e]
- Updated dependencies [11e3007]
- Updated dependencies [61d3c2e]
- Updated dependencies [1b3fa11]
- Updated dependencies [e81ebaa]
- Updated dependencies [192270e]
  - @nexpress/core@0.3.26
  - @nexpress/editor@0.3.26
  - @nexpress/blocks@0.3.26
  - @nexpress/next@0.3.26
  - @nexpress/theme@0.3.26

## 0.3.25

### Patch Changes

- Updated dependencies [a9b2a81]
- Updated dependencies [d48a1c8]
- Updated dependencies [2b72360]
- Updated dependencies [a96907c]
- Updated dependencies [2c95312]
  - @nexpress/next@0.3.25
  - @nexpress/core@0.3.25
  - @nexpress/blocks@0.3.25
  - @nexpress/theme@0.3.25
  - @nexpress/editor@0.3.25

## 0.3.24

### Patch Changes

- Updated dependencies [b8cce91]
  - @nexpress/next@0.3.24
  - @nexpress/blocks@0.3.24
  - @nexpress/core@0.3.24
  - @nexpress/editor@0.3.24
  - @nexpress/theme@0.3.24

## 0.3.23

### Patch Changes

- @nexpress/blocks@0.3.23
- @nexpress/core@0.3.23
- @nexpress/editor@0.3.23
- @nexpress/next@0.3.23
- @nexpress/theme@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies [7a28472]
- Updated dependencies [31f1868]
  - @nexpress/core@0.3.22
  - @nexpress/blocks@0.3.22
  - @nexpress/next@0.3.22
  - @nexpress/theme@0.3.22
  - @nexpress/editor@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies [edfc9ae]
- Updated dependencies [b5b9074]
  - @nexpress/core@0.3.21
  - @nexpress/blocks@0.3.21
  - @nexpress/next@0.3.21
  - @nexpress/theme@0.3.21
  - @nexpress/editor@0.3.21

## 0.3.20

### Patch Changes

- @nexpress/blocks@0.3.20
- @nexpress/core@0.3.20
- @nexpress/editor@0.3.20
- @nexpress/next@0.3.20
- @nexpress/theme@0.3.20

## 0.3.19

### Patch Changes

- @nexpress/blocks@0.3.19
- @nexpress/core@0.3.19
- @nexpress/editor@0.3.19
- @nexpress/next@0.3.19
- @nexpress/theme@0.3.19

## 0.3.18

### Patch Changes

- @nexpress/blocks@0.3.18
- @nexpress/core@0.3.18
- @nexpress/editor@0.3.18
- @nexpress/next@0.3.18
- @nexpress/theme@0.3.18

## 0.3.17

### Patch Changes

- Updated dependencies [6d55e54]
  - @nexpress/blocks@0.3.17
  - @nexpress/next@0.3.17
  - @nexpress/theme@0.3.17
  - @nexpress/core@0.3.17
  - @nexpress/editor@0.3.17

## 0.3.16

### Patch Changes

- @nexpress/blocks@0.3.16
- @nexpress/core@0.3.16
- @nexpress/editor@0.3.16
- @nexpress/next@0.3.16
- @nexpress/theme@0.3.16

## 0.3.15

### Patch Changes

- da32271: Fix bundled theme mobile overflow regressions, including the default header's auth-driven
  tablet overflow, and allow seeded posts to declare clean URL slugs.
- Updated dependencies [da32271]
  - @nexpress/theme@0.3.15
  - @nexpress/next@0.3.15
  - @nexpress/blocks@0.3.15
  - @nexpress/core@0.3.15
  - @nexpress/editor@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/blocks@0.3.14
  - @nexpress/next@0.3.14
  - @nexpress/theme@0.3.14
  - @nexpress/editor@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/blocks@0.3.13
- @nexpress/core@0.3.13
- @nexpress/editor@0.3.13
- @nexpress/next@0.3.13
- @nexpress/theme@0.3.13

## 0.3.12

### Patch Changes

- Updated dependencies [f4c483c]
- Updated dependencies [fb4ba86]
  - @nexpress/editor@0.3.12
  - @nexpress/blocks@0.3.12
  - @nexpress/next@0.3.12
  - @nexpress/theme@0.3.12
  - @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- ba836ea: Fix docs theme detail pages so seeded and authored post content renders from the built-in `content` rich-text field instead of falling back to an empty body placeholder.
  - @nexpress/blocks@0.3.11
  - @nexpress/core@0.3.11
  - @nexpress/editor@0.3.11
  - @nexpress/next@0.3.11
  - @nexpress/theme@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/theme@0.3.10
  - @nexpress/blocks@0.3.10
  - @nexpress/next@0.3.10
  - @nexpress/editor@0.3.10

## 0.3.9

### Patch Changes

- 48ac6a4: Align the default theme's seeded content with the Equilibrium design handoff. The home page now seeds into the writing front template instead of marketing blocks, `/blog` uses the same publication copy and category strip, and the seeded posts/navigation/footer copy match the redesigned theme preview.

  Tighten the other built-in themes against the same design handoff: docs now seeds the visible "Plugin author quickstart" page copy, magazine fixes the cover-story title/deck/byline/issue chrome, and portfolio removes the extra Press seed surface so the seeded pages match the Work/Project/Studio/Journal design set.
  - @nexpress/blocks@0.3.9
  - @nexpress/core@0.3.9
  - @nexpress/editor@0.3.9
  - @nexpress/next@0.3.9
  - @nexpress/theme@0.3.9

## 0.3.8

### Patch Changes

- 28a2dec: Aligns the docs + portfolio masthead/GNB markup and layout with the design-system prototype bundle. Operator-visible changes:

  **`@nexpress/theme-docs`** — three corrections to the masthead:
  - Header grid now uses `auto 1fr auto` (search fills the free middle track). Previously `minmax(220px, 1fr) minmax(0, 2fr) auto` pinned the brand column at ≥220px and gave the search input less room than the design intends. The search now expands to the full middle track up to its own 520px clamp.
  - The brand wordmark's extra `<span class="np-docs-brand-name">` wrapper is gone; the bare `<span>{siteName}</span>` inherits `font-weight: 700` from `.np-docs-brand`. Visual no-op; structural cleanup.
  - The conditional GitHub icon link in the header is removed. The design's masthead has three slots (brand / search / primary nav); the GitHub link wasn't one of them. Operators who want a GitHub entry add it to the primary header navigation (Settings → Menus → header), pointing at the same `settings.githubRepo` value. The doc-page footer's "Edit this page" and "Report issue" links continue to read `settings.githubRepo` independently.

  Orphan CSS rules (`.np-docs-brand-name`, `.np-docs-github`, `.np-docs-github-link`) are removed.

  **`@nexpress/theme-portfolio`** — three corrections to the masthead:
  - The desktop nav is now a flat `<ul class="np-portfolio-nav">` directly under the header-inner grid track (matching the design). The previous extra `<nav class="np-portfolio-nav-desktop">` wrapper, the per-`<li>` `np-portfolio-nav-item` class, and the unstyled hover-revealed `<ul class="np-portfolio-subnav">` dropdown are all gone.
  - Portfolio's design intent is editorial / studio-minimal — flat single-level nav, no dropdowns. Operators with nested header menus only see the children on mobile now (the drawer continues to surface them via `np-portfolio-mobile-subnav`); on desktop only the top-level items appear. Themes that ship multi-level desktop dropdowns: `default` and `magazine`.

  Orphan CSS rules (`.np-portfolio-nav-desktop` in the combined selector + the responsive `display: none`) are removed.

  No public-API change in either theme. Class-name coverage baseline in the framework's `builtin-themes-classnames.unit.test.ts` is updated to reflect the dropped portfolio classes.

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/blocks@0.3.8
  - @nexpress/next@0.3.8
  - @nexpress/theme@0.3.8
  - @nexpress/editor@0.3.8

## 0.3.7

### Patch Changes

- cfb1e92: Aligns the docs + portfolio masthead/GNB markup and layout with the design-system prototype bundle. Operator-visible changes:

  **`@nexpress/theme-docs`** — three corrections to the masthead:
  - Header grid now uses `auto 1fr auto` (search fills the free middle track). Previously `minmax(220px, 1fr) minmax(0, 2fr) auto` pinned the brand column at ≥220px and gave the search input less room than the design intends. The search now expands to the full middle track up to its own 520px clamp.
  - The brand wordmark's extra `<span class="np-docs-brand-name">` wrapper is gone; the bare `<span>{siteName}</span>` inherits `font-weight: 700` from `.np-docs-brand`. Visual no-op; structural cleanup.
  - The conditional GitHub icon link in the header is removed. The design's masthead has three slots (brand / search / primary nav); the GitHub link wasn't one of them. Operators who want a GitHub entry add it to the primary header navigation (Settings → Menus → header), pointing at the same `settings.githubRepo` value. The doc-page footer's "Edit this page" and "Report issue" links continue to read `settings.githubRepo` independently.

  Orphan CSS rules (`.np-docs-brand-name`, `.np-docs-github`, `.np-docs-github-link`) are removed.

  **`@nexpress/theme-portfolio`** — three corrections to the masthead:
  - The desktop nav is now a flat `<ul class="np-portfolio-nav">` directly under the header-inner grid track (matching the design). The previous extra `<nav class="np-portfolio-nav-desktop">` wrapper, the per-`<li>` `np-portfolio-nav-item` class, and the unstyled hover-revealed `<ul class="np-portfolio-subnav">` dropdown are all gone.
  - Portfolio's design intent is editorial / studio-minimal — flat single-level nav, no dropdowns. Operators with nested header menus only see the children on mobile now (the drawer continues to surface them via `np-portfolio-mobile-subnav`); on desktop only the top-level items appear. Themes that ship multi-level desktop dropdowns: `default` and `magazine`.

  Orphan CSS rules (`.np-portfolio-nav-desktop` in the combined selector + the responsive `display: none`) are removed.

  No public-API change in either theme. Class-name coverage baseline in the framework's `builtin-themes-classnames.unit.test.ts` is updated to reflect the dropped portfolio classes.
  - @nexpress/blocks@0.3.7
  - @nexpress/core@0.3.7
  - @nexpress/editor@0.3.7
  - @nexpress/next@0.3.7
  - @nexpress/theme@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/blocks@0.3.6
- @nexpress/core@0.3.6
- @nexpress/editor@0.3.6
- @nexpress/next@0.3.6
- @nexpress/theme@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/blocks@0.3.5
- @nexpress/core@0.3.5
- @nexpress/editor@0.3.5
- @nexpress/next@0.3.5
- @nexpress/theme@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/blocks@0.3.4
  - @nexpress/next@0.3.4
  - @nexpress/theme@0.3.4
  - @nexpress/editor@0.3.4

## 0.3.3

### Patch Changes

- f2622ca: Docs sidebar — leaf top-level doc no longer renders an eyebrow + a duplicate same-name link below it. A top-level doc that has no children now renders as a single clickable eyebrow (uppercase mono row in the sidebar's group rhythm), with primary-color current state and foreground-color hover. Top-level docs that _do_ have children continue to render their eyebrow as a non-interactive section heading above the nested link list — only the leaf case changes.

  New class `.np-docs-sidebar-eyebrow-link` inherits the eyebrow's typography (font, color, letter-spacing, text-transform) so the visual rhythm with sibling group eyebrows is preserved; the link is `text-decoration: none` and only changes color on hover / current. Themes that consume the docs CSS string verbatim get the new selector automatically.

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/blocks@0.3.3
  - @nexpress/next@0.3.3
  - @nexpress/theme@0.3.3
  - @nexpress/editor@0.3.3

## 0.3.2

### Patch Changes

- f74b413: Member-surface CSS pass — second sweep through PR #801's lint baseline:
  - **Default theme** — adds CSS for the `MemberStatusWidget` (sign-in / sign-out chrome). 5 selectors: `.np-member-status` flex container, `.np-member-status-handle` link, `.np-member-status-loading` pulse skeleton, `.np-button-primary` filled CTA, `.np-text-button` minimal text button. The button classes are also reusable outside the widget.
  - **Portfolio + docs themes** — adds CSS for the members shell + column (`np-portfolio-members` / `np-docs-members` outer container with vertical breathing room, `np-{portfolio,docs}-members-column` narrow auth-form column, max-width 30–32rem).
  - **Lint baseline** — drops 8 fixed entries (5 default + 2 portfolio + 2 docs). Reclassifies 8 inline-styled landmarks (`np-{portfolio,docs}-{error,not-found,members-error,members-not-found}`) as VERIFIED_LANDMARK_INLINE — each renders its root with a full `style={{...}}` prop, so no CSS rule is needed. Strips JSDoc / line comments before token extraction so `<main className="np-member-main">` references in docstrings stop counting as JSX (drops `np-member-main` from both portfolio + docs baselines).

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

- 07c763b: feat(theme-docs, core, app, admin): universal-content-model Phase U.2+U.3+U.4 — docs collapse into posts.kind

  Docs are now posts with `kind: "doc"`. Bundles U.2 (theme query
  rewrite + admin sidebar per-kind), U.3 (drop docs table — no
  data to migrate since pre-1.0 has no users), and U.4 cleanup
  (remove docs slug from registry) into one PR. Pages stay
  separate (the page-builder body is a different writing
  experience from prose).

  ## Theme contract (@nexpress/core)
  - `NpThemeCollectionRequirement.kinds` — keyed by discriminator
    value, each entry carries `label`, `labelPlural`, `icon`
    (lucide), optional `urlPattern`, optional `hierarchical`. The
    merge-requirements step unions across registered themes and
    stamps the result onto `admin.kinds` on the collection.
  - `NpThemeCollectionKind` exported from both
    `@nexpress/core` root and via the requirement type.
  - Merge logic now handles the `kinds` block (last-write-wins on
    per-kind props), in addition to the field-options union from
    U.1.

  ## Docs theme (@nexpress/theme-docs)
  - `requires.collections.docs` removed. The collection is gone.
  - `requires.collections.posts` now contributes `kind: "doc"`
    options, `lede` + `stableSince` fields, and
    `kinds.doc: { label, labelPlural: "Documentation",
icon: "BookOpen", urlPattern: "/docs/:slug", hierarchical: true }`.
  - `templates.docs.default` moves to `templates.posts.doc` —
    template id matches the kind value.
  - Sidebar / doc-detail route / doc-page template queries all
    switch from `findDocuments("docs", ...)` →
    `findDocuments("posts", { where: { kind: "doc", ... } })`.

  ## Built-in posts (@nexpress/app)
  - `seo.urlPath` reads `doc.kind` and returns `/docs/<slug>`
    when kind=doc, `/blog/<slug>` otherwise. Operators with
    custom kinds register their own override.

  ## Admin (@nexpress/admin)
  - `AdminShellCollection.admin.kinds` — per-kind nav metadata.
    Sidebar walks the merged map and renders one entry per kind
    under the collection's group, linking to
    `/admin/collections/<slug>?kind=<value>`.
  - Reference app's protected layout projects `c.admin.kinds`
    into the shell props.
  - Collection list view (`/admin/collections/<slug>`) reads
    `?kind=` from searchParams and adds it to the `findDocuments`
    where clause. Unknown kinds yield empty results rather than
    errors.

  ## Schema
  - `apps/web/drizzle/0003_tiresome_harry_osborn.sql`:
    `DROP TABLE np_c_docs CASCADE` + ADD COLUMN lede + ADD COLUMN
    stable_since on np_c_posts.
  - Pre-1.0 + no users → destructive drop is OK. Operators with
    doc data run U.1 first to add `kind` to posts, then export
    np_c_docs rows to `kind="doc"` posts manually before
    upgrading to this release.

  ## Remaining follow-up

  Create-form kind pre-fill and the generic kind URL resolver were
  completed later in the universal-content-model follow-up batch.
  - **Kind-aware capabilities** — `content.publish.<kind>`
    capability strings designed-in but not implemented. Add when
    an operator asks for the split.

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

- 44010a8: Theme-docs redesign — three-column reference documentation layout.

  Visual surface overhauled to a Stripe/Vercel-style docs site: sticky
  header with brand mark + `v0.2` version pill + ⌘K search input
  (label + svg + monospace kbd hint) + primary nav + GitHub button;
  hierarchical sidebar where each top-level doc becomes a group
  **eyebrow** (bullet dot indicator + monospace uppercase label),
  its descendants render as nested links with a hairline left rule
  and an active-link highlight pulled from the request pathname;
  article column carries breadcrumbs (walks the parent chain),
  display headline, lede paragraph, meta-pill row (`Stable since X` /
  `12 min read` / `Updated <date>` / `Edit this page →`), Lexical-
  rendered body with hovered-only anchor icons on h2/h3; right-rail
  on-page TOC with a primary-tinted active border + soft gradient;
  feedback row and symmetric prev/next pair close the page.

  `impl.tokens` overlay sets the new identity — blue `#2563eb`
  primary, cool gray neutrals, Geist Sans + Geist Mono with system
  fallbacks.

  **`requires.collections.docs.fields`** gains three optional
  hard:false fields the design uses:
  - `lede` (textarea) — short opening paragraph rendered under h1
  - `stableSince` (text) — drives the green `Stable since X` pill
  - `badge` (text) — sidebar pill (`new` / `beta` / `api`)

  Operator-declared fields win on collision so a site that ships its
  own `docs` schema isn't overwritten.

  **`impl.seedContent.navigation`** ships the design's header nav
  (Docs / Reference / Blog) + footer links. Seeding actual doc rows
  needs the seedContent contract to grow a `documents?` slot
  (targeting non-page / non-post collections) — queued as a
  follow-up so this PR stays focused on chrome + tokens.

  **Class names** — most align with what the existing components
  already emit. New CSS adds `.np-docs-search-kbd`,
  `.np-docs-brand-mark`, `.np-docs-page-lede`,
  `.np-docs-page-meta-pill`, `.np-docs-breadcrumbs`,
  `.np-docs-callout` (info / `--note` / `--warn` / `--danger`),
  `.np-docs-code` (file-headed code block with syntax tokens
  `.tk-c/k/s/f/t/n/p`), `.np-docs-cmdline` (terminal one-liner —
  not `.np-docs-shell`, which already maps to the route shell
  container), `.np-docs-steps`, `.np-docs-toc-*`, `.np-docs-anchor`,
  `.np-docs-feedback`. Legacy `.np-docs-github-link` continues to
  work alongside the new `.np-docs-github`.

  The sidebar's auto-current-link detection reads `x-np-pathname`
  via `next/headers`; survives server rendering with no client
  hydration.

### Patch Changes

- 9ae3da3: Fix CI failure on cold builds — `TocScrollspy`'s import in
  `doc-page.tsx` is now routed through a sibling-depth bridge
  module instead of a package self-import.

  CI on #742 failed at the docs theme's DTS step:

  ```
  src/templates/doc-page.tsx: error TS7016: Could not find a
  declaration file for module '@nexpress/theme-docs/components/
  toc-scrollspy'.
  ```

  Root cause: tsup runs the two configured entry blocks in parallel.
  When `dist/index.d.ts` is being generated for the first block, it
  hits the self-import to `@nexpress/theme-docs/components/toc-
scrollspy`. TypeScript follows `package.json` `exports` and finds
  the `.js` path, but the matching `.d.ts` is still being written by
  the second block. The DTS pass fails on `TS7016`.

  The previous fix (subpath self-import + adding the path to
  `exports`) worked in incremental local builds (where a previous
  `dist/components/toc-scrollspy.d.ts` already existed) but failed
  on every cold CI run.

  This fix routes the import through `src/toc-scrollspy-bridge.ts`
  (a tiny re-export at sibling depth to `index.ts`). The bridge
  gets inlined into `dist/index.js` because it's not in `external`;
  its own `./components/toc-scrollspy.js` import IS external, so
  the final bundle carries `import "./components/toc-scrollspy.js"`
  — resolves to `dist/components/toc-scrollspy.js` cleanly without
  crossing the package boundary. No self-import, no dts race.

  The package's `./components/toc-scrollspy` subpath was added in
  the previous attempt and is now removed (was only there to
  support the now-deleted self-import). `clean: true` is also moved
  out of the tsup config into the npm script (`rm -rf dist && tsup`)
  following the same pattern documented for `@nexpress/next` and
  the forum plugin.

- 5449b6b: Fix `apps/web` build leak — `TocScrollspy` (client component)
  was being inlined into the docs theme's server bundle, then the
  "fix" externalized it via a parent-relative path that escaped
  the dist root at consume time.

  Root cause:
  - `doc-page.tsx` lives at `src/templates/`, so its source import
    read `../components/toc-scrollspy.js`. tsup's string `external`
    does verbatim match on the specifier, and `./components/toc-
scrollspy.js` (the sibling-path entry the other client
    components used) didn't match the parent-relative form. Result:
    the client module was inlined into `dist/index.js`, RSC blew
    up on the unbannered `useEffect` import. Caught by CI on #741.
  - A first fix tried a regex external matching both depths. tsup
    preserved the specifier verbatim, so the bundled `dist/index.js`
    carried `import "../components/toc-scrollspy.js"` — which
    resolves OUTSIDE `dist/` at consume time. Next.js's Turbopack
    reported `Module not found`.

  Real fix: the import in `doc-page.tsx` now uses the package
  subpath `@nexpress/theme-docs/components/toc-scrollspy`, which
  resolves through `package.json` `exports` and is depth-
  independent. The subpath is added to the exports map alongside
  the existing `./components/error` and `./components/members-
error` entries; tsup externalizes the subpath specifier.

  No behavior change — the scrollspy itself is unchanged. Operators
  don't need to touch anything.

- f36c0f2: `renderRichText` now auto-emits `id` attributes on h2/h3 headings,
  and ships a matching `extractHeadingToc` helper.

  Before this change the docs theme had its own ad-hoc slugify + walk
  that produced a TOC list whose `#anchor` links never resolved —
  the renderer didn't write any `id` onto the heading elements they
  were supposed to land on. The fix is symmetric:
  - **`@nexpress/editor`**: the rendered DOM now includes an
    auto-derived id on each h2 / h3. Slugs use a Unicode-aware
    walker (NFKD + `\p{M}` strip for diacritics, `\p{L}`/`\p{N}` for
    letters/digits so CJK headings survive) and dedupe collisions
    inside a single document — `Notes` / `Notes` / `Notes` becomes
    `notes`, `notes-2`, `notes-3`. Empty results (punctuation- or
    emoji-only headings) fall back to `section`. Numbering is per-
    call: two `renderRichText` calls on the same page don't share
    state. h1 / h4–h6 are intentionally left alone (h1 is the page
    title; h4+ is below typical TOC scope).
  - **`@nexpress/editor/server`** also exports `extractHeadingToc`
    - `slugifyHeading` + the `NpHeadingTocEntry` type. The
      extractor returns one entry per h2 / h3 with the same id the
      renderer would emit, so deep-linking themes don't have to
      reimplement the slug logic and risk drift.
  - **`@nexpress/theme-docs`**: the doc-page template's local
    `extractToc` + `slugify` are deleted; the template now calls
    the shared `extractHeadingToc`. The "On this page" rail now
    produces working anchor links out of the box.

  Closes follow-up HIGH #1 from the theme redesign track.

  Both new exports are part of the editor's experimental surface
  (parented to `NpRichTextContent` which is already documented as
  not-stable-pre-1.0). The slug shape will be honored as a patch-
  level commitment going forward but may evolve before 1.0 if a
  broader Lexical contract change forces it.

- 0c096f1: Wires three small client-side affordances the themes already
  hinted at but didn't actually deliver:
  - **`@nexpress/theme-default`** + **`@nexpress/theme-docs`**:
    the masthead ⌘K affordance now works. A new
    `SearchKeyboardShortcut` client island listens for Cmd+K /
    Ctrl+K on `document` and focuses + selects the search input.
    Drops into both themes as a sibling of the search form;
    hidden in the DOM (renders `null`).
  - **`@nexpress/theme-docs`**: TOC scrollspy. A new
    `TocScrollspy` client island reads the heading ids the
    template already emits (h2/h3 from `renderRichText`) and
    stamps `aria-current="true"` on the matching TOC anchor as
    the user scrolls. CSS already targeted `aria-current`
    styling, but no walker was emitting the attribute — now there
    is. Uses `IntersectionObserver` with a top-biased margin so
    activation happens when a heading enters the top third of
    the viewport.
  - **`@nexpress/theme-portfolio`**: live-ticking local-time
    pill. The masthead's `City · HH:MM` label was SSR-only and
    drifted as the page sat idle. A new `LocalTimeTicker` client
    island re-derives the same `Intl.DateTimeFormat` output once
    a minute, aligned to the next minute boundary so all
    visitors see the rollover at the same wall-clock second.
    SSR initial label is reused as the first state — no
    hydration flicker.

  Each island is module-scoped, mount-only side effects, and
  disposes its listener/observer on unmount. None of them ship
  new operator-visible settings; they're polish on the chrome
  the themes already render.

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
