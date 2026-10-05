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

This initial version only accepts the exact installed suite and implementation's
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
