# Current work handoff

Observed after local acceptance of closed-approval source retention on 2026-09-18 KST.
Verify Git state and current verification logs before continuing.

## Objective and authorization

- User authorized implementing the next coherent bundle after PR #1454 merged.
- Current scope: release eligible cancelled/expired Runtime proposal source Runs
  with rejected or never-approved expired approval history, preserving evidence,
  current ACLs and consumed replay keys. Implementation and local acceptance are complete.
- User authorized committing, opening a PR and squash-merging this bundle after
  checks pass, then choosing the next task. Next implementation is not started.
- Preserve package versions, changesets and lockfile. Necessary generated
  migrations are allowed. No provider calls, new credentials, automatic
  Runtime/provider/worker activation or publishing.
- Do not merge Version PR #1366 or directly push main.

## Observed checkout

- Worktree: `/Users/baesw/development/nexpress-closed-approval-retention`.
- Branch: `codex/closed-approval-retention`; baseline/HEAD `9acdc097` (PR #1454).
- Pending changes belong to this bundle; no commit yet.
- Primary `/Users/baesw/development/nexpress` remains on main with its local
  documentation-only handoff pointing here. It does not contain this implementation.
- Prior PR #1454 exact-head CI `35320481161` passed all four checks. Merge-head
  Release `35322467080` passed. CI `35322467082` passed on attempt 2 after
  rerunning the PostgreSQL job that hit its 30-minute limit on attempt 1.

## Implementation and evidence

- [Retention flow](../design/agentic-platform/r5-runtime-retention-flow.md) owns
  the reference matrix and detailed acceptance evidence.
- Shared lifecycle/attribution proofs validate actual Runtime request projections
  and closed approval statements/decisions. MAC authentication stays with the
  approval owner; retention does not grant authority or erase original evidence.
- Creator/requester Runs have independent receipts. Current item ACLs, replay
  denial and bounded unknown-reference/active-job blocking remain.
- Existing proposal expiry now includes rejected proposals while retaining its
  active/consumed approval blocker. No cancellation contract expansion.
- V5 guards freeze approval/request/decision/audit evidence and allow only exact
  verified Run-locator detachment and existing nullable user metadata cleanup.
- Generated migrations 0058/0059 widen two edge CHECKs and install V5; earlier
  SQL/snapshots and V1–V4 bodies remain unchanged.
- Workspace verification: 113 tasks, including Core 2,098 unit tests. PostgreSQL:
  Core 64 and Web 1,449 passed (theme included); skipped native preview passed
  separately (1). Redis 16 and production browser 73 passed.
- Packed scaffold: 40 packages / 60 stages, five runtime script probes; no skips.
  Full lint: 41 tasks. Full format check and final diff check passed.
- Focused pure checks 97; generator 11; SQL protocol 28; existing approval resume
  regression 8; five new actual-producer PostgreSQL journeys passed again after
  the final request-discovery refinement. Final workspace verification also passed.
- Actual producer probes corrected rejected-proposal expiry, exact request masks
  (`approval_id=NULL`, input `approvalId:null`, no `mode`) and independent creator/
  requester evidence. Self-review corrected complete Runtime authority checks.
- Temporary verification wrapper/process interruptions are documented in the flow;
  completed test results were preserved and remaining gates resumed separately.
  Logs: `/tmp/np-closed-approval-*`; scaffold: `/tmp/nexpress-closed-approval-scaffold`.

## Next boundary

- Local implementation, self-review and required verification are complete.
- Complete the authorized PR/merge after exact-head CI, then refresh this handoff.
- Active/approved/consumed/revoked approvals, execution/rollback, unsupported
  request producers and unavailable historical generations remain pinned.
- General evidence pruning and full R5 acceptance are not completed by this slice.
- After a user-authorized merge, refresh this file and use a fresh thread for the
  next requested bundle.
