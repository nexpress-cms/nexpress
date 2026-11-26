# Current work handoff

Observed 2026-09-23 KST. Verify Git and checks before continuing.

## Objective and authorization

- Retained Agent queue backlog observations and the preceding heartbeat fixture
  race fix are complete and squash-merged in
  [PR #1482](https://github.com/nexpress-cms/nexpress/pull/1482).
- The user authorized merge and choosing the next bundle. The proposal below
  awaits an instruction to implement; selection does not authorize implementation.
- Keep versions, changesets and lockfile unchanged. No automatic worker/runtime
  activation, credentials, provider calls, publication or Version PR #1366 merge.

## Observed checkout

- `/Users/baesw/development/nexpress`, branch `main`.
- HEAD/origin-main: `318f2ef0c6d5063bada034c41cff74d8c75b8d24`; tree matches tested PR head
  `ce50a681043ba7a4abf2633c260c664dc10133c7` before this documentation update.
- This post-merge handoff is the only pending change.
- Exact-head PR CI `35844257043` passed all required checks.
- Post-merge CI/Release: CI `35846045595` and Release `35846045565` in progress. Verify outcomes before new work.

## Implementation and evidence

- [Queue backlog flow](../design/agentic-platform/agent-queue-backlog-evidence.md)
  records ownership, semantics, review fixes, verification and limits.
- Jobs reads canonical pg-boss storage through the existing DB handle. One SQL
  statement clock supplies due/scheduled/active counts and ages; query timeout
  is 500 ms or stricter. Missing/unavailable storage returns null facts.
- Health/Doctor share exact validation and presentation. Existing worker versions,
  Jobs adapters, mutation authority, schema and heartbeat metadata are unchanged.
- Contract 2 / focused App 39 / PostgreSQL 9 tests passed. Final verify: 113 tasks;
  lint: 41 tasks. Production browser: 88/88, no retries/skips; six captures inspected.
- Forty packed packages passed fresh install/typecheck/build and operational
  journey. Installed Core/App bytes matched. Existing Redis opt-in units retain
  13 passes / 3 skips; this is not a full R5 or spoken AT acceptance result.
- Self-review and delegated results were collected. Logs use `/tmp/np-backlog-*`.

## Proposed next bundle: queue investigation through Jobs

- Correct a concrete lifecycle filter mismatch, then connect Health queue
  observations to the existing Jobs list with a validated queue filter.
- `packages/admin/src/jobs/jobs-view.tsx` currently sends `source=live` for
  Completed and Failed tabs. `packages/core/src/jobs/pg-boss-adapter.ts` defines
  live as created/retry/active and archive as terminal retained states, so those
  tab requests are contradictory. Preserve the adapter's logical contract.
- `packages/app/src/admin/protected/jobs/page.tsx` has no searchParams handling;
  JobsView has no queue filter, while the existing list API already accepts name.
  Reuse its parser/service and preserve filters across relevant tabs/refresh.
- Add explicit authorized navigation from Health; do not fetch Jobs or initialize
  a producer/worker during Health rendering/prefetch. Respect Jobs admin access.
- Keep retry/cancel as existing explicit mutations. A filtered view must never
  imply the global retry-all endpoint acts only on that queue; make its scope
  unambiguous or omit the global action in a filtered view without weakening ACLs.
- Update existing jobs/operations guidance: generic heartbeat/age alone is not
  conclusive proof of worker death or stuck execution. Retained counts are not
  history completeness. Reuse owners; no automatic recovery or new authority.
- Verify terminal/live tab requests against real pg-boss facts, queue filtering,
  access/unknown states, and one browser investigation journey. Avoid a Cartesian
  route/state matrix. Full R5 and actual spoken AT remain separate boundaries.
- Read Admin/Core/app guidance and existing Jobs contracts/playbook before edits.
  Start a fresh thread when requested and preserve this pending handoff.
