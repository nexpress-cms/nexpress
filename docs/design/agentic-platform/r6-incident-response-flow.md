# R6 Incident response planning and approved staff execution

This slice connects Incident review to explicit staff response planning, existing
human approval, and the moderation owner's quarantine/restore execution. It does
not enable automatic moderation or complete AP-601 or the R6 evaluation gate.

## Ownership and installation

`createAgentIncidentResponseServiceV1`, installed as Studio’s optional `response`
owner, composes current staff Incident reads with
`createAgentModerationServiceV1`. Hosts explicitly supply `resolveTargets` from the source owner, moderation
`resolveStaffPolicy`, and the existing budget, approval and reauthentication owners. Missing
installation remains unavailable; neither reference nor scaffold bootstrap enables
it. Evidence visibility and the domain owner's current target/version checks remain
mandatory. A canonical event ID is never treated as a content target ID.

Staff requests use real Admin admission and their current session. Retained
Invocations identify staff, and their Actions have no Gateway principal or Run.
The existing signed Approval, canonical Action, containment, audit and timeline
records preserve attribution. No extra persistence table or migration is required.
Gateway and staff entry points share the moderation plan/effect implementation;
there is no second quarantine or restore executor.

## Review and execution

A staff member selects an authorized evidence target and prepares a bounded plan.
Planning records the exact capability, target/version and policy facts and creates
an expiring approval request. It does not change content. The requestor cannot
approve their own staff response; a different authorized staff member reviews it. The Studio shows the
existing approval link, approval expiry, reversibility, and current execution
eligibility. An approved plan still requires a separate explicit execution request.

Execution binds the exact Action, Approval, proposal hash and Incident version.
Current staff session, item visibility, policy, the live approver’s authority, approval and target version are
checked by the owning services. Approval consumption, domain effect, verification,
containment and audit evidence share the existing transaction. A changed Incident
or target requires fresh review. Already-active containment targets are omitted
from new quarantine choices and offered for separately approved restoration. Closed Incidents cannot acquire fresh quarantine.

Restoration uses the retained containment and its exact current version, with a
new plan and approval. It does not accept arbitrary replacement content. Quarantine
has no automatic expiry; the approval's expiry is a separate fact. Human Incident
closure does not silently restore content or settle pending response actions.

## HTTP and Admin boundary

Shared App handlers decode three staff mutations:

- `POST /api/admin/agents/incidents/{id}/response-plan` prepares quarantine or restore.
- `POST /api/admin/agents/incidents/{id}/response-plan/execute` executes quarantine.
- `POST /api/admin/agents/incidents/{id}/restore` executes restore.

Reference and scaffold use matching thin wrappers. Mutations return only an
Incident-bound acknowledgement. Private evidence, authorization context and
containment snapshots never cross the response projection.

The Admin view pauses polling and other Incident writes while a response is
pending. An unknown outcome or rate limit retains the exact command and
idempotency key for retry. Conflict or lost access clears stale evidence and
requires a current read. Preparing or refreshing never automatically approves or
executes a plan.

## Remaining boundaries

Host source ownership remains explicit. Historical comments without retained
canonical evidence and uninstalled source collectors are not fabricated. Runtime
moderation invocation remains disabled until its recipe executor owns approval
resume. The [comment evidence owner](r6-incident-evidence-flow.md) supplies a trusted
resolver for retained canonical comment observations. Assignment, other source
evidence viewers, notifications, model assessment and
the remaining recipe/evaluation gates remain separate.

This work adds no automatic Runtime, provider, worker, credential or external
provider call. Package versions, changesets and the lockfile remain unchanged.

## Verification

Local verification on 2026-09-28 KST:

- `pnpm verify --concurrency=2`: all 113 tasks passed, including Core 2,169,
  Admin 174, App 628 and Web ordinary 174 cases. Repository checks passed all
  62 cases. The exact Incident HTTP boundary passed 34 cases.
- `pnpm lint`: all 41 tasks passed.
- PostgreSQL: eight affected files, 63 cases passed without skips, covering
  moderation execution/content/Incident, staff Incident Studio/workflow,
  Gateway Incident reads, Approval, and preview-overlay isolation.
- The staff lifecycle shares the existing moderation execution fixture. It
  proves preparation, self-approval rejection, distinct approval, quarantine,
  exact replay and separately approved restoration with no Gateway Run or
  principal. Grouped probes preserve the unconsumed approval after policy,
  approver membership, target or Incident version changes and reject unselected
  targets and revoked requester-session replay.
- Production browser: 13 Incident/Approval scenarios passed across the full run
  (11 existing cases) and corrected targeted run (two new cases), with retries
  disabled. The initial new fixtures reused object references; serializing them
  as actual JSON wire data corrected the fixture, without changing product code.
  New journeys cover prepare/approval/execute/restore, unchanged unknown-outcome
  retry, conflict and access-loss cleanup.
- Fresh packed consumer: 40 public tarballs installed outside the workspace;
  configuration-inclusive typecheck, schema generation, migrations, production
  build and the operational scaffold journey all passed. Foundation checks
  confirmed 50 tables, 343 critical and 17 deferred constraints. Installed Core,
  App and Admin bytes matched the verified producer. The fresh scaffold selected
  Next.js 16.3.6; the workspace production browser used 16.3.4.
- The response screenshots at 390 and 1280 pixels were visually inspected:
  target/version text wraps, approval and execution controls stay visible, and
  there is no horizontal overflow.

Independent review caught and corrected stale execution eligibility, site context,
command/Incident binding, self-approval timing and a Date comparison that hid
plans. Final code review and whitespace checks passed. The prior handoff content
is preserved unchanged.

This is the acceptance evidence for this slice, not the full R5/R6 gate. Redis,
native preview rendering, built-in theme and spoken assistive-technology gates
were not rerun; their owners were not changed. Logs use
`/tmp/np-incident-response-{verify-final,lint,pg-final,browser,browser-corrected,scaffold}.log`.
