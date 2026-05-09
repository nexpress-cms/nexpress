---
"@nexpress/theme-docs": minor
"@nexpress/web": patch
---

**Phase F.9-B — `@nexpress/theme-docs` documentation theme.**

Second of three reference-theme rebuilds (design doc §4.9).
This is a **net-new theme** (not a rebuild like F.9-A's
magazine) — `theme-docs` didn't exist before. Stresses
different v0.2 contract axes than magazine: hierarchical
content navigation (F.2 sidebar slot), explicit `routes`
declaration for `/search` (F.2 — search isn't a collection
archive), and a different settings shape (version + repo URL
+ TOC toggle) for F.3.

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
