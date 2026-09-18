# Current work handoff

Observed after PR #1452 merged on 2026-09-18 KST. Verify Git state and current
user authorization before continuing.

## Objective and authorization

- Studio Run/input source expiration and expired Activity detail are complete
  within the boundary linked below. Commit, push, PR and squash merge were authorized.
- The user asked to merge and choose the next task. The next bundle is proposed
  below; wait for a new instruction before implementing it.
- Preserve package versions, changesets and lockfile. Necessary generated
  migrations are allowed. No credentials, real provider calls, automatic
  Runtime/provider/worker activation or package publishing.
- User is remote and dislikes repeated approvals. Reuse an appropriately
  authorized task; do not create a restricted replacement for authorized work.

## Observed checkout

- Repository: `/Users/baesw/development/nexpress`; branch `main`.
- Implementation baseline: `3132673bc0288fcbc6e06c535b3494cd3fe9ef33` (PR #1452), synchronized with origin/main
  before this subsequent documentation-only handoff commit.
- PR #1452 squash-merged exact head `8b11e8f6a412f6a27df571fbc5e0de6ef776e529`.
- The implementation worktree is `/Users/baesw/development/nexpress-studio-run-retention`,
  branch `codex/studio-run-retention`; its work was committed and pushed.
- Verify current HEAD, cleanliness and remote synchronization before acting.

## Implementation and evidence

- `studio-source-release.ts` verifies exact linked Run/invocation/audit evidence;
  `source-release.ts` masks only verified references under the existing fence.
- Audit/request/result/key bytes remain retained. Expiration cannot re-admit a
  consumed Runtime key; Admin replay preserves the original result.
- Generated migrations 0052/0053 extend owner constraints and append V2 guards;
  historical V1 migration SQL remains byte-identical.
- `released-run-history.ts` and Activity detail expose a receipt-backed expired
  resource with current staff/retained Action ACL checks, no source input,
  invented usage, live controls or polling. Lists retain live-source pagination.
- [Reference matrix and behavior](../design/agentic-platform/r5-runtime-retention-flow.md#studio-admission-reference-matrix)
  and [full verification evidence](../design/agentic-platform/r5-runtime-retention-flow.md#studio-source-expiration-verification-2026-09-18)
  own detailed boundaries, local results and corrected initial failures.
- Local gate passed: verify 113 tasks; workspace lint; Core PostgreSQL 64;
  Web PostgreSQL 1,427 ordinary cases across full/corrected runs, including theme;
  explicit native preview 1; Redis 16; production browser 73 across full/corrected
  runs; fresh packed scaffold 40 packages / 60 stages. Self-review is complete.
- PR CI `35293022348` passed all four checks on the exact head above: typecheck/
  build/test, PostgreSQL, production browser and fresh scaffold.
- Post-merge CI `35294615210` and Release `35294615270` were still running
  at this checkpoint; check their final state before the next bundle.
- This documentation-only checkpoint does not change tested implementation.
  Check links, formatting and `git diff --check`; do not repeat application builds.

## Proposed next bundle

- Release Run/input sources for Runtime ChangeSets cancelled or expired before
  execution. Begin with the retention/reference matrix and existing cancellation
  reconciliation, source-release owners, reference fences and Activity projections.
- Limit eligibility to expired retention/invocation deadlines, terminal linked
  Actions/invocations and no approval, execution or rollback generation/history.
- Preserve original request/output, audit payload, proposal/plan, fingerprints
  and consumed keys. Release only exact verified live locators through receipts.
- Active validation/preview/upload, jobs/leases/retries, unresolved usage/outcomes,
  pending effects, recovery snapshots and unknown references must keep sources pinned.
- Acceptance: proposal → pre-execution cancel/expiry → source expiration →
  retained ChangeSet/audit/replay history; verify no reexecution, current authority,
  site isolation, late-reference fences and negative preservation cases.
- Exclude executed mutation/approval/rollback release, general audit pruning,
  derived-evidence deletion and R6 recipes. Full R5 retention/acceptance remains open.
- Do not merge Version PR #1366. Start the next bundle in a fresh thread when
  requested; refresh this file after the next authorized merge.
