---
"@nexpress/core": patch
---

Scope id-based community moderation mutations to the current site (#364).

Several admin / moderation mutations bypassed the tenant boundary
that the list / read paths already enforce. The routes checked a
global `community.moderate` / `admin.manage` capability, then called
core helpers that loaded and updated by row id only.

Affected services:

- `staffHideComment`, `staffRestoreComment`, `staffDeleteComment` —
  the shared `loadCommentForStaffOp` loader now requires
  `requireSiteId()` and rejects when the loaded row's `siteId`
  diverges. Callers also include `siteId` in the update predicate.
- `revokeBan` — now loads with site-check + delete predicate pinned
  to the request site.
- `revokeMemberRole` — delete predicate pinned to the request site;
  `NOT_FOUND` covers both "no such grant" and "exists but in another
  tenant" so the response doesn't leak foreign-grant existence.

Type completeness: `NxCommentRow`, `NxBanRow`, and
`NxMemberRoleGrantRow` gain the `siteId` field that the schema has
had since Phase 18.
