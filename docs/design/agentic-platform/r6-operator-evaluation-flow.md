# R6 Operator evaluation and review

The Operator evaluation command exercises a versioned synthetic diagnosis suite
and emits a bounded report for human review. It extends the
[Operator recipe](r6-operator-recipe-flow.md), using its shipped instruction and
a separate versioned benchmark task. It does not install a Runtime service or
execute an Agent capability.

## Offline review

From a generated project or `apps/web`:

```sh
pnpm agent:evaluate --provider fake --dataset operator.v1 --out ./operator-evaluation.json --json
pnpm agent:evaluate --compare ./operator-evaluation.json --json
nexpress agent evaluate --provider fake --dataset operator.v1 --json
```

The default is `fake` / `deterministic-v1`. The eight built-in English/Korean
cases cover normal and scheduled work, intentional pause, aged pending work,
unavailable and partial observations, unrelated queues and an injected note.
Opaque case IDs do not disclose expected classifications. The fake predictor
reads the observations, not expected answers. It never reads live site data,
application configuration or credentials. This checks fixture and runner
correctness; passing does not establish model quality.

The structured response contains a closed decision, capability proposal IDs
and sorted diagnostic tags. A single snapshot cannot establish a dead worker
or progress/draining. Incomplete facts stay unknown, intentional pause takes
priority, and count and age thresholds must hold in the same queue. The runner
checks exact expected decisions/tags and rejects every disallowed proposal,
including `ops.execute`. Allowed actions describe permission, not a required
plan or a usefulness score. No returned proposal is dispatched.

## Explicit provider owner

The reference and generated wrappers install no provider. A host may explicitly
supply an isolated evaluation adapter through
`runAgentEvaluateProcessV1({ resolveProvider })`. Network runs require all of
`--provider`, `--model`, `--dataset operator.v1`, `--max-calls`,
`--max-input-tokens`, `--max-output-tokens`, `--max-cost-micros` and
`--confirm-network`. Argument and baseline validation precede provider lookup.
The host must use test credentials and a pinned model/settings where supported;
no environment search or production connection is performed by the command.

The adapter receives only case identity, locale and synthetic observations,
the shipped instruction, the benchmark task and a closed response schema.
Expected decisions, tags and action allowlists are withheld. Its local `quote`
reserves a worst-case input/output/cost ceiling including prompt and schema
overhead. The trusted host adapter must enforce those ceilings when invoking
its provider. Calls run sequentially with no retry and a five-second per-case
CLI timeout. The Core API accepts an explicit bounded timeout and abort signal.
It checks the quote against remaining totals before each call, aborts timed-out
requests and stops after unknown dispatch/usage or an exceeded ceiling. An
adapter cannot be forcibly made to cancel an already dispatched network call;
unknown usage remains `null` and cannot produce a passing report.

## Reports and comparison

`np.agent-eval.v1` embeds the versioned suite, case outcomes and declared budget.
Evidence hashes include identity, kind, observation time and text. Case/suite
hashes, shipped instruction digest, benchmark/schema bytes and scoring rules
bind the report to its inputs. Validators recompute metrics, violations, usage
and `ok`; supplied success flags are not trusted. These are local consistency
checks, not signatures, provider receipts, approval evidence or proof that a
provider executed a particular model.

Positive classifications are `advise`, `quarantine` and `approval`; missing
predictions count as abstention and as missed positives where applicable.
Zero-denominator rates are zero. Unknown token/cost totals and means remain
`null`. The one-sided 95% Wilson bound is reported without claiming the tiny
synthetic suite meets the moderation enablement thresholds. Error details and
free-form model output are discarded; reports retain only bounded enums,
synthetic inputs and counts.

`--out` writes an artifact through a private temporary file and atomic rename.
`--compare` reads a bounded regular file and rejects symlinks or invalid
artifacts. Comparable reports require the same mode, provider/model, suite,
policy, scoring rules and budget. Compatible reports expose aggregate and
per-case deltas. Incompatible reports explicitly make no regression conclusion;
a comparison does not enable anything. Exit status reflects evaluation failure
or a command error; incompatibility is separately reported. Reports with an
unknown policy/scoring implementation require their matching tool version and
are rejected by the current validator.

## Remaining acceptance

This AP-606 slice covers structured diagnosis and proposal safety. It is not a
live Runtime multi-turn replay, natural-language plan review, longitudinal
worker progress measurement or a model usefulness evaluation. Human accept,
edit, reject and outcome labels, larger locale/category datasets and explicitly
authorized provider evaluations remain open. AP-606 and R6 stay open. No actual
provider call or paid/network evaluation is part of this implementation gate.

## Local verification (2026-10-03)

- `pnpm verify --concurrency=2`: all 113 tasks passed, including Core 2,224,
  App 674, Admin 176, project CLI 165 and Web 174 unit cases, declarations,
  typechecks and the reference production build. A missing nullable annotation
  on the App baseline artifact was corrected before the final passing run.
- `pnpm lint`: all 41 tasks passed. Direct `--no-ignore` ESLint also covered
  the shared App evaluation script and tests.
- Focused checks: 25 Core contract/runner cases, four App command cases,
  13 evaluation/existing Runtime CLI cases and 42 scaffold template cases passed.
  They cover tampered reports, expected-answer isolation, unsupported diagnoses,
  forbidden proposals, explicit network admission, reservation/usage ceilings,
  abort/timeout, malformed fixtures/responses and closed error output.
- A fresh project outside the workspace installed all 40 packed public packages.
  With DB/secret environment values removed, its offline command produced a
  passing eight-case artifact and the installed `nexpress` command compared it
  successfully. Incomplete paid-run flags failed before dispatch. All provider
  unit invocations used local stubs; no external model call was made.
- The fresh project passed configuration-inclusive typechecking, generated and
  applied migrations to its isolated database, passed Agent foundation checks,
  production build and the scaffold command journey. Installed Core contracts
  and runner, App evaluator JavaScript/declarations and project CLI bytes matched
  the verified producer files.
- The reference script runtime smoke includes the evaluation entrypoint and
  validates its successful fake report with DB/secret environment values empty.
- Modified-file formatting, relative document links, credential/cast inspection
  and `git diff --check` passed. The implementation/config fingerprints matched
  the final code gate; the existing handoff edit was preserved byte-for-byte.

PostgreSQL integration suites, Redis integration, theme PostgreSQL, native
preview and production browser suites were not rerun for this offline CLI slice.
The ordinary unit run's optional Redis cases remain skipped. The fresh-scaffold
database/build checks do not substitute for those broader acceptance gates.
Versions, changesets, lockfile and repository migrations remain unchanged.
