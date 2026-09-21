# Current work handoff

Observed 2026-09-21 KST. Verify Git state before acting.

## Objective and authorization

- User authorized the Agent worker subscription evidence implementation after
  PR #1465. Implementation, self-review and verification are complete and uncommitted.
- User now authorized commit, push, PR and squash merge of this bundle,
  then choosing the next task. Next implementation awaits a separate instruction.
- Keep versions, changesets and lockfile unchanged. No provider calls, new
  credentials, automatic worker/runtime activation, publication or Version PR #1366 merge.
- Delegated lifecycle, surfaces and integration lanes returned their results;
  coordinator reviewed and completed the combined gates.

## Observed checkout

- Implementation: `/Users/baesw/.codex/worktrees/agent-worker-evidence/nexpress`,
  branch `codex/agent-worker-evidence`, HEAD `6217e0a1074e26be1411bd8cff896d87cff3d45b`.
  All pending code/tests/docs in this worktree belong to this bundle; no commit exists.
- Primary `/Users/baesw/development/nexpress` remains on main at `6217e0a1`, with
  only the local handoff updated to point to the implementation worktree.
  A fresh worktree will not contain these uncommitted changes.
- Previous PR #1465 is merged. Its exact merge-head CI `35573451301` and
  Release `35573451153` both passed; this grants no publication authority.

## Implementation and evidence

- [Worker subscription evidence](../design/agentic-platform/agent-worker-evidence.md)
  owns the contract, trust boundary, implementation, verification and limitations.
- Existing pg-boss/worker/heartbeat owners record successful subscriptions and
  fail closed for lifecycle transitions/partial failures. Host metadata cannot
  forge the reserved versioned observation. Existing outer contracts and DB schema remain unchanged.
- The bounded read collector projects aggregate categories from the latest 100
  heartbeats, preserves unknown versus zero, and uses the original Health/Doctor
  DB ownership. Shared protected Health/Doctor presentation preserves severity.
- Final verify 113/113 tasks; lint 41/41; Core units 2,116; PostgreSQL 59/59
  (Core 8, Web 51); focused lifecycle 24, aggregate contract 2, App 12; strict E2E types.
- Production browser 86/87 initial passes; the existing mobile collection-list
  draft-POST wait timed out. Targeted recheck passed unchanged (1/1, 2.6 seconds).
  Do not describe this as an uninterrupted 87-pass run. Six worker captures
  inspected at 320/768/1280 light/dark; actual browser snapshot has no workers.
- Fresh packed Core/App consumer 8/8 stages; 435/203 dist files match installed
  bytes. Reused 38 unchanged package artifacts. Not a new full 40-package/R5 gate.
- Detailed logs `/tmp/np-worker-*`; generated browser public files moved to
  `/tmp/np-worker-generated-public`. Test-only ignored `.env.local` remains in
  the implementation reference app. Existing Turbo cache is reused by symlink.
- Source self-review and documentation checks passed. Cold dependency output
  and cache setup failures were resolved before the completed gates; no test
  deletions or timeout increases were used to hide them.

## Next boundary

- On explicit merge request, review this worktree's complete diff, preserve the
  version constraints, commit the coherent bundle, push/create one PR and wait
  for exact-head required CI before squash merge. Refresh this handoff after merge.
- Subscription plus fresh heartbeat is not job progress, provider readiness,
  authority or all-queue coverage. Stop markers do not prove drain completion.
- Actual spoken assistive-technology acceptance remains an operator checklist;
  do not fabricate evidence or claim full R5 acceptance from this bundle.
- Choose the next coherent bundle after merge; do not start another implementation
  or lose pending work by moving to a fresh checkout.
