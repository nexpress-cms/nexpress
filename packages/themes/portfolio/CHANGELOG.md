# @nexpress/theme-portfolio

## 0.3.0

### Minor Changes

- 83d140f: Theme-portfolio redesign — image-led dark studio identity.

  Last of the four built-in theme redesigns (default #733, docs #734,
  magazine #735 already shipped). Refreshes `@nexpress/theme-portfolio`
  to a `color-scheme: dark` studio portfolio canvas.

  **Header.** Sticky blurred masthead with a display-italic studio
  wordmark (literal `&` characters get an accent-color span via
  CSS — matches the design's "Owen & Spruce" treatment), centered
  primary nav, a small monospaced local-time pill driven by the
  new `settings.timezone` (default `Asia/Seoul`), and a "Start a
  project" CTA that links to `settings.contactEmail` when set.

  **Hero.** Accent-dotted eyebrow, Instrument-Serif display
  headline that supports `<em>...</em>` runs for italic-accent
  phrases, and three meta blocks (What we do / Selected clients /
  Recognition) across a 3-col grid that collapses on phones.

  **Controls + grid.** Filter tablist (with `<sup>` count chips) +
  grid / list view toggle. The 12-column asymmetric project grid
  fills cards by `span` (4 / 5 / 6 / 7 / 8 / 12), defaulting to a
  7-5-4-4-8-6-6-12 mosaic when docs don't carry an explicit span.
  Eight cover-gradient variants (`a` through `h`) ship for cards
  without an image cover; covers scale up gently on hover. Optional
  top-left `badge` chip (`accent` variant available for the cover's
  featured-corner ribbon).

  **Studio strip.** Eyebrow + display headline + body paragraphs
  on the left, 2×2 stats grid on the right (each stat lives over
  a thin top rule). Hidden entirely when `studioBody` + studioStats
  are both empty.

  **Contact strip.** Centered booking eyebrow + large mailto link
  (Instrument-Serif italic at clamp(2.4rem, 6vw, 5rem)). Hidden
  when `settings.contactEmail` is unset.

  **Footer.** Single thin row with a green-pulse "Open · Mon — Fri"
  clock indicator on the left and Index / Colophon / Built on
  NexPress meta links on the right.

  **Tokens.** Off-black `#0a0a0a` surface, deep ink-paper foreground
  `#f5f1ea`, warm terracotta accent `#d97a4f`, Instrument Serif for
  display + Hanken Grotesk for chrome (mono slot points at Hanken
  too so kicker / nav letter-spacing reads consistently).

  **Schema additions** — `requires.collections.posts.fields` gains
  five optional `hard: false` fields the redesigned index template
  reads: `discipline` (text), `span` (number), `coverVariant`
  (text — one of `a`-`h`), `coverFigure` (text — monogram override),
  `badge` (text — corner chip). `featured` is intentionally NOT
  re-declared because magazine's `requires` already contributes it
  to the prebake union; the gate test catches this and the comment
  explains why.

  **Settings** — three new fields:
  - `timezone` (default `Asia/Seoul`) — drives the masthead's
    local-time pill via `Intl.DateTimeFormat`.
  - `contactEmail` — gates the Start-a-project CTA + the contact
    strip's mailto link.
  - `bookingNotice` (default `"Currently — booking late 2026"`)
    — short availability eyebrow above the contact mailto.

  **`impl.seedContent`** — 9 demo projects shipped via the `posts`
  slot, shaped for the asymmetric grid's span pattern. Each
  carries explicit `span` / `coverVariant` / `coverFigure` /
  `discipline` / `badge` so the demo renders the design's full
  mosaic on first boot. Project names are intentionally fictional
  (using real institution names as demo clients would imply
  endorsement) — operators replace with their actual work once
  they're set up.

  **Component changes.**
  - `header.tsx`: new structure with logo-amp wrapping + local-time
    pill + CTA. Adds a private `formatLocalTime(zone)` helper using
    `Intl.DateTimeFormat`.
  - `footer.tsx`: replaced with the design's thin clock-lit meta
    row (left: copyright + Open pulse, right: Index / Colophon /
    framework credit). Optional `aboutCopy` paragraph stays
    available, rendered above the meta row.
  - `templates/project-index.tsx`: rewritten — the previous
    template was a single grid; now it composes hero + controls +
    12-col asymmetric grid + studio strip + contact strip as one
    page. Renders projects inline (not via `PortfolioProjectCard`);
    the card component stays exported for sites that embed it
    elsewhere.

  **What this does NOT do.**
  - Page-builder blocks for the grid. The template renders the
    grid inline; `portfolio.project-grid` / `project-card` page-
    builder blocks would let operators drop the grid on arbitrary
    pages. Deferred — design only shows the index page.
  - Diverse authors in seeded projects. All projects attach to the
    seeding admin user; per-author seed wiring is on the deferred
    queue.
  - Real / live clock in the header local-time pill. SSR-only; a
    live-ticking clock is a separate client island.

### Patch Changes

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
- Updated dependencies [bb1bd30]
- Updated dependencies [41df9e4]
- Updated dependencies [f10d5b7]
  - @nexpress/core@0.3.0
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

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/next@0.2.2
  - @nexpress/theme@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/core@0.2.1
- @nexpress/next@0.2.1
- @nexpress/theme@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/next@0.2.0
- @nexpress/theme@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/core@0.1.6
- @nexpress/next@0.1.6
- @nexpress/theme@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/core@0.1.5
- @nexpress/next@0.1.5
- @nexpress/theme@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/blocks@0.1.3
  - @nexpress/next@0.1.3
  - @nexpress/theme@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [7d87406]
  - @nexpress/next@0.1.2
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
  - @nexpress/theme@0.1.0
