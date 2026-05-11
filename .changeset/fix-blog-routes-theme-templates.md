---
"@nexpress/web": patch
---

**Blog routes dispatch through active theme posts templates —
closes #612.**

The reference app's `/blog` and `/blog/:slug` routes previously
rendered hard-coded inline markup, ignoring the active theme's
`templates.posts.{list,index,feature,detail}` entries. Theme
authors declared list/detail templates for `posts` that were
silently unreachable through the canonical blog URLs.

Fix: walk the conventional template IDs in priority order;
render through the first match. Falls back to the inline
framework rendering when the active theme doesn't declare any.

**Blog index (`/blog`)** — priority: `list` → `index` →
`feature`. Magazine ships `list`, portfolio ships `index`; the
third (`feature`) is a reserved slot for themes that want a
magazine-style hero + grid combination.

The list payload is packed into a synthetic `doc` matching the
convention `PostListTemplate` and `ProjectIndexTemplate`
already use: `{ heading, intro, docs, totalDocs, pageNum,
totalPages, hasPrevPage, hasNextPage }`. Templates that read
additional keys see `undefined` and fall back to their internal
defaults.

**Blog detail (`/blog/:slug`)** — priority: doc's own
`template` field (if set) → `detail` → `default` → `feature`.
Mirrors the catch-all's `pages` lookup behavior so a per-doc
template override wins regardless of theme.

Behavior when no theme template matches is unchanged — the
inline rendering preserves the existing `np-blog` / `np-post`
markup the integration tests assert against. Themes don't have
to opt in; opting in is purely additive.

What this leaves untouched:
- `/blog/category/:slug` — already template-aware via
  `findPosts` + `PaginationNav`; the active theme's
  `templates.posts.category` entry would extend it the same
  way (no theme ships one yet, so no change needed today).
- The `pages` catch-all — separate dispatch surface, already
  resolves theme templates.
