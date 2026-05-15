---
"@nexpress/app": patch
---

fix(app): invalidate site cache when the site name changes

The setup wizard's `siteName` field and the admin Settings rename
endpoint both call `updateSite()` and then return, leaving the
`getCachedSite()` entry (used by every theme's masthead + footer)
stale for up to `REVALIDATE_SECONDS` (600s). Operators renaming
their site in the wizard would see the public header keep saying
the old name for ten minutes — the most visible first-boot moment.

`siteCacheTag(siteId)` is now busted after a successful
`updateSite` in both endpoints, alongside a `revalidatePath("/",
"layout")` for the same layout the masthead lives in. Mirrors the
theme-switch invalidation pattern already in
`api/admin/themes/active/route.ts`.

  - `packages/app/src/api/admin/setup/route.ts`
  - `packages/app/src/api/admin/sites/[id]/route.ts`
