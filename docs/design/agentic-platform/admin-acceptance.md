# Admin Agent Studio acceptance

Working acceptance record for the bundle after PR #1457, based on the 20 shipped
Agent Studio page routes at `55a0d271`. The implementation and assertions described
below are present in the working tree; this document does not mark pending
validation as passed. The [R5 decision](r5-acceptance.md) owns the broader Runtime
acceptance boundary.

The purpose is to make existing operator workflows usable and honest during
loading, refresh, failure and keyboard operation. It does not install providers,
activate Agents, change authority, or add an incident-response product ahead of
its implementation phase.

The later [state and accessibility bundle](admin-state-accessibility.md) records
Activity/review loading and refresh, additional connection/policy/Gateway fixtures,
and the remaining assistive-technology boundary. Historical gaps below describe
the PR #1458 checkpoint; use the later records for current supported behavior.

The [assistive-technology acceptance record](admin-assistive-technology-acceptance.md)
reconciles remaining requirements and consolidates the actual screen-reader run.
It also identifies success-path fixture gaps without claiming new product failures.

## Shipped route inventory

Paths below are relative to `/admin/agents`. Page wrappers live in
[`packages/app/src/admin/protected/agents`](../../../packages/app/src/admin/protected/agents).
The count is page routes, not separate permissions or independent test journeys.

| Routes                                                                           | Shared state and rendering owner                                                                                                           | Existing direct browser evidence and current additions                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/connections` (2)                                                          | `AgentStudioView`, `AgentStudioFrame`; Connections includes outbound provider, inbound Gateway, OAuth-client and principal-creation cards. | `agents.spec.ts`: signed-out admission, disabled discovery, unavailable control plane, empty provider/principal lists. New `agent-states.spec.ts`: delayed initial response, retained refresh data, receipt time, disabled controls, 403/404/429/502/contract failures, data removal and no retry loop. The response fixture exercises Connections; sharing the owner is reasoned coverage for Overview, not a second independent Overview fixture. |
| `/connections/new`, `/connections/[id]` (2)                                      | `AgentConnectionCreateView`, `AgentConnectionDetailView`, shared frame.                                                                    | New `agent-connections.spec.ts`: keyboard create, delayed adapter loading, safe 503 failure and focused error, credential clearing, unchanged create retry identity, populated detail, malformed detail removal, revoke retry identity and 403 evidence removal. Empty adapter and unavailable-service rendering exists; it is not a separate browser fixture in this journey.                                                                      |
| `/gateway/[principalId]` (1)                                                     | `AgentPrincipalDetailView`, `AgentPrincipalControls`, shared frame.                                                                        | `agents.spec.ts`: reviewed reason and fresh versions for suspension/resumption/revocation; current additions cover a long localized principal name at 320 px, malformed-refresh evidence removal and recovery by retry. Refresh, cancellation and exact principal binding are shared implementation changes, not a fixture for every token/OAuth transition.                                                                                        |
| `/configurations`, `/configurations/new`, `/configurations/[id]` (3)             | `useRuntimeResource`, `AgentRuntimeListView`, `AgentRuntimeCreateView`, `AgentRuntimeDetailView`, shared frame.                            | `agent-runtime.spec.ts`: absent host, filtering, activation conflict with reviewed version/trigger plan, typed draft and explicit self-delegation, structured manual input and retry identity. New `agent-states.spec.ts`: 50-item localized list, retained refresh, disabled filter controls, empty/forbidden/contract outcomes. Detail/create behavior is not independently retested for every list-state combination.                            |
| `/policies`, `/policies/new`, `/policies/[id]` (3)                               | `useRuntimeResource`, Policy views, `AgentPolicySimulation`, shared frame.                                                                 | `agent-runtime.spec.ts`: typed Agent override draft and unchanged retry, bounded non-authorizing simulation, stale and inaccessible simulation evidence removal. Shared resource/frame behavior covers the loading mechanism; separate policy-list empty, delayed, degraded and forbidden visual fixtures remain absent.                                                                                                                            |
| `/budgets` (1)                                                                   | `AgentBudgetView`, independent Runtime-status and budget reads through `useRuntimeResource`, shared frame.                                 | `agent-runtime.spec.ts`: configured budget/operations facts, unknown measurements preserved as unknown. Independent resources can report a failed subsystem without inventing success for it. A complete combination matrix for partial budget/operations failures has not been run.                                                                                                                                                                |
| `/activity`, `/activity/[id]`, `/activity/actions`, `/activity/actions/[id]` (4) | `useActivity`, `AgentActivityView`, Run and Action detail views; embedded principal filters are not another route.                         | `agents.spec.ts`: unavailable versus empty, filters/pagination, redacted retained Actions, malformed private receipt fields, access loss, recorded Gateway/Runtime facts, expired Run without invented facts or polling. These existing cases cover several list/detail transitions; delayed initial-loading and refresh presentation are not complete per-route fixtures.                                                                          |
| `/approvals`, `/approvals/[approvalId]` (2)                                      | `useAgentReviewRead`, Approval views and `DecisionControls`.                                                                               | `agent-approvals.spec.ts`: unavailable versus empty, populated sealed facts, typed challenge, unknown-outcome exact retry, hostile text, conflict and access loss. Existing cases now check keyboard entry, accessible challenge description, dialog initial/return focus, Escape and focused uncertain-result notice.                                                                                                                              |
| `/changesets`, `/changesets/[changeSetId]` (2)                                   | `useAgentReviewRead`, ChangeSet views, preview, execution and rollback controls.                                                           | `agent-changesets.spec.ts`: unavailable versus empty, populated review, permission loss, escaping, native preview CSRF, bounded polling, exact cancellation/execution retry, reauthentication loss, rollback bindings and conflict removal. Existing rollback cases now use keyboard actions and distribute responsive/theme/long-copy checks across the four operations.                                                                           |

Browser evidence files:
[`agents`](../../../apps/web/tests/e2e/agents.spec.ts),
[`Runtime`](../../../apps/web/tests/e2e/agent-runtime.spec.ts),
[`connections`](../../../apps/web/tests/e2e/agent-connections.spec.ts),
[`shared states`](../../../apps/web/tests/e2e/agent-states.spec.ts),
[`approvals`](../../../apps/web/tests/e2e/agent-approvals.spec.ts),
[`ChangeSets`](../../../apps/web/tests/e2e/agent-changesets.spec.ts).
Assertions in these files are evidence of intended coverage; the verification
record below determines which executions passed.

## Confirmed implementation repairs

The [shared frame](../../../packages/admin/src/agents/agent-studio-frame.tsx)
keeps the page title available, presents a static initial skeleton and polite
loading/refresh status, marks locally received data with its exact receipt time,
and disables form controls while a read is in progress. That timestamp is
**browser receipt time**, not a fabricated server snapshot or worker heartbeat.
Same-resource refreshes in
[`useRuntimeResource`](../../../packages/admin/src/agents/agent-runtime-api.ts)
retain previously validated values until success or failure. A changed resource
path cannot borrow the prior record; a failed response clears it. Explicit refresh
also resets mutation editors and simulation evidence, including when the server
returns the same row version. An access-loss mutation aborts an outstanding read
so a late response cannot restore rejected evidence. Long localized Agent names
use a readable line height.

Overview and Connections previously retained their old projection after a failed
refresh. The current owner clears failed or invalid evidence and rejects
unvalidated fields. Connection detail now clears rejected read/mutation evidence,
checks the returned ID, prevents late responses from replacing the current view,
and makes recovery explicit. Connection creation has honest adapter loading and
unavailable states. Both connection mutations preserve unchanged retry identity;
create retains only a credential digest for comparison, clears the entered secret,
and requires re-entry before an uncertain attempt is repeated.

Gateway principal reads bind the exact requested principal, cancel superseded
loads, clear failed evidence and one-time token state, and use the same honest
refresh frame. Approval decisions now focus the dialog heading on entry, attach
the one-time challenge as the input's accessible description, focus a single
error notice and restore a meaningful focus target on close. These repairs do
not change sealed facts, allowed decisions, challenge semantics or execution
bindings.

The subsequent [error-recovery bundle](admin-error-recovery.md) owns 401 login
recovery, server 429 wait handling and partial-read retries. The following gaps
record the PR #1458 boundary; use that follow-up's verification for later repairs.

## State applicability and remaining gaps

The [design state contract](admin-agent-studio.md#13-loading-empty-error-and-stale-states)
and [release criteria](admin-agent-studio.md#20-admin-release-acceptance) remain
requirements. Shared-owner coverage reduces duplicated tests; it does not prove a
20-route by every-state matrix.

- **Empty versus missing:** empty is an authorized list result. A missing or
  cross-site detail is unavailable, not a valid empty record. Budget configuration
  is not a valid empty state once the Runtime is enabled. No adapter/recipe being
  installed is a deliberate unavailable/setup state.
- **Incidents:** no incident page route is shipped in this inventory. Incident
  response acceptance applies when its product phase ships; a fabricated incident
  fixture would not close an R5 implementation gap.
- **Authorizing review refresh:** explicit refresh in `useAgentReviewRead`
  deliberately invalidates the mounted approval/ChangeSet review. Retaining old
  authorizing controls after explicit invalidation would weaken its current
  contract. Background review polling retains mounted controls and in-flight
  identity until the next validated result; failures clear evidence. This is not
  identical to the read-only Runtime refresh presentation.
- **Stale data:** current frame receipt timestamps and a refresh-in-progress notice
  do not constitute a server-defined cache age or stale-health verdict. Activity
  and review owners still use their existing loading/polling presentation, without
  a complete shared freshness/skeleton treatment. Where a stale contract is not
  provided, the UI must not invent one. The design's complete stale/degraded
  presentation remains an acceptance gap, not silently passed by the new frame.
- **Degraded subsystems:** a reported unavailable host, unknown budget measurement,
  retained expired record and partial failed read are different facts. Current
  fixtures cover specific distinctions; they do not prove every subsystem-failure
  combination or justify synthesizing heartbeat/provider health data.
- **Errors and retry:** the shipped error envelope remains exact `{ error, status }`.
  A safe code can be shown when provided; there is no universal support-correlation
  or declared-retryable field to fabricate. `Retry-After` presentation is not
  supplied by the current shared error helper. The new 429 case verifies safe
  failure and absence of a busy retry loop, not complete rate-limit UX. Some
  non-Activity owners clear 401 state and explain sign-in without a dedicated
  automatic login transition; this is not a complete authentication-loss journey.
- **Conflict and mutation error:** these apply where the view owns a mutation.
  Read-only lists do not need fictional mutation controls. Existing approval,
  activation, simulation, execution and rollback fixtures prove particular CAS
  and authority boundaries. They are not substitutes for all connection, policy,
  budget and Gateway mutation-error fixtures.

## Keyboard, visual and screen-reader boundary

The browser journeys exercise real Tab/Enter/Space order where specified; tests
do not assign DOM focus to make the traversal pass. Programmatic focus in product
code is limited to meaningful dialog/error transitions. Accessible names,
descriptions and focused alerts are automation evidence, not a claim that a
screen reader announced every workflow correctly.

The new Runtime list fixture uses 50 contract-valid items with long Korean names
and checks 320/768/1280 px, light/dark and reduced motion. Existing manual-input
coverage uses the same viewport/theme sizes. Rollback checks distribute narrow,
tablet and desktop cases with long localized target content across existing
operations. Screenshots and containment/actionability checks cover these exact
surfaces; they do not prove translation of the entire UI or every high-volume
connection, policy, approval and Activity state.

Full Admin acceptance remains open until:

1. The remaining state/fixture gaps above are resolved or explicitly reconciled
   with an owned, supported contract; component sharing alone is insufficient.
2. An actual screen-reader check records the browser/assistive technology and
   results for complete shipped connection, Agent activation, approval and
   rollback workflows, including errors and recovery. Gateway connection/token
   variants need their own applicable checks. No incident workflow is claimed.
3. Remaining complete per-surface visual checks cover narrow/tablet/desktop,
   light/dark, reduced motion, long localized content and bounded high-volume
   data. Record which captured states were inspected and any unresolved defects.

These are concrete release-acceptance limits; they do not reopen completed
Runtime/provider-only retention or executor-owned structured input as missing
features.

## Verification record

Local evidence is for the uncommitted `codex/admin-acceptance` bundle based on
`55a0d271`, observed 2026-09-19 KST. It is not exact-head PR CI.

- Final workspace build: 41 tasks passed with the required local DB/auth/site
  environment. Earlier missing-environment attempts stopped at configuration
  validation; those attempts are not passes.
- Final `pnpm verify --concurrency=2`: 59 repository checks and 113 workspace
  tasks passed (105 cached). Final `pnpm lint`: 41 tasks passed (40 cached).
  Logs: `/tmp/np-admin-acceptance-build-with-env.log`,
  `/tmp/np-admin-acceptance-verify-settled.log`,
  `/tmp/np-admin-acceptance-lint-final.log`.
- Final production browser: **76/76 passed**, no skips or retries (2.0 minutes),
  using the final production build. Log: `/tmp/np-admin-acceptance-browser-final.log`.
  Earlier full run found retained policy
  simulation evidence and a stuck conflict state after same-version refresh;
  generation keys repair both and reset mutable editors. The auth fixture now
  isolates login/logout quotas. The principal malformed-response fixture waits
  for the preceding mutation refresh to settle before changing its response. A
  subsequent run stopped after 32 passes with local disk `ENOSPC`; only this
  task's regenerable cache/temporary consumer artifacts were removed before retry.
- Packed scaffold: 40 public packages / 60 baseline stages passed, including
  migrations/foundation, production build, seven-extension lifecycle matrix,
  five closed-port module-load checks and deployment-readiness journey; no skips.
  After the final Admin edits, seven additional stages in a fresh consumer passed
  (repack/scaffold/link/install/typecheck/build/journey). All ten Admin dist files
  match built, packed and installed bytes. The other 39 packages and unaffected
  extension/DB checks reuse the baseline. The first attempt to reuse the extension
  consumer failed on its `workspace:*` theme dependency; a fresh consumer resolved
  that setup constraint. Summaries: `/tmp/np-admin-scaffold-acceptance/summary.json`
  and `final-policy-fix-fresh/summary.json` below that directory.
- Screenshot review: inspected 320 px dark structured input, 320 px dark rollback
  execution with long Korean content, and 320 px light / 1280 px dark 50-Agent
  list captures. The list review found cramped multiline titles; `leading-snug`
  repairs their line height; final 320 px light and 1280 px dark captures were
  inspected and show the corrected spacing. These are
  selected visual checks, not every shipped surface or human screen-reader use.
- Unchanged Core/server/DB behavior reuses [PR #1457 CI](https://github.com/nexpress-cms/nexpress/actions/runs/35364371255)
  on `530b0a01` and the preceding exact baseline evidence in the
  [R5 decision](r5-acceptance.md#verification-for-this-bundle): Core PostgreSQL 64,
  Web PostgreSQL 1,449 including theme 5, Redis 16 and separate native preview 1.
  These were not rerun for this UI bundle; the ordinary PostgreSQL preview skip
  is covered by the explicit preview job, not counted as a pass by itself.
- No versions, changesets, lockfile, schema or migrations changed. No provider
  calls, credentials, automatic activation, publication or new API contract.
  Self-review, relative documentation links and `git diff --check` passed;
  formatting and artifact cleanup passed. Final screenshots are preserved at
  `/tmp/np-admin-acceptance-browser-final-artifacts`.
