# R6 Incident review and human decisions in Agent Studio

The Studio connects the existing Incident read and feedback owners to staff
Admin review and explicitly installed human workflow decisions. It does not close AP-601, R6 evaluation, or R5 spoken
assistive-technology acceptance.

## Ownership and installation

- `agent/incident-service.ts` shares canonical signal verification, per-category
  permission checks and the mandatory per-evidence visibility callback between
  Gateway reads and the new staff reader. Staff reads use a real current staff
  session; they never manufacture a Gateway principal. Hosts must explicitly
  supply `canReadStaffIncident`, even for administrators.
- `agent/incident-studio-service.ts` composes that staff reader with the existing
  Incident writer, Activity and Approval services. Install it as `incidents` in
  the existing Studio server runtime. Missing installation returns unavailable.
  Writer presence alone does not enable feedback: its `feedbackEnabled` flag
  reflects installation of the existing feedback visibility owner. Actual writes
  still validate current target ACLs, session authority, CAS and idempotency.
- `agent/incident-workflow-service.ts` is installed separately as Studio's
  optional `workflow` owner. Its staff reader must retain current evidence ACLs;
  `canReviewContainment` authorizes actual retained targets, and `canReviewAction`
  is required when pending moderation actions exist. Missing or denied target
  review disables the workflow summary rather than exposing hidden counts.
- `agent-contract/incident-studio-contract.ts` is the exact browser-safe detail
  projection. Private source bodies, raw timeline details, actor fingerprints and
  containment original state are excluded. Unknown deterministic scores remain
  null; they are not model confidence.
- Shared App handlers own HTTP decoding and response binding. Reference and
  scaffold routes are thin matching wrappers. The Admin views use existing
  fetch, safe recovery and bounded polling helpers.

## Review behavior

The initial view filters unresolved incidents. Supported filters are exact
status, category and severity; the HTTP service also accepts the existing
updated-after filter. Staff ordering is unresolved first, severity descending,
then last observation descending and ID. Gateway ordering is unchanged.

List cursors are authenticated and bound to the current site, staff session,
authority and complete query. At most one page is scanned; hidden rows can
produce an empty page with continuation. Generation checks exclude rows that
changed after selection. Pagination is a live view, not a historical snapshot.

Detail reuses the existing limit of 100 retained signals. Each signal exposes
its detector/version/category, deterministic confidence basis and optional
score. Timeline pages contain at most 50 entries with explicit text labels for
observations, deterministic correlation, assessments, human notes, actions and
verification. Continuations bind to the incident generation; updates require a
fresh first page. Source evidence and current item visibility are checked again
after composition.

Action and approval links are exposed only after the corresponding read owner
accepts the current viewer. Real containment entries retain an action ID; its
approval is resolved and independently authorized through the existing Approval
service. Generic Activity currently rejects comment targets, so those action
links remain absent while an authorized moderation approval remains reviewable.
The [staff response flow](r6-incident-response-flow.md) connects optional response
planning and explicit execution to these same owners. No incident-specific
approval, quarantine or restore executor is introduced.

Feedback offers confirmed-spam and false-positive labels for spam signals. The
current immutable feedback head is displayed per signal; a correction passes
its exact superseded ID. The underlying history remains retained. Unknown
outcomes preserve the same command and idempotency key for retry; conflicting
versions or lost access discard stale evidence. Feedback does not dismiss an
incident or change containment. Polling pauses while a write outcome is pending
and stops on terminal state/access loss.

## Human investigation and closure

The optional Incident workflow service owns `agents.incidents.transition` through
existing staff admission. An open Incident can move to `investigating`; unresolved
Incidents can be resolved or dismissed. Terminal Incidents cannot be reopened by
the client. Each decision requires a bounded human note. Resolution categories
are `REMEDIATED` or `NO_FURTHER_ACTION`; dismissal categories are `FALSE_POSITIVE`,
`DUPLICATE` or `OUT_OF_SCOPE`. Dismissal records an Incident disposition, not a
replacement signal-feedback label, and retains the original signals.

Before closing, the server supplies a bounded review of retained containment and
pending moderation work. Active, restored and unresolved containment are distinct;
expired or failed records do not imply that the original content was restored.
Current target visibility is required before exposing this review. Missing review
ownership or unavailable evidence does not become a zero count.

Closure binds the exact reviewed facts and Incident version. Changed facts require
fresh review. The human explicitly retains active quarantine, or acknowledges the
remaining summary when no active quarantine is present. A state transition does
not restore content, execute moderation, or bypass an approval. Pending moderation
work must be settled before closure through the existing approval/expiry owner, and closed Incidents cannot acquire a new
quarantine through a previously prepared command. Approved restoration remains
owned by the existing moderation executor.

The immutable timeline exposes the bounded human decision, including its previous
and resulting state, category, note and containment disposition. Other raw timeline
details remain private. Browser commands preserve their exact identity while an
outcome is unknown; conflicting versions or lost access discard stale review.
Feedback, transition and response writes cannot run concurrently from the same
detail view.

## Boundaries

This document records the review, feedback and human-decision slice. The
[response flow](r6-incident-response-flow.md) records staff plan/approval/execution.
The [comment evidence flow](r6-incident-evidence-flow.md) adds bounded observation
metadata/current-state review and exact response target selection. Assignment,
other source evidence viewers, model assessment content,
notification posture and the additional designed filters still need their
owning services and projections. Comment source collectors, evaluation datasets
and Runtime approval-resume boundaries remain as recorded in the
[Moderator flow](r6-moderator-flow.md). This work installs no Runtime, provider,
worker, collector or credential and makes no external provider call. It changes
no schema, package version, changeset or lockfile.

## Verification

### Review and feedback slice

Local verification on 2026-09-27 KST:

- `pnpm verify --concurrency=2`: 113 tasks passed, including Core 2,164,
  App 612 and Web 174 unit tests. One initial CLI template typecheck process
  exited with a native Bus error; the isolated check and complete rerun passed.
  Reclaiming older regenerable Turbo cache increased free disk space from about
  4 GiB to 30 GiB. This is not evidence of a code-level cause for the native exit.
- `pnpm lint`: final 41 tasks passed without warnings. The final React cleanup
  replaced an effect-driven filter reset with a keyed view; Admin typecheck,
  Admin/Web builds and the Incident browser journey passed afterward. Two
  unnecessary Core non-null assertions were removed; Core typecheck passed and
  compiler output comparison confirmed identical emitted JavaScript.
- PostgreSQL: all 24 cases across five files passed without skips: the new Studio
  suite plus Incident read, Incident Gateway, Moderator feedback and Moderator
  execution regressions. Coverage includes current-session/item visibility,
  canonical evidence rejection, bounded pagination/generation binding, list
  selection races, feedback enablement/CAS/replay/supersession and real retained
  quarantine/restore approval links. The existing execution fixture now uses its
  frozen clock consistently for Incident creation/update timestamps.
- App HTTP boundary: 18 cases passed as part of the final unit gate. Five
  reference/scaffold wrapper pairs are byte-identical.
- Production browser: six existing Approval cases and three Incident cases
  passed with retries disabled. Two initial Incident assertions also matched
  Next's route-announcer alert; the scoped assertions and final three-case run
  passed. The real uninstalled route returns 503/no-store. UI fixtures cover
  filtering, exact unknown-outcome retry, conflict/access-loss cleanup and safe
  review links. Both 390px and 1280px captures were inspected; these browser
  fixtures do not claim a fully installed host's end-to-end moderation workflow.
- Packed consumer: 40 public packages installed in a fresh project outside the
  workspace. Typecheck, production build, existing 50-table/343-critical/
  17-deferred Agent foundation checks and operational scaffold journey passed.
  After the final UI cleanup, a new Admin tarball was installed; installed JS
  and declarations matched producer bytes, and consumer typecheck/build passed
  again. The unrelated extension/script matrix was not repeated.
- Formatting, documentation links, secret/generated-file review and
  `git diff --check` passed. Versions, changesets, lockfile and migrations are
  unchanged. The pre-existing handoff diff remains byte-identical.

Logs use `/tmp/np-incident-studio-*`. Redis, theme-specific integration, native
preview and spoken assistive-technology gates were not rerun for this review
surface; this evidence does not claim the complete R5/R6 acceptance gate.

### Human investigation and closure slice

Local verification on 2026-09-27 KST:

- `pnpm verify --concurrency=2`: 113 tasks passed, including Core 2,167,
  App 615 and Web 174 unit cases. An initial run loaded the old registry golden
  before its update; the complete rerun passed. After the final equivalent note
  validation cleanup, the affected 13 contract cases, Core typecheck/build and
  Web production build passed again.
- PostgreSQL: 31 cases across six files passed without skips: human workflow,
  Moderator execution, Studio review, Incident read, Incident Gateway and
  Moderator incident/feedback. New coverage exercises immutable decisions,
  terminal replay with current ACL/session checks, distinct concurrent decisions,
  stale containment review without an Incident version change, pending action
  review, retained quarantine after closure, approved restore after closure and
  concurrent closure versus a new quarantine proposal. The moderation fixture
  and workflow share the existing frozen clock; the initial clock mismatch was
  corrected without weakening persisted time validation.
- Pure contracts and the Admin operation registry: 13 cases passed, including
  invalid state/reason combinations, unsupported authority fields, exact review
  bounds and Unicode decision notes. The registry fingerprint changed with the
  now-concrete transition input; a bounded JSON Schema branch was corrected.
- `pnpm lint`: 41 tasks passed. The final note control-character check uses
  explicit character codes rather than a lint-rejected control-character regex.

- Production browser: all five Incident scenarios passed without retries or
  skips. The real uninstalled read boundary remains 503/no-store; installed UI
  fixtures cover investigation/closure, the explicit current-review checkbox,
  network/429 exact-command retries, conflict re-review and access-loss cleanup.
  Four captures at 390px and 1280px were inspected, including the closure form.
  These fixtures do not claim a fully installed host's end-to-end execution.
- Packed consumer: 40 public packages installed into a fresh project outside
  the workspace. Typecheck, fresh schema generation/migration, Agent foundation
  checks, production build and the operational scaffold journey passed. Installed
  Core, App HTTP handler and Admin bundle bytes matched the verified producer.
- Formatting, transition wrapper parity, secret/generated-file review and
  `git diff --check` passed. Final browser-test capture changes passed Web lint.
  Versions, changesets, lockfile and migrations remain unchanged.

Redis, theme-specific integration, native preview and spoken assistive-technology
checks were not repeated for this state-decision surface. This slice does not
claim full R5/R6 acceptance. Logs use
`/tmp/np-incident-workflow-*`; the existing handoff remains unchanged.
