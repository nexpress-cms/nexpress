# R6 implementation and acceptance

This decision follows the R6 implementation at `3d38784c` (PRs #1537 and #1538)
and the user-delegated AI review below. It separates shipped behavior, local
verification, actual model usefulness and optional production enablement. A
passing synthetic report or an installed recipe cannot establish all four.

## Current decision

R6 operates within human-approved Moderator response, Operator observation and
plan review, and Publisher draft/validation/preview. The explicitly installed
[unattended profile](r6-unattended-flow.md) adds event/scheduled read/proposal work
without changing the original manual definitions, granting effect authority or
enabling any worker/provider. The completion bundle passed the complete local
coverage recorded below, with the explicit corrected-run limits. **The retained
model responses are accepted within this implemented slice; the full original R6
goal remains incomplete.** The [original-goal audit](r6-goal-gap-audit.md)
identified missing flood continuation, Operator event/runbook/monitoring paths,
Publisher exclusion evidence and broader assessment/lifecycle work. Its
[authorized implementation follow-up](r6-goal-gap-audit.md#authorized-implementation-follow-up)
records the subsequent bundled fixes and their preserved boundaries. This corrects
the earlier, overly broad AP-600–606 development-completion wording.
[The delegated review record](r6-delegated-acceptance-review.md) still binds the
actual model outputs and qualitative decisions. This is AI review, not independent
human acceptance, live-site qualification or automatic-action enablement.
General production usefulness and spam accuracy remain unestablished.

The subsequent [integrated-path recheck](r6-goal-gap-audit.md#integrated-path-recheck-after-the-gap-fix-bundle)
found remaining flood visibility, semantic selection, Publisher source/snapshot,
Operator gate/review/check-identity and new-profile evaluation gaps. The
[integrated-path corrections](#integrated-path-corrections-and-verification)
address those counterexamples and additional supplied-source/projection/UI
connections. The earlier local passes remain valid only for their declared
assertions; the new bundle has its own verification below. Automatic quarantine
code and complete segmented large-Incident semantic assessment were outside
that preceding bundle. The subsequently authorized
[explicit Moderator extensions](r6-moderator-automatic-segmented-flow.md) own their
new implementation and separate verification. Actual model quality and automatic
production enablement remain unestablished.

The reference app and fresh scaffold remain disabled by default. Existing
installations are not migrated to a new profile or activated automatically.
Previously admitted Runs retain their immutable definition snapshots; adopting
the expanded profile requires a newly saved draft and explicit activation.

## AP scope and owning evidence

| Package | Implemented boundary                                                                                                                                                                                                    | Owning flows and remaining acceptance                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-600  | Shared Signal, Incident, timeline, notification and feedback persistence; bounded current-authority reads and Gateway/MCP projection.                                                                                   | [Foundation](r6-incident-foundation-flow.md), [Studio review](r6-incident-studio-flow.md). Security sources belong to R7.                                                                                                                                                                                                                                |
| AP-601  | Actual comment/document observation and report collection, bounded mixed correlation, deterministic repeated-link detector, fresh human-approved quarantine/restore, feedback and Member advisory review.               | [Content collection](r6-moderator-content-collection-flow.md), [document recipe](r6-moderator-document-recipe-flow.md), [Member review](r6-incident-member-report-flow.md), [unattended dispatch](r6-unattended-flow.md). Rule conformance is separate from spam accuracy; Member filings grant no response authority.                                   |
| AP-602  | Jobs/storage/backup-manifest/plugin/readiness observations, bounded status/audit, owner-backed plans and three approved execution actions. Explicit progress diagnostics add actual retained job transition timestamps. | [Observations](r6-operator-observations-flow.md), [recipe](r6-operator-recipe-flow.md), [execution](r6-operator-execution-flow.md). Snapshot, retained transitions, backup manifests and host declarations retain their distinct limits.                                                                                                                 |
| AP-603  | Current-base stale-content/SEO/link selection, bounded field-safe ChangeSet draft/validate/preview and same-document/revision cooldown; explicit scheduled execution.                                                   | [Publisher review](r6-publisher-content-review-flow.md), [unattended dispatch](r6-unattended-flow.md), [delegated AI acceptance](r6-delegated-acceptance-review.md). Four actual V2 drafts accepted within the bounded corpus; production editorial quality remains unestablished.                                                                       |
| AP-604  | Current-ACL Admin feed, exact transition provenance, bounded local recovery and optional external delivery outbox/status.                                                                                               | [Notifications](r6-incident-notifications-flow.md), [recovery](r6-incident-notification-recovery-flow.md), [external delivery foundation](r6-external-incident-notifications-flow.md). Actual email/Slack delivery remains unestablished; local recording and delivery confirmation remain distinct.                                                     |
| AP-605  | Template-specific draft presets with current scopes, policy and narrowed budgets; explicit provider selection, delegation, activation and trigger enablement.                                                           | [Moderator](r6-moderator-recipe-flow.md), [Operator](r6-operator-recipe-flow.md), [Publisher](r6-publisher-content-review-flow.md), [unattended profile](r6-unattended-flow.md). No default installation or activation is inferred.                                                                                                                      |
| AP-606  | Versioned bilingual detector/proposal/diagnostic fixtures, bounded opt-in evaluation runner, exact offline review/compatible comparison, report, Workbench and runbooks.                                                | [Report](r6-evaluation-report-flow.md), [Workbench](r6-evaluation-workbench-flow.md), [evaluation design](testing-and-evaluation.md#10-provider-evaluation-runner), [delegated AI acceptance](r6-delegated-acceptance-review.md). Actual model outputs reviewed for the declared reference/scaffold scope; production generalization is not established. |

## Required local gate

Reuse the owning suites rather than adding a route-by-state Cartesian matrix.
Record the exact tested working state and inspect final output for skipped
optional integrations. The completion gate includes:

- `pnpm verify` and `pnpm lint` after dependency builds.
- Complete Core/Web PostgreSQL integration, including restored theme rendering.
- The live Redis cases and separately enabled native preview browser case.
- Production Playwright, including Incident review, template setup, trigger
  activation, approvals/ChangeSets and evaluation review.
- All public packed packages installed in a fresh external scaffold, configuration
  typecheck, fresh generated migrations/Doctor, production build and the existing
  extension/operations/evaluation journeys.
- Independent review, test-inclusive typechecks for changed fixtures and browser
  specs, formatter/link checks and `git diff --check`.

The earlier reviewed implementation bundle starts at `3e24be6304c07e8ec209770e59bec64f5046d9a6`.
Its 30 changed code/test files are frozen in a local SHA-256 manifest with digest
`c985a6cb42aca89767d4c495a0a9059457324704b3e16d4d5697bf88034c9bbe`.
Existing feature flows preserve their dated, narrower results.

This historical table is not the gate for the subsequent gap-fix working tree.

| Gate                                | Completion working-tree result (2026-10-15)                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository/build/type/unit          | `pnpm verify --concurrency=1`: 113/113 tasks; repository 62, Core 2,342, App 706, Admin 194 and Web 164 cases passed, including production build. Final repeat after the test-only lint correction: 113/113 (107 cached).                                                                                                                                                                          |
| Core PostgreSQL                     | All 63 cases across 10 files passed; no skips. Isolated PostgreSQL 18.3, separate from developer/production data.                                                                                                                                                                                                                                                                                  |
| Redis                               | 16/16 passed against isolated Redis 7.2.6, including the three opt-in cases skipped by ordinary unit execution.                                                                                                                                                                                                                                                                                    |
| Lint and changed-test types         | `pnpm lint`: 41/41 tasks after correcting nine test-only callback/binding style errors. Explicit test-inclusive typecheck covers all nine changed Web tests/fixtures/browser specs; focused App cases passed 26/26 again.                                                                                                                                                                          |
| Web PostgreSQL/theme/native preview | All 1,677 ordinary cases covered across the complete run and corrected sitemap/reference-fence runs, including five theme-render cases. Native HTTPS preview was explicitly enabled separately and passed 1/1, covering the ordinary run's sole opt-in skip.                                                                                                                                       |
| Production Playwright               | 122/122 passed against the production build; no retries or skips. Member review at 320px, Moderator setup at 390px and Runtime activation captures were inspected.                                                                                                                                                                                                                                 |
| Packed fresh scaffold               | All 40 public packages passed 57 stages outside the workspace: install, public API/type smoke, generated migrations, production build, extension matrix, five runtime module-load probes, evaluation/operations journeys and fresh migrated foundation. All 457 Core/Admin dist files (including chunks/maps/declarations) and four changed published App source paths matched the producer bytes. |

The first verification attempt found the Admin Link shim missing the installed
Next Link `prefetch` prop; the matching prop was added and compilation passed.
Two intermediate runs stopped from host resource limits (parallel typechecking
exit 137, then exhausted local build-cache disk space). Clearing expired disposable
build caches and running the final complete gate sequentially resolved those host
failures; neither was counted as a pass.

The complete Web PostgreSQL run reported 1,668 passed, nine sitemap assertions
failed and one native-preview skip, plus a reference-fence `afterAll` failure.
The sitemap assertions expected `SITE_URL=http://localhost:3000`; the initial
command had incorrectly reused the browser's `3001` origin. Rerunning that complete
suite with the expected origin passed 15/15. All 28 reference-fence assertions had
passed, but dropping its disposable database exceeded the 30-second hook while
PostgreSQL waited for a checkpoint. After the owned cluster finished flushing and
its checkpoint pacing was adjusted, the complete fence suite passed 28/28 including
cleanup. `fsync` and `synchronous_commit` stayed on; no application code, test
assertion, hook timeout or durability check was weakened for either correction.
These are complete-plus-corrected local coverage results, not a claim that the
initial full run exited successfully or that hosted PostgreSQL 16 CI was run.

Independent source/acceptance reviews found no further confirmed required
implementation gap. Review found and fixed two boundedness defects: maximum legal
Member evidence exceeded the old clone byte cap, and unknown Operator reads could
reuse an attempted audit budget. Maximum Unicode/JSON-escaping pages and conservative
unknown-read reservations now have focused regressions. Final changed-file
formatting, local document links, secret-pattern/unintended-file checks and
`git diff --check` passed. The pre-existing handoff diff was preserved.

## Authorized gap-fix implementation and local gate, 2026-10-15

The user requested the remaining work while excluding actual Runtime validation.
This bundle implements G1–G6, U1 and I1 from the
[original-goal audit](r6-goal-gap-audit.md#authorized-implementation-follow-up),
with V2 coverage for the supported source, contract and service behavior. No
live-model/provider Runtime trial or new model-quality measurement was performed.
The earlier model artifacts retain their exact profile and dataset identities;
their passes are not transferred to the new profiles.

- Moderator collection now resumes bounded selected-source scans, handles late
  delivery and current-target replacement, and waits for complete collection
  before Runtime admission. A separately installed read-only semantic profile
  records current-source evidence and immutable provider/Run/policy provenance.
  Its budget checks precede dispatch, and Studio separates model assessment from
  deterministic facts and human decisions.
- Operator has an explicit operational Event source, event-eligible profile,
  concrete local pg-boss runbook planning and persisted bounded before/after
  monitoring. A fresh heartbeat and actual queue changes support the reported
  outcome; missing sources, pause and timeout do not become recovery claims.
- Publisher retains safe selection/exclusion receipts before dispatch, supports
  actual SEO metadata fields and supplies an anonymous-ACL canonical route
  inventory adapter. Multi-candidate, nested/rich-text, SEO-title and stale-source
  cases verify supported behavior without claiming editorial model quality.
- Incident Studio adds source, assignee, containment, time-range and literal
  query filters. Explicit maintenance policy prunes eligible terminal history,
  local feed records and completed flood bookkeeping through the existing owner.
  The [retention matrix](r6-history-retention-flow.md) preserves active work,
  unknown outcomes, immutable audit, approvals, Actions and rollback evidence;
  it does not promise universal erasure of audited Incident skeletons.

The code gate below includes the final installed-Node import correction and
Module-boundary regression. The final collector fixture correction changes only
test construction and assertions at real ten-minute source-window boundaries;
it does not rewrite source timestamps or change product behavior.

| Gate                          | Current gap-fix working-tree result                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository/build/type/unit    | `pnpm verify --concurrency=2`: **113/113 tasks**, including repository 62, Core 2,370, App 726, Admin 195 and Web 164 cases.                                                                                                                                                                                 |
| Lint and fixture types        | **41/41** workspace lint tasks; explicit test-inclusive typecheck covers all fourteen changed Web integration fixtures/specs.                                                                                                                                                                                |
| Core PostgreSQL               | **63/63** cases, ten files, no skips.                                                                                                                                                                                                                                                                        |
| Web PostgreSQL                | **1,711 ordinary cases covered across the complete and corrected runs**, including five theme cases. The separately enabled native-preview case is recorded below. Initial failures and corrections are retained in the paragraph below.                                                                     |
| Live Redis and native preview | **16/16** Redis cases; **1/1** native preview with actual headless Chromium.                                                                                                                                                                                                                                 |
| Production browser            | **122/122** Chromium cases using the production build, including new filter queries and separately labelled assessment/provenance links. The 390/1280 Incident screenshots were inspected; no horizontal overflow.                                                                                           |
| Fresh installed packages      | **40 public packages / 59 stages**: public factories in plain Node, installed configuration types, production build, generated schema, evaluation/report, extension matrix, five runtime-module probes, operations journey and fresh-database migrations/foundation. Installed files matched producer bytes. |

The complete Web PostgreSQL run reported 1,710 passes, one outdated over-capacity
assertion failure and the intentionally disabled native-preview case, plus a
reference-fence database-cleanup hook timeout. The collector assertion was
replaced with actual bounded continuation and exact selected-source checks; its
whole twelve-case file passed. All 28 reference-fence assertions passed before
the hook timed out. PostgreSQL was waiting for a checkpoint after the full test
workload; only this bundle's disposable cluster was changed to disable `fsync`
and synchronous commit. The complete fence file then passed **28/28**, including
cleanup. No application/developer database setting or product durability claim
was changed. A later focused run exposed a real-clock boundary assumption in the
151-target collector fixture: a new edit can belong to the next window and must
not be accepted into the old one. Its corrected assertions verify the actual
source window and require nonempty evidence. These results are complete-plus-
corrected coverage, not a claim that the initial full command exited successfully.
The final affected ten-file pass covered 72 passing cases before that single
fixture failure; the corrected whole mixed-collector file then passed **6/6**.
The final 81 code/test/CI files are recorded in
`/tmp/np-r6-remaining-source-manifest-accepted.json`, SHA-256
`71a26a289253d3f2b767a9f8cbfb448f0a0c6d88126d107c850e45429d7f2f2d`.
Only that fixture changed after the full code gate; product sources and installed
artifacts stayed frozen.

The fresh installed-package check also found that Operator's first App entry
transitively imported an application bootstrap alias in plain Node. Existing
health-check bodies were moved unchanged into a neutral module and reused by both
entry points. The new import-boundary regression, focused App checks and final
fresh installation all pass. Earlier failed attempts remain in the local logs;
the final package gate uses newly packed artifacts and a new empty database.

Logs use `/tmp/np-r6-remaining-*` and `/tmp/np-r6-final-consumer.log`. No model or
provider was called in this bundle. The eight bilingual semantic cases establish
contract conformance, not measured spam accuracy. Actual model plus Runtime
acceptance remains excluded, and broader semantic/editorial/operational usefulness
remains unestablished. Automatic quarantine and external notification delivery
remain separate opt-in work. No versions, changesets, lockfile, migrations,
credentials, default activation, commit, PR or merge were introduced. The
pre-existing handoff was preserved rather than rewritten.

## Integrated-path corrections and verification

The next authorized bundle closes the eight concrete
[integrated-path counterexamples](r6-goal-gap-audit.md#authorized-integrated-path-corrections):
whole-Incident visibility and bounded target continuation, trigger-aware eligible
semantic selection, anonymous per-document inventory/content ACL, durable V3
selected snapshots, the existing Operator deployment mutation gate, safe Activity
plan/recovery review, stable backup check identities and new-profile offline
evaluation tooling. It also adds authorized opt-in Incident list summaries,
explicit retained Doctor/release report sources and declared-block projection
using actual registered fields. Existing default wire shapes and older recipe,
evaluation and review identities remain preserved.

Semantic evaluation now has eight bilingual synthetic cases; Publisher V3
selection has eleven. CLI evaluation/comparison, exact-bound accept/edit/reject,
reports and Admin Workbench reuse the existing owners without live approval or
provider calls. Independent review corrected empty-response fallback, comparison
parsing and case-version review isolation. Actual DB coverage includes a readable
151-target Incident and multi-document nested/rich-text Publisher proposal
create–validate–preview. Unknown/stale/denied evidence remains unavailable.

Those integrated corrections did not implement automatic quarantine or segmented
complete large-Incident semantic classification. The subsequent
[explicit Moderator extension bundle](r6-moderator-automatic-segmented-flow.md)
adds those code paths with separate verification and opt-in installation. Required
production precision/sample/shadow qualification remains absent; existing approved
quarantine/restore remains available. Actual model/provider Runtime validation is
excluded by the user. Earlier model results are not transferred to these new
profiles, and `fullR6`/`modelUsefulness` remain `not-established`.

| Gate                       | Integrated correction result                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository/build/type/unit | Final `pnpm verify --concurrency=2`: **113/113 tasks**; repository 62, Core 2,391, App 738, Admin 195, Web 164 and CLI 165 cases.                                                                                                                                                                                                                         |
| Lint and fixture types     | **41/41** lint tasks; explicit test-inclusive TypeScript covers all **21** changed Web fixture/spec entry files.                                                                                                                                                                                                                                          |
| Core PostgreSQL            | **63/63**, ten files, no skips.                                                                                                                                                                                                                                                                                                                           |
| Web PostgreSQL             | Complete 203-file run: **1,724 passed / one compatibility regression**. After its product correction, the complete affected evidence, document-report and Studio files plus theme/native-preview gates passed **30/30**, no skips.                                                                                                                        |
| Live Redis                 | **16/16**, including the three explicitly enabled live cases.                                                                                                                                                                                                                                                                                             |
| Production browser         | Final production build: **126/126** Chromium cases, no retries or skips. New semantic/Publisher Workbench, Operator review and Incident summary/target-page journeys pass; the 390/1280 Workbench/Operator captures were inspected.                                                                                                                       |
| Fresh installed packages   | **40 public packages / 59 stages**: plain-Node factories, installed configuration types, production build, generated schema, actual new-profile CLI evaluation/review/comparison, extension matrix, five runtime-module probes, operations journey and empty-database migrations/foundation. Installed Core/Admin/App/CLI bytes match producer artifacts. |

The full Web run's single failure expected eight eligible response choices and
received seven: an omitted response cursor had been converted to an explicit
first-page request. The correction preserves that expectation, the existing
11/100-target default response and absence of `nextCursor`; explicit pagination
and 151-target defaults remain bounded. The final 30-case run includes the new
100-target regression, all five theme cases and actual native-preview Chromium.
This is complete-plus-corrected coverage, not a claim that the first full Web
command exited successfully.

Installed-package verification exposed the CLI's missing exact-suite/profile-
review dispatch despite the shared App script passing. The CLI now independently
binds both new datasets, review sources, labels and baselines while preserving
the existing command envelope. Its entire 165-case suite passes; the installed
guard also executes actual fake evaluation, review and review comparison commands.
The initial repeated full-corpus review composition test was reduced to one exact
case while retaining the complete corpus baseline. An unrelated existing payment
plugin self-import/build race was resolved in verification by completing its
build first; no payment behavior or task graph was changed.

The final 128 code/test/CI files are frozen in
`/tmp/np-r6-integrated-source-manifest-final.json`, SHA-256
`bcd7098eda76ab9f1289d5ce9e34c70f64c19842704b0a334d1eef3895d00324`.
Current logs use `/tmp/np-r6-integrated-*`. Versions, changesets, lockfile,
migrations, production credentials and default activation are unchanged. The
pre-existing handoff is preserved. No commit, PR, merge or live provider call
was performed.

## Actual model and operating acceptance

The existing evaluation CLI requires an explicitly injected evaluation-only
provider. The reference wrapper installs none. A concrete evaluation run needs a
selected provider/model snapshot, isolated test credentials, a declared dataset,
call/input/output/cost ceilings and explicit network intent. Do not reuse a
Runtime connection or discover credentials automatically.

Preserve the exact artifact, suite/instruction/policy/model identity, measured
usage and failures. Review the proposals against their actual evidence and
record accept/edit/reject/abstention results with reviewer provenance and coverage.
Use representative cases for the deployment; synthetic schema/extractive checks
alone cannot prove operational usefulness or general language accuracy. The
current design sets no universal numerical usefulness threshold, so this bundle
must not invent one to obtain a passing status.

Applicable operational evidence must distinguish due from scheduled work,
intentional pause, actual current source/authority loss, missed-occurrence recovery,
duplicate suppression and fresh approval. Operator progress claims need measured
facts: a heartbeat/count snapshot alone proves neither progress nor failure;
retained started/completed timestamps prove only the observed retained sample.
Backup manifests are not proof of a usable backup artifact or restore, and
declared/in-process readiness is not end-to-end service health.

The offline report deliberately keeps `fullR6` and `modelUsefulness` as
`not-established`; this decision does not modify those fields or promote fake
provider results to model acceptance. The explicitly authorized assessment below
supplies an evaluation-only provider host. Representative review and operating
evidence must be supplied separately, not synthesized by tests. The later
[delegated review](r6-delegated-acceptance-review.md) supplies a manual AI
assessment for the declared development scope; these fixed report fields still
do not authenticate a reviewer or make a milestone decision.

### Authorized OpenAI assessment, 2026-10-15

The user selected their existing local API key, `gpt-6-luna` and a total USD 1
ceiling. A task-local host injected the existing evaluation runner; the reference
wrapper and shipped application remain unchanged. No Runtime connection, vault,
worker, capability, approval or execution was installed or invoked. Requests used
`store: false`, Standard/default processing, a 4,096-token output ceiling and a
30-second per-case timeout. The provider returned the `gpt-6-luna` alias; no dated
immutable model snapshot is asserted.

The installed bilingual suites, recipe instructions, response schemas and labels
were unchanged. Provider inputs included locale and evidence, without local case
IDs or expected labels. Fixture notes themselves contain descriptive names, so
this is an unblinded synthetic benchmark. Exact JSON schemas were included in the
instructions and canonical validation remained local. The first request with the
JSON-object format option received HTTP 400; the subsequent request format omitted
that option and obtained model responses. The rejected request's usage remains
unknown and its full reservation is retained.

| Configuration                                   | Moderator proposal v3 | Operator plan v1 | Publisher v1 |
| ----------------------------------------------- | --------------------- | ---------------- | ------------ |
| Reasoning `none`, initial host parser           | 24/24                 | 13/16            | 9/12         |
| Reasoning `medium`, concatenating output parser | Not repeated          | 16/16            | 11/12        |
| Reasoning `high`, concatenating output parser   | Not repeated          | Not repeated     | 11/12        |

Counts are cases accepted by the unchanged synthetic artifact gate, not human
acceptance rates. The complete 52-case initial run and complete follow-up cohorts
retain all negative cases; no passing subset or edited answer key replaces them.
Both reasoning and parsing changed for the medium run, so its result does not
isolate reasoning as the cause of any improvement. Provider identities distinguish
the configurations. The latest combined report uses separate recipe settings, not
one common-settings 52-case run.

The original failures remain evidence:

- `opn-010` and `opn-011` omitted explicitly requested, owner-backed normal-queue
  pause/retry plans. `opn-013` remains an initial host framing ambiguity: the
  provider completed with two message outputs, but the original host accepted only
  one text and did not retain those texts. It is not a proven model JSON failure.
  The follow-up parser concatenates output text and retains message outputs.
- `pub-004` repeatedly returned `ignore/normal` for an incomplete route inventory
  that requires `observe/unknown`. It made no proposal or mutation, but the
  uncertainty-classification gate still fails at medium and high reasoning.
- Initial `pub-010` proposed an unjustified no-op link patch and described an
  unverified mapped route. Initial `pub-012` omitted the required grounded SEO
  proposal under hostile notes. These cases passed in the later configurations;
  their earlier failures are not erased.

There were 92 successful inference responses over 52 unique synthetic cases, one
rejected inference request and one model-access read. Every dispatch reserved its
worst-case cost before the network call, without refunds for unknown usage. All
93 dispatch reservations together were USD 0.465786. Actual returned usage at the
[official Standard rates](https://developers.openai.com/api/docs/models/gpt-6-luna),
including cache reads/writes and reasoning output, computes to USD 0.018690 with
per-call upward rounding. Including the rejected request's entire USD 0.003377
reservation gives a final accounted upper bound of **USD 0.022067**, below the
authorized USD 1. No key value was copied to artifacts or repository files.

Local evidence is retained under `/tmp/np-r6-luna-eval-20261015/`: original and
follow-up artifacts, host sources, preflight reservations, request hashes,
response/request IDs, usage ledgers, `assessment.json`, `report.json` and unlabeled
review templates. The report's file SHA-256 is recorded in `assessment.json`.
Independent AI review checked all outputs against source facts, reproduced the
follow-up message parsing, confirmed unchanged suites and reconciled all charges.
This is AI self-review, not human acceptance. Review templates retain null labels;
`fullR6` and `modelUsefulness` remain `not-established`. At that assessment, the remaining Publisher failure and representative
deployment review prevented a full R6 completion claim. The versioned follow-up below retains
those original results.

Before PR #1537 merged, only acceptance documentation changed after this
assessment; its thirty frozen code/test files and complete local gate remained
unchanged at that merge. No application build or unrelated test gate was repeated
for that documentation. The following section records a separate code bundle.

### Publisher uncertainty follow-up, 2026-10-15

At the `b7b6ae80` merged baseline, PR #1537 and its post-merge CI/Release passed.
The follow-up preserves the original twelve-case V1 corpus, instruction/profile
bytes, policy hash and failing provider artifacts. It adds an explicit alternative
Publisher instruction profile (template version two, recipe wire version one),
the complete unattended V2 installation profile and `publisher.v2` evaluation.
The new instruction explains unverified observations without changing capabilities,
settings, schemas or execution authority. Six additional cases check priority
boundaries; the original V1 cases and expected labels remain unchanged.

A separately identified exploratory five-call probe tested the proposed wording
against the failure and normal/fresh/unsupported-replacement controls. It is not a
canonical evaluation artifact. The subsequent canonical `publisher.v2` run used
Luna medium reasoning, a 30-second per-case limit and the unchanged strict gate.
All **18/18** cases passed, including the original failure and all six added
controls; schema validity was 100% with no forbidden proposals. The new suite hash
is `cj1:sha256:__1tEsppaXuHBQLf4VXqzxIkJH5fIgF-AVyJf1oG7GA`, and policy hash is
`cj1:sha256:OkEwSQRJnTkPMcnTpyAuIjh3CldIzewa7p8Muj2koQ0`. The gate hash remains
`cj1:sha256:S8KzzaU7HFJSicVSEgKyWHBNs-FDZXKmJS_JAQ3jfXg`, identical to V1.
Same-provider V1/V2 comparison is `SUITE_MISMATCH`. The actual historical high
reasoning and new medium host artifacts have different provider identities and
therefore report `PROVIDER_MISMATCH` first. Neither permits a pooled improvement
rate. These synthetic, unblinded results cannot establish general model reliability.

The extra five probe calls cost USD 0.001456 and the eighteen canonical calls
USD 0.003604 at the same observed Standard/default tariff. Across both bundles,
returned usage computes to USD 0.023750; retaining the original unknown request's
full reservation gives **USD 0.027127**. All dispatch reservations cumulatively
remain USD 0.616838, below the user's single USD 1 ceiling. There were no retries
of ambiguous dispatch or automatic credential/provider/worker installation.

Local source/usage/provenance is retained under
`/tmp/np-r6-publisher-uncertainty-probe/` and
`/tmp/np-r6-publisher-uncertainty-v2/`. The latter contains the canonical artifact,
model/usage ledger, exact host source, reconciled `assessment.json`, combined
`report.json` and an unlabeled review template. The report file SHA-256 is
`6428bd95dceb8c5949c5ecd7900f58606dda3a23b1ac520c48f9fe1ed27ab083`.
It retains the historical V1 Publisher artifact as an incompatible baseline.
Review labels remain absent. AI self-review found the four proposed patches and their explanatory text grounded
in the supplied source facts, with no execution/approval/preview-success claim.

Focused Core checks passed 18/18, App command checks 7/7 and installed CLI protocol
checks 11/11. The actual PostgreSQL unattended suite passed 6/6 with no skips,
covering both instruction profiles through scheduled admission, provider-bound
instruction/digest, persisted registry, draft/preview, replay and cooldown. The
changed integration test also passed an explicit test-inclusive typecheck.
Final workspace verification passed **113/113 tasks** and lint passed **41/41**.
The first lint attempt overlapped declaration generation, and its errors persisted
in the file cache on the next attempt. An uncached check passed; clearing only
the derived App scripts lint cache and rerunning the complete lint passed without
source changes or rule suppression.

All **40 public packages / 60 stages** passed in a fresh external scaffold across
the initial and corrected DB stages: explicit V2 API/type imports, installed CLI
evaluation/review/report, production build, extension matrix, five runtime module
loads, operations journey and actual generated migrations/Agent foundation. The
initial migration stage incorrectly reused the previous bundle's test database
and rejected existing types. The final two stages passed against a newly created
empty database in the same owned cluster; no existing database was dropped or
product migration changed. All **448 Core/CLI dist files**, selected Admin builds
and published App source paths matched their producer bytes. The fifteen changed
code/test source hashes stayed frozen throughout final verification.

Logs use `/tmp/np-publisher-uncertainty-*`, including the original and corrected
consumer/lint results. Final formatting, local links/anchors, secret-value absence
and `git diff --check` passed; the pre-existing handoff was preserved. The earlier
complete PostgreSQL/Redis/native/browser gate belongs to PR #1537; this follow-up
ran the affected six PostgreSQL journeys and does not claim those unrelated
local integration/browser suites were repeated or that full R6 acceptance closed.
At that follow-up, representative deployment cases, actual reviewer provenance
and applicable operating acceptance remained required. `fullR6` and
`modelUsefulness` remained `not-established`; the earlier negative evidence is
not erased.

### User-delegated acceptance, 2026-10-15

The user subsequently delegated the decision to Codex AI in this conversation:
“너가 판단해도 될것같은데”. The same previously recorded qualitative rubric
was applied to all 58 retained selected model responses and 32 detector cases.
No new numerical threshold, model call, Runtime activation or human judgment
was introduced. All 44 canonically eligible model responses were accepted; the
14 Publisher no-proposal decisions were assessed separately rather than made
eligible. Detector spam-verdict labels remain absent; normal repeated-reference
controls still produce two advisory false positives against fixture intent.

The [complete review](r6-delegated-acceptance-review.md) records case rationales,
AI provenance, exact artifact bindings, nonblocking wording issues and the
existing operating evidence. That assessment accepts the reviewed responses for
explicitly installed reference/scaffold use. The subsequent
[original-goal audit](r6-goal-gap-audit.md) corrects its initial broader milestone
claim and records the implementation/evidence gaps that remain. It does not convert
AI labels to authenticated Incident feedback, change report `fullR6` or
`modelUsefulness` from `not-established`, or establish production automatic-action
readiness. Earlier failed model runs remain preserved. No additional application
builds were needed for this documentation and offline review only follow-up.

## Optional extensions and separate gates

The optional [external delivery foundation](r6-external-incident-notifications-flow.md)
provides host-injected durable routing, retry/recovery and authorized delivery
status. It installs no transport, credential, worker or recipient configuration,
and its fake-transport tests do not establish actual external delivery.
Its [retention owner](r6-history-retention-flow.md) also expires complete old
terminal notification groups under an explicit host policy, preserving unknown
effects, required references and a compact routing tombstone against re-delivery.

Actual email/Slack delivery, broader audit families, Member account responses
and durable authenticated evaluation-review history are separate extensions;
their absence does not invalidate the stated Admin-feed/human-approved R6 scope.
Member restriction display uses the existing ban owner and grants no new policy
or action authority. Guardian collectors/responses and Build-plane generation
remain R7/R8 work.

Automatic quarantine is a separate opt-in enablement gate: the predeclared rule,
policy/locale-specific reviewed precision and confidence bounds, positive/hard
negative sample minima and production shadow period in
[testing and evaluation](testing-and-evaluation.md#93-enablement-gates) must be
met before enabling it. This bundle enables no automatic quarantine. Publisher
auto-publish remains unavailable in v1. Those production gates must neither be
waived nor imposed on ordinary human-approved read/proposal implementation.

R5's actual assistive-technology acceptance remains a separate open product
release check. The current R6 Incident/Evaluation routes must not be described as
unshipped merely because earlier R5 acceptance documents predate them.
