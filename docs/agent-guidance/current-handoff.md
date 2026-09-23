# Current work handoff

Observed 2026-09-23 KST. Verify Git and checks before continuing.

## Objective and authorization

- The user authorized queue-level worker subscription visibility after PR #1480.
  Implementation, self-review and verification are complete in this checkout.
- The user authorized commit, push, PR and squash merge, followed by selection
  of the next bundle. Require green CI on the exact PR head.
- Keep versions, changesets and lockfile unchanged. No provider calls, credentials,
  automatic worker/runtime activation, publication or Version PR #1366 merge.

## Observed checkout

- `/Users/baesw/development/nexpress`, branch `codex/agent-queue-subscriptions`.
- HEAD/origin-main baseline: `5d2e4787d217a0756093747bfb8aa979f4d2a4ba`.
- Core/App changes, existing test extensions and documentation are this bundle's
  pending work. The prior post-merge handoff is replaced here.
- PR #1480 merge CI `35767460247` and Release `35767460176` both succeeded.
- No PR or commit exists for this new bundle; old PR CI is not its verification.

## Implementation and evidence

- [Queue observations](../design/agentic-platform/agent-worker-queue-evidence.md)
  documents ownership, compatibility and limits; existing worker flow is preserved.
- Core adds the exact v2 worker-health read envelope with the unchanged v1 summary
  and nine queue rows. One bounded heartbeat query supplies all evidence; the v1
  collector preserves its original result. No schema/heartbeat envelope changes.
- Shared App Health/Doctor uses v2, keeps legacy v1 presentation, and distinguishes
  fresh subscriptions from paused/stale/stopped registrations. Null is unavailable;
  zero is only an observed sample count. Unknown workers are not assigned to queues.
- Contract tests: 4 passed. App focused tests: 37 passed. Selected PostgreSQL:
  18 passed in worker health, Runtime ops diagnostics and contract diagnostics.
- Dependency-complete build: 41 tasks passed. Final `pnpm verify --concurrency=2`:
  113 passed (62 cached), including Core 2,124 and App 586 unit tests. Existing Redis
  opt-in unit group: 13 passed / 3 skipped. Default-concurrency attempt exited 137;
  bounded retry passed without changing tests or code for that termination.
- Collector/contract independent review and presentation self-review completed.
  A presentation fixture with mismatched aggregate/queue counts was corrected.
- Final lint: 41 tasks passed (39 cached). Production browser: 88/88 passed,
  no retries/skips. Six queue captures at 320/768/1280 light/dark were inspected.
- Forty packed packages: fresh consumer install/typecheck/production build and
  operational journey passed. Core 438 / App 203 dist files and four changed App
  runtime sources match installed bytes. Details/logs use `/tmp/np-queue-*`.
- Formatting, local documentation target checks and `git diff --check` passed.
  Browser-generated untracked media was moved to task-owned temporary artifacts.

## Next boundary

- Complete the authorized PR/CI/merge and replace this handoff afterward.
- Full R5, actual spoken AT, exhaustive visual/state coverage, required queue
  coverage and processing progress remain open. This slice does not prove them.
- After merge, replace this handoff and choose the next coherent bundle; use a
  fresh thread when requested and preserve pending work.
