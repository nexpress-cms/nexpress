# R6 original-goal gap audit

Audited 2026-10-15 against implementation commit
`3d38784c6b5ae37dc9e5f2f1b9069f045e22385f`. This is a source/design audit,
not a new application acceptance run. It preserves the pending documentation
and handoff edits and performs no provider call or activation.

## Decision

**R6's full original product goal is not complete.** The
[delegated AI review](r6-delegated-acceptance-review.md) accepts the retained
responses within the implemented human-approved/read/proposal slice; it cannot
close implementation gaps outside those examples. Its earlier wording accepting
the entire planned AP-600–606 development milestone was too broad. This audit
supersedes that wording without changing any evaluation result or inventing
human judgments.

The requirements baseline is the
[R6 roadmap](implementation-roadmap.md#r6--moderator-operator-and-publisher-recipes),
[Phase 3 acceptance](product-requirements.md#phase-3--publisher-moderator-and-operator),
`PR-CNT-001..003`, `PR-MOD-001..006`, `PR-OPS-001..005`, and the three
[concrete MVP recipes](agent-runtime-and-guardian.md#concrete-mvp-recipes).
The Admin design and retention plan identify additional planned surfaces;
optional integrations and automatic-action enablement remain separate.

Priorities below are proposed work order, not security severity. “Missing” means
no shipped concrete owner/path was found in the inspected source, even when a
type or host callback exists. “Evidence gap” means the behavior is not disproved,
but the current verification does not establish it.

## Authorized implementation follow-up

The user subsequently requested all remaining work **except actual Runtime
validation**. The follow-up interprets that exclusion as no live-model/provider
Runtime trial; ordinary fake-inference, PostgreSQL, Redis and browser verification
remain applicable. No provider call, credential installation or automatic
activation is introduced. The findings below describe the original audited
baseline; this follow-up supersedes their implementation status.

The implementation owners below exist, but the subsequent
[integrated-path recheck](#integrated-path-recheck-after-the-gap-fix-bundle)
found remaining correctness and product-surface gaps. This table is not an
end-to-end completion declaration.

| Gap   | Follow-up implementation                                                                                                                                                                                                        | Preserved boundary                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1    | Selected-source durable scan/verify/emit checkpoints, late-event ledger, current-target rechecks and exact bounded evidence chunks; Runtime admission waits until collection completes.                                         | Per-transaction and downstream Signal/Incident bounds stay. Old expired windows cannot be reconstructed from partially retained sources.                                                                                                   |
| G2/G3 | Explicit Operator operational Event source, separate V3 event-eligible profile, concrete pg-boss local runbook plan and persisted bounded before/after recovery monitor.                                                        | Source installation and site/deployment authorization are explicit. Restart/retry-all remain local plans. Unknown, paused and timed-out observations are distinct from recovery.                                                           |
| G4/I1 | Publisher selection receipt retained before dispatch, safe exclusion/coverage evidence, real SEO metadata fields, and a supplied anonymous-ACL canonical public route adapter.                                                  | Complete coverage requires an explicit host declaration and complete sources; hidden/unreadable content remains unavailable or partial. Original instruction/profile bytes stay frozen.                                                    |
| G5    | Alternative read-only semantic Moderator profile, bounded current-source excerpts, separate classification record/provenance and safe Incident Studio display. Fingerprint daily/cooldown admission precedes provider dispatch. | No capability tools/effects, deterministic fact replacement or human labels. Versioned synthetic conformance is separate from measured model accuracy.                                                                                     |
| G6    | Explicit dependency-safe history policy in existing maintenance, terminal orphan Signals/reference-free closed cohorts, independently eligible local feed rows and completed flood bookkeeping cleanup.                         | Immutable audit, active work, unknown outcomes, Actions, approvals, rollback and required evidence remain pinned. Audited Incident skeletons are not promised universal erasure. See the [retention matrix](r6-history-retention-flow.md). |
| U1/V2 | Source/assignee/containment/time/literal-query Incident filters; actual multi-candidate nested/rich-text/SEO-title/stale-reference Publisher coverage and semantic persistence/admission fixtures.                              | These prove source/contract/service behavior, not broad model usefulness.                                                                                                                                                                  |

V1 is explicitly excluded by the user. The retained model evaluations continue
to describe their earlier exact profiles and corpus; they are not rerun or
relabelled as acceptance of these new profiles. Automatic quarantine, external
delivery and production shadow/quality gates remain separate. Current verification
results are recorded in the [acceptance crosswalk](r6-acceptance.md).

## Integrated-path recheck after the gap-fix bundle

Read-only source recheck on 2026-10-15 at `3d38784c` plus the uncommitted gap-fix
bundle. All 81 code/test/CI files still match the accepted manifest
`71a26a289253d3f2b767a9f8cbfb448f0a0c6d88126d107c850e45429d7f2f2d`.
This recheck supersedes the preceding blanket statement that only actual Runtime
validation remained. Existing passing tests retain their stated coverage; they
do not establish the newly identified missing connections.

### Corrections identified at that recheck

1. **Flood Incident visibility does not support the new collector's union.**
   The collector can attach several bounded Signals containing 151 distinct
   Events to one Incident. The
   [observation owner](../../../packages/core/src/agent/incident-observation-service.ts)
   permits that union (lines 156–211), but the
   [evidence owner](../../../packages/core/src/agent/incident-evidence-service.ts)
   rejects more than 100 distinct Event references (lines 127–135) and returns
   false from staff visibility (lines 453–457).
   [Incident reads](../../../packages/core/src/agent/incident-service.ts)
   apply that visibility callback (lines 251–264), so the supplied owners can
   successfully store a flood Incident that staff cannot list or review. The
   151-target fixture checks stored rows, not this actual read/Studio path.
   Whole-Incident access proof and bounded evidence pages must work together;
   approving visibility from an arbitrary sample is not an acceptable fix.
2. **Semantic selection does not advance to an eligible Incident.** The
   [source](../../../packages/core/src/agent/moderator-assessment-source.ts)
   requests only `limit: 1, cursor: null` and ignores `nextCursor` (lines 203–215).
   The read owner deliberately allows an ACL-filtered empty page with a
   continuation. A hidden first row therefore hides a later authorized target.
   Separately, an already-assessed open Incident A can remain first when B is
   created later. B's Run selects A, its fingerprint budget correctly rejects A,
   and selection never considers B. Event admission has already consumed that
   occurrence. Preserve budget and ambiguity guards while adding bounded,
   trigger-aware eligible selection and continuation.
3. **Publisher route inventory omits document-aware anonymous access.** The
   [adapter](../../../packages/app/src/lib/agents/publisher-route-inventory.ts)
   checks site/status/visibility/audience (lines 71–115), but ordinary
   [collection queries](../../../packages/core/src/collections/pipeline.ts)
   only apply the collection-level read callback; document-aware checks are
   applied to single-document reads and preview (lines 2609, 2697–2700, 2763).
   A callback allowing the query but denying a particular `doc.slug` can thus
   deny public document retrieval while the inventory emits its canonical path
   and age as complete public facts. Reuse the document-aware access owner.
4. **The pre-dispatch Publisher candidate snapshot is still absent.**
   [Selection receipt](../../../packages/core/src/agent/publisher-content.ts)
   lines 41–67 retain criteria, counts and safe exclusion codes. Candidate IDs,
   bases and findings exist in transient
   [request metadata](../../../packages/core/src/agent/runtime-context.ts)
   (lines 735–759), but the
   [durable call](../../../packages/core/src/agent/runtime-usage.ts)
   stores only that receipt (lines 763–782). A hash-only classification manifest
   cannot reconstruct the selected snapshot after failure or a no-proposal
   response. PR-CNT-002 requires an appropriately bounded, protected snapshot
   before dispatch, without retaining raw content or hidden exclusions.
5. **The supplied Operator mutation adapter does not preserve the existing
   deployment feature flag.** The
   [remote Ops endpoint](../../../packages/app/src/api/admin/ops/actions/route.ts)
   requires `NP_REMOTE_OPS_MUTATIONS=1` (lines 90–91), while the explicitly
   installed [Agent host](../../../packages/app/src/lib/agents/operator-host.ts)
   can execute approved cache invalidation after its authorizer without checking
   that flag (lines 309–326). A custom authorizer can compensate, but the supplied
   path does not itself guarantee PR-OPS-003's existing deployment gate. This is
   a gate inconsistency, not a claim of execution without human approval.
6. **Operator plans lack an Admin evidence-review path.** The
   [plan owner](../../../packages/core/src/agent/operator-service.ts)
   actually saves and returns plan/digest/checks/local handoff (lines 1059–1092).
   [Activity](../../../packages/core/src/agent/activity-service.ts) instead
   projects action input and successful output as empty objects (lines 334–361),
   which the Admin renders. Local queue plans have no approval page as an
   alternative. A safe current-authority plan/runbook projection is needed for
   the MVP's exact-evidence display. Recovery monitoring exists through the host
   API and jobs facet; automatic monitor startup is not a missing requirement.
7. **Backup plan check identifiers are replaced by list positions.**
   [The App adapter](../../../packages/app/src/lib/agents/operator-host.ts)
   maps shipped check IDs to `backup.check.${index}` (lines 516–518), losing
   stable identities such as `backup.verified` and `backup.database_artifact`.
   Preserve the owning contract's IDs under PR-OPS-001.
8. **New-profile evaluation tooling and representative coverage are incomplete.**
   The semantic eight-case corpus validates authored expected responses and
   source/schema bindings; it has no evaluation runner/artifact/review/report or
   Workbench integration. The closed
   [CLI dataset list](../../../packages/core/src/agent-contract/evaluation-command-contract.ts)
   excludes it. A pure installed-contract probe accepted `publisher.v2` and
   rejected `moderator-semantic-assessment.v1`; no inference was performed.
   Publisher evaluation still selects V1/V2 and represents one flat candidate,
   whereas V3 and the new source path admit broader shapes. The new PostgreSQL
   selection test proves reads/ranking, not multi-document/nested/title/rich-text
   create–validate–preview behavior. These fake/offline tooling and coverage
   gaps can be addressed without a live-model Runtime trial.

### Additional incompleteness and preserved boundaries

- Operator's supplied sources do not consume the shipped Doctor and release
  results under their stable contracts. Current readiness aggregates three
  configuration checks. Custom host adapters remain possible; the provided
  PR-OPS-001 source coverage is narrower than the full requirement.
- Incident filters exist, but list rows still omit the designed assigned-Agent,
  active-containment count/nearest-expiry and assessment-availability summary.
  Detail views and filtering do not implement those missing row facts.
- Block content is opaque JSON in the Agent read projection. Group/array hidden
  fields are omitted, while declared hidden block props can survive canonical
  save and appear in Publisher content even when omitted from the host JSON
  Schema. Generic `hidden` is an Admin UI flag, so this is a projection-policy
  inconsistency needing an explicit supported boundary, not a standalone claim
  that every hidden prop is confidential or that a vulnerability was exploited.
- Large-Incident semantic evidence remains bounded to one Incident, ten Signals,
  100 Events and ten targets. Truncation correctly forces uncertainty; splitting
  larger evidence into complete semantic assessments is not implemented.
- Automatic quarantine is **unimplemented code as well as an unmet enablement
  gate**. Approved quarantine/restore exists. The original full recipe cannot be
  called automatic merely because its deterministic detector is high-confidence;
  required precision/sample/shadow evidence must remain separate.
- Immutable audit, approvals, Actions and rollback evidence intentionally pin
  real Incident skeletons. Current retention is not universal 365-day erasure.
  External notifications, Member account actions and R7/R8 remain separate work.
- Actual live-model Runtime validation remains excluded by the user. Prior AI
  reviews and passing local checks do not prove the new profiles' model quality.

Recommended order: fix R1–R4's read/selection/persistence boundaries and R5's
deployment gate first; complete R6–R7's safe Operator review/identity path next;
then connect R8's versioned fake/offline evaluation and representative complete
journeys. Resolve the remaining projection/source/UI limits explicitly. Do not
enable automatic actions or call a provider as an implicit consequence.

This pass changed acceptance documentation only. It ran a pure parser/export
probe and preservation/link/format checks, not application builds, database
tests, servers, model calls, credential reads, commits, PRs or merges. Source
reviews are code-backed counterexamples; the missing integration regressions
belong to the implementation follow-up. The current handoff remains untouched.

### Authorized integrated-path corrections

The subsequent authorized implementation addresses all eight counterexamples
above. This section supersedes their present-tense missing-connection claims;
the original observations remain as the reason for the corrections.

| Recheck | Implemented correction                                                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1      | Whole-Incident ACL proof covers the canonical bounded Signal/Event union; evidence and response targets use bounded continuation. Planning independently revalidates the exact selected target. A real 151-target Incident remains readable through Studio. |
| R2      | Semantic source selection follows bounded ACL continuations, skips already charged fingerprints and resolves an Event-triggered Run to its actual linked Incident. Retained attempts preserve their selected target.                                        |
| R3      | Both canonical route inventory and selected public content apply the existing per-document anonymous read-access owner. Denied documents do not become public inventory facts.                                                                              |
| R4      | The pre-dispatch versioned diagnostic retains bounded selected document IDs, bases, findings and schema/content digests, without raw content or hidden exclusions. It remains bound to the exact V3 request and classification manifest.                    |
| R5      | The supplied Operator host preserves `NP_REMOTE_OPS_MUTATIONS` before approval consumption/reservation, dispatch and mutation.                                                                                                                              |
| R6      | Activity exposes authorized, hash-verified safe Operator checks, plan/local handoff, queue aggregates and recovery evidence. It adds no execution control.                                                                                                  |
| R7      | Backup plans retain the owning check identifiers rather than replacing them with positions.                                                                                                                                                                 |
| R8      | Versioned semantic and Publisher V3 selection profiles now run through offline evaluation, CLI comparison, exact-bound review, reports and Admin Workbench. Representative nested/rich-text multi-document proposals reach create–validate–preview.         |

Additional source/projection work supplies explicit retained Doctor/release
report adapters, opt-in authorized Incident row summaries, and declared-block
projection with an actual registered theme/plugin field supplier. Unknown,
missing, stale or inaccessible facts remain unknown. New summary fields are
opt-in so existing list callers retain their wire shape.

Independent review also corrected three evaluation-boundary defects: explicit
null/missing provider outputs are rejected rather than replaced by fake answers;
new profile comparisons round-trip through the command validator; and review
acceptance scores the exact case version while retaining the original suite's
failed gate. These are local fixture/provider-stub checks, not live inference.

The installed CLI independently verifies both new suite identities and profile
review artifacts through its existing command envelope. Its actual installed
evaluation/review/comparison guard caught a missing downstream dispatcher that
the App-only tests could not detect. Complete PostgreSQL coverage also caught
an implicit-cursor compatibility regression: ordinary 11/100-target calls now
retain their full legacy response, while explicit paging and 151-target defaults
use continuation. The original eight-choice document-report expectation remains.

Current evidence and final verification are recorded in the
[acceptance crosswalk](r6-acceptance.md#integrated-path-corrections-and-verification).
Full R6 remains open: automatic quarantine code and its enablement evidence are
absent; large-Incident semantic assessment remains bounded to ten targets and
forces uncertainty on truncation; actual model/Runtime validation is excluded.
No prior model quality or self-reported review is transferred to the new profiles.

## Subsequent authorized Moderator extensions

After the integrated corrections were committed, the user authorized both
remaining Moderator implementations. The
[explicit automatic-quarantine and segmented-assessment flow](r6-moderator-automatic-segmented-flow.md)
now owns their current behavior and verification. Earlier statements above and
in the preserved findings that these paths had no implementation describe the
preceding bundle, not the extended source tree.

Automatic quarantine has a separate host-only deterministic execution path with
immutable preauthorization evidence, current production-artifact verification and
existing moderation effect owners. No qualifying production review/shadow
artifact is supplied or installed, so production activation remains unavailable.
The V2 read-only assessment profile uses a bounded durable full-manifest segment
continuation and separately verified coverage aggregate. It does not authorize
quarantine. V1 profiles and old evaluation identities remain unchanged.

Actual model/provider Runtime validation remains excluded, and production model
quality/automatic-action enablement remain unestablished. The fixed offline
`fullR6` and `modelUsefulness` fields are not promoted to completion.

## AP reconciliation

This table and G1–G6 below preserve the pre-follow-up audit findings.

| Package | Implemented                                                                                                               | Remaining qualification                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-600  | Site-bound Signal/Incident/timeline/feedback storage, read facade and evidence ACLs.                                      | Model-assessment production/projection and terminal R6 record retention are incomplete; foundation is not missing.                                                                  |
| AP-601  | Actual content/report collectors, deterministic repeated-domain advisory, human-approved quarantine/restore and feedback. | Flood-window continuation is missing. Semantic moderation is not supplied by the proposal-copy recipe. Automatic quarantine is unimplemented and its enablement evidence is absent. |
| AP-602  | Concrete bounded observations/audits, task-owner plan seam and approved cache/run retry/run cancel.                       | Built-in operational Event producers, shipped Operator event eligibility, concrete worker runbook plan integration and bounded recovery monitoring are incomplete.                  |
| AP-603  | Stale candidate ranking, schema/field-safe ChangeSet draft/validate/preview, base checks and cooldown.                    | Explicit exclusion evidence is incomplete. Canonical link inventory is a host seam without a supplied concrete route supplier.                                                      |
| AP-604  | Current-ACL Admin notification feed, transition deduplication and bounded local recording recovery.                       | Baseline Admin feed exists. Email/Slack/webhook escalation is an optional unimplemented extension.                                                                                  |
| AP-605  | Three Studio draft presets and explicit immutable unattended profiles.                                                    | Setup exists; it does not fill the missing source/plan/inventory owners. Operator's supplied profile supports manual/schedule only. No automatic installation is required.          |
| AP-606  | Versioned fixtures, actual bounded provider evaluation, review/report/Workbench and runbooks.                             | Actual model plus Runtime execution has not been tested together; retained selected synthetic responses do not establish broad semantic, editorial or operational usefulness.       |

## Confirmed implementation gaps

### G1 — Moderator flood windows cannot make bounded forward progress

Priority: first. `PR-MOD-005` and Phase 3 require flood batching, deduplication,
breakers and hard budget admission while preserving deterministic records.

The [combined collector](../../../packages/core/src/agent/moderator-combined-collector.ts)
selects 101 site/window Events, throws `MODERATOR_COLLECTION_LIMIT` if there are
more than 100, and only then filters by `settings.collectionSlugs`. Its input has
no continuation cursor. Therefore a full window stays over capacity on retry;
unselected collections can also consume the selected recipe's limit. Events are
retained, so this is not silent record deletion, but the collector cannot produce
Signals/Incidents for that window through its current path.

The existing [101-source integration case](../../../apps/web/tests/agent-moderator-mixed-collector.integration.test.ts)
explicitly expects rejection and zero partial Incident/Signal/timeline rows. It
proves safe rejection, not successful flood processing. The
[Runtime event owner](../../../packages/core/src/agent/runtime-event-service.ts)
leaves failed collection pending; retry alone cannot reduce a closed window.

Needed: scope-aware bounded collection with durable continuation/aggregation and
an exact completion criterion. Preserve latest-target replacement, author
independence, deduplication, ACL rechecks and immutable evidence across pages.
Simply raising the cap or treating a partial page as complete is insufficient.

### G2 — Operator's operational event chain is not supplied

Priority: next. Role templates and the worker MVP describe worker/backlog,
backup/storage/readiness changes causing bounded operational investigation.

`jobs.handler.failed`, `jobs.worker.stale`, `jobs.backlog.threshold`,
`ops.check.changed`, `ops.backup.failed` and `ops.backup.stale` have
[canonical payload contracts](../../../packages/core/src/agent-contract/types.ts).
Source inspection found their contracts/parsers, but no production source
producer for those events in Core/App/reference source. The supplied
[unattended registry](../../../packages/core/src/agent-contract/r6-recipe-registry.ts)
also sets Operator to `manual`/`schedule`, excluding `event`.

Current periodic/manual diagnostics are real. They are not the designed
event-driven worker/backup reaction. A custom host could implement this, but
the shipped recipe/profile does not provide that path. Needed: source-owned,
site/deployment-authorized deterministic producers, compatible explicit recipe
eligibility, deduplication and recovery verification. Keep installation opt-in.

### G3 — Worker runbook planning and recovery verification stop at seams

Priority: next, bundled with G2. The worker MVP requires an existing
`worker-not-draining` plan and a live heartbeat plus decreasing backlog over a
bounded monitoring window. Restart, raw retry-all and resume intentionally stay
local plan/runbook handoffs in v1; adding remote execution is not the remedy.

The [App Operator host](../../../packages/app/src/lib/agents/operator-host.ts)
implements cache and injected Runtime-control plans and a backup restore-plan
adapter. Queue-global and other task-specific plans require `planOwners`; no
concrete shipped `queue.global.plan` owner was found outside fixtures.
Missing owners correctly return unavailable.

[Progress observations](../../../packages/core/src/jobs/operator-progress-observation.ts)
and their [App projection](../../../packages/app/src/lib/agents/operator-progress-observation.ts)
sample retained transitions in one 15-minute interval. They do not retain before/
after queue measurements or verify decreasing backlog after a response. This
honest limitation is not a defect in their current wording; it is an unfinished
MVP monitoring workflow. Needed: reuse the existing runbook/plan owner and add
bounded, persisted before/after verification with explicit unknown/time-out states.

### G4 — Publisher exclusion evidence is incomplete

Priority: next. `PR-CNT-002` explicitly requires selection criteria, candidate
snapshot, exclusions and maximum targets before model dispatch.

The [candidate owner](../../../packages/core/src/agent/read-capability-executors.ts)
uses retained recipe settings/queued time for criteria and builds a real bounded
selected snapshot. Its [result type](../../../packages/core/src/agent/publisher-content.ts)
contains `observedAt`, `scanned`, `truncated` and `candidates`. Skipped races,
content/base mismatches, oversized documents and read failures are represented by
`continue`/`truncated`; no explicit exclusion reasons/counts are retained in this
selection result. Some changed-state skips do not set `truncated` either.

Needed: an evidence-bound, bounded selection receipt with safe exclusion codes
and coverage. Do not expose hidden document identities, field values or ACL
side channels. The existing field, base and cooldown protections are present.

### G5 — Moderator reasoning is candidate selection, not semantic assessment

Priority: broader product completion; specify the supported classifier scope
before implementation. `PR-MOD-002` defines constraints for semantic classifiers;
it does not require guessing a verdict for every item or guaranteeing all spam
detection. The Phase 3 goal includes spam classification, while the existing
model recipe handles a narrower metadata task.

The [Moderator recipe](../../../packages/core/src/agent-contract/moderator-recipe-contract.ts)
copies one framework-admitted proposal or abstains. It receives advisory candidate
metadata and forbids inventing a spam verdict. The
[detector](../../../packages/core/src/agent/moderator-detector.ts) discards prose
before durable facts and always emits an advisory. Existing community adapter
verdicts remain separate; their presence is not a new semantic model assessment.

The `agent_assessment` timeline kind exists in schema/contract/UI labels, but no
production writer for that kind was found. The
[Studio projection](../../../packages/core/src/agent/incident-studio-service.ts)
does not expose assessment text, category/confidence/reason/evidence provenance.
Thus a label for “Agent assessment” is not proof that the workflow exists.

Needed for the broader semantic experience: a bounded read-only assessment
contract, actual source evidence, immutable Run/provider/policy provenance,
safe separately labelled display and appropriate evaluation. It must not choose
effects, overwrite deterministic facts or grant authority.

### G6 — Closed R6 history has no terminal pruning owner

Priority: before sustained deployment. The retention design proposes 90-day
Signals and 365-day Incident/action/approval histories, subject to exact dependency
and deployment rules. Active work and restore/audit evidence must remain pinned.

[Runtime retention](../../../packages/core/src/agent/runtime-retention.ts)
prunes Events, diagnostics, eligible calls/reservations/Runs/breakers and daily
usage. It does not select Signals, Incidents, timeline, feedback, notifications or
terminal containment as prune candidates. Generic reference fences preserve
their dependencies, and site deletion is a distinct supported owner. No terminal
R6 lifecycle releases those references for ordinary aging.

Needed: define a dependency/retention matrix for closed R6 records, then use the
existing explicit maintenance job. Preserve active containment/restoration,
unknown outcomes, approval/audit history and same-site reference integrity.
This is not authorization to start deleting existing history.

## Verification and product-surface deficits

| ID  | Deficit                                                             | Current evidence and implication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1  | Actual model and actual Runtime have not been verified together.    | The 58 retained selected provider responses are offline evaluation. The [unattended integration suite](../../../apps/web/tests/agent-r6-unattended.integration.test.ts) uses real services/persistence with fake inference. Both passed their stated scope; neither proves the full live-model context/capability/approval/resumption chain. Use an explicitly isolated, budgeted trial through the shipped provider/Runtime owners when authorized.                                                                           |
| V2  | Quality coverage is narrower than the original recipe surface.      | Publisher V2 evaluates one flat candidate with extractive `seoDescription`/`internalLink` edits; it does not establish multi-document editorial, nested schema/rich-text, SEO-title or stale-reference improvement quality. Operator plan fixtures cover queue facts/explicit plan requests, not backup/plugin/storage diagnosis. Moderator proposal fixtures assess exact metadata copying/abstention, not semantic spam accuracy. Keep current passes and add representative scenarios only for actually supported behavior. |
| U1  | Incident filtering is a partial implementation of the Admin design. | The [list contract](../../../packages/core/src/agent-contract/incident-contract.ts) and [UI](../../../packages/admin/src/agents/agent-incident-view.tsx) support status/category/severity and a backend `updatedAfter` bound. Planned source, assigned Agent, active-containment, full time range and safe query filters are absent. Assignment itself and existing sort/pagination are implemented.                                                                                                                           |
| I1  | Publisher link checks require application-written integration.      | `publisherRouteInventory` is an optional [host callback](../../../packages/core/src/agent/read-capability-executors.ts); no concrete production supplier was found. Without it, checks correctly remain unknown. The analyzer/ranking supports broken links and stale references when a complete canonical inventory is injected; those algorithms are not missing.                                                                                                                                                            |

The prior AI labels remain 44 accepted eligible model responses plus fourteen
supplemental Publisher decisions; they remain AI labels. They do not establish
human acceptance rates. `PR-METRIC-003`'s 60% useful-proposal value is a product
hypothesis, not a universal release threshold to retrofit to four AI-reviewed
drafts. The machine report's `fullR6`/`modelUsefulness` remain `not-established`.

## Conditional and optional work

- **Automatic quarantine:** implementation and enablement both remain absent.
  Detector signals always have `advisory: true`; changing
  `automaticConfidenceBasisPoints` is not an execution switch. A direct probe
  using the retained five-item/three-author case returns the same 7,000 score and
  advisory at thresholds 0 and 10,000. The unchanged
  [section 9.3 gate](testing-and-evaluation.md#93-enablement-gates) additionally
  requires reviewed precision/confidence bounds, at least 1,000 positives and
  1,000 hard negatives per policy/locale, and 14 days of production shadow.
  Fixture conformance 32/32 is not that gate: intent classification remains
  TP 10 / FP 2 / TN 2 / FN 18. Keep this tier unavailable until both code and
  evidence are ready. It is not mandatory to enable it for advisory operation.
- **External notifications:** AP-604's email/Slack integration is explicitly
  optional. The [notification owner](../../../packages/core/src/agent/incident-notifications-service.ts)
  only records a local Admin feed; no `agent:notificationSend` delivery handler
  or concrete external sender is installed. Do not describe this as missing
  Admin notifications or require sending any message to finish the audit.
- **Durable authenticated evaluation history, broader audits and Member account
  actions:** extensions, not substitutes for G1–G6. Offline review/import/export
  and current content quarantine/restore already exist.
- **R5 actual assistive-technology acceptance and R7/R8:** separate release/phase
  work. They do not explain away a concrete R6 implementation gap.
- **Publisher auto-publish, arbitrary shell/SQL, raw worker restart/retry-all and
  automatic credential/worker/provider activation:** deliberately unavailable or
  approval/local-handoff bounded. Their absence is not a bug to fix under R6.

## Recommended bundles

1. Moderator flood resilience: selected-source bounds, resumable exact collection,
   dedup/latest-source semantics and a real over-capacity recovery journey (G1).
2. Operator event-to-review workflow: concrete source producers, explicit event
   profile, existing local runbook planning and bounded recovery evidence (G2/G3).
3. Publisher selection evidence and canonical inventory adapter, followed by
   representative multi-document evaluation (G4/I1/V2).
4. Read-only semantic assessment and its Incident provenance, plus the supporting
   review/evaluation coverage (G5/U1/V2).
5. Closed R6 lifecycle/retention, then a budgeted actual-model Runtime acceptance
   pass covering the implemented bundles (G6/V1). Acceptance should accompany
   each affected bundle; this last pass is not a reason to defer focused checks.

Automatic quarantine and external delivery remain independently selected work.
The original audit performed no implementation, commit, PR or merge. The
subsequent authorized implementation is described above; commit/PR/merge remain
separate from this implementation request.

## Audit verification

Bounded source reads covered the seven roadmap packages and the relevant product,
Runtime, Admin and evaluation requirements. Existing test assertions were
inspected for scope; the over-capacity test was not rerun against a new database.
Current built owners were invoked only to check advisory threshold behavior and
Operator profile eligibility (`manual`/`schedule`). No network inference, database
initialization or capability execution occurred. Documentation link/format and
currentness checks apply; no application build is needed for this audit.
