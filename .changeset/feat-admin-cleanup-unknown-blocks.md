---
"@nexpress/admin": minor
"@nexpress/web": patch
---

**v0.3 (C + E) — bulk "cleanup unknown blocks" admin action +
cross-theme migration hint.**

Closes two v0.3-deferred items from
`docs/design/theme-v0.2-extension.md` §10 in one bundled PR
since both deal with cleanup workflows after theme/plugin
changes:

> Bulk "cleanup unknown blocks" admin action — placeholder
> rendering covers correctness; bulk action is convenience.

> Cross-theme migration — switching themes A → B is idempotent
> at install time but doesn't remove A's leftover fields.
> Cleanup workflow tracked here.

### What changed

**New admin route**: `/admin/themes/cleanup` — scans every
collection's `type: "blocks"` field for instances whose `type`
string isn't in the active block registry (typical after
`theme:uninstall`, theme switch, or plugin removal). Lists
unknown types with instance + doc counts; operator can:

- "Remove all" — strip every unknown instance across the site
- Per-row "Remove" — strip just one type at a time

Each cleanup run goes through `saveDocument` so revisions
track the change and media-ref / search-vector hooks fire
correctly. Operators can revert via the per-doc revision
history if a removal was a mistake.

**New API endpoints** under `/api/admin/blocks/unknown`:

- `GET` — scan-only, returns `{ unknownTypes, affected,
  totalInstances, totalDocs }`
- `POST` — apply cleanup, optional `{ types: string[] }` body
  filters which types to strip (default: all). Returns
  `{ removedInstances, updatedDocs }`

Both are gated by `admin.manage` capability and CSRF-protected
by the standard proxy.

**Cross-theme migration hint** (E): the existing theme switcher
(`/admin/settings/theme`) now shows a yellow callout after a
successful theme switch (skipped on first-boot when there was
no previous active theme), pointing operators at the cleanup
tool. The hint surfaces specifically because the operator just
took an action (switching themes) that commonly produces stale
references — discoverability without permanent visual noise.

### Why bundled

Both items address the same workflow: "I changed something
about my site's theme/plugins; now my pages have orphan
references to blocks that no longer render." C is the tool;
E is the discovery surface that points operators at the tool
right when they're most likely to need it.

### Scan scope (today)

- Walks every registered collection
- Inspects `type: "blocks"` fields (incl. those nested inside
  `row` / `collapsible` containers)
- Recurses into block `children` arrays — even known parent
  blocks can hold unknown descendants
- Caps at 1000 docs per collection (a future iteration paginates
  when sites cross the threshold; today's reference sites are
  far below)
