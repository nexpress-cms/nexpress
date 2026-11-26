# R6 Moderator proposal evaluation and review

This AP-606 slice evaluates the shipped [Moderator recipe definition](r6-moderator-recipe-flow.md)
against versioned synthetic evidence projections. `moderator-proposal.v1` adds
sixteen Korean/English cases: three selection and five abstention cases per
locale. It complements the actual detector replay in `moderator.v1`.

`moderator-proposal.v2` adds twenty-four Korean/English synthetic report and mixed
observation/report cases. The v1 factory, sixteen cases and canonical suite hash
remain unchanged. Both versions use the same installed recipe instruction,
response schema and offline review/report owners.

The subsequent [document and comment proposal dataset](r6-moderator-content-proposal-evaluation-flow.md)
adds `moderator-proposal.v3` with a separately versioned content facts envelope,
exact mixed-target selection and the same review/CLI/Workbench/report owners.
The original v1/v2 suite hashes and strict v1 comment-only evidence helpers remain
unchanged.

## Response and evidence owners

The shared evaluation runner supplies the recipe's actual instruction and response
schema. A provider returns the same `interactive-capability` response as the
recipe: `complete`, or one `moderation.quarantine` proposal with `mode: propose`.
It receives only case identity, locale, evidence, instructions and schema; expected
answers, allowed actions and scoring tags are not exposed. The runner derives the
artifact's decision/action/tag fields after parsing the response. Invalid or missing
output is a handled failure with no partial prediction.

The pure `moderator-proposal-evaluation-contract.ts` validates bounded synthetic
facts and response grounding. The source projection types and response-schema
factory live in the pure recipe contract, and the existing Runtime source retains
its public type exports. This extraction changes no Runtime admission behavior.
The fixture factory is server-side; the shared artifact/review contracts remain
browser-safe. The CLI accepts `--dataset moderator-proposal.v1` through the existing
bounded evaluation, review and report owners.

The facts envelope explicitly labels source availability as current, stale or
unavailable. Its optional snapshot has the existing source metadata shape:
observation timestamp, scan completeness, Incident/Signal/Event references,
advisory detector aggregates and exact candidate proposals. The benchmark limits
each snapshot to three candidates, ten Event references per candidate and 4,000
characters of evidence. It uses fixed synthetic identifiers, no comment text,
member identities, links, live records or source reads. These fixtures do not
reproduce current-authority attestation or the source's full scan limits; those
remain covered by the Runtime recipe owner.

Only current, nonnull, nontruncated snapshots admit candidates. The fixtures check
one candidate, a choice between two candidates, hostile notes, an empty scan,
missing source, stale retained candidates, a truncated scan and unavailable retained
candidates. Any admitted candidate is a valid selection. The target, Incident,
expected version digest and reason code must exactly match that candidate.
Restoration, direct execution and `execute_approved` are outside the actual schema
and cannot be accepted as a proposal. Notes cannot supply approval or source validity.

The fake adapter reads facts only and copies the first admitted candidate; poisoned
expected answers do not change its predictions. Fake results establish deterministic
fixture conformance, not model usefulness. The existing explicit evaluation-provider
injection, confirmation and budget contracts also apply to this dataset; implementation
and local verification use only deterministic local stubs. No provider calls,
credentials, activation, database access or capabilities are needed by these commands.

### Report and mixed source fixtures

The optional `detector.reportClaims` projection matches the
[report recipe source](r6-moderator-report-recipe-flow.md): exactly
`{ unverified: true, itemCount }`, where the integer count is `1..detector.itemCount`.
It counts distinct reported targets, not raw report rows, independent reporters,
classifier verdicts or approval. Unexpected keys, private report details, verified
claims, null values and invalid counts are rejected, never silently removed.
Observation-only evidence still omits the field.

The new suite has twelve cases per locale: current report and mixed candidates,
hostile notes on each, resolved reports, changed targets, resolved mixed evidence,
stale mixed evidence, empty or missing sources, truncated scans and unavailable
mixed evidence. Four cases per locale admit an exact candidate; eight require
abstention. The facts envelope's existing availability/scan labels describe these
synthetic states. They do not replay a real report resolution, deduplication,
author independence check, ACL change or Runtime attestation; those remain owned
by the actual recipe's PostgreSQL acceptance tests.

The v2 factory uses suite id `moderator-proposal-review`, version 2 and case
version 2. Evaluation commands select each version explicitly and validate the
requested suite hash across the installed child boundary. A v1/v2 baseline reports
`SUITE_MISMATCH`, with no pooled comparison deltas. Exact source/case/prediction
bindings continue to prevent labels from being reused against different evidence.
Workbench imports and exports retain the marker through the existing generic
composition, without a new UI action or live moderation authority.

```bash
pnpm agent:evaluate --dataset moderator-proposal.v2 --out reports.json --json
nexpress agent evaluate --dataset moderator-proposal.v2 --compare reports.json --json
nexpress agent evaluate --review reports.json --out report-review-template.json --json
```

## Run and review

```bash
pnpm agent:evaluate --dataset moderator-proposal.v1 --out proposals.json --json
nexpress agent evaluate --dataset moderator-proposal.v1 --compare proposals.json --json
nexpress agent evaluate --review proposals.json --out review-template.json --json
```

The generic `np.agent-eval.v1` artifact retains `moderatorResponse` on every parsed
prediction. Selection fixtures expect `approval`; abstention fixtures expect
`observe`. These names describe a proposed outcome for offline scoring and do not
create an approval or Runtime Run. Grounding violations are recomputed from the
retained evidence, independently of generic decision/tag agreement. Compatible
comparison includes `moderatorResponseChanged` for exact response changes.

Both proposals and parsed abstentions are reviewable. Copy the exact binding fields
from the matching template entry into a JSON array of labels:

```json
[
  {
    "caseId": "copy from entry",
    "caseHash": "copy from entry",
    "predictionHash": "copy from entry",
    "sourceHash": "copy from entry",
    "outcome": "accept",
    "reviewer": "local-reviewer",
    "reviewedAt": "2026-10-08T00:00:00.000Z",
    "notes": "Explain the judgment against the synthetic metadata.",
    "editedProposal": null
  }
]
```

The placeholders are not valid bindings. Outcomes are `accept`, `edit` and `reject`.
Accept requires the exact case to pass its deterministic scoring. For edit,
`editedProposal` is a complete recipe response with a meaningful change to the
selected proposal or to completion. It must stay inside the admitted evidence;
changing rationale/summary wording alone does not count as an edit. A reviewer may
replace a selection with completion even when that fixture originally expected a
proposal. This records a human preference without rewriting the source's gate or
claiming the edited outcome met that fixture's selection expectation.

```bash
pnpm agent:evaluate --review proposals.json --reviews labels.json --out reviewed.json --json
nexpress agent evaluate --review proposals.json --reviews labels.json --compare reviewed.json --json
```

The `np.agent-moderator-proposal-eval-review.v1` artifact embeds its exact source,
response, labels and recomputed summary. Labels are self-reported offline attribution,
not authenticated Incident feedback or human approval. Missing labels remain
unreviewed; failed/unparsed responses remain ineligible. Comparisons use only matching
reviewed case/prediction cohorts and explicitly report unmatched coverage. Input aliases,
symlinks, oversized files, unexpected child output and changed source bindings use the
existing closed CLI errors and private atomic output owners.

## Report and acceptance boundary

The [unified report](r6-evaluation-report-flow.md) accepts `moderator-proposal` as a
fourth manifest entry alongside `moderator`, `operator` and `publisher`. New reports
always show all four rows, with missing evidence explicit. Historical three-row
reports remain readable only after their exact original projection and hash are
independently reconstructed. Detector signal conformance, proposal/abstention
conformance and self-reported human response acceptance remain distinct metrics.
Proposal fixture decision precision is not actual spam precision.

This single-turn synthetic benchmark does not measure arbitrary natural-language
truth in completion/rationale prose, real-model usefulness, production false positives,
approval-resume behavior or automatic quarantine readiness. The existing recipe's
PostgreSQL journey covers current-source fences and signed approval separately.
AP-601/AP-606 and full R6 remain open, including the per-policy/per-locale reviewed
sample, confidence-bound and production-shadow requirements. No migrations,
versions, changesets or lockfile changes are included.

## Verification

Observed report/mixed extension verification on 2026-10-13 KST:

- Existing v1 suite canonical hash remains
  `cj1:sha256:PekLjRb2nqaNolY_zLLbLqztyj9QwTae6PbabuJPYec`.
  The full v2 fake replay covers 24 cases: eight exact selections and sixteen
  abstentions. Invalid/private/verified claims are rejected. Poisoned expected
  answers do not alter predictions, and neither hostile notes nor retained
  candidates override availability or scan fences.
- Focused Core evaluation/Workbench and App/CLI workflows passed 25 cases across
  five files. Representative composition fixtures avoid replaying the full suite
  for each binding mutation. Tests cover either mixed candidate, grounded edits,
  stale labels, exact requested CLI suite hashes and explicit cross-version
  comparison refusal. Existing response-schema and v1 behavior tests remain.
- `pnpm verify --concurrency=2`: 113 tasks passed in 7m33.589s, including builds,
  typechecks, 62 repository checks and all units. Core passed 2,307, App 688,
  CLI 154, Admin 191 and Web 164 cases. Final `pnpm lint`: 41 tasks passed.
  An early parallel lint read incomplete Core declarations and retained a stale
  CLI diagnostic; after the dependency build and clearing that generated cache,
  uncached CLI lint and the final workspace lint both passed without source changes.
- The existing production Chromium Workbench journey passed once, without retries
  or skips. It imports three factory-derived v2 cases, preserves exact imported
  labels, reviews a retained abstention, rejects an ungrounded edit, exports
  independently validated review/report JSON and retains CSRF/admission guards.
  The 320px capture was visually inspected; the overflow assertion passed.
- Forty fresh public tarballs passed 54 stages outside the workspace, including
  installed CLI v2 evaluation/self-comparison, v1 project evaluation, proposal and
  abstention reviews, exact review comparison, an incompatible v1 report baseline,
  Workbench round trip, generated-project typecheck and production build. Six
  shipped Core/App/CLI runtime/declaration files matched producer bytes. The CLI
  is a binary-only package and does not emit declarations. Evaluation commands ran
  without database or secret environment; the later build/typecheck used only
  offline placeholder configuration.
- Independent read-only review and self-review found no material regression.
  Modified code/test hashes stayed fixed through the final gates. Formatting,
  relative feature-document links and `git diff --check` passed. Versions,
  changesets, lockfile, schema and the pre-existing handoff edit are unchanged.

Ordinary units retained 13 Redis passes and three opt-in skips. Separate
PostgreSQL integration, live Redis, theme and native preview suites were not
repeated for this offline extension. The browser used an isolated local database
for existing staff admission, not live report resolution or Runtime attestation.
No real model/provider was invoked. These results do not establish spam quality,
automatic moderation readiness or full R6 acceptance. Logs use
`/tmp/np-report-eval-*`.

PR CI exposed an existing Publisher Workbench comparison test exceeding its
unchanged ten-second deadline. That edit/accept/reject comparison now uses one
actual admitted prediction instead of revalidating three unrelated cases. Its
grounded edit, exact review export, matched cohort and rate-delta assertions are
preserved; other tests retain the three-case failure/unreviewed coverage fixture.
The corrected Workbench file passed all nine cases locally, all 2,307 Core units,
Core typecheck and workspace lint passed, and production code/packed output did not change.
A later CI run first exceeded the Moderator matrix's twenty-second deadline,
then timed out in subsequent cases. Recipe export tests now validate the report
through its owner and require its independently validated embedded review to
equal the separate review export and exact labels, instead of replaying the same
fixed detector suite through a second review validator. Shared review reimport
remains covered once by the v2 composition and production browser journeys.
The CI unit step also uses workspace concurrency two, as local verification does,
to bound overlapping package Vitest pools. Package file parallelism, test counts,
domain/export assertions and all timeout values are retained. The corrected
`pnpm test --concurrency=2` command passed all 66 local workspace tasks, including
the unchanged unit counts. The corrected commit still requires its own full
exact-head PR checks; this is not a measured CI speedup claim.

Observed local verification on 2026-10-08 KST:

- Focused Core evaluator and existing recipe regressions: 45 cases passed. Review
  and report verification: 11 cases passed, including independently reconstructed
  historical three-row reports, modified sources, matched review cohorts and
  grounded edits. The recipe-schema regression also passed.
- App/CLI targeted checks: 20 cases passed across nine files, including actual
  file workflows and a real npm child boundary. Invalid child/source/label/baseline
  output is rejected without extra subprocess launches for each mutation.
- `pnpm verify --concurrency=2`: 113 workspace tasks passed, including all builds,
  typechecks and units, the reference production build, and 62 repository checks.
  Core passed 2,285, App 682, CLI 153, Admin 183 and Web 164 cases.
- Final lint cleanup removed an erased type assertion/import and replaced
  unnecessary test `async` wrappers with explicit resolved promises. The affected
  Core typecheck and six proposal evaluation cases passed again. These changes do
  not alter emitted production behavior or declarations.
- `pnpm lint`: all 41 workspace tasks passed. Modified-file formatting, local
  feature-document links and `git diff --check` passed after self-review.
- Forty fresh public tarballs passed 57 stages outside the workspace: new dataset,
  exact comparison, proposal and abstention reviews, four-entry project/installed
  CLI reports, actual saved legacy report validation, existing Operator/plan,
  Publisher and Moderator artifact comparisons, and generated-project typecheck.
  Seven installed Core/App/CLI runtime/declaration entry files matched producer
  bytes. Evaluation commands ran without database or secret environment; typecheck
  used placeholder configuration without opening a database connection.
- The existing Publisher CLI binding tests now generate the full twelve-case
  dataset once and a two-case review fixture once, with fresh copies per test.
  Previously they replayed the full dataset four times. Nine real subprocess
  checks remain; the Publisher workflow now shares the existing scoped twenty-second
  deadline. No global timeout, provider timeout or assertion was weakened.
  Same-machine focused test time was 6.92 to 6.36 seconds; wall time was 11.72 to
  14.62 seconds under concurrent work. This does not demonstrate CI speedup.

The ordinary units retained 13 Redis passes and three opt-in skips. PostgreSQL,
live Redis, browser, theme and native preview journeys were not repeated for this
offline slice; packed verification did not run migrations or a database journey.
This is not the full R6 gate. Detailed logs use `/tmp/np-moderator-proposal-*`.
The pre-existing handoff edit remains byte-for-byte unchanged.
