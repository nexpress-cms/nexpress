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
- The Admin list opts into `includeSummaries=true`; older Studio/Gateway clients
  retain the original list projection. Per-Incident summaries bind the exact
  Incident version, optional current workflow review and the newest verified AI
  assessment. Missing/denied containment ownership and invalid assessment proof
  return unknown, never a fabricated zero or absence.
- `agent-contract/incident-studio-contract.ts` is the exact browser-safe detail
  projection. Private source bodies, raw timeline details, actor fingerprints and
  containment original state are excluded. Unknown deterministic scores remain
  null; they are not model confidence.
- Shared App handlers own HTTP decoding and response binding. Reference and
  scaffold routes are thin matching wrappers. The Admin views use existing
  fetch, safe recovery and bounded polling helpers.

## Review behavior

The initial view filters unresolved incidents. Supported filters are exact
status, category, severity, detector source, assigned Agent, active containment,
observation-time range and literal title/summary search. The HTTP service also
accepts the existing updated-after filter. Staff ordering is unresolved first, severity descending,
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

The list displays the existing assigned Agent ID and optional active-containment
count, nearest recorded expiry and AI-assessment availability. The workflow owner
authorizes all retained containment and pending Actions before the aggregate;
its review hash/count are checked again afterward. Exact Incident generation and
staff authority are reread before returning a summary. No expiry automatically
restores content. No assessment entry is distinct from an invalid/unverifiable
entry; the latter remains unknown.

Flood evidence follows the existing canonical maximum of 100 attached Signals
with at most 100 references each. The staff evidence owner checks the whole set
of up to 10,000 unique Events, loading at most 100 source rows per query, while
returning ten metadata items per page. Visibility is never granted from only the
displayed page. A missing or inaccessible source on a later page denies the
whole Incident.

Action and approval links are exposed only after the corresponding read owner
accepts the current viewer. Real containment entries retain an action ID; its
approval is resolved and independently authorized through the existing Approval
service. Generic Activity currently rejects comment targets, so those action
links remain absent while an authorized moderation approval remains reviewable.
The [staff response flow](r6-incident-response-flow.md) connects optional response
planning and explicit execution to these same owners. No incident-specific
approval, quarantine or restore executor is introduced.
Response targets paginate independently through detail's `responseCursor` and
the response's optional authenticated `nextCursor`. Timeline `cursor` is never
forwarded to the response owner. Omitting the response cursor preserves the
existing complete response and wire shape for up to 100 distinct eligible
targets. Larger default results start a ten-evidence-item page; an explicitly
provided cursor, including `null` at the service boundary, always requests that
bounded page mode. Changing response pages clears the selected
target; a last-page proposal independently rechecks exact target membership and
current version rather than requiring that target on the first display page.
Existing approval, 50-plan and 100-containment/choice limits remain. When the
combined choice ceiling is reached, restoration remains available and the result
is explicitly partial; further quarantine waits for human restoration/review.

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
metadata/current-state review and exact response target selection. The
[assignment flow](r6-incident-assignment-flow.md) adds explicit Agent designation
and removal. The [semantic assessment flow](r6-moderator-assessment-flow.md)
provides separately labeled read-only judgments; its ten-target uncertainty
boundary does not claim whole-flood semantic classification. Other source
extensions still need their owning services and projections. Comment source collectors, evaluation datasets
and Runtime approval-resume boundaries remain as recorded in the
[Moderator flow](r6-moderator-flow.md). This work installs no Runtime, provider,
worker, collector or credential and makes no external provider call. It changes
no schema, package version, changeset or lockfile.

## Verification

### Bounded comment evidence read performance

The October 2026 performance follow-up keeps the canonical whole-Incident ACL
proof, ten-item pages, fresh source/parent generation checks and exact response
planning. The content owner inspects at most 100 comments per batch, hydrates
shared parents for the batch and its final recheck, and still runs collection/audience checks
for every target. Parent and comment rows are checked again after those checks;
changed, moved, missing or denied targets fail closed. Each authorization and
final evidence pass builds fresh batches. No authorization cache crosses passes
or requests, and mutation loaders retain their existing lock order and behavior.

A local PostgreSQL 16 comparison used the same 151-source review journey, one
Vitest worker, unchanged assertions and the existing 180-second deadline. Fixture
construction issued 11,516 SQL calls in both runs and took 9.8–12.9 seconds.
The subsequent review/pagination/final-plan/feedback work fell from 123,801 to
6,854 SQL calls and from 87.9 to 13.7 seconds. This measures the complete existing
journey after fixture preparation, not one HTTP request or the whole hosted CI
suite. The test records optional phase timings and enforces a generous SQL-call
budget instead of adding a wall-clock speed assertion. Its async body uses the
existing integration work-scope barrier so a timeout cannot race fixture reset.

Real PostgreSQL coverage compares batch results to the single-target owner,
checks per-item ACL denial and isolation of ACL-local document mutations, and
rejects parent revocation or sibling deletion during a pass. Existing 100-target
compatibility, all 151 targets, final-page planning/feedback, off-page denial,
session/cursor invalidation, mixed document reports and quarantine/restore
coverage remain required. This is a read-performance slice; it adds no Runtime,
provider or automatic-moderation authority.

### Current paging and optional-summary verification

On 2026-10-15, the focused PostgreSQL run passed 24 cases across Incident Studio,
actual comment evidence and read-only semantic assessment. It covers 151 actual
source Events through strict staff visibility, all target pages, a final-page
proposal and feedback; detail forwards response pagination without consuming the
timeline cursor. An unavailable off-page source denies the whole Incident.
Actual approved quarantine proves active-count projection and denied review
becomes unknown. Genuine assessment proof becomes available; tampered retained
proof becomes unknown. Generation changes exclude mixed summaries.

The staff-query contract suite passed two cases and the HTTP boundary suite
passed 62 cases. Core, App and Admin source TypeScript, the connected Studio,
assessment, evidence and browser test types, and focused product lint passed
against the coordinated Core build. The new browser fixture covers optional
summaries and explicit target selection after response pagination; the full
bundle's acceptance document records its production-browser gate. These checks
install no production owner and establish no model accuracy or automatic
moderation permission.

A follow-up persistence run passed all 16 comment-evidence and document-report
cases. It preserves the existing complete 11-target and 100-target default
response and absent `nextCursor` field, while explicit first-page requests and
151-target defaults use bounded continuation. The document-report case still
requires all eight eligible choices after resolution, owner edits and hiding;
its expectation was preserved.

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
