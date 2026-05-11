# @nexpress/theme-docs

## 0.2.0

### Minor Changes

- 33b31f9: **Portfolio + docs reference themes adopt the M.\* member-surface
  contract.**

  Both themes now declare `impl.members.{shell, notFound}` plus a
  `./components/members-error` client subpath. Without this, the
  F-track fallback chain in `<ShellWrap surface="member">` would
  walk back to `impl.shell` + chrome slots, leaving auth forms
  stretched across the public site's wide layouts (portfolio is
  image-led, docs has a hierarchical sidebar that's useless on
  auth surfaces).

  **Portfolio** ships:
  - `PortfolioMembersShell` — `np-portfolio` root + accent-color +
    card-aspect CSS vars, header + footer chrome, narrow 420-wide
    content column.
  - `PortfolioMembersNotFound` — minimal serif heading, stale-auth-
    link copy, `/members/login` CTA.
  - `./components/members-error` (client subpath) — same minimal
    voice as the rest of the theme, "Try again" + "Back to sign in"
    CTAs.
  - `--np-member-form-*` overrides — transparent input bg,
    hairline borders, theme primary on focus, 0.25rem corners.

  **Docs** ships:
  - `DocsMembersShell` — drops the sidebar (hierarchical doc nav
    has no place on auth forms), header + 440-wide content column.
  - `DocsMembersNotFound` — monospace eyebrow ("404 · account"),
    technical voice.
  - `./components/members-error` (client subpath) — monospace
    ("500 · account") eyebrow + same dual-CTA pattern.
  - `--np-member-form-*` overrides — 0.375rem corners, monospace
    label accent.

  The host's `(member)/error.tsx` registers both new theme entries
  in `THEME_MEMBER_ERRORS` alongside magazine's existing entry, so
  the active-theme `<style data-np-theme="…">` tag lazy-imports
  the correct client chunk when the boundary fires.

  Reference impl pattern stays unchanged from magazine (M.ref):
  - Member shell wrap component is a Server Component that
    duplicates `<Header />` (and `<Footer />` where applicable)
    inline because `<ShellWrap surface="member">` opts OUT of
    the layout's chrome-slot injection when `impl.members.shell`
    is truthy.
  - `notFound.tsx` renders a `<div>`, not `<main>` — the framework
    `<ShellWrap>` already emits the page's `<main>` landmark.
  - `error.tsx` uses the F.7.1 client-subpath delegation pattern
    (Next.js requires error.tsx be `"use client"`, so theme error
    UI lives in a separate chunk the host lazy-imports).

  Closes the trigger-driven follow-up from
  `v0.3-theme-deferred-queue.md`: "portfolio / docs reference
  theme adoption of M.\*".

- 94be860: **Phase F.9-B — `@nexpress/theme-docs` documentation theme.**

  Second of three reference-theme rebuilds (design doc §4.9).
  This is a **net-new theme** (not a rebuild like F.9-A's
  magazine) — `theme-docs` didn't exist before. Stresses
  different v0.2 contract axes than magazine: hierarchical
  content navigation (F.2 sidebar slot), explicit `routes`
  declaration for `/search` (F.2 — search isn't a collection
  archive), and a different settings shape (version + repo URL
  - TOC toggle) for F.3.

  ### What ships

  #### Package surface
  - `packages/themes/docs/` — new package `@nexpress/theme-docs`
  - Exports `docsTheme`, `DocsHeader`, `DocsShell`, `DocsSidebar`,
    `DocsNotFound`, `DocsSearch`, `DocPageTemplate`, `docsCss`,
    `docsSettingsSchema`, type `DocsSettings`

  #### v0.2 contract surfaces
  - **F.1** `manifest.requires`: `docs` collection with
    `title` (text), `body` (richText), optional `parent` rel for
    hierarchy, `order` (number). `createIfAbsent: true` so F.8's
    CLI scaffolds it from scratch.
  - **F.3** `settingsSchema`: 5 fields — `version` (text),
    `githubRepo` (URL), `sidebarHeading` (text),
    `showTableOfContents` (boolean), `searchPlaceholder` (text).
    Pure-text + URL field set; different shape from magazine's
    enum/array-heavy schema for cross-axis validation.
  - **F.2** `impl.routes`: explicit `/search` route. Search is
    NOT an archive (it's cross-collection), so it lands in the
    routes array directly rather than archives sugar.
  - **F.6** `impl.navLocations`: `primary` location in the
    masthead (with maxItems hint).
  - **F.7** `impl.notFound`: docs-flavored 404 (different visual
    language from magazine).

  #### Components
  - `DocsShell` — header + sidebar + main grid layout
  - `DocsHeader` — masthead with brand + version chip + search
    form + GitHub link (when settings.githubRepo set)
  - `DocsSidebar` — walks `docs` collection, builds parent/order
    tree, renders nested `<nav>` (recursive `NavTree`)
  - `DocPageTemplate` — title + body + prev/next bar + optional
    "Edit on GitHub" link. Prev/next walks the same flat ordered
    list the sidebar uses.
  - `DocsSearch` — reads `?q=`, runs `searchCollections`, lists
    cross-collection hits with collection label + title +
    excerpt
  - `DocsNotFound` — concise 404 pointing at search + homepage

  #### Settings consumption
  - `resolveDocsSettings()` — typed wrapper over
    `getThemeSettings("docs")`. Parses through Zod, falls back
    to schema defaults on parse failure (admin shows banner via
    `getThemeSettingsWithStatus`).
  - Header reads version + searchPlaceholder; templates read
    githubRepo for the edit link.

  ### Validation status

  Second of 3 reference themes. F.9-C (portfolio) follows.
  F.9-D retires `default` + `minimal`.

  The docs theme registered in `apps/web`'s nexpress.config.ts
  alongside the existing four themes. Operators can switch via
  admin → Settings → Theme.

  ### What's not in this PR (F.9.1 follow-up)
  - **In-page TOC rendering**: settings expose
    `showTableOfContents`, but the actual TOC component (heading
    scanner + sticky right rail) isn't shipped yet. The flag
    flips on/off without effect — wired contract, missing
    implementation.
  - **Sidebar active-link highlight**: tree renders correctly
    but doesn't `data-current` the active page. Needs request
    URL access; deferred polish.
  - **Body rendering**: template displays a placeholder for
    `doc.body` rather than calling `renderBlocks(...)`. Sites
    that customize body rendering swap it; the contract shape is
    intact.

  ### Dependency note

  `@nexpress/theme-docs` depends on `@nexpress/blocks`,
  `@nexpress/core`, `@nexpress/editor`, `@nexpress/next`,
  `@nexpress/theme`, `zod`. `apps/web` adds the new theme as a
  workspace dep + registers it in `nexpressConfig.themes`.

- 10d3d1d: **Docs `/docs/:slug` + portfolio `/work/:slug` theme routes
  land — closes #609, #613, #614.**

  Three related route-mismatch issues from the 2026-05-10 sweep,
  all about theme components emitting URLs the framework had no
  way to resolve.

  **#609 — Docs theme `/search` shadowed by host file route.**
  Per the locked dispatch order (app file > page > theme >
  plugin), the reference app's `apps/web/src/app/(site)/search/page.tsx`
  takes `/search` before the catch-all can route it. Docs theme's
  own search component (`DocsSearch`) was unreachable. The theme
  can't override the universal search page, so it scopes its own
  search to `/docs/search` — the operator gets both routes
  (framework `/search` + docs `/docs/search`). `DocsHeader`'s
  form action updates accordingly.

  **#614 — Docs `/docs/:slug` links unresolved.** The sidebar
  (`packages/themes/docs/src/sidebar.tsx`) and `DocPageTemplate`'s
  prev/next bar both emit `/docs/<slug>` links, but the reference
  app has no `/docs/[slug]` file route and the framework catch-all
  only resolves `pages` rows + theme archive routes. Arbitrary
  `docs` collection rows weren't reachable by URL.

  Fix: docs theme declares an explicit `/docs/:slug` route
  (`routes/doc-detail.tsx`) that looks up the docs row and
  renders it through `templates.docs.default` (DocPageTemplate).
  Status filter `"published"` matches the catch-all's `pages`
  visibility pattern.

  Route registration order matters — `/docs/search` precedes
  `/docs/:slug` so the literal beats the parametric route
  (dispatcher is first-match-wins).

  **#613 — Portfolio `/work/:slug` links unresolved.** Same
  shape: `PortfolioProjectCard` emits `/work/<slug>` URLs, but
  portfolio declared `templates.posts.detail`
  (ProjectDetailTemplate) without a route to reach it. The
  framework catch-all only resolves `pages` — `posts` rows
  addressed as `/work/<slug>` 404'd.

  Fix: portfolio gains a `routes` array with
  `{ pattern: "/work/:slug", component: PortfolioProjectDetailRoute }`.
  The component looks up the posts row by slug + status
  `"published"` and renders through
  `templates.posts.detail`.

  Both new route components live in a `routes/` subdirectory
  (matches the forum plugin's layout from PRT.3) and use
  `findDocuments<RowShape>` with locally-declared row interfaces
  — the schema lives in the operator's project, not the theme,
  so `theme:install @nexpress/theme-docs`/
  `@nexpress/theme-portfolio` is what reconciles the field set.

  ## What this DOESN'T solve

  `#612` — Reference blog routes (`apps/web/src/app/(site)/blog/`)
  still bypass `resolveTemplateComponent("posts", ...)`.
  `magazine`'s and `portfolio`'s `templates.posts.{list,detail}`
  remain unreachable via the canonical `/blog/*` URLs. Closing
  that is an apps/web edit (route delegation through theme
  templates) — separate PR with a user decision (which template
  wins on collision?), tracked.

  `#608` — Theme requirements can't express collection-level
  settings (`slugField`, `seo.urlPath`, etc.). Independent of
  the route work above; tracked for a follow-up that designs the
  contract extension or generates safe defaults in the install
  template.

### Patch Changes

- 4af9d6a: **Portfolio + docs ship theme-flavored public-site error pages.**

  Both themes now provide `./components/error` (client subpath) —
  the same F.7.1 delegation pattern magazine has used since #466.
  The host's `(site)/error.tsx` registers them in `THEME_ERRORS`
  alongside magazine, so a 500 in the `(site)` tree renders with
  the active theme's chrome instead of the framework's stripped
  default.

  Closes the trigger-skipped item from the previous
  member-surface PR (#631): "portfolio/docs `impl.error` (public-
  site error subpath)".

  **Portfolio** ships `PortfolioError` — minimal serif heading
  ("Something didn't load."), uppercase eyebrow, dual CTA ("Try
  again" + "Back home"). Matches the rest of the portfolio
  member-surface aesthetic (sharp corners, hairline borders,
  muted-foreground accents).

  **Docs** ships `DocsError` — monospace eyebrow ("500 · docs"),
  technical voice ("The page failed to render."), same dual CTA
  shape with 0.375rem corners. Matches `DocsMembersError`
  visually so the two surfaces feel like one theme.

  No change to either theme's `impl.error` field — that's a
  forward-compat type marker per the F.7.1 contract; the actual
  render goes through the host's lazy-imported client subpath
  keyed by the active-theme `<style data-np-theme>` tag.

  `default` theme deliberately remains bare — sites running on
  `default` still see the framework `DefaultError` when a 500
  fires, demonstrating the framework fallback baseline.

- b8c3b8d: fix(themes, web): strip `<main>` from `(site)`-tree components — eliminate nested landmarks

  `(site)/layout.tsx` already emits `<main className="np-site-main">` as the page's single landmark. Eight components inside the layout's children also emitted their own `<main>`, producing nested mains:
  - `apps/web/src/app/(site)/not-found.tsx` (default JSX)
  - `apps/web/src/app/(site)/error.tsx` (DefaultError JSX)
  - `packages/themes/magazine/src/not-found.tsx` (`MagazineNotFound`)
  - `packages/themes/magazine/src/components/error.tsx` (`MagazineError`)
  - `packages/themes/magazine/src/archives.tsx` (`ArchiveLayout`)
  - `packages/themes/docs/src/not-found.tsx` (`DocsNotFound`)
  - `packages/themes/docs/src/search.tsx` (`DocsSearch`, two branches)
  - `packages/themes/portfolio/src/not-found.tsx` (`PortfolioNotFound`)

  HTML spec allows one `<main>` per page; nesting breaks landmark navigation in screen readers and confuses ATs. Cleanup mirrors the same fix M.ref applied to the `(member)` tree (per the M.ref self-review). Each component now uses `<div>` with a class name unchanged, with an inline comment pointing to the layout's outer `<main>` as the single landmark.

  No visual change — `<main>` and `<div>` render identically without browser default styling. No CSS selectors changed (all selectors target the class names).

  Verified with `pnpm typecheck` (58/58) and `pnpm build` (31/31).

  Memory note `(site) tree nested-main cleanup` (recorded as a deferred follow-up after M.ref) is now closed.

- Updated dependencies [5103c65]
- Updated dependencies [c40cded]
- Updated dependencies [c40cded]
- Updated dependencies [ab9c759]
- Updated dependencies [2eb505d]
- Updated dependencies [b9a4e08]
- Updated dependencies [8bed938]
- Updated dependencies [131be43]
- Updated dependencies [4ebf2b4]
- Updated dependencies [5203fd7]
- Updated dependencies [9f3a81b]
- Updated dependencies [65da716]
- Updated dependencies [0c59b98]
- Updated dependencies [f778e80]
- Updated dependencies [6672371]
- Updated dependencies [89c32db]
- Updated dependencies [53627e1]
- Updated dependencies [98d3a4e]
- Updated dependencies [6657059]
- Updated dependencies [ae0c053]
- Updated dependencies [a107c8a]
- Updated dependencies [f98fe9c]
- Updated dependencies [9f3a81b]
- Updated dependencies [d3ea817]
- Updated dependencies [cf5db32]
- Updated dependencies [580f0f2]
- Updated dependencies [225d6a1]
- Updated dependencies [f239ce0]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [ad7ea4e]
- Updated dependencies [ca1722e]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [b78dbbc]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [930d0d4]
- Updated dependencies [9942779]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [7b61ba8]
- Updated dependencies [463fe5f]
- Updated dependencies [09a7b75]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [ab55980]
- Updated dependencies [41ac5d2]
- Updated dependencies [6772bf2]
- Updated dependencies [f5df65e]
- Updated dependencies [b42d8ff]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [45020fd]
- Updated dependencies [6fd0332]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [15aa1d4]
- Updated dependencies [89c7180]
- Updated dependencies [6483de7]
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0
  - @nexpress/editor@1.0.0
  - @nexpress/next@1.0.0
  - @nexpress/theme@1.0.0
