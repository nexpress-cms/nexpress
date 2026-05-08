---
"@nexpress/theme": minor
"@nexpress/next": minor
"@nexpress/web": patch
---

**Phase F.2 — `impl.routes` + `archives` sugar: theme-declared dynamic routes.**

Second implementation phase of the v0.2 theme contract extension
(see `docs/design/theme-v0.2-extension.md` §4.2). Themes can now
register URL patterns the framework's catch-all dispatches to,
closing the dynamic-archive gap (`/category/[slug]`,
`/tag/[slug]`, `/author/[id]`, `/:year/:month`, `/search`) and
unlocking theme-only routes (`/lookbook`).

### Surface added

#### `@nexpress/theme`

- `NpThemeImpl.routes?: NpThemeRoute[]` — declared dynamic routes
  with `pattern`, `component`, optional `metadata` and `revalidate`.
- `NpThemeImpl.archives?: NpThemeArchives` — sugar over routes
  for the common archive shapes (`byCategory`, `byTag`,
  `byAuthor`, `byDate`, `search`). Default patterns expand at
  boot; per-entry `pattern` override possible.
- `NpRouteRenderProps` — props passed to a route component
  (`{ params, searchParams, blockCtx }`).

Pattern syntax is a small path-to-regexp subset (no new
dependency): literal segments match exactly, `:name` captures any
segment, `:name(regex)` constrains the captured segment.

#### `@nexpress/next`

- `dispatchThemeRoute(theme, path)` — pure linear-scan matcher.
  Returns `{ route, params }` on first hit, null otherwise.
- `collectThemeRoutes(theme)` — concatenates explicit routes
  with expanded archives. Explicit routes come first so a theme
  can override an archive pattern by declaring an explicit route
  earlier.
- `buildRouteRenderProps(...)` — small helper that constructs
  `NpRouteRenderProps` from a match + searchParams + blockCtx.

#### `apps/web/(site)/[[...slug]]/page.tsx`

Catch-all integrates the dispatcher into both the page render
path and `generateMetadata`, with the precedence locked in the
design doc:

1. App-explicit Next.js routes (always win — Next handles them
   before the catch-all sees the request).
2. Page document slug lookup.
3. Slug redirect history (operator's renamed pages).
4. Theme route dispatcher.
5. `/` empty-state (DefaultHomePage).
6. 404.

Operator-authored content always wins over theme contributions:
a theme route can never silently shadow a CMS page or its
rename history. Both `Page` and `generateMetadata` share the
dispatcher — theme-rendered URLs get the route's `metadata`
builder, not page-fallback SEO (which would be a real bug per
design doc §4.2).

### Open question resolved

Design doc §11.1 left "where does `getArchiveQuery` helper
live?" open. Resolution: **skip for v0.2 F.2.** Theme route
components can call `findPosts({ where: { categories: id } })`
directly — F.E (#542) already made `hasMany` filtering work
natively, so the boilerplate is minimal. If multiple themes end
up sharing identical query construction, we add the helper as a
follow-up.

### Tests

14 unit tests in `route-dispatcher.test.ts` cover: null theme,
no match, literal route, single param, multiple params, regex
constraint enforcement, declaration-order first-match-wins,
segment-count mismatch, leading-slash normalization, and 6
archive expansion cases (byCategory default pattern, byDate
year/month/day granularities, per-entry pattern override,
explicit-routes-first ordering, empty-archives no-op).

Total `@nexpress/next` tests: 62.

### What's not in this phase

- Search-results UI is a route the theme can declare; the
  framework doesn't pre-resolve search hits for it (theme
  component calls `searchCollections` directly).
- `getArchiveQuery` helper — see open-question resolution above.

### Dependency note

`@nexpress/theme` gained an optional `next` peer dependency
(themes inherently target Next routes; the typed `metadata`
builder uses `next.Metadata`). Existing themes are unaffected
unless they declare `routes`/`archives`.

`@nexpress/next` now depends on `@nexpress/theme` (was: only
core + blocks). No cycle: theme → core, next → theme + core.
