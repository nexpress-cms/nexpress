---
"@nexpress/core": minor
"@nexpress/web": minor
---

Slug renames now permanently redirect (HTTP 308) instead of
404. When an operator renames a page (e.g. `/old-page` →
`/new-page`), search-engine indices, external links, and
bookmarks for the old URL stay working — the public-site
catch-all looks up the rename history and issues a permanent
redirect to the current path. (Next's `permanentRedirect` emits
308; semantically equivalent to the classic 301 for SEO and
preserves the request method.)

Implementation:

- New table `np_slug_history` records every slug change for
  collections that declare `slugField`. Indexed on
  `(siteId, collection, oldSlug)` for the read path.
- The content pipeline writes a history row inside the same
  transaction as the doc UPDATE — half-applied state isn't
  possible. Skipped on creates and on updates that don't
  change `slug`.
- New helper `findSlugRedirect(collection, oldSlug)` walks the
  history chain (capped at 5 hops) and returns the most recent
  target. Cycle-safe.
- The `(site)/[[...slug]]` catch-all calls the helper before
  emitting `notFound()`. Locale prefixes survive the redirect.

Wire-compat: existing slugs unchanged. Empty history table on
upgrade — sites get redirects only for renames that happen
after the migration runs.
