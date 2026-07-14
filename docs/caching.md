# Caching Strategy

> Phase 14 baseline. Layered caching with explicit invalidation
> hooks; sites that don't deploy behind a CDN still get the
> full benefit at the Next.js data-cache layer.

---

## Cache Layers

NexPress assumes three caching layers stack from origin → user:

```
Postgres
   │
   ▼  (a) Next.js data cache  ← unstable_cache + revalidateTag
   │
Origin Next.js
   │
   ▼  (b) HTTP Cache-Control  ← Cache-Control + Vary headers
   │
CDN / Browser
   │
   ▼
User
```

Each layer has its own TTL, invalidation API, and failure
mode. Sites can disable any single layer (e.g. no CDN) and
the others still hold.

---

## (a) Next.js data cache (`unstable_cache`)

Wraps expensive read paths so repeat requests skip the DB
walk. Tagged so writes can invalidate selectively.

**Tagged routes**

| Route                      | Tag(s)                                                                                 | Revalidate |
| -------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| `/sitemap.xml`             | `nx:sitemap:<siteId>`, `nx:sitemap`                                                    | 600s       |
| `/feed.xml` (default)      | `nx:feed:<siteId>`, `nx:feed:<siteId>:posts`, `nx:feed`, `nx:feed:posts`               | 600s       |
| `/feed.xml?collection=…`   | `nx:feed:<siteId>`, `nx:feed:<siteId>:{collection}`, `nx:feed`, `nx:feed:{collection}` | 600s       |
| `/api/search?q=…`          | `nx:search:<siteId>`, `nx:search`                                                      | 60s        |
| `getCachedTheme()`         | `nx:theme:<siteId>`                                                                    | 600s       |
| `getCachedActiveThemeId()` | `nx:theme:<siteId>` (shared)                                                           | 600s       |
| `getCachedNavigation(loc)` | `nx:nav:<siteId>:<location>`                                                           | 600s       |

**Invalidation**

The pipeline's `revalidateCollection` (`@nexpress/next`)
always emits the generic `nx:collection:<slug>` tag, then
expands tags from the per-collection `RevalidationMap` rule and
calls `revalidateTag` on each. Default rules:

```ts
posts: {
  paths: ["/blog", "/blog/{slug}"],
  tags: [
    "nx:posts",
    "nx:sitemap",
    "nx:feed:posts",
    "nx:search",
    "nx:sitemap:{siteId}",
    "nx:feed:{siteId}:posts",
    "nx:feed:{siteId}",
    "nx:search:{siteId}",
  ],
},
pages: {
  paths: ["/{slug}", "/"],
  tags: ["nx:pages", "nx:sitemap", "nx:search", "nx:sitemap:{siteId}", "nx:search:{siteId}"],
},
```

`{slug}` placeholders work in tags too — useful when a
collection caches per-row data with a tag like
`nx:posts:{slug}`.

Theme and plugin route caches created with `cachedThemeFetch()`
or `cachedPluginFetch()` should use `nx:collection:<slug>` in
`extraTags` for every collection they read. That tag is emitted
for all collection writes, even when the app has not declared a
collection-specific route rule.

Write routes already call `revalidateCollection` after
successful saves / deletes. Scheduled publish triggers also
call it for every row promoted from `scheduled` to `published`
so sitemap/feed/search/theme-route caches do not wait for their
TTL. Sites that add collections only need a rule-map entry when
they want path-specific invalidation beyond
`nx:collection:<slug>`.

Write-side invalidations also forward resolved path/tag hints
to an optional CDN purge bridge. This includes collection
writes, theme changes/settings, site rename/hostname changes,
navigation saves, setup-time site/theme busts, and plugin
config saves:

```ts
import { setCdnPurgeAdapter } from "@nexpress/next";

setCdnPurgeAdapter({
  async purge({ paths, tags }) {
    // Call your CDN provider here. Providers differ: some purge
    // by tag/surrogate key, some by URL/path, some support both.
  },
});
```

The adapter runs fire-and-forget after each invalidation pass.
Failures are logged and swallowed so a temporary CDN provider
outage does not turn a successful write into a 500. Providers
that need full URLs should derive them from the deployment's
canonical site URL plus the received path hints.

**Test fallback**

`unstable_cache` requires Next's incremental cache, which is
absent when route handlers are invoked directly (integration
tests calling `GET()`). Sitemap, feed, and search routes catch the
"incrementalCache missing" invariant and fall through to the
direct (uncached) path. Production traffic always hits the
cache.

---

## (b) HTTP `Cache-Control` + `Vary`

Layered on top of the data cache so a CDN / browser can hold
the rendered output even when the origin's data cache is hot.

**Public read-only routes**

| Route          | Cache-Control                         |
| -------------- | ------------------------------------- |
| `/sitemap.xml` | `public, max-age=600, s-maxage=600`   |
| `/feed.xml`    | `public, max-age=600, s-maxage=600`   |
| `/robots.txt`  | `public, max-age=3600, s-maxage=3600` |

**Private routes (proxy-applied)**

The Next 16 proxy (`src/proxy.ts`, implemented in `@nexpress/app/proxy`)
applies `Cache-Control: private, no-store,
must-revalidate` to:

- `/admin/*`
- `/api/admin/*`
- `/api/auth/*`
- `/api/members/*`
- `/api/identities/*`
- `/api/users/*`

so a misconfigured reverse proxy can't cache an admin's
dashboard or a user's session response.

**Public site `Vary`**

The proxy sets `Vary: Cookie, Accept-Language` on
public site routes that don't define their own
`Cache-Control`. This stops a CDN from serving a logged-in
user's rendered page (member-status-widget, draft banner) to
an anonymous visitor — or a Korean visitor's page to an
English one.

---

## (c) Media binary serving

LocalStorageAdapter writes to `./public/media` by default and exposes URLs
under `/media/`. Production deployments should:

1. Serve `./public/media/` via a CDN (Cloudflare, Fastly, S3 +
   CloudFront) rather than via the Next.js origin.
2. Set long immutable cache headers (`Cache-Control: public,
max-age=31536000, immutable`) on those responses (media URLs include
   the uuid, which makes them effectively immutable — a "delete then
   re-upload" produces a different id).

The `S3StorageAdapter` makes this easier — point a CDN at
the bucket directly. Local dev relies on Next's static-file
serving with no CDN; that's fine for development.

---

## Known tradeoffs / follow-ups

- **Catch-all page render** (`/[[...slug]]`) — every (site)
  route is dynamic because the **root layout** (`app/layout.tsx`)
  calls `headers()` (Phase 12.2, for `<html lang>`), which is a
  dynamic API and auto-marks every child route dynamic regardless
  of what the (site) layout says.

  Lifting that call would lose locale-correct `lang` attributes
  for crawlers and screen readers — SEO-impacting, not a free
  trade. Public pages stay dynamic until a deeper redesign.
  Documented as future work; not blocking.

  Note: dark-mode initial paint no longer ties the framework to
  `cookies()` either — color-scheme handling is now an opt-in
  theme-level concern (`<NpColorSchemeScript />` mounted by the
  theme's shell) that runs entirely client-side, so themes can
  ship saved-choice dark mode without forcing the root layout
  dynamic.

- **Global fallback tags still over-invalidate** — sitemap,
  feed, and search caches now carry site-scoped tags
  (`nx:sitemap:<siteId>`, `nx:feed:<siteId>`, `nx:search:<siteId>`)
  alongside legacy global tags (`nx:sitemap`, `nx:feed:posts`,
  `nx:search`). Multi-tenant writes hit the site-scoped tags
  for precision, while the global tags remain as a compatibility
  hammer for older plugins and external purgers.
- **CDN cache invalidation providers** — NexPress exposes a
  stable `setCdnPurgeAdapter()` hook and forwards framework
  invalidation hints to it, but does not ship provider-specific
  Cloudflare / Fastly adapters yet. Keep provider credentials,
  retry policy, batching, and URL expansion in application code
  for now.
- **stale-while-revalidate (data cache)** — `unstable_cache`
  itself doesn't expose a SWR window; a request arriving
  just after the 600s TTL waits for the regen. The HTTP
  layer (Phase 14.9) adds `stale-while-revalidate=86400` to
  sitemap / feed / robots `Cache-Control`, so a CDN smooths
  the boundary. Sites without a CDN still hit the cache-miss
  spike on the origin.

Keep these in mind when tuning production deployments.

## Already cached (Phase 14 retrospective)

- 14.1 — `sitemap.xml` and `feed.xml` (tag-based ISR)
- 14.2 — `Cache-Control` + `Vary` proxy
- 14.3 — `getCachedTheme()`, `getCachedActiveThemeId()`,
  `getCachedNavigation()` with site-scoped tags
- 14.5 — plugin-contributed page templates (separate concern,
  but reuses the cache plumbing)
- 14.7 — `/api/search` hot-query data cache with
  `nx:search:<siteId>` + `nx:search` invalidation tags
- current — `nx:collection:<slug>` is emitted on every
  collection write, including custom collections without an
  explicit route rule, so cached theme/plugin routes have a
  stable invalidation tag
