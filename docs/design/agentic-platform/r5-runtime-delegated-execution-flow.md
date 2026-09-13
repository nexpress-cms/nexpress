# R5 explicit delegated execution and approval recovery

This slice extends AP-505/AP-506 over the provider/read execution foundation
merged in PR #1440 (`ee16abd9`). It reuses the existing Runtime, principal,
ChangeSet, approval, invocation, action and execution owners. Local acceptance
passed on 2026-09-12. This does not establish the full R5 gate.

## Explicit authority

The existing `agents.configurations.create` command accepts an optional
`authority: { kind: "user", userId }`. The selected id must equal the currently
admitted staff user's id. Omission preserves deployment authority. Creation
retains a draft Agent and suspended principal; existing activation admission
and reauthentication remain required. Update cannot rebind authority.

No identity is inferred from the Agent creator. No session, Gateway token or
synthetic administrator is created. Current deployment scope ceilings, frozen
and current Agent policy, actual staff membership/capabilities and item ACLs
all remain necessary. Deployment principals retain their public/published
content read path without gaining staff-only schema or ChangeSet access.

New Run admission evidence binds principal token version, principal authority,
deployment authority and current staff authorization in the existing private
admission sources and canonical admission digest. The optional extension keeps
old deployment admission bytes compatible. A legacy Run without this evidence
cannot acquire user authority. Membership changes, removal/regrant and
super-admin changes invalidate existing delegated principal versions. Existing
authority-loss containment also covers Runtime principals before user deletion.

## Existing execution owners

Installed ChangeSet descriptors join the same Runtime capability inventory
only under real staff authority. Runtime mutations use the existing canonical
`runtime` actor and Run relationship, idempotency journal, current resource
read/write checks, validation, preview, approval and execution services.
Transaction stages join current Run admission; preview storage I/O remains
outside authority and parent locks. The host explicitly installs each service.
Stored validation, preview and scheduled execution also verify their exact
admitting invocation and current phase permission before work. Direct Runtime
mutation without the shared invocation context is rejected. Discovery intersects
the selected recipe and the minimum legal autonomy permission, while invocation
continues to enforce its exact phase.

The model receives bounded action metadata and currently authorized ChangeSet
references needed for its next invocation: ids, versions, hashes, closed states
and the existing cursor. These are projected from verified descriptor outputs
and checked again by the context builder. Titles, raw diffs, operation input,
credentials and internal evidence never become trusted action facts.

An approval request action remains immutable. Explicit
`executor.resumeApproval({ siteId, runId, requestActionId })` verifies that exact
request and signed approval, then creates or reuses a distinct approved
execution action. The execution key is derived from the original request.
Stored input, output and invocation digests, current authority, approval target
and execution receipt must agree before the request counts as fulfilled.

Each approval claim increments the existing bounded attempt counter, fencing
old leases without introducing another lease column. Pending approval does not
claim work or call the provider. Scheduled or unresolved execution remains
`verifying`; ordinary recovery cannot plan past it. A completed execution can
continue the bounded provider loop. Terminal replay adds no execution or call.

Action sequence is independent of provider-call sequence because approved
execution adds its own action. Existing mutation idempotency and canonical
read-input evidence identify replay; new actions allocate the next bounded
sequence while the Run is locked. Successful completion and retry both inspect
the exact execution receipt instead of rewriting the approval request.

## Scope and verification

This slice adds no table, migration, runtime HTTP route, automatic worker,
provider installation, seed, default activation, package version or changeset.
The Doctor inventory remains 40 Agent tables and 266 critical constraints.
AP-503 trigger/event work and AP-507/AP-508 Studio, operations and retention
remain separate work. Tests use injected fake inference, not paid providers.

Final local verification passed against the completed working tree:

| Check                   | Result                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Workspace `pnpm verify` | 113 build/typecheck/test tasks, including the reference app                                                                     |
| Workspace `pnpm lint`   | 41 tasks                                                                                                                        |
| Core unit               | 1,854 cases in 192 files                                                                                                        |
| Core PostgreSQL         | 67 cases in 10 files                                                                                                            |
| Web PostgreSQL          | 1,373 cases in 149 files; includes all five theme-render cases                                                                  |
| Native preview security | 1 case with real Chromium and ephemeral HTTPS                                                                                   |
| Live Redis              | 16 cases; ephemeral container removed                                                                                           |
| Production Playwright   | 62 cases; no failures, retries or skips                                                                                         |
| Packed fresh scaffold   | 40 packages and 56 stages, including migrations, disabled/empty Agent foundation, build, extension matrix and first-run journey |

The ordinary PostgreSQL run skips only the explicitly gated native-preview
case; that same case passed separately with `NP_TEST_PREVIEW_BROWSER=1`.
The full web run completed in 904.56 seconds with two workers. Test databases,
browser servers and the Redis container were cleaned up. Packed artifacts are
retained outside the repository for review.

`git diff --check` passes. Package versions, changesets, the root lockfile and
migration files are unchanged. Configured secret values and credential-bearing
URLs were checked against the diff, new files and verification/packed logs with
zero matches. No paid provider request was made; live provider interoperability
is not claimed. These results record local acceptance before PR creation.
The pull request records the four CI checks for the exact submitted head.

The focused PostgreSQL tests currently pass 36 cases: delegation and real item
reads (11), membership/version concurrency (6), approval resumption (8),
ChangeSet authority/receipt integrity (6), rollback (1), queued validation and
preview policy changes (2), scheduled policy changes (1), and projection lock
ordering (1). The provider-enabled resume fixture uses the real context,
Vault, usage and inference host with an injected fake adapter; completed replay
does not make another call or append another action.

Self-review corrected the missing create-command parser extension, the mistaken
requirement for a non-null approval column on a `domain.read` request action,
missing next-step safe references, stale-claim reconciliation, fulfilled-request
retry gating, current policy checks on durable work, and Runtime projection
lock inversion. Runtime projection now acquires the Run before its ChangeSet
parent. PostgreSQL barriers inspect actual lock waits rather than relying on
short sleeps. Existing Gateway lock and approval contracts remain unchanged.
