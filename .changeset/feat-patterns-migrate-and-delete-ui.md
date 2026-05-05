---
"@nexpress/admin": minor
---

Page-builder patterns — auto-migrate localStorage to server, expose Delete pattern in Cmd-K (#467 follow-up).

Two follow-ups to #493 flagged in the self-review. Closes the
loop between local-only and server-stored patterns and gives
operators a way to remove saved patterns without going through
JSON.

- **Auto-migration**: the first successful server fetch in a
  given browser pushes any local-only patterns up via
  `saveServerPattern`. Idempotent (server upserts by id) and
  guarded by a `np-page-builder.patterns-migrated` flag in
  localStorage so we don't re-run on every command-menu open.
  When the migration succeeds the migrated patterns are removed
  from the local list, ending the duplicate-listing surface in
  the merged view. Total failures (no migrations succeeded with
  a non-empty local list) leave the flag unset so the next
  session retries.
- **Delete pattern in Cmd-K**: every custom pattern (server-
  stored or local-only) now appears under the **Pattern** group
  with a "Delete pattern: <label>" action marked `destructive`.
  Built-ins stay immutable. Selection prompts via
  `window.confirm`; on confirm the editor calls
  `deleteServerPattern` (no-op success when the id isn't on the
  server) and `deleteCustomPattern` so a stale localStorage
  entry can't survive.

Backward compatible. The new helpers (`migrateLocalPatternsToServer`)
just live next to the existing `get / save / delete` ones and
are opt-in for callers — the editor wires them, anything else
that imports `patterns.ts` keeps working unchanged.
