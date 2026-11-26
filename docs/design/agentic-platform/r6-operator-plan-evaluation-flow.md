# R6 Operator diagnosis and plan evaluation review

This AP-606 slice evaluates grounded Operator diagnoses and plan proposals from
bounded synthetic observations. It adds `operator-plan.v1` alongside the existing
`operator.v1` structured-tag benchmark. It does not create a live plan, grant
approval, execute capabilities, install a worker or call a provider by default.

## Owners and bounds

`operator-plan-evaluation-fixtures.ts` owns sixteen versioned cases, eight each in
English and Korean. They cover normal and scheduled work, intentional pause,
missing facts, same-queue age/count thresholds, absent owners or explicit intent,
named queue requests, failed-job retry and hostile notes. No production data or
credentials are required.

The pure `operator-plan-evaluation-contract.ts` owns the bounded evidence and
proposal checks. The shared evaluator and runner use category `ops-plan` and a
required `planProposal` field; existing Operator and Publisher output fields and
policy hashes retain their contracts. The actual `ops.plan` input parser owns
plan validation. This benchmark exercises only its `queue.global.plan` subset:
pause, drain and retry-failed on the exact explicitly requested observed queue.
Owner availability, complete observations and operation-specific ready/failed
counts must justify the proposal. An aged backlog alone is not planning intent.

Every valid result includes a diagnosis, even when the plan is null. Summary
text uses fixed localized statements with an optional conservative caveat.
These checks establish consistency with this snapshot, not arbitrary natural
language truth, progress, dead-worker diagnosis or real-model usefulness.
Notes are untrusted data and cannot supply intent, approval or owner availability.

The existing provider boundary remains opt-in and host-injected, with its call,
token, cost and timeout limits. Providers receive evidence and instructions,
never fixture expected decisions or tags. The default fake adapter derives its
output from facts rather than copying the fixture answer key. Local verification
uses that adapter and injected in-process stubs only.

## Run and review

No database or application bootstrap is required:

```bash
pnpm agent:evaluate --dataset operator-plan.v1 --out operator-plan.json --json
nexpress agent evaluate --dataset operator-plan.v1 --compare operator-plan.json --json
nexpress agent evaluate --review operator-plan.json --out review-template.json --json
```

Review templates include diagnosis-only proposals. Copy exact case, prediction
and source bindings from an eligible entry into a JSON array of labels:

```json
[
  {
    "caseId": "copy from entry",
    "caseHash": "copy from entry",
    "predictionHash": "copy from entry",
    "sourceHash": "copy from entry",
    "outcome": "accept",
    "reviewer": "local-reviewer",
    "reviewedAt": "2026-10-06T00:00:00.000Z",
    "notes": "Explain the judgment against the synthetic evidence.",
    "editedProposal": null
  }
]
```

The placeholders are intentionally not valid labels. Supported outcomes are
`accept`, `edit` and `reject`. Accept requires the exact case's evaluation gates
to pass. Edit requires a grounded proposal and a substantive correction; adding
or removing an otherwise valid caveat alone does not count. Correcting a false
summary or evidence reference does count. Reject requires an actual proposal.
Missing or malformed proposals remain ineligible, and omitted labels remain
unreviewed rather than accepted. Reviewer attribution is self-reported.

```bash
pnpm agent:evaluate --review operator-plan.json --reviews labels.json --out reviewed.json --json
nexpress agent evaluate --review operator-plan.json --reviews labels.json --compare reviewed.json --json
```

`np.agent-operator-plan-eval-review.v1` retains the source unchanged and grants no
approval authority. Validators recompute derived fields and hashes. Labels never
change source `ok`. Comparisons report rates only on the intersection of reviewed
cases with identical case and prediction bindings under compatible evaluation
settings; unmatched cases are explicit and empty cohorts have no rate delta.
The installed CLI captures inputs before child execution and verifies the child
result against those inputs. Bounded file reads, separate review output paths
and atomic writes reuse the existing evaluation command boundary.

## Acceptance boundary

Verification covers pure grounding and review contracts, local runner stubs,
real file workflows, installed CLI result validation and a fresh packed consumer.
This offline addition does not change persistence, browser rendering, theme or
native-preview behavior; their full R6 acceptance gates remain separate.

Local verification on 2026-10-06 passed all 113 `pnpm verify --concurrency=2`
tasks and all 41 `pnpm lint` tasks. Core had 2,281 passing unit tests, App 679,
CLI 173 and Web 174; twenty added tests cover this slice across its owning
layers. Three optional Redis integration cases were skipped without a Redis
test URL. PostgreSQL, browser, theme and native-preview integration gates were
not rerun for this offline slice. The first lint attempt overlapped build output
cleanup and failed a file lookup; rerunning after build completion passed.

A fresh external consumer packed and installed all forty public packages, ran
the generated project entry and installed CLI through evaluation, comparison,
review template, labels and matched-cohort comparison, and passed its TypeScript
check. Existing Operator, Publisher and Moderator saved artifacts all remained
comparable. Seven installed Core/App/CLI JavaScript and declaration files matched
the producer outputs byte for byte. No provider or database was used by these
evaluation commands.

Broader operational sources, historical observations, arbitrary model summaries,
live-model usefulness and full AP-602/AP-606/R6 acceptance remain open. Synthetic
fixture success and self-reported review labels cannot establish production
safety or enable automatic operations.
