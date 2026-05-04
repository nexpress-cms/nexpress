---
"@nexpress/admin": patch
---

`AdminShell` now types `collections` as `AdminShellCollection[]` — slug,
labels, and admin sidebar flags only — instead of full `NxCollectionConfig`.
Passing complete configs from a Server Component embedded `access` callbacks
and triggered Next.js “Functions cannot be passed to Client Components”
errors; consumers should map config to this shape in their layout.
