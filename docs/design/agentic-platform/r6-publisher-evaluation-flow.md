# R6 Publisher proposal evaluation and offline review

This AP-606 slice extends the existing `agent:evaluate` owner with `publisher.v1`
and evaluation-only human review records. It evaluates actual ChangeSet-shaped
proposals against synthetic source content, resource/base bindings, allowed
fields, route evidence and forbidden actions. It does not execute ChangeSets,
create live approvals, publish content or establish real-model usefulness.

## Owners and boundaries

- `packages/core/src/agent-contract/publisher-evaluation-contract.ts` owns the
  bounded Publisher facts, proposal schema, facts-only fake predictor and
  deterministic proposal checks. It reuses the existing ChangeSet draft and
  operation validators.
- `packages/core/src/agent/publisher-evaluation-fixtures.ts` owns the versioned
  bilingual synthetic suite. The shared evaluation runner, artifact scorer and
  comparison contracts own budgets, output validation, hashes and metrics.
- `packages/core/src/agent-contract/evaluation-review-contract.ts` owns offline
  review labels, bound proposal/evidence projections and reviewed-cohort rates.
- `packages/app/src/scripts/agent-evaluate.ts` owns command parsing, bounded
  artifact input/output and mode dispatch. Reference and scaffold wrappers
  continue to call this shared owner. The installed project CLI verifies the
  requested dataset and recomputes review/comparison output from bounded inputs
  captured before the project script starts.

This command does not read application configuration or credentials, initialize
a DB or Runtime service, start workers or invoke capability executors. Fake mode
makes no provider calls. A host may explicitly inject a provider through the existing runner seam;
network mode still requires every provider/model/dataset/budget flag and explicit
`--confirm-network`. Shipped wrappers install no provider adapter.

## Dataset and proposal checks

`publisher.v1` contains twelve English/Korean cases with opaque case ids:
normal content, missing SEO text, a broken internal link with a known replacement,
partial routes, missing content, fresh content, quoted hostile instructions,
unsupported replacement, protected fields and combined improvements. Cases,
source evidence, recipe instructions, response schema and scoring rules are
bound to the evaluation artifact hashes. Expected labels stay outside provider
requests and the fake predictor.

The source is a bounded synthetic snapshot, not an arbitrary CMS export. Its
single candidate records an exact document resource/base, stale/published state,
content/route completeness, editable fields, body/SEO/link values and explicit
route replacement evidence. Content is intentionally small: this fixture is an
extractive proposal benchmark, not a general editorial-quality assessment.

A justified proposal contains exactly one update to that document/base. A missing
SEO description must be a contiguous 20–160 character extract of the supplied
body. A broken internal link may change only to its explicitly evidenced,
existing internal destination. All justified improvements must be present;
protected/unrelated fields, new factual text in content patches, arbitrary
targets, guessed links and unsupported operations fail deterministic checks.
Freeform titles, summaries and operation reasons require human review: the
evaluator does not establish their truth, usefulness or absence of unsupported
preview/approval claims. Uncertainty remains observe;
no justified change remains ignore. Proposal generation grants no execution or
approval authority.

The existing `operator.v1` default, prediction shape, scoring hashes and command
output remain compatible. Publisher predictions additionally require `proposal`
(an actual draft or explicit `null`). Neither synthetic suite measures real-model
usefulness, long-form writing quality, actual preview output or live Runtime
continuation.

## Runbook

From `apps/web` or a generated project, generate an offline evaluation artifact:

```sh
pnpm agent:evaluate --provider fake --dataset publisher.v1 --out ./publisher-evaluation.json --json
```

Compare another run through the existing evaluation command:

```sh
pnpm agent:evaluate --provider fake --dataset publisher.v1 --compare ./publisher-evaluation.json --json
```

Create an unreviewed proposal/evidence artifact:

```sh
pnpm agent:evaluate --review ./publisher-evaluation.json --out ./publisher-review-template.json --json
```

Read the review artifact's `entries`. Each entry exposes its source evidence,
actual proposal, eligibility and exact binding fields. No accept/edit/reject
label is generated automatically. Only an actual proposal with no runner error
is reviewable; skipped cases and null proposals stay ineligible.

Write `publisher-labels.json` as a JSON array. For each reviewed entry copy
`caseId`, `caseHash`, `predictionHash` and `sourceHash` exactly, then supply:

```json
{
  "outcome": "accept",
  "reviewer": "your-local-reviewer-name",
  "reviewedAt": "2026-10-05T12:00:00.000Z",
  "notes": "Describe the actual assessment of this synthetic proposal.",
  "editedProposal": null
}
```

The object above illustrates the human-supplied fields only; the four copied
binding fields are required in every complete label. Set the timestamp to the
actual review time. `reviewer` is explicitly self-reported local attribution,
not an authenticated staff identity or signature. Notes are bounded to 2,000
characters and reviewer text to 128. One label is allowed per exact case version.

- `accept` requires the source case to pass deterministic checks, including its
  proposed actions, and the actual proposal to pass content/evidence checks.
- `edit` requires a complete corrected `editedProposal` with changed content
  patches and valid grounding. Changing only its title, summary or operation
  reason does not count as a content edit.
- `reject` requires `editedProposal: null`. It can record rejection of a failed
  actual proposal. No label changes the original evaluation's `ok` result.

Save and compare reviews:

```sh
pnpm agent:evaluate --review ./publisher-evaluation.json --reviews ./publisher-labels.json --out ./publisher-reviewed.json --json
pnpm agent:evaluate --review ./publisher-evaluation.json --reviews ./publisher-labels.json --compare ./publisher-reviewed.json --json
```

Review mode rejects provider, model, dataset, network and budget flags. It never
resolves a provider. `--out` may replace an existing ordinary output artifact,
but cannot alias the source, labels or comparison input, including hardlinks.
Inputs and outputs reject final-component symlinks, inputs must be bounded
regular files, and writes use private temporary files plus atomic rename.
Errors expose fixed safe codes without paths or input/provider details.

## Review integrity and comparison

`np.agent-eval-review.v1` embeds the validated source artifact, source hash,
closed labels, proposal/evidence entries, summary and review artifact hash.
Reading it recomputes every derived value and verifies the embedded source.
Hashes detect inconsistent/tampered artifacts; they do not authenticate the
reviewer and do not prevent someone from constructing a different valid local
artifact with new self-reported labels.

Unreviewed and ineligible counts remain separate. Accept/edit/reject rates use
reviewed proposals as their denominator; an empty reviewed set has null rates.
The report carries `authority: offline-self-reported-no-approval` and cannot be
consumed as a live approval token.

Review comparison first requires compatible evaluation mode, provider, model,
suite, policy, scoring rules and budgets. It then compares only the intersection
of reviewed cases with identical case hashes and prediction hashes. Both rates
use that same cohort. `matchedCaseKeys` and unmatched current/baseline case keys
include case versions. Different predictions and different review coverage are
reported as unmatched instead of changing the denominator silently. An empty
matched cohort or incompatible sources yields no regression conclusion.

## Verification and remaining acceptance

Focused tests cover the bilingual facts/proposal contract, expected-label
isolation, content/evidence/forbidden-action failures, bound human labels,
substantive grounded edits, multiple versions of the same case, artifact
recomputation, equal-cohort comparison and CLI save/load/tamper/symlink/hardlink
boundaries. The packaged command acceptance covers both the project script and installed CLI.

The bundle also corrects the existing Publisher Runtime integration test's
per-test timeout to 60 seconds for its four-run duplicate-base/cross-run access
and independently revised-base journey; seven PostgreSQL cases passed after
that correction. Assertions and
Runtime behavior remain unchanged. This is CI reliability evidence, not a new
offline-evaluation integration requirement.

This slice has no database, worker, browser or public content behavior change.
It does not replace the preceding Publisher Runtime/ChangeSet acceptance.
Real-provider usefulness, representative larger editorial datasets, authenticated
review workflows, live replay and longitudinal model comparisons remain open.
AP-606 and the full R6 gate remain open; Publisher auto-publish remains unavailable.

## Observed local verification (2026-10-05)

- Final `pnpm verify --concurrency=2`: 113 tasks passed, including Core 2,258,
  App 676 and installed project CLI 168 unit cases, package declarations,
  typechecks and the reference production build. `pnpm lint`: all 41 tasks
  passed. A stale App ESLint cache from a concurrent dependency rebuild was
  moved aside; the uncached script check and complete lint then passed.
- Focused evaluation suites cover 41 Core cases, six App command cases and nine
  installed CLI cases. The separate Publisher Runtime PostgreSQL suite passed
  seven cases with no skips after the scoped four-run test timeout correction.
- A new project outside the workspace installed all 40 packed public packages.
  Both `pnpm agent:evaluate` and installed `nexpress agent evaluate` passed
  Publisher evaluation, proposal review, label persistence and matched-cohort
  comparison. Commands ran without a generated `.env` or DB/secret environment
  values. The initial packed check exposed an Operator-only installed CLI
  verifier; the corrected wrapper was retested in a second fresh project.
- The fresh project accepted an Operator artifact generated before this change.
  Core contract/runner JavaScript and declarations, App evaluator JavaScript and
  declarations, and installed CLI JavaScript matched verified producer bytes.
  Configuration-inclusive typechecking passed after supplying nonconnecting
  placeholder config values for its required schema-generation prehook; no
  database connection or migration was performed in this consumer check.
- The optional Redis integration cases (three) were skipped because their test
  URL was unset. Broader PostgreSQL, Redis, theme/browser/native-preview and full
  production scaffold journeys were not repeated for this offline slice; these
  results do not replace the full R6 acceptance gate. No external model was called.
- Modified-file formatting, relative documentation links and `git diff --check`
  passed. Existing handoff edits remained byte-for-byte unchanged. Package
  versions, changesets, lockfile and migrations were not changed.
