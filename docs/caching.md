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

| Route                    | Tag(s)                                         | Revalidate |
| ------------------------ | ---------------------------------------------- | ---------- |
| `/sitemap.xml`           | `nx:sitemap`                                   | 600s       |
| `/feed.xml` (default)    | `nx:feed`, `nx:feed:posts`                     | 600s       |
| `/feed.xml?collection=…` | `nx:feed`, `nx:feed:{collection}` (when added) | 600s       |
| `getCachedTheme()`       | `nx:theme:<siteId>`                            | 600s       |
| `getCachedActiveThemeId()` | `nx:theme:<siteId>` (shared)                 | 600s       |
| `getCachedNavigation(loc)` | `nx:nav:<siteId>:<location>`                 | 600s       |

**Invalidation**

The pipeline's `revalidateCollection` (`@nexpress/next`)
expands tags from the per-collection `RevalidationMap` rule
and calls `revalidateTag` on each. Default rules:

```ts
posts: {
  paths: ["/blog", "/blog/{slug}"],
  tags: ["nx:posts", "nx:sitemap", "nx:feed:posts"],
},
pages: {
  paths: ["/{slug}", "/"],
  tags: ["nx:pages", "nx:sitemap"],
},
```

`{slug}` placeholders work in tags too — useful when a
collection caches per-row data with a tag like
`nx:posts:{slug}`.

Write routes already call `revalidateCollection` after
successful saves / deletes. Sites that add collections add
their own entries to the rule map (or override defaults).

**Test fallback**

`unstable_cache` requires Next's incremental cache, which is
absent when route handlers are invoked directly (integration
tests calling `GET()`). Sitemap and feed routes catch the
"incrementalCache missing" invariant and fall through to the
direct (uncached) path. Production traffic always hits the
cache.

---

## (b) HTTP `Cache-Control` + `Vary`

Layered on top of the data cache so a CDN / browser can hold
the rendered output even when the origin's data cache is hot.

**Public read-only routes**

| Route          | Cache-Control                          |
| -------------- | -------------------------------------- |
| `/sitemap.xml` | `public, max-age=600, s-maxage=600`    |
| `/feed.xml`    | `public, max-age=600, s-maxage=600`    |
| `/robots.txt`  | `public, max-age=3600, s-maxage=3600`  |

**Private routes (middleware-applied)**

The middleware applies `Cache-Control: private, no-store,
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

The middleware sets `Vary: Cookie, Accept-Language` on
public site routes that don't define their own
`Cache-Control`. This stops a CDN from serving a logged-in
user's rendered page (member-status-widget, draft banner) to
an anonymous visitor — or a Korean visitor's page to an
English one.

---

## (c) Media binary serving

LocalStorageAdapter writes to `./uploads` and exposes URLs
under `/uploads/`. Production deployments should:

1. Serve `./uploads/` via a CDN (Cloudflare, Fastly, S3 +
   CloudFront) rather than via the Next.js origin.
2. Set a long `Cache-Control: public, max-age=31536000,
   immutable` on those responses (media URLs include the
   uuid, which makes them effectively immutable — a "delete
   then re-upload" produces a different id).

The `S3StorageAdapter` makes this easier — point a CDN at
the bucket directly. Local dev relies on Next's static-file
serving with no CDN; that's fine for development.

---

## What's NOT cached (yet)

- **Catch-all page render** (`/[[...slug]]`) — uses
  `force-dynamic` because of `draftMode()` and member-
  authored content. ISR for the non-draft public path is the
  biggest open perf win.
- **Search responses** (`/api/search`) — query strings make
  caching tricky; the pluggable adapter from 10.6 may handle
  its own cache. A simple short-TTL wrapper for the
  hot-query case is a candidate follow-up.
- **Multi-site sitemap / feed cache keys** — current tags
  (`nx:sitemap`, `nx:feed:posts`) are global. In a multi-
  tenant deploy where the same worker pool serves several
  sites, a write to site A invalidates site B's cache too.
  Site-scoped tags (`nx:sitemap:<siteId>`) would mirror the
  Phase 14.3 theme/nav pattern.
- **CDN cache invalidation** — `revalidateTag` only flushes
  the Next data cache, not a downstream CDN. Sites running
  Cloudflare / Fastly need their own purge call. A pluggable
  hook (`setCdnPurgeAdapter()`) parallel to the spam /
  search adapters is the natural fit.
- **stale-while-revalidate** — Tagged routes have a hard
  `revalidate: 600` TTL with no SWR window. A request that
  arrives just after expiry waits for the regen. Adding
  SWR to sitemap / feed / theme would smooth the spike.

These are tracked as 14.x follow-ups.

## Already cached (Phase 14 retrospective)

- 14.1 — `sitemap.xml` and `feed.xml` (tag-based ISR)
- 14.2 — `Cache-Control` + `Vary` middleware
- 14.3 — `getCachedTheme()`, `getCachedActiveThemeId()`,
  `getCachedNavigation()` with site-scoped tags
- 14.5 — plugin-contributed page templates (separate concern,
  but reuses the cache plumbing)
