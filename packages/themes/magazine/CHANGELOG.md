# @nexpress/theme-magazine

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
