# R4 rollback compensation

This slice implements AP-405 and the rollback portions of AP-407/AP-408 on the
existing ChangeSet, approval, execution and verification services. AP-406
Agent HTTP/MCP execution capabilities and task projection remain open.
Validation for this rollback slice is complete; results are recorded below.

## Installation and surface

Rollback uses the explicit execution intent, approval keyrings, canonical
execution-definition resolver, convergence verifier and optional effect
inspection hooks from [R4 execution flow](r4-execution-flow.md). The resolver
also supplies the exact `changeset.rollback` definition. This binds authority
and fingerprints without advertising a Gateway capability. No runtime, worker,
provider call, listener, seed or default activation is installed automatically.

Three existing Admin operation registry rows now have implementations:

- `POST /api/admin/agents/changesets/{id}/rollback-plans` calls `prepareRollback`;
- `POST /api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/request-approval`
  calls `requestRollbackApproval`;
- `POST /api/admin/agents/changesets/{id}/rollback-plans/{rollbackPlanId}/execute`
  calls `executeRollback`.

They reuse the current staff/site admission, central CSRF, exact invocation
idempotency, reauthentication floor and normal audit. Preparation binds the
parent draft version and original plan hash. Request/execute bind the rollback
row's separate positive version and independent plan hash. Execution also
binds approval ID and statement hash. A generation is not a mutable row version.
Reference and scaffold wrappers only export the shared handlers.

The existing ChangeSet review includes `rollbackDetail` and server-derived
`rollbackActions`. Existing generic approval queue/decision/challenge routes
handle the exact `changeset_rollback` target and reuse the same MAC, expiry,
reauthentication and one-time challenge contracts. Rollback approval detail
uses `rollbackReview`; intendedOperation and scheduledFor remain null because
the capability ID and exact rollback target identify the operation.

Non-executing rollback cancellation reuses
`POST /api/admin/agents/changesets/{id}/cancel`. The existing parent-cancel
body is unchanged. Its second exact body branch carries
`targetKind: "rollback_plan"`, rollbackPlanId and expectedRollbackVersion,
alongside the parent expectedDraftVersion, rollback plan hash, expected state,
`OPERATOR_CANCELLED`, reason and idempotency key. Only preparing, ready,
approval_pending and approved plans can take this branch; it cannot cancel an
already executing compensation or undo a commit.

## Preparation and immutable evidence

Preparation verifies current item authority, the original sealed plan and
committed execution result, the rollback eligibility window and every original
snapshot. Each current target must still equal the original applied after
hash/version. A changed or missing target fails closed rather than overwriting
later work. Eligibility does not extend merely because audit retention still
holds reconstruction bodies.

A new bounded generation records its admitting invocation/authority,
compensated execution ID, original plan/result digest, current base fingerprint,
independent canonical rollback plan and exact ordered compensation operations.
Only one non-terminal generation exists per ChangeSet. Current schemas,
ownership, risk, scopes, human requirements and policy facts are sealed again.
The original plan, operation rows, apply result, approval, snapshots and audit
history remain unchanged.

The canonical rollback branch reuses existing operation inputs. Two exact
snapshot restoration variants are accepted only in rollback compensation:
`document/restore` and `theme_tokens/restore`, each with its existing resource
identity. The outer canonical operation already binds originalSnapshotHash and
expected current hash/version; no second raw restoration payload is accepted.
Initial draft/proposal operations cannot use restore.

The resource kernel reconstructs prior document content/status/schedule and
publish metadata from the verified original snapshot, then uses the normal
revisioned writer. A document created by the original plan is archived rather
than permanently deleted. Theme restoration preserves explicit override
absence. Navigation, the closed settings inventory and media-reference
compensation use existing domain writers. Missing required media or an
unrepresentable prior state is unavailable. No compensation is inferred from a
digest alone.

Full/residual/unavailable classification and visible residual codes remain
part of the sealed plan. Delivered email, webhooks, feeds, stored binaries and
external cache/index copies are not promised reversible. Rollback creates new
revisions and audit records rather than deleting history.

## Approval, execution and recovery

Each generation needs a fresh human approval bound to its own target and hash.
The existing execution transaction and per-site serialization recheck current
intent, authority, policy, approval integrity/expiry and current resource bases.
Compensation writes, new revisions, normal audit, result evidence, approval
consumption and the parent/rollback execution transition commit together.

A host explicitly invokes `processRollback` or registers the existing execution
job handlers, including `agent:changesetRollback`. Its exact payload binds site,
ChangeSet, rollback plan, plan hash, approval and idempotency key. The host owns
`reconcileRollbacks({ siteId, limit, cursor })` and bounded continuation; no timer
or worker is started by service construction or route loading.

The shared execution journal distinguishes apply and rollback with an exact
rollback-plan link. A committed reservation is not applied twice. Deferred
post-commit work and its uncertainty use the existing durable effect evidence,
leases and inspection-only recovery. Verification reuses the fixed check
inventory and binds rollback purpose and plan ID in its result digest while
preserving the previous apply digest representation.

Successful verification marks the plan verified and parent rolled_back.
Execution/verification failure records failed and rollback_failed. Preparation
conflict or invalidity leaves the original applied parent unchanged. Approval
rejection/revocation and operator cancellation terminate a non-executing plan
with their precise reason; approval/snapshot expiry expires that plan. A later
attempt creates a new generation if eligibility and current bases still permit
it. No terminal approval or generation is revived. A failed rollback plan cannot
be made verified by retrying verification: its failure remains terminal.
Its former `retry_verification` next actions become `refresh_plan`;
`inspect_effect` remains an investigation instruction, not permission to replay
a hook or revive the plan.
A terminal failed rollback keeps its state, result, verification digest and
finished timestamp immutable. The existing optional host
`inspectPostCommitEffect` may observe a retained pending, running or unknown
effect and CAS-record confirmed success or failure in execution effects and
version only. This path invokes neither convergence verification nor the opaque
effect itself. Missing observers, lost current authority, fingerprint mismatch
and unknown observations leave that effect unresolved.

Committed, verifying or ambiguous work still fences a new generation until its
retained outcome is resolved. Unresolved effects retain the new-generation and
site-deletion fences even when the rollback plan is terminal failed; Doctor
reports them through existing execution issue codes. Once a terminal generation
releases that fence,
a replacement must independently satisfy the current base hashes, remaining
rollback window and a fresh approval; it cannot reuse the old approval.

## Admin evidence and operations

The current review renders only safe compensation diffs after target and
snapshot verification. Document restoration selects currently declared editable
fields recursively, excluding hidden/read-only and undeclared snapshot metadata.
Safe status and publish-time changes are shown explicitly. Missing or expired
evidence has no invented diff. Approval review uses the same projection.

Buttons follow `rollbackActions`; known capability names do not create client
permission. Unknown responses retain the identical attempt key. Conflict or
access loss clears stale evidence, while safe reauthentication guidance remains
visible. Operators can inspect residual warnings, current plan state, execution
and fixed verification checks before requesting or executing compensation.

Generated migrations 0043 and 0044 add rollback plans/operations and their
reviewed deferred lifecycle references. Doctor covers 31 Agent tables and 167
critical constraints, including 11 deferred lifecycle foreign keys. Ordinary
site deletion follows the dependency order and preserves unresolved execution
relationships and refuses site deletion while their effects are unresolved.
Diagnostics describe retained metadata
and uncertainty; they do not invent MAC or external convergence verification.

For a conflicted target, prepare a new manual ChangeSet from current state.
For snapshot expiry, do not force retained bodies back into authority. For a
committed but uncertain effect, inspect its durable identity and resume bounded
verification without replaying opaque hooks. Never rewrite canonical evidence,
consume approval manually or erase the original apply history to force success.

Required validation includes current authorization/revocation/scope checks,
all compensation classes and absence cases, conflict races, atomicity and
one-time approval consumption, crash/lease recovery, safe review redaction,
Doctor/deletion, contract fingerprints, production Admin browser flows and a
packed fresh scaffold. Live Redis and restored theme PostgreSQL tests remain
required. Package versions and changesets are unchanged.

## Validation results

| Check                                              | Recorded result                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Workspace verification baseline                    | 113/113 tasks passed before the final effect-observation adjustment                                            |
| Final core build and typecheck                     | Passed; 1,713 unit tests passed                                                                                |
| Final reference production build and web typecheck | Passed                                                                                                         |
| Full lint and formatting                           | 41 lint tasks passed; formatting passed                                                                        |
| Full PostgreSQL suites                             | 1,147 web tests and 67 core tests passed                                                                       |
| Final affected PostgreSQL regression               | 73/73 passed                                                                                                   |
| Terminal-effect inspection regression              | 5/5 passed; existing apply/lease regression 11 passed                                                          |
| Redis                                              | 16 passed, including 3 against live Redis                                                                      |
| Theme PostgreSQL                                   | 5 passed within the full PostgreSQL suite                                                                      |
| Native preview opt-in                              | Separate enabled Chromium test 1/1 passed                                                                      |
| Final production Playwright                        | 60/60 passed on the frozen final build                                                                         |
| Packed fresh scaffold                              | Full 53 passed; final core refresh 14/14 stages passed, with installed Core byte-identical to the frozen build |
| Diff hygiene                                       | `git diff --check` passed; no package version or changeset changes                                             |

The normal web PostgreSQL suite skips the native-browser opt-in case; the
separate enabled run above supplies that coverage. The default workspace run
also skips three Redis opt-in cases; the separate live Redis run passed all
16 tests, including those three. Final production browser
validation includes all four rollback flows and the corrected approval guidance.
Only newly generated media matching the exact test fixture bytes was removed.
The final packed refresh confirmed 31 Agent tables, 167 critical constraints,
11 deferred lifecycle foreign keys and 30 ordinary deletion tables; empty Agent
rows and disabled healthy diagnostics remained intact. The 32 MiB physical
result-body bound was verified, and the isolated database was removed.

## Self-review corrections

- Terminal rollback failure cannot become verified on retry. State, result,
  verification digest and completion time remain immutable, while safe next
  actions direct operators to a new plan or effect inspection.
- The existing optional effect inspector may record confirmed outcomes only;
  it cannot replay an opaque effect or run convergence checks. Unresolved
  effects retain new-generation and site-deletion fences after plan failure.
- Rollback document diffs project currently declared editable fields, excluding
  hidden, read-only and undeclared snapshot metadata. Restoration bodies remain
  private and canonical snapshot hashes bind compensation.
- Compensation document writes alone bypass revision pruning to preserve
  original revision history. Ordinary document writes retain their existing
  revision limit.
- Lost prior schemas or references persist a safe invalid rollback plan;
  `ACCESS_DENIED` remains an authority error rather than being reclassified as
  plan invalidity.
- Non-executing rollback cancellation reuses the existing ChangeSet cancel
  route with an exact rollback target and independent row-version CAS.
- Approval guidance now points to the current ChangeSet review for execution;
  the full browser suite verifies the final wording and server-derived controls.

Explicit host installation, current authority, fresh approval, rollback window
and current resource bases remain prerequisites. AP-406 Gateway execution and
task exposure remain later work; no automatic worker or default activation is
introduced.
