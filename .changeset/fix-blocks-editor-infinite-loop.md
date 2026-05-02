---
"@nexpress/blocks": patch
"@nexpress/next": patch
---

Two admin-form bugs surfaced while writing E2E coverage for the
publish flow (Phase 23.6.1):

- **`BlockPageEditor` infinite update loop** — the RESET-on-
  `initialBlocks`-change effect compared by reference, but the
  parent (`field-renderer`'s `toBlockInstances`) returns a fresh
  array on every render. Combined with the `onChange(blocks)`
  effect, that produced a "Maximum update depth exceeded" storm
  whenever a page with empty blocks was opened in the admin. Now
  the effect only fires when the *serialized* shape changes, so
  reference churn doesn't re-trigger the dispatch.
- **`toClientCollectionConfig` left `seo.urlPath` in the result**
  — the helper stripped `access`, `hooks`, and per-field
  functions but never walked the `seo` block. Both `pages` and
  `posts` define `seo.urlPath` as a function, so the admin
  create-form crashed under RSC serialization with "Functions
  cannot be passed directly to Client Components." The helper
  now drops any function-valued slot inside `seo`.

Both bugs only manifested when opening the *create* form for a
collection with `seo.urlPath` and the blocks field; the existing
edit views with persisted block content were unaffected by the
loop and skipped the seo issue because they don't re-render the
client config from scratch.
