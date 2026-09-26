# R6 Moderator: observed comments and reviewed containment

This AP-601 bundle connects bounded repeated-link observations to real Signals,
Incidents, reviewable human approvals, exact content quarantine/restore, and
immutable feedback. Installation is explicit. Observation never grants mutation
authority, and this bundle does not establish automatic-quarantine readiness or
complete the R6 evaluation gate.

## Source evidence and detection

The existing comment owner still runs the installed profanity and spam adapters.
An optional bootstrap-owned `setCommunityModerationObserverV1` observer records
only their actual verdict pair and a digest of the exact saved comment state.
The comment mutation and canonical community event commit together. A failed
observer rolls back the source mutation; no event dispatch, Agent Run, worker,
provider, credential or external delivery is started. Without an observer the
existing comment path remains available without invented historical evidence.

`createAgentModeratorCommentObserverV1` uses the existing Runtime event recorder,
which now accepts the caller's transaction. Pending comments have an explicit
canonical event status. Code-owned verdict codes and the source deduplication key
bind the actual state; bodies, adapter reasons and URLs are not retained in the
Agent event. Reject verdicts still reject the content write through its existing
owner.

`createAgentModeratorCollectorV1` is a host-invoked collector for closed, aligned
600-second windows. It reads at most 101 events to detect overflow of the
100-event bound, checks current staff and domain visibility, and excludes legacy,
stale, edited, hidden or non-author observations that cannot prove their source.
It extracts normalized hostname hashes locally, without fetching links. The
versioned deterministic detector counts distinct registered members and distinct
targets, deduplicates revision/replay evidence, and records an advisory score.
The score is not a probability or an authorization decision. Quoted text and
injected instructions cannot alter thresholds, scopes, targets or approval.

`createAgentIncidentWriteServiceV1` requires the source owner's evidence
validator. It serializes incident correlation, checks canonical evidence digests,
uses a stable site/domain/window fingerprint, and appends immutable timeline
records. Replaying the same evidence does not create another Signal or Incident.
Growth remains bounded; it never truncates evidence to claim a complete result.

## Approved effects and restoration

`createAgentModerationServiceV1` reuses Gateway admission, current staff authority,
the actual policy evaluator, current budget measurements, canonical invocation
and action evidence, and the existing signed approval service. Its host supplies
current policy and budget sources and per-target Incident visibility. Missing
owners do not grant permission. The explicitly installed facade adds
`moderation.quarantine` and `moderation.restore` to the existing HTTP and MCP
surfaces, with caller-stable idempotency keys.

A proposal creates one real provider-free Gateway Run, immutable Action and
expiring human approval. It has no content effect. Execution requires a distinct
invocation carrying exactly the original action, approval and proposal hash.
Current credential exposure, scopes, role, policy, budget, target version and
single-use approval are rechecked in the execution transaction. Policy changes,
revoked/expired approvals and content edits reject the request. The service
always requires recent staff-primary human approval; it does not automatically
execute a high detector score.

Execution also locks and rechecks the distinct approving staff member's current
site authority and target visibility. Losing that authority blocks execution and
allows existing approval reconciliation to revoke the approval. Site run limits
use one shared Gateway/Runtime measurement, so changing admission order cannot
bypass the ceiling; Agent-specific counters remain scoped to that Agent. Zero
attempt or capability-call ceilings deny admission, while a zero provider-call
ceiling permits this provider-free operation.

The shared approval service can route Action targets through
`resolveActionTargets: () => moderation.approvalTargets`, including when created
by the existing ChangeSet service. Its existing list, typed challenge, decision,
reauthentication and expiry paths remain the authority owner. Safe `actionReview`
facts show the exact target, expected version, reason and containment handle.
Completed approval history checks current visibility without requiring the
pre-effect version to remain current.

The community domain owns content changes. Comments can move from `pending` or
`visible` to `hidden`; restoration returns the recorded status, so pending
content never becomes visible merely because it was restored. Documents use the
existing collection pipeline, ACLs, hooks and revisions, and require the
configured moderation hidden field. The whole target state, including the parent
of a comment, participates in compare-and-swap. Concurrent edits and unexpected
hook changes reject restoration instead of overwriting newer work.

The containment records the private exact original state. The source action's
verification evidence binds its digest and installed target version. Restoration
accepts that server-owned state and exact current version; callers cannot submit
replacement restoration bodies. Domain writes, approval consumption, action
verification and incident timeline updates are atomic. A failure rolls back the
content and associated evidence. Deferred cache/reputation/realtime effects run
only after commit. Restore compensates the original action and never
re-quarantines automatically.

## Feedback and retention

`agents.incidents.feedback` uses existing staff admission, idempotency and an
Incident version check. It accepts `confirmed-spam` or `false-positive` against
an explicitly selected retained Signal. Detector identity/version and source
attribution come from that Signal. Corrections append a same-target successor;
they do not overwrite earlier labels, tune a policy or grant authority.

The additive containment table has one live containment per exact site/target,
same-site source/restore Action and Incident references, and bounded original
state. Deferred Action references preserve approval and containment evidence
while allowing transactional creation. Existing reference fences, Doctor and
site deletion know the new owner. Maintenance conservatively retains direct
effect evidence and its dependencies; elapsed age alone does not delete an
active containment or its restoration input. Automatic containment expiry and a
terminal containment pruning owner are not installed here.

## Explicit boundaries

- The concrete collector captures comment creates and author edits. Historical
  comments without exact source evidence, document/report collectors, and model
  classification are not fabricated. Approved document quarantine/restore is
  supported through its domain owner.
- These effect capabilities are installed for Gateway use. Runtime source
  projection does not advertise them and Runtime invocation fails closed until
  the recipe executor owns the corresponding approval resume lifecycle.
- The host must install the observer/collector, policy/budget sources, Incident
  visibility, approval routing and moderation facade. No reference/scaffold
  bootstrap silently enables any of them.
- Automatic spam quarantine still requires the documented per-locale/policy
  reviewed dataset, precision and Wilson-bound thresholds, and 14-day production
  shadow evidence. These local fixtures do not establish that evidence.
- R5 actual screen-reader acceptance, the remaining R6 recipes and full R6
  acceptance remain separate.

## Verification

Local acceptance completed on 2026-09-27:

- `pnpm verify --concurrency=2`: 113 tasks passed, including Core 2,164 unit
  cases, App 594 and Web 174. The reviewed OpenAPI fingerprint includes the two
  new exact moderation invocation branches.
- `pnpm lint`: 41 tasks passed. Changed-file formatting, final Web typecheck
  after browser-fixture refinements, and `git diff --check` passed.
- PostgreSQL: 176 cases across 16 files passed with explicit isolated test
  databases and no skips. This includes the four new Moderator files (22 cases),
  reference/retention/diagnostic regressions (45), existing approval/Gateway/event/
  comment regressions (70), and Runtime admission/usage regressions (39).
- Real execution covers approval, exact quarantine and restoration to `pending`,
  replay, stale content/policy, human and system revocation, expiry, distinct
  approver authority loss, per-run and shared site budgets, atomic failure and
  retry, and retained restoration evidence after the ordinary retention age.
- Production browser: all six approval-suite cases passed without retries on
  an isolated migrated database. The new restoration review was rerun after
  fixture refinements; 390px and 1280px captures were inspected. These UI tests
  use the existing safe-response fixtures; actual service effects and signed
  approvals are verified by the PostgreSQL journeys above.
- Packed scaffold: all 40 public packages were packed and installed outside
  the workspace. Fresh typecheck, generated migrations, migration application,
  production build, generated plugin/theme lifecycle matrix, five script-loading
  probes, and the existing operations journey passed. Installed Core/App bytes
  match the frozen producer hashes. Doctor verified 50 tables, 343 critical
  constraints and 17 deferred constraints, with Runtime disabled.
- Migration generation adds only the containment table in `0062`; `0063` adds
  its reference guards and the two deferred Action references. Historical SQL
  remains unchanged. Migration helper (13 cases) and migration-chain (5 cases)
  checks passed.

This is the acceptance for the implemented slice, not a full R5/R6 gate. Redis,
theme PostgreSQL and native-preview gates were not rerun for this slice; actual
screen-reader acceptance and the recipe/evaluation boundaries above remain open.
Package versions, changesets, lockfile and the inherited session handoff remain
unchanged.
