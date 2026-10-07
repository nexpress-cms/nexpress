# R6 unified evaluation report and operating guide

This AP-606 slice puts Moderator, Operator and Publisher evaluation evidence in
one offline report. It reuses the existing evaluation and review owners, keeps
missing and unreviewed evidence visible, and never turns a report into a live
approval or an R6 release gate.

## Inputs and ownership

The existing `agent:evaluate` entry and installed `nexpress agent evaluate`
command accept `--report <manifest.json>`, optional `--out`, and optional `--json`.
Report mode rejects evaluation/provider/review/compare flags; comparison inputs
are explicit in the manifest. No application bootstrap, database, credentials,
provider invocation or capability execution is required.

The pure `evaluation-report-contract.ts` owns manifest parsing, types and text
formatting. Server `evaluation-report.ts` reuses the artifact validators and
comparison functions, including the actual offline Moderator replay.
`evaluation-report-files.ts` owns bounded local reads and output alias checks.
The shared App script writes atomically; the installed CLI captures the inputs
before running the project script and independently reconstructs its result.

Each recipe occurs at most once. Operator requires the diagnosis/plan category
from `operator-plan.v1`; legacy `operator.v1` tag-only results do not substitute
for plan evaluation. Publisher uses its proposal artifact, and Moderator uses
its deterministic detector artifact. A supplied review must bind the exact
supplied evaluation, even if another artifact has the same suite or predictions.
The report preserves existing validators' scope; a hash establishes consistency,
not the authenticity of an external provider run or reviewer identity.

## Produce and review evidence

Create versioned synthetic evaluation files using the existing commands:

```bash
pnpm agent:evaluate --dataset moderator.v1 --out moderator.json --json
pnpm agent:evaluate --dataset operator-plan.v1 --out operator.json --json
pnpm agent:evaluate --dataset publisher.v1 --out publisher.json --json
```

Create review templates with `--review <evaluation.json> --out <template.json>`.
Inspect the source and use the exact bindings when authoring labels. Follow the
[Moderator feedback guide](r6-moderator-evaluation-flow.md#run-and-review),
[Operator review guide](r6-operator-plan-evaluation-flow.md#run-and-review), and
[Publisher review guide](r6-publisher-evaluation-flow.md). A template contains no
human judgments. Run `--review <evaluation.json> --reviews <labels.json> --out
<reviewed.json>` only after authoring those labels; never generate fake approvals
just to raise a rate.

Save this manifest next to the evaluation files. Every key shown is required;
use `null` when a review or baseline is absent:

```json
{
  "schemaVersion": "np.agent-eval-report-manifest.v1",
  "entries": [
    {
      "recipe": "moderator",
      "evaluation": "moderator.json",
      "review": null,
      "baseline": null
    },
    {
      "recipe": "operator",
      "evaluation": "operator.json",
      "review": null,
      "baseline": null
    },
    {
      "recipe": "publisher",
      "evaluation": "publisher.json",
      "review": null,
      "baseline": null
    }
  ]
}
```

Paths resolve relative to the manifest directory; absolute local paths also
work. Every declared reference counts toward the read budget. The manifest plus all file
reads share a 4 MiB budget, and the embedded report has its own 4 MiB bound.
Symlink inputs, non-files, malformed/extra fields and duplicate recipes fail
closed. The output must differ from the manifest and every input, including
hardlink aliases. Errors expose fixed codes rather than paths or file contents.

```bash
pnpm agent:evaluate --report manifest.json --out report.json --json
nexpress agent evaluate --report manifest.json
```

When a prior run exists, an entry's `baseline` can be
`{"evaluation":"prior/evaluation.json","review":"prior/reviewed.json"}`.
Set its review to null if it was not reviewed. Leave out an entire recipe entry
when its evaluation is missing; the report still includes its missing row.
An empty entries array is valid and produces three missing rows.

## Interpret the result and recover

The report embeds its validated source input, derived rows and hash. The public
server verifier recomputes the whole report rather than trusting reported rates,
coverage, comparisons or authority. Rows always appear in Moderator, Operator,
Publisher order. Metrics remain separate by recipe; there is no combined score.

| Report state                           | Meaning and next step                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing recipe                         | Supply that recipe's evaluation; another recipe's pass cannot fill the gap.                                                                                |
| Fixture/schema gate failed             | Inspect the original artifact's violations and repair the proposal or evaluator; labels cannot rewrite the source result.                                  |
| Review missing                         | Eligibility and unreviewed counts come from an empty review projection. No supplied review or judgment is claimed.                                         |
| Review present with unreviewed entries | Continue manual review of eligible entries; absence is not acceptance. Ineligible cases are listed separately.                                             |
| Comparison missing                     | Supply the named baseline or missing review file.                                                                                                          |
| Comparison not comparable              | Follow the existing owner's reason, such as changed suite/policy/budget or no matched reviewed cohort. No improvement/regression conclusion is implied.    |
| Artifact invalid                       | Check schema, exact evaluation/review binding and installed implementation compatibility. Keep old evidence; do not rewrite its hashes to hide a mismatch. |
| Artifact unavailable                   | Select a writable output separate from every input. Existing reports survive failed validation/writes.                                                     |

Moderator metrics distinguish expected detector signals from classification
against fixture-authored spam/legitimate intent. Publisher and Operator metrics
measure their bounded fixture rules. Review counts and deltas retain each
owner's meanings; rates apply only to a matched reviewed case/prediction cohort.
A nonempty provider-mode result is still self-contained evidence, not proof of
representative model quality. Historical changed Moderator predictions remain
unsupported by the fixed installed-version verifier.

Exit zero means a valid report was generated, including a report with missing
or failed evidence. `fullR6` and `modelUsefulness` remain `not-established`.
Report errors return exit one and a closed error envelope. Automation must read
the rows instead of treating command success as production readiness.

## Remaining acceptance and operating boundaries

Full R6 requires the roadmap and [testing/evaluation gates](testing-and-evaluation.md#93-enablement-gates),
including representative usefulness evidence and the relevant operational,
recovery and production-shadow checks. This command cannot establish the
required reviewed moderation sample counts or fourteen days of production shadow
from a small synthetic fixture. Self-reported labels are not authenticated live
feedback. Publisher stays draft/preview with fresh human approval for application;
Operator execution uses the existing approval-bound service; Moderator automatic
quarantine is not enabled by this report. No thresholds or live authority change.

The existing host-injected provider evaluation path still requires its explicit
provider/model/budget authorization. Report mode cannot initiate that path.
Version, changeset, lockfile and migration files are unchanged.

## Verification of this implementation

Local acceptance on 2026-10-07 passed `pnpm verify --concurrency=1` (113 tasks)
and `pnpm lint` (41 tasks). The workspace run includes 2,288 Core, 680 App,
176 CLI and 174 Web unit cases. Report coverage adds seven Core cases, one App
workflow and three CLI cases for evidence recomputation, missing/failed inputs,
owner comparisons, review binding, bounded file reads, aliases and child-result
validation. The fresh-scaffold job additionally exercises the installed CLI and
real project script through a pipe with a report larger than 64 KiB, comparing
complete stdout and the saved file against independently reconstructed evidence.
Prettier and `git diff --check` passed.

Two initial PR runs exposed a twenty-second timeout when that whole installed
process workflow was embedded in the parallel CLI unit suite, including after
replacing source transformation with the built entrypoint. It now runs once in
the existing fresh-scaffold job after installation. Unit tests retain source
binding, forgery, exit-status and alias checks without duplicating installed
process startup; their timeout remains unchanged.

A fresh external project installed all 40 packed public packages and passed
typecheck. Its project script and installed CLI produced identical three-recipe
reports with evaluation/review baselines and a synthetic acceptance label.
JSON, text and entirely missing-evidence reports passed. Existing Operator,
Publisher and Moderator artifacts remained comparable through their owning
commands. Installed Core/App exports and CLI bytes matched the producer builds.
This consumer run exposed premature CLI exit truncating buffered JSON; the
entrypoint now sets its exit code and lets output drain before exiting.

The first workspace run at concurrency two ended with exit 137 during a theme
typecheck; a serial full rerun passed. Two existing full-artifact rejection
workflows had exceeded Vitest's five-second default in hosted CI. Their scoped
timeouts are now twenty seconds, without relaxing assertions or evaluator
budgets. No hosted CI rerun is claimed by these local results.

This offline report slice changes no database, live worker or browser path.
PostgreSQL, Redis-backed integration, theme/native-preview integration and
production-browser gates were not rerun; the optional Redis unit suite reported
13 passes and 3 skips without its integration URL. The fresh packed consumer
smoke above does not replace the full scaffold matrix or full R6 acceptance.
