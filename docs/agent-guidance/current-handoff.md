# Current work handoff

Observed on 2026-09-18 KST. Studio Run/input retention implementation is complete;
local acceptance and self-review are complete. The user has authorized this bundle's
commit, push, PR and squash merge; verify GitHub for its final state.

## Objective and authorization

- Implement explicit release ownership for Studio staff-audit and Admin
  invocation results, preserving replay evidence and expired detail navigation.
- Implementation, necessary generated migrations and verification are authorized.
  The current user request additionally authorizes commit, push, PR and merge.
- Preserve package versions, changesets and lockfile. No credentials, real
  provider calls, automatic activation, worker installation or R6 recipe work.
- User is remote and dislikes repeated approvals. This bundle uses the existing
  unrestricted task with an isolated Git worktree, not a new restricted task.

## Observed checkout

- Worktree: `/Users/baesw/development/nexpress-studio-run-retention`.
- Branch: `codex/studio-run-retention`; baseline
  `7e8f3796cc3adcda1cc0d33a462eb2252f33d3cb` (PR #1451).
- All pending changes in this initially clean worktree belong to this bundle.
  Main remains separate; verify Git state before acting.
- PR #1451 is merged. Its post-merge CI `35288707857` and Release `35288707881`
  both passed. No PR exists for the current uncommitted bundle.

## Implementation and evidence

- `studio-source-release.ts` verifies linked Run/invocation/audit evidence,
  canonical fingerprints, exact result/target paths and expiry. The existing
  source-release transaction masks only those verified references.
- Audit/request/result/key bytes remain retained. Source Run/input deletion
  cannot re-admit a consumed Runtime key. Admin replay keeps the original result.
- Generated `0052_rapid_blockbuster.sql` extends two edge constraints;
  `0053_agent-studio-source-reference-lifecycle.sql` appends upgraded guards.
  The original migration SQL stays byte-identical. Snapshot changes are bounded.
- Activity detail uses a receipt-backed expired union with current staff and
  retained Action ACL checks. It exposes no source input, invented usage or live
  execution controls; lists retain existing live-source pagination.
- [Reference matrix and behavior](../design/agentic-platform/r5-runtime-retention-flow.md#studio-admission-reference-matrix)
  owns the feature boundary; final verification belongs there.
- Passed: verify 113 tasks; workspace lint; Core PostgreSQL 64; Web PostgreSQL
  1,427 ordinary cases across the full run and corrected 42-case rerun; theme
  suites included; explicit native preview 1; Redis 16; production browser 73
  across full/corrected runs; fresh packed scaffold 40 packages / 60 stages.
- [Exact evidence and initial failures](../design/agentic-platform/r5-runtime-retention-flow.md#studio-source-expiration-verification-2026-09-18)
  distinguishes full-run failures, corrected reruns and the explicitly enabled
  optional preview gate. Final Web typecheck passed.
- Self-review fixed union inference and historical migration preservation.
  Tests now scope invocation expiry updates, expect the new expired projection,
  verify retained Action ACL denial and isolate invalid-login request quotas.
  Large retention fixtures, production budgets and product rate limits remain intact.

## Next boundary

- Complete the authorized squash merge after all four exact-head checks pass.
  Logs/scripts use `/tmp/np-studio-retention-*`.
- Recommended next bundle: release eligible terminal mutation Run references
  owned by completed Actions/ChangeSets, approvals and rollback evidence. Define
  the exact retention/reference matrix first; preserve still-usable approval,
  rollback and unresolved-outcome evidence. Add explicit historical projections
  where sources can expire. Start implementation only on a fresh user request.
- Unknown/global audit, mutation Actions, approvals, rollback, active work and
  unresolved usage still pin source data. Derived provider/Action evidence keeps
  its own lifetime. This is not full R5 retention or full R5 completion.
- Do not merge Version PR #1366 or publish packages. After an authorized bundle
  merge, refresh this file and use a fresh thread for the next requested bundle.
