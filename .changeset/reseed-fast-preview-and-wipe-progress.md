---
"@nexpress/app": patch
---

Reseed safety/perf nits:
- GET `/api/admin/themes/reseed` (preview) now answers from two SQL `FILTER (...)` count aggregates instead of loading up to 500 rows per collection and filtering in JS. Counts are accurate regardless of total row volume.
- `wipeSeededContent`'s per-row delete loop re-throws with the deleted-so-far count when a row fails (`Wipe of pages (seedSource="theme:default") failed after deleting 12 rows: …`). The wipe is still non-transactional (hook callbacks use the singleton DB handle), but the operator now sees the resume point in the error.
