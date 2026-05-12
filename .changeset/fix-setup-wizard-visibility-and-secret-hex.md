---
"create-nexpress": patch
---

Three setup wizard polish fixes:

1. **Migration failure output is no longer silently empty.** `runChild`'s `spawn` now uses `shell: true` so PATH resolution and the chained `&&` in `pnpm schema:gen && drizzle-kit generate` flow through the same pipe linkage the operator sees in their own terminal. Previously some operators got an empty `<details>` toggle in the UI with no error trace, even though running the same `pnpm db:generate` directly printed a full stack trace.

2. **Silent-fail guard.** If the spawned child exits non-zero but produced nothing on stdout/stderr (rare — happens with early-spawn-error edge cases or OS-level pipe disconnects), the captured output is replaced with a one-line "child X exited with code N but produced no output — try running X directly" message. Better than an empty `<details>` panel.

3. **NP_SECRET encoding unified.** Wizard auto-generated secret now uses `randomBytes(32).toString("hex")` (64 chars) instead of `base64url` (~43 chars), matching what `create-nexpress --yes` writes. Same 32-byte entropy; consistent encoding means operators don't see two different-looking secrets in the same project depending on which path created the `.env`.
