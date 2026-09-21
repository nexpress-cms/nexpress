# Current work handoff

Observed 2026-09-21 KST. Verify Git state and ongoing checks before continuing.

## Objective and authorization

- User authorized the Agent maintenance execution evidence bundle after PR #1463.
  Implementation and final verification are complete; changes remain uncommitted.
- User now authorizes commit, push, PR and squash merge after exact-head CI,
  then selecting the next task. Next implementation awaits instruction.
- Keep versions, changesets and lockfile unchanged. No provider calls, credentials,
  automatic worker/runtime activation, publication or Version PR #1366 merge.
- Delegated atomic persistence and App presentation work was collected and reviewed.

## Observed checkout

- Implementation: `/Users/baesw/.codex/worktrees/2e7d/nexpress`, branch
  `codex/agent-maintenance-evidence`, baseline `6aa447492e7e0d9023c35e36aefb8f6be25970d0`.
  Pending uncommitted changes belong to this bundle; a new checkout lacks them.
- Primary `/Users/baesw/development/nexpress`: main at that baseline; only the
  local handoff pointer is modified. Preserve it when synchronizing.
- PR #1463 exact-head CI `35516543834`, merge CI `35517465569` and Release
  `35517465570` were all verified successful before starting this bundle.

## Implementation and evidence

- [Maintenance execution evidence](../design/agentic-platform/agent-maintenance-evidence.md)
  owns the contract, scope, verification results and limitations.
- Separate versioned `agents.runtime.maintenance` receipt; existing v1 cursor,
  job payload, tables and migrations remain unchanged.
- Retention batch pruning, cursor advancement and receipt share one bounded
  transaction. Legacy cursor tails cannot claim an entire sweep; rollback
  preserves earlier successful evidence. Reading never creates a receipt.
- Read-only Health/Doctor projection separates current-process registration,
  generic heartbeat, host-wide retained failures and sampled committed receipts.
  First 100 receipt-bearing sites only; no identifiers or private cursor exposed.
- Existing readiness check IDs/severity and explicit host activation are preserved.
- Focused Core/App units 28/54; full Core units 2,104; PostgreSQL 53/53;
  verify 113/113 tasks; lint 41/41; strict E2E TypeScript; production browser
  87/87 without retries. Six maintenance viewport/theme captures were inspected.
- Fresh packed Core/App consumer: 8/8 stages; 434/203 dist files match installed
  bytes, with 38 unchanged package artifacts reused. Detailed logs, corrected
  execution failures and unchanged-gate reuse are recorded in the flow document.
- Self-review corrected unobserved queue support to unavailable; unknown data
  remains distinct from zero and no receipt failure can preserve partial deletes.

## Next boundary

- Commit and squash merge this bundle after exact-head CI passes.
- After merge, refresh this handoff and use a fresh thread for the next bundle.
- Agent-specific remote consumer liveness and budget measurement readiness remain
  unprovided. Generic heartbeat or a successful cursor pass does not prove them.
- Actual spoken AT acceptance still needs an operator run of the
  [six-workflow checklist](../design/agentic-platform/admin-assistive-technology-acceptance.md).
  Do not repeat the failed VoiceOver investigation or fabricate spoken evidence.
