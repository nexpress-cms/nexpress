---
"@nexpress/core": minor
"@nexpress/theme": minor
"@nexpress/web": patch
---

**Phase F.7 — error / 404 / SEO surface contributions.**

Seventh implementation phase of the v0.2 theme contract extension
(see `docs/design/theme-v0.2-extension.md` §4.7). Themes can now
contribute the public-site 404 page, plus extra sitemap / feed
entries and a custom `robots.txt` body.

### Surface added

#### `@nexpress/theme`
- `NpThemeImpl.notFound?: ComponentType` — public-site 404
  component. Used by `(site)/not-found.tsx`.
- `NpThemeImpl.error?: ComponentType<NpThemeErrorProps>` —
  public-site error boundary fallback. Currently typed for
  forward-compatibility; the framework's `error.tsx` ships a
  client default because Next requires error.tsx to be a
  client component (see deferred section).
- `NpThemeImpl.seo?: NpThemeSeoHooks` — sitemap / feed / robots
  contributions.

#### `@nexpress/core`
- `extractNotFoundComponent` / `extractErrorComponent` /
  `extractSeoHooks` — pure structural narrowers (testable
  without DB).
- `getActiveThemeNotFound` / `getActiveThemeError` /
  `getActiveThemeSeoHooks` — async wrappers.
- `BuildAtomFeedOptions.extraEntries?: NpFeedEntry[]` — feed
  builder accepts theme-supplied entries; merged with the
  collection walk, deduped by id (framework wins), re-sorted
  newest-first, capped by limit.

#### `apps/web`
- `(site)/not-found.tsx` — delegates to active theme's
  `impl.notFound` when defined; framework default otherwise.
- `(site)/error.tsx` — framework default (client component;
  see deferred section).
- `sitemap.xml` route merges theme entries from
  `seo.sitemapEntries`; deduped by `loc` (framework wins).
- `feed.xml` route passes theme entries to
  `renderAtomFeed({ extraEntries })`.
- `robots.txt` route uses theme's `seo.robotsTxt` when defined
  (whole-body replacement); framework default otherwise.
- `PUT /api/admin/themes/active` busts `nx:sitemap:<siteId>` +
  `nx:feed:<siteId>` when the new active theme contributes
  SEO hooks (parallel to F.3 settings save invalidation).

### Caching contract

Per design doc §4.7:
- Theme switch (`activeTheme` row write) → busts theme cache
  always; busts SEO tags when new active theme has
  `impl.seo.*`. Implemented in this phase.
- Theme settings save (`theme.settings:<themeId>` row write)
  → already wired in F.3 via `activeThemeContributesSeo`.
- Theme tokens save (`theme` row write) → no SEO bust. Tokens
  don't affect sitemap/feed content.

### What's not in this phase (deferred)

- **Generic delegation from `(site)/error.tsx` to theme's
  `impl.error`** — Next requires `error.tsx` to be a client
  component, but theme components are server-defined. React's
  server→client boundary blocks the generic wiring. The type
  exists for forward-compat (a future Next API for
  server-rendered error fallbacks would let the framework
  delegate transparently) and themes that want a fully custom
  error surface can ship their own `(site)/error.tsx`
  override. Recorded as **F.7.1 follow-up** when the Next API
  shape settles.

### Tests

7 new unit tests in `packages/core/src/themes/error-seo.test.ts`:
- `extractNotFoundComponent` / `extractErrorComponent` —
  null on undefined / non-function, returns ref when present
- `extractSeoHooks` — empty on missing seo, picks up
  individual hooks, ignores non-function members, partial
  declaration only fills present fields

Total core tests: 321 (was 314).

### Dependency note

`@nexpress/theme` declares `NpSitemapEntry` / `NpFeedEntry`
local-mirror types instead of importing from `@nexpress/core` —
same tsup DTS bundler workaround already used for
`NpThemeTokensOverlay` (the bundler intermittently fails to
resolve named cross-package types even when present in the
consumed dist). Structural identity is enough; theme authors
get the right shape and runtime values pass through unchanged.
