---
"@nexpress/core": patch
"@nexpress/app": patch
---

`deleteDocument` now accepts an optional `{ tx }` option that threads an outer Drizzle transaction handle through the read + cascade phases. When provided, the existence check and the per-row cascade (child tables, media refs, comments, reactions, reports, the main row itself) run against the caller's transaction — so a wrapping `db.transaction(async (tx) => { … })` covering many `deleteDocument` calls rolls back as a unit on any failure.

`wipeSeededContent` (`@nexpress/app`'s reseed flow) uses this to make the WHOLE wipe atomic: phase 1 reads all (collection, id) targets matching the seed-source set; phase 2 opens one transaction and threads it into every per-row `deleteDocument({ tx })`. Mid-wipe failure rolls back every previously-completed delete in the same call — the operator re-runs from clean state instead of trying to reason about half-deleted seed content.

New `NpTransaction` type alias exported from `@nexpress/core` for callers that want to type the `tx` parameter without depending on Drizzle internals. Existing `deleteDocument(collection, id, user)` call sites are unaffected (the new option is optional).

The seed phase that follows wipe is NOT yet in the same transaction — `saveDocument` doesn't accept the option today, and pulling it into one would force a wider pipeline refactor. Mid-seed failures (most commonly the slug-collision case the 409 handler catches) still leave the wipe committed and the seed half-written; the seeder's per-theme idempotency check makes the re-run safe. The reseed route docstring spells this out.
