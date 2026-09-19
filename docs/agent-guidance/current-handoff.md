# Current work handoff

Observed 2026-09-19 KST. Verify Git state before continuing.

## Objective and authorization

- User authorized the Admin error-recovery bundle after PR #1458, including
  implementation, self-review and verification. This bundle is complete locally.
- User now authorizes commit, push, PR and squash merge after passing CI, then
  selecting the next bundle. Next implementation is not started by that request.
- Preserve versions, changesets and lockfile. No migration is needed. Necessary
  future migrations are allowed after review. No provider calls, new credentials,
  automatic activation, publishing or Version PR #1366 merge.

## Observed checkout

- Pending work: `/Users/baesw/development/nexpress-admin-acceptance`, branch
  `codex/admin-error-recovery`, baseline `b34dc7a68ff96f0facc3b9dd6db10898f9c071cf`.
- The prior completed worktree was reused on a new branch to avoid duplicating
  installed dependencies. All current Admin/test/doc changes are uncommitted.
- Primary `/Users/baesw/development/nexpress` remains on main at the baseline,
  with only this documentation pointer changed. A fresh checkout lacks pending work.
- PR #1458 exact-head CI `35372125515`, merge CI `35374408041`, and Release
  `35374408080` all succeeded. No Version PR merge/publication was performed.

## Implementation and evidence

- [Error recovery](../design/agentic-platform/admin-error-recovery.md) owns current
  behavior and verification. [Admin acceptance](../design/agentic-platform/admin-acceptance.md)
  owns the broader 20-route inventory and remaining gaps.
- Internal error metadata preserves valid 429 Retry-After deadlines. Shared
  recovery UI hides sensitive children on 401 and links to the existing login;
  429 retains mounted drafts, blocks premature retry and never replays requests.
- Runtime, connection/Gateway, Activity, Approval and ChangeSet owners propagate
  typed failures. Dialog portals guard their own submissions. All prior 403
  invalidation remains; recent reauthentication is distinguished by safe copy.
- Partial budget/Runtime reads retry independently; healthy budget drafts survive.
  Review invalidation aborts pending reads and uses the current generation, so old
  mutation closures or late GETs cannot restore evidence or stick in loading.
- Build 41 tasks, final verify 59 repository checks / 113 tasks, lint 41 passed.
  Production browser 77/77 and packed consumer 7 stages passed. All ten Admin
  dist files match build/tarball/installed consumer; 39 unchanged packages reuse
  the verified baseline. The recovery record distinguishes reused integration gates.
- Browser diagnostics fixed an invalid cancel-state fixture, a moving test-clock
  boundary and duplicated reauthentication announcements. Do not weaken assertions.
- Initial packed consumer build stopped on ENOSPC. Only this task's regenerable
  completed artifacts were cleaned; failed logs were preserved before sequential
  retry. See `/tmp/np-admin-recovery-*` for logs and exact artifact evidence.

## Next boundary

- Implementation, self-review and scoped verification are complete. Create one
  bundled PR, verify exact-head CI, then squash merge under current authorization.
- Full R5/Admin acceptance still requires actual screen-reader workflows and
  unresolved per-surface/state/visual evidence. Do not infer a human test pass.
- After authorized merge, replace this handoff and use a fresh thread for the
  next requested bundle. Do not reopen completed Runtime retention/input work.
