# R6 implementation and acceptance

This decision follows the current R6 implementation at the `3e24be63` baseline
and the subsequent completion bundle. It separates shipped behavior, local
verification, actual model usefulness and optional production enablement. A
passing synthetic report or an installed recipe cannot establish all four.

## Current decision

R6 operates within human-approved Moderator response, Operator observation and
plan review, and Publisher draft/validation/preview. The explicitly installed
[unattended profile](r6-unattended-flow.md) adds event/scheduled read/proposal work
without changing the original manual definitions, granting effect authority or
enabling any worker/provider. The completion bundle passed the complete local
coverage recorded below, with the explicit corrected-run limits. **Full R6
acceptance is not established until actual model usefulness and the applicable
operating evidence are reviewed.**

The reference app and fresh scaffold remain disabled by default. Existing
installations are not migrated to a new profile or activated automatically.
Previously admitted Runs retain their immutable definition snapshots; adopting
the expanded profile requires a newly saved draft and explicit activation.

## AP scope and owning evidence

| Package | Implemented boundary                                                                                                                                                                                                    | Owning flows and remaining acceptance                                                                                                                                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AP-600  | Shared Signal, Incident, timeline, notification and feedback persistence; bounded current-authority reads and Gateway/MCP projection.                                                                                   | [Foundation](r6-incident-foundation-flow.md), [Studio review](r6-incident-studio-flow.md). Security sources belong to R7.                                                                                                                                                                                              |
| AP-601  | Actual comment/document observation and report collection, bounded mixed correlation, deterministic repeated-link detector, fresh human-approved quarantine/restore, feedback and Member advisory review.               | [Content collection](r6-moderator-content-collection-flow.md), [document recipe](r6-moderator-document-recipe-flow.md), [Member review](r6-incident-member-report-flow.md), [unattended dispatch](r6-unattended-flow.md). Rule conformance is separate from spam accuracy; Member filings grant no response authority. |
| AP-602  | Jobs/storage/backup-manifest/plugin/readiness observations, bounded status/audit, owner-backed plans and three approved execution actions. Explicit progress diagnostics add actual retained job transition timestamps. | [Observations](r6-operator-observations-flow.md), [recipe](r6-operator-recipe-flow.md), [execution](r6-operator-execution-flow.md). Snapshot, retained transitions, backup manifests and host declarations retain their distinct limits.                                                                               |
| AP-603  | Current-base stale-content/SEO/link selection, bounded field-safe ChangeSet draft/validate/preview and same-document/revision cooldown; explicit scheduled execution.                                                   | [Publisher review](r6-publisher-content-review-flow.md), [unattended dispatch](r6-unattended-flow.md). Actual proposal usefulness still needs review.                                                                                                                                                                  |
| AP-604  | Current-ACL Admin notification feed, exact transition provenance/deduplication and explicit bounded local recording recovery.                                                                                           | [Notifications](r6-incident-notifications-flow.md), [recovery](r6-incident-notification-recovery-flow.md). Email/Slack are optional; local recovery is not external delivery.                                                                                                                                          |
| AP-605  | Template-specific draft presets with current scopes, policy and narrowed budgets; explicit provider selection, delegation, activation and trigger enablement.                                                           | [Moderator](r6-moderator-recipe-flow.md), [Operator](r6-operator-recipe-flow.md), [Publisher](r6-publisher-content-review-flow.md), [unattended profile](r6-unattended-flow.md). No default installation or activation is inferred.                                                                                    |
| AP-606  | Versioned bilingual detector/proposal/diagnostic fixtures, bounded opt-in evaluation runner, exact offline review/compatible comparison, report, Workbench and runbooks.                                                | [Report](r6-evaluation-report-flow.md), [Workbench](r6-evaluation-workbench-flow.md), [evaluation design](testing-and-evaluation.md#10-provider-evaluation-runner). Actual model/representative-review/operating usefulness remains unestablished.                                                                     |

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

The tested working tree starts at `3e24be6304c07e8ec209770e59bec64f5046d9a6`.
Its 30 changed code/test files are frozen in a local SHA-256 manifest with digest
`c985a6cb42aca89767d4c495a0a9059457324704b3e16d4d5697bf88034c9bbe`.
Existing feature flows preserve their dated, narrower results.

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
evidence remain external inputs, not missing facts to be synthesized by tests.

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
`fullR6` and `modelUsefulness` remain `not-established`. The remaining Publisher
failure and representative deployment review prevent a full R6 completion claim.

Only acceptance documentation changed after this assessment; the 30 frozen
code/test files and their complete local gate above remain unchanged. No
application build or unrelated test gate was repeated for this documentation.

## Optional extensions and separate gates

External email/Slack delivery, broader audit families, Member account responses
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
