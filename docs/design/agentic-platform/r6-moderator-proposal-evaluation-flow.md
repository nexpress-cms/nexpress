# R6 Moderator proposal evaluation and review

This AP-606 slice evaluates the shipped [Moderator recipe definition](r6-moderator-recipe-flow.md)
against versioned synthetic evidence projections. `moderator-proposal.v1` adds
sixteen Korean/English cases: three selection and five abstention cases per
locale. It complements the actual detector replay in `moderator.v1`.

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
