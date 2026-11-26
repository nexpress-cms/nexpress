# R6 approved Operator execution

An explicitly installed Operator can prepare an exact site-owned operation,
obtain a human decision through the existing approval service and execute that
approved plan once. The closed inventory is `cache.revalidate`,
`agent.run.retry` and `agent.run.cancel`. The earlier
[diagnostics and planning flow](r6-operator-diagnostics-flow.md) continues to own
status, audits and plan-only CLI handoffs.

## Authority and review

Executable plans have a separate sensitive `ops.execute` action and a real
signed approval statement. The statement binds the requester, action proposal,
capability fingerprint, current resolved policy and budget, target plan digest
and expiry. Existing staff-primary reauthentication and current staff capability
checks protect the human decision. The Admin approval view shows only the exact
operation, target, checks, plan digest and expiry; approval does not dispatch the
operation.

`createAgentApprovalActionTargetRouterV1` lets a host explicitly compose the
existing moderation and Operator approval owners. Routing by a same-site stored
action does not replace the selected owner's authority or integrity checks.
There is no default registration or authority fallback.

Execution rechecks the original requester, live approver, current policy and
budget, exact input and private artifact before consuming approval. Current
permissions also protect retained results. Changed or expired evidence requires
a new plan. Direct-action limits use the existing shared budget measurement;
Operator subjects are conservatively grouped by operation within the site.

The concrete App host additionally requires `NP_REMOTE_OPS_MUTATIONS=1` for all
three effects. Its deterministic `preflightExecution` runs before approval
consumption/reservation and again before dispatch, with a final flag check at
the effect boundary. When disabled, an already approved plan remains approved
and unconsumed; an authorized later retry still follows the existing expiry,
current authority and one-use checks. The flag neither installs an owner nor
replaces any approval, policy or target-access requirement.

Retained Activity review has its own explicit installation: supply
`authorizeReview` to [the App host](../../../packages/app/src/lib/agents/operator-host.ts)
and the Operator service as the Activity service's optional `operator` facet.
Current staff/site/target authorization is checked around the integrity-bound
read. [The pure review contract](../../../packages/core/src/agent-contract/operator-review-contract.ts)
admits only stable check IDs/states, the validated public plan, aggregate queue
facts, recorded recovery state/counts/times and execution state/result digest.
The Admin Activity card exposes no execution button, private artifacts, paths or
raw worker evidence. Historical recovery and expired plans remain clearly dated
evidence rather than renewed authority.

## Dispatch and uncertainty

The Operator owner persists a single-use execution reservation before effects.
A separate committed `dispatching` fence precedes the host operation. Only a
validated actual result produces a completed wire result and digest. A timeout,
exception or lost finalization retains unresolved execution evidence. Exact-key
retries do not blindly dispatch an uncertain effect again, and a different key
cannot reuse the consumed plan. No automatic repair or reconciliation worker
is installed.

Cache targets require an explicitly supplied host resolver and current target
access. The adapter binds the exact normalized invalidation request into the
private plan and recomputes it before calling `npInvalidateCache`. Global
collection tags or host-wide paths are never inferred from a site-owned request.
The existing adapter receipt determines the reported result; configuration
alone is not evidence of cache invalidation.

Runtime retry reuses the original retained intent and the current admission
owner. It creates a new queued run after current Agent/version, trigger/source,
policy, provider and budget checks. A scheduled retry preserves the failed
occurrence without consuming or advancing the trigger's next occurrence. The
source and resulting run links are saved in the same transaction as admission.
No provider or worker is started by this operation.

Runtime cancellation uses current authority and the existing run control lock.
It rejects work that has reached a mutation commit boundary, including related
ChangeSet execution or dispatched Operator work. It does not manipulate raw
queue jobs, erase unresolved provider usage or pretend to undo committed work.
The concrete adapter supports Runtime-owned runs; absent Gateway run owners
remain unavailable.

## Runtime approval continuation

An executable `ops.plan` keeps its Runtime request action pending and moves the
existing executor to `waiting_approval`. The existing approval continuation
claims a fresh lease, reconstructs the exact approved execution request and
invokes the same Operator owner. Completion resolves the original plan action
and exposes only validated execution evidence to subsequent provider context.
Rejected, revoked or expired approvals cannot authorize continuation. Replay and
repeated continuation retain the original result instead of creating another
effect.

## Persistence and retention

| Record              | Required references                                                         | Retention boundary                                                                                          |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Operator plan       | Original invocation and audit; optional approval action                     | Private artifact, review and approval evidence remain bound together.                                       |
| Operator execution  | Same-site plan, invocation, approval action and optional source/result runs | Reserved, dispatched, unknown and completed evidence remain referenced; no independent purge is introduced. |
| Retried Runtime run | Existing admission evidence; execution journal links both runs              | The retry relationship commits atomically with the new run and prevents premature source/result deletion.   |

Generated migrations add the execution journal and plan approval-action link.
The appended reference-fence migration extends the existing lifecycle without
rewriting applied SQL. Doctor, source-reference checks and dependency-safe site
deletion include the new table.

## Retained source update, 2026-10-15

Restore plans now preserve the backup owner's actual check IDs instead of
inventing index-based IDs. Explicit `reportSources` can add retained shipped
Doctor/release checks to authorized readiness status and source-change events.
The [source and monitor flow](r6-operator-source-monitor-flow.md) describes the
concrete bounded file reader, freshness/unknown rules and explicit maintenance
installation. Supplying a report never invokes Doctor, release or restore.

Focused checks passed Core contracts 16/16, App 30/30, three new PostgreSQL
retained-review/preflight cases and 22 existing Activity/execution/Runtime
regressions. The new review case checks persisted recovery from backlog 11 to 5,
safe Activity facts, changed authority and tampered evidence. A disabled
deployment flag leaves the actual approval unconsumed before reservation; the
same approved request can execute once after explicit enablement. Typechecks,
scoped lint, formatting and diff checks passed. The dedicated Activity browser
fixture belongs to the coordinated final gate; no live provider was called.

## Acceptance boundary

The original execution bundle does not add shell/SQL execution, migration or restore execution,
global queue control, provider credentials or automatic service activation.
AP-602 still needs additional scoped collectors and recipe/evaluation acceptance;
this was the original 2026-09-29 boundary. The retained-source update above closes
its listed review/source gaps; it does not establish full R5/R6 acceptance.
Versions, changesets and lockfile are deferred.

## Verification

The final source passed 15 new PostgreSQL cases: eight approved execution cases
and seven Runtime owner/continuation cases. The latter includes the actual
Runtime executor, approval owner and App cache facade with a deterministic local
provider and cache adapter. No external provider was called. A further 104
existing PostgreSQL cases passed across approval, moderation execution, Operator
planning, Runtime approval/controls/retention and source-reference fences.

The new cases cover one-use approval consumption, concurrent dispatch, retained
request/result tampering, current authority/policy/budget, expiry, known failed or
conflicted outcomes, uncertain effects without redispatch, atomic retry lineage,
scheduled retry and pre-commit cancellation. The real approval continuation
waits, resumes once, returns retained results and records revoked waiting runs
through the existing Runtime audit owner. Repeated resume after revocation is
rejected, consistently with the existing ChangeSet continuation contract.

On 2026-09-29, `pnpm verify --concurrency=1` passed all 113 workspace tasks,
including 62 repository checks, Core 2,194, App 651, Admin 174 and Web 174 unit
cases, package typechecks and the reference production build. `pnpm lint` passed
all 41 tasks; the final expectation-only Admin registry/OpenAPI updates also
passed scoped ESLint checks.

Production Playwright approval and Runtime suites passed all 17 cases with
retries disabled. The new Operator review covers cache, retry and cancellation
facts without adding an execution button. Both 390px and 1280px captures were
inspected: no horizontal overflow, clipped content or obscured decision controls.

A fresh project outside the workspace installed all 40 packed public packages,
passed typechecking including its configuration, generated and applied migrations
to a fresh database, and passed the Agent foundation checks (52 tables, 365
critical constraints and 17 deferred constraints), production build and scaffold
command journey. Installed Core agents, App Operator host and Admin client bytes
matched the verified producers. Logs use `/tmp/np-ops-exec-*`; the final new
execution and Runtime PostgreSQL logs are `/tmp/np-ops-execution-pg-final.log` and
`/tmp/np-ops-exec-runtime-final.log`.

Self-review, delegated review/results, modified-document links, formatting and
`git diff --check` passed. Snapshot comparison found only the new execution table
and approval-action link on Operator plans. Existing migration SQL, package
versions, changesets, lockfile and the pre-existing handoff edit were preserved.

The optional live Redis tests remained at 13 passes and three skips; theme
PostgreSQL and native preview were not rerun for this bundle. These scoped
results do not replace the outstanding full R5/R6 acceptance gates.
