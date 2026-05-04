---
"@nexpress/admin": minor
"@nexpress/core": minor
---

Three follow-ups to the nav editor (cluster 1 from the post-#429 triage):

- **Cache invalidation on page slug change.** `apps/web`'s `pages`
  collection now ships an `afterUpdate` hook that calls
  `revalidateTag(navCacheTag(siteId, location))` for every nav
  location when `data.slug !== originalDoc.slug`. Without it,
  rename a page slug and the menus kept rendering the old URL
  until the nav cache TTL expired.
- **Unsaved-changes warning on location switch.** Switching the
  Header/Footer/Main selector while edits are pending now opens a
  Discard / Cancel dialog instead of silently blowing away the
  in-progress changes. The `dirty` check compares serialized items
  against the last loaded/saved snapshot.
- **`type: "collection"` support.** The editor's type select gains
  a `Collection` option backed by a picker populated from
  `/api/meta/collections`. `getNavigation()`'s URL resolver maps
  `type: "collection"` + slug to `/{slug}` so themes' renderers
  don't change. Collections without a registered slug fall back to
  `#` for the same cache-stability reason as missing pages.
