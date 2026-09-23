# Current work handoff

Observed 2026-09-23 KST. Verify Git and checks before continuing.

## Objective and authorization

- The user authorized implementing Agent queue backlog observations after PR #1481.
- This bundle includes the preceding worker integration fixture race correction.
- The user authorized commit, push, PR and squash merge, followed by selection
  of the next bundle. Require green CI on the exact PR head.
- Keep versions, changesets and lockfile unchanged. No automatic worker/runtime
  activation, credentials, provider calls, publication or Version PR #1366 merge.

## Observed checkout

- Repository `/Users/baesw/development/nexpress`, branch `codex/agent-queue-backlog`.
- HEAD/origin-main baseline `fd563277875302cb973f531265b581ab15c57390`.
- All pending implementation, tests and documentation belong to this bundle;
  the prior local post-merge handoff is replaced here.
- PR #1481 exact-head CI passed. Post-merge Release `35807181308` succeeded;
  CI `35807181273` failed one worker lifecycle fixture due to its clock race.
  This bundle fixes that fixture without changing its product assertions.

## Implementation and evidence

- [Queue backlog flow](../design/agentic-platform/agent-queue-backlog-evidence.md)
  records scope, ownership, time meanings and query limits.
- Jobs owns read-only canonical pg-boss observations on the existing DB handle;
  the pure additive v1 wire preserves all prior adapter and worker contracts.
- Health/Doctor share due/scheduled/active labels, age evidence and limitations.
  Absent storage and failed reads remain unknown rather than zero.
- Contract tests 2 / focused App 39 / real PostgreSQL 9 passed without skips.
- Final `pnpm verify --concurrency=2`: 113 tasks passed (3 cached), including
  Core 2,126 / App 588 / Web 174. Lint: 41 passed (39 cached).
- Production browser: 88/88 passed without retries/skips. Six backlog captures
  at 320/768/1280 light/dark were inspected; they show actual unsupported storage.
- Forty packed packages: fresh install/typecheck/production build and operational
  journey passed. Core 438 / App 203 dist files and five changed App runtime sources
  match installed bytes. Detailed evidence and limitations are in the flow.
- Self-review corrected SQL parameter expansion, due-time equality, shared SQL
  snapshot clock and state coercion; affected tests were rerun. Agent handoffs
  were collected. Formatting, local links and `git diff --check` passed.
- No versions, changesets, lockfile or migrations changed. No providers/workers
  activated. Existing Redis opt-in units retain 13 passes / 3 skips.
- Logs/artifacts: `/tmp/np-backlog-*`; no new commit or PR exists yet.

## Next boundary

- Complete the authorized commit/push/PR/merge after exact-head CI passes.
- Counts are host-wide retained pg-boss facts, not tenant-specific, custom-adapter
  evidence, actual processing progress, required queue coverage or readiness.
- Full R5 and spoken assistive-technology acceptance remain open.
- After an authorized merge, replace this handoff; start the next bundle in a
  fresh thread when requested and preserve pending work.
