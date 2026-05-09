---
"@nexpress/next": minor
"@nexpress/theme-magazine": patch
---

**v0.3 (H) — `cachedThemeFetch` helper for per-route theme
cache.**

Closes the last v0.3-deferred item from
`docs/design/theme-v0.2-extension.md`'s
`feat-theme-routes.md` changeset:

> Per-route `revalidate` cache hint — considered, dropped.
> Next's route-segment `revalidate` is a static export; we
> can't vary it per URL pattern from a single catch-all. Theme
> routes that want caching wrap their data fetches in
> `unstable_cache(...)` themselves. **Tracked as a v0.3
> candidate** if a future SSG pass needs it.

### Problem

Theme routes (archives like `/category/:slug`, custom URL
patterns) render through the framework's catch-all dispatcher.
Next's route-segment `revalidate` operates at the segment
level — `/category/:slug` and `/author/:slug` share one
segment, so per-pattern caching can't be expressed.

Magazine theme's `CategoryArchive` did `findDocuments` on
every request — every visit to `/category/tech` was a fresh
DB query.

### API

`@nexpress/next` ships `cachedThemeFetch<T>(keyParts, fetcher,
options?)`. The wrapper:

- Auto-tags with `nx:theme:<siteId>` so theme switch /
  settings save / theme uninstall bust the cache (same tag
  the existing `getCachedTheme` / `getCachedThemeSettings`
  share).
- Keys by site + caller-supplied parts so `/category/tech`
  and `/category/design` cache independently.
- Defaults `revalidate: 60` — theme route data is more dynamic
  than tokens / active id, so a tight default keeps freshness
  reasonable while cutting the per-request DB hit on hot URLs.
- Falls back to the uncached fetcher when Next's incremental
  cache isn't reachable (integration tests, scripts).

### Options

| Option | Default | Purpose |
|---|---|---|
| `revalidate` | `60` | Cache TTL in seconds. |
| `extraTags` | `[]` | Tags appended after `nx:theme:<siteId>`. Pass `["nx:collection:posts"]` so a posts edit busts the matching cached archive too — `revalidateCollection` already calls `revalidateTag("nx:collection:<slug>")` on every save. |

### Reference implementation

`packages/themes/magazine/src/archives.tsx` — `CategoryArchive`
and `AuthorArchive` migrated:

```ts
const data = await cachedThemeFetch(
  ["magazine.category-archive", slug, String(settings.postsPerPage)],
  async () => {
    const cats = await findDocuments("categories", {...});
    const posts = await findDocuments("posts", {...});
    return { category: cats.docs[0] ?? null, posts };
  },
  { revalidate: 60, extraTags: ["nx:collection:posts"] },
);
```

The key parts include `postsPerPage` so when the operator
changes the setting, the archive rebuilds at the new page
size on next read (settings save busts `nx:theme:<siteId>`
which is one of the cache's tags).

### Tests

6 new unit tests in `cache.test.ts` (71 total in
`@nexpress/next`):
- per-site key composition with caller parts
- default `revalidate: 60`
- caller-overridden revalidate
- `extraTags` appended after the auto-applied theme tag
- incremental-cache-unavailable fallback to uncached fetcher
- non-cache-related errors propagate (don't silently swallow)

### v0.3 queue closed

This is the last v0.3-deferred item from the theme-system
extension cluster. Remaining bigger-scope items (F = member
surface skinning, G = plugin auto-form) deferred to the
post-v0.3 phase.
