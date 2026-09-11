# R4 ChangeSet execution and verification

This slice implements AP-402/AP-403/AP-404 and the execution portions of
AP-407/AP-408 on the existing ChangeSet and approval services. The subsequent
[R4 rollback slice](r4-rollback-flow.md) adds AP-405 compensation, and
[R4 Gateway execution slice](r4-gateway-execution-flow.md) connects AP-406 Agent
HTTP/MCP execution and bounded run/task projection. Validation of this slice
passed; current AP-406 results are recorded in the Gateway flow, including the passing final 66-case execution PostgreSQL run and
40-package/56-stage packed scaffold refresh. The R4 section 18 acceptance gate passed.
See [R4 approval flow](r4-approval-flow.md) for the preceding approval boundary.

## Explicit installation

The existing `createAgentChangeSetServiceV1` host options accept `execution`
alongside the explicit approval keyrings and canonical execution-definition
resolver. The host supplies:

- `resolveIntent({ siteId })`: current enabled/paused execution intent;
- `verificationFingerprint`: the immutable convergence contract fingerprint;
- `verifyConvergence`: bounded checks for cache, search, media and public routes;
- optional `enqueueApply` and `enqueueVerify` dispatch hooks;
- optional `inspectPostCommitEffect`, which inspects an existing opaque effect
  and returns only `succeeded`, `failed` or `unknown`.

These options do not construct a runtime, queue, worker, provider, timer or
listener. The default reference and generated apps leave the runtime absent.
A host may explicitly call `registerExecutionJobs()` to register the existing
job names `agent:changesetApply` and `agent:changesetVerify`; registering handlers
alone neither starts a worker nor dispatches a job. Existing job site scope and
quota handling remain authoritative.

The facade exposes `apply`, `schedule` and `cancel` with the existing current
staff actor, ChangeSet ID and exact command. Each returns the existing
`NpAgentChangeSetReviewV1`. The shared Admin routes are:

- `POST /api/admin/agents/changesets/{id}/apply`
- `POST /api/admin/agents/changesets/{id}/schedule`
- `POST /api/admin/agents/changesets/{id}/cancel`

Reference and scaffold routes are thin `@nexpress/app` exports. Execution detail
is part of the existing review GET, not a second history contract. There is no
public verification mutation route and no new advertised Gateway capability.
The approval definition resolver binds the intended execution definition; it
does not by itself advertise a tool or grant execution authority.

## Admission and atomic apply

Apply and schedule bind `expectedDraftVersion`, `planHash`, `approvalId`,
`statementHash` and one bounded idempotency key. Schedule additionally requires
the exact canonical UTC instant already signed in the approval. Admission
reuses staff session, current site capability, central CSRF, reauthentication,
invocation idempotency and audit contracts. Schedule intent cannot be converted
into immediate apply or moved to a different time with the same approval.

A durable same-site execution reservation binds the existing invocation,
approval, plan, intended time and verification fingerprint. The processor
rechecks live intent, approval integrity and expiry, required human authority,
resource authority, current policy, definition and any required live preview.
An external requester additionally retains the stored Gateway authority,
transport audience, scopes and `approved-execute` exposure checks. Approval
never upgrades a `propose` credential ceiling.

Per-site transaction serialization and resource locks protect the sealed base
from concurrent writers. The resource adapter reuses the existing document,
navigation, theme-token, SEO and media-reference writers under the same outer
transaction. Current resource schemas and ACLs remain authoritative; stable
reserved document IDs do not bypass document-create behavior. An invalid base
requires a fresh plan instead of overwriting newer work.

Content mutations, revisions, operation result evidence, approval consumption,
execution commit, parent state and normal audit commit together. Actual after
hashes come from persisted resource reads. A database commit establishes
`applied`; it does not establish `verified`. The recorded rollback eligibility
window is metadata only: no rollback executor or rollback control is installed.

## Explicit processing and recovery

The host owns these bounded entry points:

- `processExecution(job)` checks the exact persisted apply/schedule payload and
  refuses early scheduled dispatch. A committed reservation is never applied
  again; later processing uses its retained verification evidence.
- `processVerification(job)` verifies one committed execution using its exact
  site, ChangeSet and execution IDs.
- `reconcileExecutions({ siteId, limit, cursor })` scans at most 100 retained
  execution rows per call. The returned cursor permits bounded continuation.
  The host decides when to resume scans and when to restart from the beginning.

Host callers may pass an `AbortSignal` as `processExecution(job, { signal })`.
An abort observed before domain writes closes the reservation with
`EXECUTION_CANCELLED` and canonically revokes remaining approval authority.
Once atomic domain writes begin, their outcome remains authoritative; an abort
never claims to undo a committed transaction.

Failure to enqueue does not erase the durable reservation. Serialization
conflicts retain recoverable work. Operators must distinguish pre-commit failure,
committed content awaiting verification and an ambiguous effect; none permits
blindly replaying opaque post-commit work.

The existing deferred post-commit boundary records a bounded effect inventory
before dispatch. Effects are dispatched after the outer commit, and their safe
states are retained separately from content success. A 60-second execution lease
fences this dispatch interval; only its owner may dispatch or release it. The
30-second bounded drain leaves time for final journal writes. Duplicate apply
and verification processors respect this lease, so an active hook is not
mistaken for a failed verification. Recovery may inspect remaining effects only
after the lease expires. A pending/running/failed
effect is not treated as completed simply because a process restarted. Opaque
hooks are not automatically replayed by verification. The optional inspector
receives the retained effect identity and an abort signal within the bounded
verification wait. It must inspect only, never redispatch a hook; missing or
uncertain inspection remains unknown.

## Verification and Admin evidence

The fixed check inventory is `resource_after_hashes`, `revisions_audit`,
`post_commit_hooks`, `cache`, `search`, `media`, and `public_routes`. Checks carry
separate `required`, severity and status fields, bounded operation/artifact
references and a fixed next-action code. They never contain arbitrary host
messages, canonical bodies, locators, credentials or chain-of-thought.

The framework verifies actual resource hashes and revision/audit evidence.
The explicitly supplied convergence hook verifies the four host-dependent
checks with an abort signal and bounded wait. Unknown, timed-out, malformed or
unavailable results remain unavailable. Verification uses a leased attempt and
rechecks resource evidence before its final transaction. The result digest binds
site, ChangeSet, execution, verification contract and the exact ordered checks.
A missing dependency or changed verification fingerprint cannot produce success.

Admin controls use only the review's server-derived `executionActions`.
An absent runtime or unavailable authority does not create optimistic actions.
Apply/schedule submit the current sealed approval binding; schedule input is
converted to UTC. Cancel uses the exact current cancellable state and the closed
`OPERATOR_CANCELLED` reason code. Cancellation does not undo a committed change.
Unknown responses retain the same attempt key; conflict or access loss clears
stale evidence. Reauthentication guidance remains visible after evidence clears.

The execution section distinguishes reservation, commit, verification and safe
failure states. Check counts and rollback timestamps do not assert successful
convergence or an available compensation plan.

## Operations and release checks

Migration `0042_agent-changeset-execution.sql` adds the execution journal to the
existing Agent inventory: 29 tables and 144 critical constraints, with 28
ordinary site-deletion tables. Same-site references, state matrices, bounded result
and effect evidence, lease state and verification fields are checked by the
schema and Doctor. Actual snapshots retain the canonical aggregate 16 MiB limit;
the result-body storage guard allows 32 MiB for PostgreSQL JSON formatting and
metadata overhead. Site deletion includes the journal before its dependencies.
Doctor reports retained divergence, stale work and failed verification through
`AGENT_EXECUTION_DIVERGED`, `AGENT_STALE_EXECUTION` and
`AGENT_EXECUTION_VERIFICATION_FAILED`; metadata health is not a substitute for
live convergence.

For stale work, inspect the current authorized review and safe Doctor state,
confirm the required host dependencies, and invoke bounded reconciliation.
After a committed effect becomes uncertain, investigate its durable identity
before retrying verification. Do not edit retained canonical evidence, force an
approval to consumed, or infer that an absent response means no commit occurred.

Required release validation includes workspace lint/typecheck/unit/build,
PostgreSQL authority and transaction/recovery regressions, Admin browser flows,
OpenAPI/registry closure, and packed fresh-scaffold verification. Live Redis
cases and the restored theme-render PostgreSQL cases are required checks from
the preceding merge follow-up; they are not intentional skips. The existing
opt-in native preview browser verification requires a separate explicit run.
Package versions, changesets and default runtime activation remain unchanged.

## Self-review findings

Scheduled staff-origin work now rechecks the approved human's current authority
without depending on the draft creator's old session; external-origin work also
retains its current principal, audience, token-version, scope and exposure checks.
Approval maintenance uses that same execution authority boundary. Document hooks
receive the existing exact staff projection instead of a complete database row.

Serialization and deadlock failures retain recoverable reservations. Persisted
snapshots preserve the canonical size limit while allowing PostgreSQL formatting
overhead. A duplicate processor cannot verify content while the original
post-commit dispatcher holds its lease, nor release that dispatcher's lease.
Controlled concurrency, authority-loss, failed-hook and recovery regressions
cover these corrections; uncertain opaque effects remain inspect-only.

## Validation record (2026-09-09)

- Workspace `pnpm verify --concurrency=1`: 113 tasks passed, covering typecheck,
  unit tests and builds. Workspace lint: 41 tasks passed. After the final lease
  correction, core and reference production builds, targeted lint and affected
  PostgreSQL regressions passed again.
- Full PostgreSQL runs: core 67 passed; web 1,115 passed and one opt-in native
  preview case skipped. That preview case passed in its separate explicit run.
  The final affected five-file regression run passed all 75 cases, including
  the added post-commit dispatch race. The full web run includes the restored
  five theme-render cases.
- Redis suite: 16 passed, including three actual Redis 7 integration cases run
  separately from the generic workspace's conditional skips.
- Final production Playwright: 56 passed without retries. Isolated databases
  and the exact generated media fixtures were cleaned up.
- Packed scaffold: the complete 53-stage run passed. After the final core fix,
  the 14-stage fresh-project run repacked core and reused the 39 unchanged,
  previously verified archives. Installation, typecheck, migration, production
  build, extension matrix and first-run journey passed. Installed-code checks
  confirmed the dispatch lease fix, 29 tables, 144 critical constraints, empty
  Agent rows, the physical result-body bound and disabled healthy defaults.
- `git diff --check` and source/log secret-value scans passed. Package versions
  and changesets are unchanged.

Tests exercise explicit host fixtures and convergence adapters. They do not
certify a deployment's real external cache, search, media or route adapter;
the host must install and validate those dependencies before enabling execution.
