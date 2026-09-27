# R6 Incident review in Agent Studio

This bundle connects the existing Incident read and feedback owners to staff
Admin review. It does not close AP-601, R6 evaluation, or R5 spoken
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
- `agent-contract/incident-studio-contract.ts` is the exact browser-safe detail
  projection. Private source bodies, timeline details, actor fingerprints and
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
No incident-specific approval, quarantine or restore executor is introduced.

Feedback offers confirmed-spam and false-positive labels for spam signals. The
current immutable feedback head is displayed per signal; a correction passes
its exact superseded ID. The underlying history remains retained. Unknown
outcomes preserve the same command and idempotency key for retry; conflicting
versions or lost access discard stale evidence. Feedback does not dismiss an
incident or change containment. Polling pauses while a write outcome is pending
and stops on terminal state/access loss.

## Boundaries

This is the review/feedback slice. Assignment, state transitions, response plans,
containment summaries, richer evidence viewers, model assessment content,
notification posture and the additional designed filters still need their
owning services and projections. Comment source collectors, evaluation datasets
and Runtime approval-resume boundaries remain as recorded in the
[Moderator flow](r6-moderator-flow.md). This work installs no Runtime, provider,
worker, collector or credential and makes no external provider call. It changes
no schema, package version, changeset or lockfile.

## Verification

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
