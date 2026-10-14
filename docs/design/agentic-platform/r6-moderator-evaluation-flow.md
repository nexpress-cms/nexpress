# R6 Moderator offline evaluation and feedback review

This AP-606 slice runs the shipped repeated-link detector against versioned,
synthetic Korean and English observations. It keeps detector conformance,
authored spam intent and human feedback separate. It does not install a source,
run a provider, write an Incident, grant approval or enable automatic quarantine.

## Owners and contracts

`moderator-evaluation-fixtures.ts` owns `moderator.v1`: 22 bounded cases, eleven
per locale. Fixed synthetic comment observations include exact threshold,
low-volume and insufficient-independent-account activity, unknown actors,
duplicate evidence, replay, later edits, rejected writes, legitimate repeated
references and hostile instructions. URLs use reserved example domains; there
are no network requests or live records.

`moderator-evaluation.ts` invokes the actual `npDetectAgentRepeatedLinkSpamV1`
with the existing canonical settings and facts. Predictions come from that
implementation, independently of expected domain hashes. Existing thresholds,
canonical candidate validation, advisory scores and authority remain unchanged.
Pure types and command formatting remain in `agent-contract`; replay and review
verification belong to the server `agents` entry. Existing Operator and Publisher
schemas and commands are preserved.

The `np.agent-moderator-eval.v1` artifact includes the source cases, exact detector
candidates, case/prediction hashes, locale summaries and an artifact hash. `ok`
means all expected deterministic signals matched. It does **not** mean spam
classification passed a quality gate. `syntheticClassification` reports the
case-level confusion matrix against fixture authors' spam/legitimate labels;
these labels are synthetic intent, not independently reviewed production truth.
A repeated legitimate reference can therefore pass the detector expectation
while remaining a classification false positive. Insufficient-volume spam is a
reported false negative. No signal does not establish harmless content.

Validators bound canonical input and independently replay the fixed shipped
suite. Editing expectations, observations, predictions, summary or authority
cannot make an artifact valid by recomputing its hash. Hashes establish binding,
not reviewer identity or cryptographic signatures.

Each version only accepts its exact installed suite and implementation's
recomputed output. Evaluation comparison checks same-version replay; it cannot
compare a historical implementation whose predictions changed. Historical
multi-version detector acceptance needs a separately versioned verifier. Human
review comparison can compare different labels on identical predictions.

## Run and review

No database or application bootstrap is required:

```bash
pnpm agent:evaluate --dataset moderator.v1 --out moderator.json --json
nexpress agent evaluate --dataset moderator.v1 --compare moderator.json --json
nexpress agent evaluate --review moderator.json --out moderator-review.json --json
```

`moderator.v1` is deterministic only. Network providers, explicit model,
confirmation and call/token/cost flags are rejected as inapplicable. The existing
`fake` provider default is accepted for CLI compatibility, but this result is
labeled `deterministic-offline` and makes no model-quality claim.

Review entries expose exact `caseId`, `caseHash`, `predictionHash` and
`sourceHash` bindings. Inspect the corresponding case observations and signal in
`source`, then create a JSON **array** of labels using those exact values:

```json
[
  {
    "caseId": "copy from eligible entry",
    "caseHash": "copy from eligible entry",
    "predictionHash": "copy from eligible entry",
    "sourceHash": "copy from eligible entry",
    "label": "false-positive",
    "reviewer": "local-reviewer",
    "reviewedAt": "2026-10-06T00:00:00.000Z",
    "notes": "Explain the judgment against the synthetic source."
  }
]
```

The placeholders deliberately are not valid labels. Supported labels reuse
`confirmed-spam` and `false-positive` from the existing Incident feedback owner.
Attribution is explicitly self-reported; this operation never writes authenticated
Incident feedback. Only a case with one retained candidate is eligible. There
are eight eligible cases and fourteen without a reviewable signal in this suite.
Missing labels remain unreviewed; labels cannot be duplicated, attached to an
ineligible case or transferred to different evidence/predictions.

```bash
pnpm agent:evaluate --review moderator.json --reviews labels.json --out reviewed.json --json
nexpress agent evaluate --review moderator.json --reviews labels.json --compare reviewed.json --json
```

Review artifacts retain their immutable source and independently recompute every
entry and summary. Labels do not change the source `ok`. Comparison calculates
rates only on the same reviewed case and prediction cohort, reports unmatched
reviewed cases separately and gives no conclusion for an empty overlap.

Both project script and installed CLI use bounded regular-file inputs, private
atomic writes and existing closed error output. Source, label and baseline files
cannot be overwritten through an output path or hardlink alias. The installed
CLI captures inputs before launching the child and independently checks the exact
expected result; child stderr, unknown fields and mismatched exit status are not
passed through.

## Report and mixed detector replay (`moderator.v2`)

`moderator.v2` adds 24 synthetic cases, twelve per locale, to the actual detector
replay owner. The original 22-case `moderator.v1` suite, artifact hashes and strict
V1 APIs remain unchanged. This detector dataset is separate from
`moderator-proposal.v2`, which tests recipe response grounding on synthetic
metadata projections.

Report-only facts carry paired `unknown` spam/profanity verdicts. Their
`memberId` is the comment author; filing a report never adds an independent
account or establishes a classifier verdict. The suite checks exact thresholds,
insufficient items/authors, unknown authors, repeated event evidence, distinct
reports of one target, observation/report duplicates, newer report snapshots
that remove a link, and later rejected observations. Legitimate repeated
references and hostile prose retain separate authored intent labels. Expected
domain hashes are fixed independently of the extractor under test.

The new evaluation/review envelopes are `np.agent-moderator-eval.v2` and
`np.agent-moderator-eval-review.v2`, with case version 2. Unsuffixed replay,
review and comparison APIs dispatch to the exact shipped V1 or V2 suite; the
original suffixed V1 APIs reject V2 artifacts. A recomputed hash cannot validate
caller-edited observations, predictions or expectations. This supports both
installed datasets, not historical implementations with changed predictions.

```bash
pnpm agent:evaluate --dataset moderator.v2 --out reports.json --json
nexpress agent evaluate --dataset moderator.v2 --compare reports.json --json
nexpress agent evaluate --review reports.json --out report-review.json --json
```

The same deterministic-only provider/model/budget restrictions apply. CLI child
results must match the requested dataset exactly. Reviews retain exact source,
case and prediction bindings, and missing labels remain unreviewed. The shared
report and Admin Workbench import, label and export both detector versions.
A V1/V2 baseline reports `INCOMPATIBLE_SUITE`, with no cohort rates or deltas.

All 24 cases can match deterministic expectations while synthetic classification
still reports eight true positives, two false positives and fourteen false
negatives. These counts describe authored fixtures, not production precision.
Ten signals are eligible for offline review; fourteen cases have no reviewable
signal. Report resolution, ACLs and attestation remain the live report recipe's
existing PostgreSQL owners; the offline benchmark neither reads those records
nor claims to exercise that authority boundary.

### Report/mixed replay verification

Observed 2026-10-14 KST:

- Focused Core replay/report/Workbench: 26 cases; App command: 9;
  CLI boundary: 13. Independent review found no material correctness issue.
  The Workbench result validator now explicitly accepts detector review V2;
  original V1 evaluation and review serialized bytes were compared with the
  previous implementation and preserved.
- Final `pnpm verify --concurrency=2`: 113/113 tasks in 7m40s, including Core
  2,311, App 689, CLI 155 and Web 164 unit cases; `pnpm lint`: 41/41.
- Production Chromium: 2/2, 21.2s, no retries or skips. The existing proposal
  journey and new actual detector review/export journey passed. The 320px
  capture was inspected and had no horizontal overflow. A pre-merge check found
  the new detector test sharing the Jobs rate-limit bucket; the test now uses
  its own bucket. Both browser journeys passed again without retries (28.2s),
  with the assertions and production limits unchanged.
- Forty freshly packed packages installed outside the workspace: 54 stages,
  including V1 hash preservation, installed V2 evaluation/review/comparison,
  report and Workbench reconstruction, generated-project typecheck and build.
  Six installed Core/App/CLI runtime/declaration files matched the producer.
- Existing Redis units retain 13 passes / 3 environment-dependent skips.
  Full PostgreSQL integration, live Redis, theme integration and native preview
  were not rerun for this offline-only change. The browser used a newly migrated
  isolated PostgreSQL database; that is not a report-resolution SQL acceptance
  run. Its temporary server was stopped after verification.

Logs and consumer-path references use `/tmp/np-detector-*`. Source files stayed
unchanged across the final code gates, browser and packed-consumer checks.
These results do not close AP-606, production precision or full R6 acceptance.

## Document/comment detector replay (`moderator.v3`)

The [content detector evaluation](r6-moderator-content-evaluation-flow.md) adds 32
bilingual synthetic cases with document reports and combined document/comment
facts. It preserves both earlier corpus/artifact hashes, uses the same actual v1
detector and exact offline feedback owners, and connects the new version through
CLI, Admin workspace and unified report. Synthetic classification and signal
conformance remain separate; incompatible earlier baselines have no pooled delta.

## CI follow-up in this bundle

After PR #1512, main CI `37345688341` timed out in evaluation CLI tests. The
Publisher suite/budget and review tampering matrices unnecessarily launched npm
repeatedly. They now call the actual parent verifier directly; real child success,
closed errors, stderr suppression and exit-code checks remain. Child launches
fell from sixteen to nine in that existing test file. Same-machine focused
measurements were 11.79 to 6.94 seconds of test time, and 17.16 to 12.00 seconds
wall time; these are not predictions of CI duration. PR CI `37355468624`
then exposed the separate five-second default limit on complete artifact review
workflows (three Publisher wrapper cases and the repeated Moderator verifier).
These workflows and the matching multi-command App Moderator journey have a
scoped twenty-second test deadline. Assertions, workload, provider timeouts and
global test defaults are unchanged; the subprocess reduction remains in place.

Release `37345688406` failed its Version PR CI bridge (`37345802991`), including
an additional PostgreSQL reference-fence fixture race. A rejected implicit writer
transaction had not necessarily finished rollback before another connection's
NOWAIT lock attempt. The fixture now explicitly begins and rolls back that
writer transaction before checking the lock; cleanup rolls both sessions back.
Product locking behavior and assertions are unchanged. No Version PR was merged
and no remote release was retried by this work.

## Verification and remaining acceptance

Observed local verification on 2026-10-06 KST:

- Focused Core detector/evaluation: 11/11; shared App evaluation: 8/8;
  installed CLI boundary: 12/12. The extractor-loss probe confirms a broken
  extractor cannot silently rewrite the fixed expected domain hashes.
- `pnpm verify --concurrency=2`: 113/113 tasks, including Core 2,264, App 678,
  project CLI 171 and reference app 174 unit cases plus production build and
  declarations. The first unrestricted run was interrupted by exit 137 in an
  unrelated plugin typecheck; bounded rerun passed. Optional Redis tests reported
  13 passes / 3 skips without an integration URL, not a live Redis acceptance run.
- `pnpm lint`: 41/41; repository tests: 62/62.
- Reference-fence PostgreSQL protocol: 28/28 without skips, including the fixed
  transaction/partition-lock journey. Its isolated databases were removed.
- Forty freshly packed packages installed outside the workspace: project-script
  Moderator evaluation and labels, installed CLI replay/template/cohort comparison,
  and pre-change Operator/Publisher artifacts all passed with no DB/secret
  environment. Generated-project typecheck passed with placeholder configuration
  and no DB connection. Installed Core/App runtime and declarations plus CLI
  runtime bytes matched the producer. Artifacts are in
  `/tmp/np-moderator-evaluation-consumer/smoke-app`.
- Independent review found and corrected the shared extractor/expectation oracle;
  the fixed-version artifact compatibility limit above is explicit.

Full production browser, native preview, live Redis and packed database journeys
were not rerun for this offline evaluation slice. These checks do not establish
full R6 acceptance. Detailed logs are `/tmp/np-moderator-*.log`.

This bounded synthetic benchmark does not close AP-606 or full R6 acceptance.
It supplies no authenticated production labels, detector/model longitudinal
comparison, broader source collectors, confidence bound or automatic-action
readiness evidence. The documented per-policy/per-locale sample requirements
and fourteen-day production shadow gate remain open. No provider call, credential,
worker, automatic moderation, package version, changeset or migration is added.
