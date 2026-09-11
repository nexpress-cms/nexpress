# R4 Gateway execution and acceptance

AP-406 connects the existing approval, ChangeSet execution and compensation
services to Agent HTTP and MCP. The remaining AP-407/AP-408 work reuses Admin
Activity, bounded review refresh and aggregate Doctor diagnostics. The R4
acceptance gate passed with the verification and scenario evidence below.

## Installed surface

The explicitly installed ChangeSet facade adds `changeset.apply`,
`changeset.schedule` and `changeset.rollback` to the existing five ChangeSet
capabilities and three read capabilities. One descriptor source owns discovery,
exact invocation schemas, MCP tool projection and Agent HTTP OpenAPI branches.
See [the capability contracts](capabilities-and-mcp.md) for normative inputs and
outputs. Existing R3 invocation results retain their original contract.

Apply and schedule with `approvalId:null` request a human decision for the exact
sealed plan. Rollback retains its prepare, request-approval and execute-approved
modes. A separate invocation with a new idempotency key supplies the approved
target/hash tuple. Gateway exposure is a ceiling, never an approval decision;
domain effects require `approved-execute` across deployment, site and immutable
credential/grant authority as well as the existing live scopes and human approval.
MCP cannot approve its own request.

The Agent HTTP surface remains the same four routes. Reference and generated
projects re-export their shared implementation. No listener, extra route,
provider call, automatic factory, automatic worker, seed or default enablement
is installed. Hosts retain responsibility for explicit execution intent,
keyrings, convergence adapters and bounded processor/reconciliation calls.

## Real Gateway runs and MCP tasks

These three capabilities create actual Gateway run/action evidence linked to
the admitted invocation and existing ChangeSet journals. A run is not an R5
Agent Runtime: no Agent version, provider usage or model activity is invented.
Action input and target inventories retain their canonical integrity binding;
raw execution inputs never become Activity output.

Negotiated task requests use the existing durable MCP task service. Its
authorization context, task-mode/TTL idempotency, active limits, bounded polling,
opaque cursors and immutable terminal results remain authoritative. A request
requiring approval completes its task with the exact approval-required result;
later approval or execution cannot revive or rewrite that task. A non-task
caller receives the existing bounded invocation result and real run reference.
Cancellation uses the existing authorized domain cancellation path and cannot
undo committed content. Task expiry does not erase execution history.

Migration 0045 updates the existing invocation MCP-mode constraint for stdio
task attribution. It adds no table or new critical-constraint identity: Doctor
remains at 31 Agent tables, 167 critical constraints and 11 deferred lifecycle
foreign keys.

## Admin and operational visibility

Activity's optional `changesets` dependency uses the existing ChangeSet `get`
facade with the current staff or machine viewer. The action's exact canonical
input, invocation/run fingerprints and resource inventory must match its
durable source. Missing service injection, missing resources and denied current
item access fail closed; scope checks alone never reveal a navigation, theme,
setting or media-reference operation. The shared target inventory deduplicates
document references without skipping any underlying resource authorization.

Authorized nonterminal run-detail reads may call the same optional
`refreshGatewayInvocation` projection method before re-reading the run. This
only observes durable approval/execution evidence; it cannot execute content.
An original approval-request run can therefore finish after a human decision
without rewriting its already-terminal task result. Lists retain their original
cursor/filter semantics. A host may select a bounded set of invocation IDs it
already knows and explicitly call `refreshGatewayInvocation` for each. No
automatic invocation discovery or backlog sweep is installed, and this slice
adds no scanner. Terminal detail reads do not repeatedly reconcile finished work.

Run and ChangeSet detail reuse a bounded polling hook with the existing
framework two-second default and ten-second ceiling. Reads back off while work
is active, stop on terminal or unavailable evidence, and cancel their timers
when navigating away. Existing mutation controls retain CSRF, reauthentication,
CAS, stable unknown-outcome idempotency and explicit conflict refresh.

Doctor reuses aggregate issue codes for mismatched execution action/run links
and task/run attribution. It returns counts and age evidence, not row IDs,
canonical inputs, credentials or private adapter failures. Existing failed
verification, unresolved effects, retention and rollback-generation fences
remain unchanged.

## Acceptance verification (2026-09-11)

- Workspace `pnpm verify --concurrency=1`: 113 tasks passed, including 56
  repository checks and 3,865 workspace tests, typechecks and builds. Workspace
  lint passed all 41 tasks. The generic run skipped three environment-gated
  Redis tests; the separate live Redis run passed all 16 cases.
- Core PostgreSQL: 67 passed. Full web PostgreSQL collected 1,182 cases:
  1,179 initially passed, two failed and the native-preview opt-in case skipped.
  The two failures were resolved and rechecked in the complete seven-case
  Activity suite and five-case R4 acceptance suite. Across those runs all 1,181
  ordinary cases passed; native preview separately passed its one live case.
  The five restored theme-render PostgreSQL cases also passed explicitly.
- Production Playwright: the final complete run passed all 62 cases, including
  polling, unknown-outcome retry keys and hostile approval proposal text.
- Packed fresh scaffold: all 40 packages and 56 stages passed, including
  installation, typecheck, migration, production build, extension matrix,
  runtime commands and first-run journey. The disposable database was removed.
- After the last shared admission conflict-normalization change, Core unit
  tests passed all 1,726 cases; Core typecheck/build and the reference production
  build passed. Workspace lint passed all 41 tasks again. The five-file execution
  PostgreSQL regression run passed all 66 cases. The final packed scaffold
  refresh again passed all 40 packages and 56 stages, and its disposable
  database was removed. These focused final checks follow the original full
  workspace, PostgreSQL and browser runs recorded above.

The R4 section 18 acceptance gate passed with the concrete evidence below.
This completes AP-406 and the remaining R4 portions of AP-407/AP-408; R5
runtime work remains separate.

### Section 18 scenario evidence

The acceptance scenarios in [changesets-and-approvals §18](changesets-and-approvals.md#18-acceptance-scenarios)
map to the following tests. Paths are under `apps/web/tests/`; related authority
boundaries are tested separately rather than claimed as one combined workflow.

| Scenario                                                         | Concrete regression evidence                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Concurrent independent plans sharing a base                   | `agent-changeset-r4-acceptance.integration.test.ts`: commits exactly one of two independently approved plans sharing a base and gives the loser a zero-write conflict.                                                                                                                                                                                                                                                            |
| 2. Operation tampering after approval                            | Same file: rejects an operation changed after human approval without consuming approval or writing content.                                                                                                                                                                                                                                                                                                                       |
| 3. Expired/revoked approval at execution                         | Same file: rejects revoked approval when its already-reserved scheduled apply reaches the transaction. `agent-changeset-execution.integration.test.ts` also covers delayed approval expiry and expiry maintenance before dispatch.                                                                                                                                                                                                |
| 4. Lost committed response and retry                             | `agent-changeset-r4-acceptance.integration.test.ts`: does not duplicate documents, revisions, media references or audits when the committed response is lost and the caller retries.                                                                                                                                                                                                                                              |
| 5. Late database failure is atomic                               | Same file: rolls back every resource, revision, audit, approval consumption and applied state on a late injected PostgreSQL failure.                                                                                                                                                                                                                                                                                              |
| 6. Post-commit failure preserves content and reports remediation | `agent-changeset-execution.integration.test.ts`: failed convergence preserves committed writes/consumed approval; failed document hooks and unavailable follow-up jobs do not apply content twice.                                                                                                                                                                                                                                |
| 7. Preview cannot persist content or run effects                 | `agent-changeset-preview-overlay.integration.test.ts`: virtual creates create no row; effectful read hooks are skipped; document/media/theme overlays and detach/SEO absence leave persisted values unchanged.                                                                                                                                                                                                                    |
| 8. Rollback cannot overwrite later edits                         | `agent-changeset-rollback.integration.test.ts`: reserves queued compensation once and rejects stale targets without overwriting later edits.                                                                                                                                                                                                                                                                                      |
| 9. Site and principal isolation                                  | `agent-changeset-draft.integration.test.ts`: cross-site and hidden targets return no detail/list evidence. `agent-preview-generation.integration.test.ts`: cross-site preview reads fail. `agent-approval.integration.test.ts`: wrong-site/unauthorized approval reads fail. `agent-changeset-gateway-execution.integration.test.ts`: live credential site/audience/transport and authority mismatches block execution admission. |
| 10. Untrusted text cannot forge approval UI                      | `e2e/agent-approvals.spec.ts`: renders hostile proposal text without forged approval controls or challenge bypass. HTML buttons/scripts/image handlers and Markdown links/headings remain literal text; only the server-issued typed challenge produces the exact approval command.                                                                                                                                               |

### Self-review corrections and operational limits

Canonical run/action evidence now uses independent JSON values, exact source
linkage and actual capability-call usage. Approval-required tasks retain their
immutable terminal result while an authorized run-detail refresh may observe a
later human decision. Same-transport stdio run reads now share the existing
machine facade; genuine cross-transport and absent-run reads retain identical
safe errors. Test fixture clocks share the same host clock instead of weakening
production timestamp validation.

Background polling preserves mounted mutation controls. Exact unknown-outcome
idempotency keys survive transient read errors and remounts, and route changes
clear them. The approval hostile-text fixture also persists its server decision
for the subsequent authoritative GET; the UI never infers approval from text.

Apply/schedule descriptor branches retain `domain.read` for approval requests
and the existing mutation effect profiles for approved execution. Rollback MCP
`readOnlyHint` derives from its effect profiles, so its read-style entry mode
cannot misrepresent compensating writes. Task reconciliation fences stale
accepted invocation output instead of freezing it as an immutable completed
task result during a concurrent execution transition.

Concurrent independent plans exposed a raw PostgreSQL serialization/deadlock
error in shared ChangeSet admission. SQLSTATE `40001`/`40P01` now normalize to
the existing safe 409 conflict; no automatic transaction retry was added. The
five acceptance cases passed after this correction.

Hosts must explicitly install execution intent, approval keyrings/definitions,
convergence adapters and optional task/effect services. Fixture convergence
checks do not certify a deployment's cache/search/media adapters. Unknown
external effects remain fenced and inspection-only. No R5 runtime, provider,
automatic worker/factory, scanner, seed, default activation, package-version
change or changeset is added.
