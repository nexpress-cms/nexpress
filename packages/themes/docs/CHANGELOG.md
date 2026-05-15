# @nexpress/theme-docs

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
