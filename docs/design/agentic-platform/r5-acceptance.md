# R5 acceptance decision

Current acceptance reconciled on 2026-09-25 KST at PR #1490 (`ba7da8d7`).
The original Runtime audit was reviewed on 2026-09-18 KST against `3d293ef329d34756be468143ab032e6f0209846c`
(PR #1456) plus the acceptance-only changes later merged in PR #1457.
The subsequent [Admin acceptance inventory and repairs](admin-acceptance.md)
records the 20 shipped routes, current UI corrections and the exact remaining
release checks; the evidence below retains its historical scope.

## Decision and scope

The bounded AP-500–AP-508 Runtime implementation has an evidence path for all
five [roadmap gates](implementation-roadmap.md#r5--durable-provider-backed-agent-runtime).
The audit found missing combined assertions, rather than a confirmed missing
backend feature: open/half-open breakers must stop actual subsequent admission
and dispatch, and actual retention contention must leave CMS work available.
Existing integration journeys now exercise those boundaries directly.

**Full R5 acceptance remains open.** The shipped-route inventory and later
[Admin state evidence](admin-state-accessibility.md) now cover bounded loading,
refresh, failure, keyboard and visual scenarios; the
[success lifecycles](admin-success-lifecycle.md) add activation, connection
revocation and full rollback presentation. Actual screen-reader workflows remain
not verified, and this evidence is not an exhaustive pass for every applicable
state and visual variant in
[Admin release acceptance](admin-agent-studio.md#20-admin-release-acceptance).
Accessible-name assertions and automated viewport checks do not substitute for
actual screen-reader or visual review.
The remaining work is specified below; this is not a claim of complete R5 or
permission to begin R6.

This reconciliation changes documentation only. The original acceptance audit
also made no production service, public contract, schema, migration, package
version, changeset, lockfile or activation changes. Provider
responses in acceptance tests use injected fixtures; no external provider is
called. Existing historical results retain their original dates and scope.

## AP implementation and evidence map

Paths in the evidence column name the existing owning test suites; they are
not a claim that every suite was rerun during this audit.

| Item   | Implemented boundary                                                                                                                                                                              | Owning evidence                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-500 | Exact site-owned Agent/configuration/policy/trigger/provider-call/reservation/breaker/event persistence and extended Run constraints.                                                             | [Runtime persistence](../../../apps/web/tests/agent-runtime-persistence.integration.test.ts), [foundation flow](r5-runtime-foundation-flow.md).                                                                                                                                                                                                                                                                        |
| AP-501 | Reference inference adapter, structured output validation, timeout/cancellation and bounded safe errors. Provider transport is injected for tests.                                                | [Inference](../../../packages/core/src/agent/provider-inference.test.ts), [reference adapter](../../../packages/core/src/agent/provider-openai.test.ts), [execution flow](r5-runtime-execution-flow.md).                                                                                                                                                                                                               |
| AP-502 | Active immutable policy resolution, hard-rule enforcement and current-source validation; guidance never grants authority.                                                                         | [Runtime service](../../../apps/web/tests/agent-runtime-service.integration.test.ts), [boundaries](../../../apps/web/tests/agent-runtime-boundaries.integration.test.ts), [queued policy](../../../apps/web/tests/agent-runtime-queued-policy.integration.test.ts).                                                                                                                                                    |
| AP-503 | Exact event envelopes, registered event/manual/scheduled triggers, coalescing, durable Run jobs and duplicate suppression.                                                                        | [Events](../../../apps/web/tests/agent-runtime-events.integration.test.ts), [jobs](../../../apps/web/tests/agent-runtime-jobs.integration.test.ts), [job quota](../../../apps/web/tests/agent-runtime-job-quota.integration.test.ts), [operations flow](r5-runtime-events-operations-flow.md).                                                                                                                         |
| AP-504 | Locked site/Agent admission, reservations, known/unknown usage, hard ceilings, emergency controls and explicit local recovery.                                                                    | [Usage](../../../apps/web/tests/agent-runtime-usage.integration.test.ts), [controls](../../../apps/web/tests/agent-runtime-controls.integration.test.ts), [execution recovery](../../../apps/web/tests/agent-runtime-execution-recovery.integration.test.ts).                                                                                                                                                          |
| AP-505 | Durable state machine, bounded/redacted context, validated installed capability execution and exact delegated approval/rollback recovery.                                                         | [Context](../../../apps/web/tests/agent-runtime-context.integration.test.ts), [executor](../../../apps/web/tests/agent-runtime-executor.integration.test.ts), [capabilities](../../../apps/web/tests/agent-runtime-capability.integration.test.ts), [delegated flow](r5-runtime-delegated-execution-flow.md).                                                                                                          |
| AP-506 | Bounded same-provider retry, unknown-outcome containment, connection/Agent breakers and exact probe settlement. No automatic credential or provider substitution.                                 | [Execution store](../../../apps/web/tests/agent-runtime-execution-store.integration.test.ts), [recovery](../../../apps/web/tests/agent-runtime-execution-recovery.integration.test.ts), [outage isolation](../../../apps/web/tests/agent-runtime-isolation.integration.test.ts).                                                                                                                                       |
| AP-507 | Shared Agents/Triggers/Policies/Budgets and Activity, reviewed activation, per-Agent controls, bounded manual input and non-authorizing policy simulation. Full Admin release checks remain open. | [Studio](../../../apps/web/tests/agent-runtime-studio.integration.test.ts), [mutations](../../../apps/web/tests/agent-runtime-studio-mutations.integration.test.ts), [manual input](../../../apps/web/tests/agent-runtime-manual-input.integration.test.ts), [simulation](../../../apps/web/tests/agent-policy-simulation.integration.test.ts), [browser journeys](../../../apps/web/tests/e2e/agent-runtime.spec.ts). |
| AP-508 | Safe readiness/health/ops evidence, host-registered retention, dependency fences and typed verified source-release owners.                                                                        | [Ops diagnostics](../../../apps/web/tests/agent-runtime-ops-diagnostics.integration.test.ts), [maintenance](../../../apps/web/tests/agent-runtime-maintenance.integration.test.ts), [retention](../../../apps/web/tests/agent-runtime-retention.integration.test.ts), [source release](../../../apps/web/tests/agent-source-release.integration.test.ts), [retention matrix](r5-runtime-retention-flow.md).            |

## Five Runtime gates

| Roadmap gate                                                   | Evidence and acceptance boundary                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission, redaction, policy and budget precede provider calls | Runtime service/boundaries/context/usage suites exercise denied admission, current policy, redaction and reservations. The executor orders context, reservation, fresh claim/configuration and dispatch checks before the injected provider invocation. Unknown usage remains reserved.                                                                                                 |
| Provider output cannot invent an action                        | Inference validation and executor/capability suites reject unknown or malformed capabilities; installed contracts, current authority, sealed approval and ordinary collection controls remain authoritative.                                                                                                                                                                            |
| Events coalesce; jobs remain idempotent                        | Event/job suites cover duplicates and schedule occurrence locking. Source-release suites preserve consumed keys and reject late references/replays after source expiry.                                                                                                                                                                                                                 |
| Provider outage leaves CMS available                           | The existing outage journey now holds a real audit reference writer while actual retention attempts its NOWAIT fence. Collection create/read/update and unrelated job-log maintenance still finish; retention leaves source/epoch unchanged on contention and succeeds after the writer commits. This proves that boundary, not fresh-process bootstrap or production-scale throughput. |
| Denial of wallet trips bounded admission/breakers              | Budget/quota suites retain their existing coverage. The repeated-proposal journey now proves denied subsequent admission leaves Runs unchanged. The connection journey checks both open and half-open admission/dispatch rejection with unchanged Run/call/reservation journals; exact successful probe settlement restores dispatch.                                                   |

## Retention and manual-input boundaries

The mandatory source-lifecycle acceptance is a complete provider-only lifecycle
and a completed read-action lifecycle that physically release eligible sources
while preserving audit and non-authorizing receipts. The existing retention and
source-release suites prove both. Later owners also cover exact cancelled
proposals, closed never-approved requests and Studio admission references.
They do not broaden generic evidence deletion.

Active work, unknown usage/outcomes, malformed or unknown references, approved
execution and rollback evidence remain intentional pins. Missing historical
proof or more than the bounded owner limit also retains a source. Those cases
are safe retention behavior, not evidence that the mandatory release lifecycle
is unimplemented. Broader audit/mutation-history erasure is a separate design
boundary; Guardian evidence belongs to its later phase.

[Structured manual input](r5-runtime-studio-flow.md#structured-manual-input-storage-and-execution)
is implemented for supported closed flat scalar schemas, with canonical
Run-owned persistence, digest-bound admission, redacted untrusted executor
consumption and eligible Run-owned expiry. Unsupported nested/array/reference
schemas remain unavailable. No authority is accepted from manual input.
Admin journals retain a digest rather than a second raw input copy; derived
provider/Action text keeps its own evidence lifetime.

Policy simulation uses versioned synthetic fixtures and the actual policy
evaluator. It neither executes a capability nor grants authority. Historical
fact selection is not required in addition to the supported synthetic mode.
R6 template executors and broader proposed Studio wizard refinements are not
silently included in the R5 implementation claim.

## Remaining Admin acceptance work

The table distinguishes implemented evidence from still-unverified requirements.
Do not repeat completed work or add a test for every route/state combination to
make the table appear complete. Use the existing owners when a concrete gap or
product defect is established.

| Requirement                     | Current evidence                                                                                                                                                                                                                                                                                                                                                                    | Remaining boundary                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §20.3 state inventory           | The [20-route inventory](admin-acceptance.md#shipped-route-inventory), [state follow-up](admin-state-accessibility.md#applicable-state-boundary), [diagnostics](agent-error-diagnostics.md) and [read observation](studio-read-observation.md) document loading, empty, retained or invalidating refresh, independent failures, access loss, contract errors and mutation recovery. | Coverage is bounded to the documented shared owners and fixtures. No exhaustive per-view/state pass is claimed. Source freshness/cache age remain unsupported; projection and receipt times do not supply those facts.                                                |
| §20.6 accessible workflows      | Existing keyboard/focus cases and [successful activation, revocation and rollback](admin-success-lifecycle.md) provide synthetic outcomes and optional local checkpoints.                                                                                                                                                                                                           | All six [actual AT workflows](admin-assistive-technology-acceptance.md#one-consolidated-run) remain not verified. Observe utterances, focus and timing in one consolidated operator run. Incident response is a future-phase workflow, not a missing shipped fixture. |
| §20.7 visual variants           | The [state/accessibility record](admin-state-accessibility.md#browser-and-assistive-technology-evidence) contains 320/768/1280, light/dark, reduced-motion, bounded volume and long-copy inspections; later flows record their own inspected states.                                                                                                                                | Those inspections are not a manual pass for every state or every localization. Preserve their recorded scope and assess any uncovered applicable variant explicitly.                                                                                                  |
| §13 diagnostics and read timing | Safe optional support correlation/recovery declarations and independent browser receipt/available Runtime projection times are shipped.                                                                                                                                                                                                                                             | Missing metadata stays unavailable; server projection time is not source freshness. Submitted diagnostic events do not guarantee durable support lookup.                                                                                                              |
| §20.10 Health/Doctor            | [Maintenance](agent-maintenance-evidence.md), [budget](agent-budget-evidence.md) and [worker](agent-worker-evidence.md) observations distinguish receipts, measurement and subscription evidence, including unknown/unavailable states.                                                                                                                                             | Bounded samples, generic heartbeats and subscription observations do not prove end-to-end progress, coverage of every required queue or overall maintenance readiness. Complete Health/Doctor acceptance is not established by those observations alone.              |

[Retained Runtime outcomes](agent-runtime-outcome-evidence.md) additionally expose
Run-owner terminal results and current unfinished deadline/lease facts in Health
and Doctor. Their host-wide retained scope, unknown states and investigation
links do not establish external effects, complete history or full readiness.

### State and visual disposition at this baseline

A shared-owner review found stale evidence descriptions, not a reproduced new UI
failure. The [route inventory](admin-acceptance.md#shipped-route-inventory) now
reflects the existing Policy-list delayed/empty/503/403/contract/recovery journey
and Budget's two independent read failure/recovery paths. Their owning fixtures
are `agent-states.spec.ts` and `agent-runtime.spec.ts`; they are not new tests in
this pass. Shared loading, invalidation, retry-wait and request-cancellation
behavior is implemented in `AgentStudioFrame` and `useRuntimeResource`.

The remaining work is finite evidence collection, not a request to add every
route/state combination:

- Reuse already inspected list layouts at 320/768/1280 in both themes. Policy
  error assertions do not imply that every error-state screenshot was inspected.
- In one consolidated visual session, inspect the distinct detail/decision and
  Budget-editor layouts in uncovered narrow/dark states. Existing creation-form
  evidence samples 320-light, 768-dark and 1280-light; activation/rollback success
  readbacks were inspected at desktop size; Budget observation was inspected at
  320px. Record exactly which additional states are observed. See
  [forms](admin-form-acceptance.md#verification),
  [success readbacks](admin-success-lifecycle.md#verification) and
  [read observation](studio-read-observation.md).
- Complete AT-01–06 using the existing consolidated operator checklist and
  synthetic fixtures, recording actual utterances, focus and timing. No new AT
  attempt was made here; the historical inability to capture speech is not a
  freshly measured environment result.
- Keep source freshness/cache age explicitly unavailable until its source owner
  supplies a contract. Receipt/projection timestamps cannot satisfy that claim.
  Incident-response acceptance applies when that route ships; read-only lists
  do not need invented mutation/conflict actions.

These observations narrow what remains; they do not waive §20.3, §20.6 or §20.7,
or promote bounded samples to full acceptance. Only a reproduced defect warrants
an implementation change and its affected regression check.

### Health and Doctor requirement crosswalk

The eight subjects in §20.10 are present in the shipped shared Health and Doctor
owners. This establishes the available diagnostic surfaces, not complete
operational readiness. The earlier table's general readiness boundary must not
be read as eight missing features or permission to infer readiness from counts.

| Required subject   | Current authoritative observation                                                                                                                                                   | Unestablished claim                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Vault              | [Contract diagnostics](../../../packages/core/src/agent/contract-diagnostics.ts) compares required adapters with an explicitly supplied registry; an absent registry stays unknown. | Credential usability and an operational vault on another host.                      |
| Adapters           | The same owner reports required/available provider adapter counts and declared readiness.                                                                                           | A successful live provider request.                                                 |
| Runtime            | [Retained Run outcomes](agent-runtime-outcome-evidence.md), state counts and Runtime contract issues.                                                                               | End-to-end external effects or progress of every Run.                               |
| Queues             | [Queue subscriptions](agent-worker-queue-evidence.md) and [retained backlog](agent-queue-backlog-evidence.md), each with independent observation scope.                             | Coverage of a required queue set or successful processing from subscriptions alone. |
| Stale runs         | Run-owner deadline/lease observations and existing diagnostic issue codes.                                                                                                          | Worker death or authorization to recover a Run from age alone.                      |
| Approvals          | Existing approval state/issue counts; sealed review remains in the authorized Approval owner.                                                                                       | Permission to decide an approval from aggregate Health facts.                       |
| Retention          | [Committed batch/sweep receipts](agent-maintenance-evidence.md), local registration and retained failures.                                                                          | Complete eligible-record deletion or overall maintenance readiness.                 |
| Budget measurement | [Budget observations](agent-budget-evidence.md) distinguish measured, unresolved and unavailable sites and report sample truncation.                                                | Spare capacity or a cross-site spend total.                                         |

`gatherSystemHealth` and Doctor reuse these collectors and shared presentation
modules. The Runtime outcome contract, collector and three PostgreSQL journeys
were inspected in this reconciliation; the feature flow retains their executed
verification. No missing production implementation was established by this
crosswalk. Declaring overall readiness would require an explicit host-owned
required configuration/queue set and evidence of its operation; the current
aggregate observations do not provide that verdict. This is an open acceptance
boundary, not a proposed new readiness heuristic.

The other Admin requirements have existing owning contract, authorization,
secret-exclusion, sealed-fact, polling, audit, diagnostics and wrapper tests.
Their feature-flow evidence remains applicable; this audit does not relabel
untested human workflows as passed because automated CI is green.

<a id="verification-for-this-bundle"></a>

## Historical verification — PR #1457 acceptance audit

The production tree, dependency lockfile and workflow inputs are unchanged from
the baseline. `git diff` confirms PR #1456 head
`76934b20146eb64dfeda841c11e3071f9d0252cc` and merge `3d293ef3` have identical
application/package/workflow/script trees. Reuse applies to their unchanged
assertions, not to the new assertions below.

| Gate                                      | Result and provenance                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current production build                  | 41 successful tasks, 40 cached.                                                                                                                                                                                                                                                                                                                                                         |
| Current workspace verify                  | Repository tests 59 passed; 113 successful workspace tasks, 110 cached.                                                                                                                                                                                                                                                                                                                 |
| Changed PostgreSQL journeys               | Execution-store 15, recovery 10, isolation 1 passed; zero skips. The first recovery fixture constructed its request after claiming and was corrected to construct it while queued. The isolation fixture expiry was corrected to satisfy the existing time constraint. Only the affected suites were rerun.                                                                             |
| Changed production browser                | All 8 Runtime Studio cases passed together, zero skips. Real Tab/Enter/Space activation and manual-input keyboard navigation, native validation and retry identity passed. The form passed 320/768/1280 px light/dark containment under reduced motion. Native select navigation was corrected from platform-dependent End to typeahead; the final run includes persistent screenshots. |
| Final lint / typecheck                    | Workspace lint 41 successful cached tasks; final Web typecheck passed. Integration/E2E files are excluded from the normal lint/typecheck inventories; their real runners and scoped Prettier checks validate these changes.                                                                                                                                                             |
| Unchanged full PostgreSQL / Redis / theme | [PR CI 35338310266](https://github.com/nexpress-cms/nexpress/actions/runs/35338310266): Core 64, Web 1,449, live Redis 16; Web includes theme-render 5. Both partitions and exact-coverage aggregate passed. The single ordinary PostgreSQL native-preview skip is covered by the separate execution below.                                                                             |
| Unchanged native preview / browser        | Same exact PR-head CI: explicit native preview 1 and complete production browser 73 passed. Merge-head CI skips its E2E job by workflow design; that skip is not a second pass.                                                                                                                                                                                                         |
| Unchanged packed scaffold                 | Same exact PR-head CI: fresh packed-scaffold job passed its isolated install, typecheck, migration, production build, extension and first-run journey steps.                                                                                                                                                                                                                            |
| Baseline post-merge workflows             | [CI 35344430067](https://github.com/nexpress-cms/nexpress/actions/runs/35344430067) and [Release 35344430065](https://github.com/nexpress-cms/nexpress/actions/runs/35344430065) succeeded on `3d293ef3`; workflow success is not authorization to merge the Version PR.                                                                                                                |

The new assertions extend existing registered cases; they do not add fixture-heavy
parallel copies or claim that a parameter matrix is a new independent journey.
No complete unaffected PostgreSQL/Redis/scaffold rerun was needed for test/doc-only
changes. Local logs are `/tmp/np-r5-acceptance-{build,verify}.log`,
`/tmp/np-r5-breaker-tests{,-first-attempt}.log`,
`/tmp/np-r5-isolation-tests.log` and `/tmp/np-r5-browser-tests.log`.

The first browser startup overlapped a verify rebuild and executed no tests; it
was repeated only after the production build completed. Subsequent checks used
stable production output. This infrastructure attempt is not counted as a test
pass or as a product defect.

The final screenshot review found the initial narrow capture was taken during a
sidebar/theme transition. Capture now disables animations and each target
control must pass Playwright pointer actionability without an actual click.
The affected manual case passed again (1/1, zero skips); the other seven cases
remain unchanged from the complete 8/8 run. Settled 320 px light/dark captures
were visually inspected and showed no form overlay. This remains a single-form
review, not the complete Admin visual gate. Final evidence is
`/tmp/np-r5-browser-settled.log` and `/tmp/np-r5-browser-settled-artifacts/`;
lint/typecheck logs use `/tmp/np-r5-acceptance-{lint,web-typecheck}.log`.

Self-review corrected a stale section anchor. Changed Markdown file links and
anchors, scoped formatting and `git diff --check` pass. Inspection confirms
only four existing test files and acceptance/handoff documentation changed;
no production, generated, package or secret material was added.

## Prior reconciliation verification — PR #1478

The preceding 2026-09-22 documentation reconciliation used PR #1478 (`7603200b`):
[exact-head CI](https://github.com/nexpress-cms/nexpress/actions/runs/35694278882),
[merge CI](https://github.com/nexpress-cms/nexpress/actions/runs/35695613276) and
[Release](https://github.com/nexpress-cms/nexpress/actions/runs/35695613252) succeeded.
That documentation-only pass checked formatting, local links and whitespace;
it did not execute a new full R5 gate.

## Current reconciliation verification

The implementation baseline is PR #1490 (`ba7da8d7`). Its
[exact-head CI](https://github.com/nexpress-cms/nexpress/actions/runs/36145351255)
passed typecheck/build/test, both PostgreSQL partitions and their aggregate,
production E2E and fresh scaffold checks. These are results for that implementation
bundle; they do not verify actual assistive-technology output or form a newly
executed full R5 gate in this documentation reconciliation.

This pass inspects the existing requirement, shared owners and owning fixtures,
updates the Health/Doctor crosswalk and operator instructions, and preserves
historical evidence rather than rerunning unchanged application suites.
Documentation validation covers formatting, local links/anchors and whitespace.
No new build, PostgreSQL, Redis, theme, native-preview, browser or AT run is claimed.
The handoff, versions, changesets, lockfile, migrations and runtime behavior are
unchanged by this pass.
