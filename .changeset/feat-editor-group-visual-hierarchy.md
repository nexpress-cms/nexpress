---
"@nexpress/core": patch
"@nexpress/app": patch
"@nexpress/admin": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
"@nexpress/theme-docs": patch
---

feat(admin, core, themes): editor sidebar group icons + descriptions (8/14)

Adds visual hierarchy to sidebar group cards introduced in
#757. Operators currently see plain text titles ("Publish",
"Author", "Taxonomy") — scanning ~6 groups visually is
slower than necessary. Each group now renders with a Lucide
icon next to the title and an optional one-line description
beneath when open.

## Type contract

- `NpAdminGroupMeta` — `{ icon?: string, description?: string }`.
- `NpCollectionConfig.admin.groupMeta?: Record<string, NpAdminGroupMeta>`.
- `NpThemeCollectionRequirement.groupMeta?: Record<string, NpAdminGroupMeta>`
  — themes contribute icons for their own groups; merge unions
  across themes (last-write-wins per key).

## Built-in posts groups

- Publish → Calendar
- Lead → Layout
- Author → User
- Taxonomy → Tag
- SEO → Search
- Hierarchy → FolderTree

## Theme contributions

- **theme-magazine** Magazine → Newspaper
- **theme-portfolio** Portfolio → Briefcase
- **theme-docs** Docs → BookOpen

## Admin client

`SidebarGroupCard` gains `icon` + `description` props. The
header layout reflows: icon → title + description (truncated
when long) → chevron. `GROUP_ICONS` registry mirrors the
existing `COLLECTION_ICONS` pattern in `admin-shell`. Unknown
names fall back to no icon (silent — no warning).

## What's queued for the next 6 PRs

- **PR 9 (CRITICAL)**: `admin.condition` is currently stripped
  in `toClientCollectionConfig` so the editor never sees it
  on the client. Kind-based field hiding (the entire PR 1
  promise) doesn't work in the browser today — server-side
  validation works because the pipeline has the original
  config. Needs a serializable condition predicate language
  (e.g. `{ when: "kind", equals: "doc" }`) so both server +
  client can evaluate.
- PR 10: Empty state when every sidebar group is hidden
- PR 11: Main column field grouping (symmetry)
- PR 12: SEO field `maxLength` hints
- PR 13: Container-nested field condition evaluation
- PR 14: Nested-group error aggregation in toast + auto-expand

## Test plan

- [x] core 452/452
- [x] All themes build + typecheck clean
- [x] admin build + typecheck clean
- [ ] Browser: sidebar groups render with icons + descriptions
