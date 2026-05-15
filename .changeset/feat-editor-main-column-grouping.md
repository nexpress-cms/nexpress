---
"@nexpress/admin": patch
---

feat(admin): main column grouping symmetry (11/14)

PR 11 of the editor progressive-disclosure sequence. Mirrors
the sidebar's `admin.group` semantics in the main column so
custom collections with multiple main-position fields can
cluster them into purpose-titled Cards.

## Behavior

Main column walks `mainFields` in order:

| Field | Renders |
|---|---|
| Unwrapped (title / richText / blocks) | naked (no Card) — keeps the focused editor flow |
| No group, wrapped | Own Card (existing behavior) |
| Has `admin.group`, consecutive same group | Single Card titled with group name, icon, description |
| Has `admin.group`, different from previous | Flushes the previous group, starts a new Card |

Group metadata (icon + description) comes from the same
`admin.groupMeta` map the sidebar uses — `Layout`, `Calendar`,
etc. resolve via the shared `GROUP_ICONS` registry.

## In-tree consumer

Built-in `posts` has no main-column fields with `admin.group`
(title + content are unwrapped). The framework infrastructure
exists for custom collections (e.g. a `products` collection
with `name` / `sku` / `dimensions` / `weight` in main) to opt
in. Theme authors can also contribute main-position grouped
fields via `requires.collections.<slug>.fields.<name>.admin.group`.

## Test plan

- [x] admin build + typecheck clean
- [x] Built-in posts: title + content still render unwrapped,
  no other main fields affected
- [ ] Add a test collection with two main fields sharing
  `admin.group: "Specs"` → both render in one Card titled
  "Specs"
