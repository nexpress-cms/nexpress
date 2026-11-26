# R6 Moderator document and comment proposal evaluation

`moderator-proposal.v3` evaluates exact document and comment proposals through
the existing Moderator recipe instruction, response schema and offline
evaluation/review owners. It closes the comment-only benchmark gap after the
[document recipe](r6-moderator-document-recipe-flow.md) and
[combined content collector](r6-moderator-content-collection-flow.md).
The original [observed and report/mixed proposal datasets](r6-moderator-proposal-evaluation-flow.md)
remain available with their original suite hashes.

## Versioned synthetic evidence

The new factory `npCreateAgentModeratorProposalEvaluationSuiteV3` emits suite
`moderator-proposal-review`, version 3 and case version 3. Its twenty-four
Korean/English cases contain four exact selections and eight required abstentions
per locale. Document report candidates retain five unverified reported targets.
Mixed document/comment candidates share one campaign, five synthetic Event
references, five detector items and three unverified reported targets; candidate
count is neither author independence nor filing count.

The new `np.agent-moderator-proposal-eval-facts.v2` envelope permits exact document
and comment targets. A document candidate requires bounded
`detector.reportClaims: { unverified: true, itemCount }`. Reports never establish
spam verdicts, reporter independence or approval. Existing limits remain three
candidates, ten Event references per candidate, 4,000 evidence characters and
bounded public metadata. No document body/title, report reason, identities,
domains, live records or restoration state are included.

Unsuffixed evidence, prediction and grounding helpers dispatch by the exact facts
schema. The original suffixed V1 helpers still require v1 comment-only facts and
reject the new envelope. Shared scoring, the fake runner and offline review use
the version dispatcher. The Runtime recipe definition, instruction digest,
response schema, source, admission and human approval/execution owners are
unchanged.

The v1 suite hash remains
`cj1:sha256:PekLjRb2nqaNolY_zLLbLqztyj9QwTae6PbabuJPYec`; the v2 hash remains
`cj1:sha256:9qDu-MfXfpy_FZi9d_Ng9YBGLBPOFvecMuut80aktdI`.

## Exact selection and refusal

A current nonnull, nontruncated snapshot admits its exact candidates. Either
target in a mixed snapshot is a valid selection; candidate order confers no
priority or authority. Proposal kind, collection, ID, Incident, expected version
and reason must match one complete admitted proposal. A document cannot become
a comment by copying only its ID. The existing response permits one
`moderation.quarantine` proposal or completion; direct execution and restoration
remain invalid responses.

Resolved, changed, unavailable, missing, empty and truncated synthetic snapshots
require completion even if they retain candidate metadata. Hostile notes cannot
override availability, change a target/version or manufacture approval. Those
labels describe synthetic projections; they do not replay an actual report
resolution, ACL change or Runtime attestation. Real current-source fences remain
covered by the existing document/combined-content PostgreSQL journeys.

The deterministic fake adapter reads only evidence and copies an admitted
candidate. Expected answers, allowed actions and scoring labels do not enter its
request. Its results establish fixture conformance, not live-model usefulness.

## CLI, Admin review and report

```bash
pnpm agent:evaluate --dataset moderator-proposal.v3 --out content.json --json
nexpress agent evaluate --dataset moderator-proposal.v3 --compare content.json --json
nexpress agent evaluate --review content.json --out content-review-template.json --json
```

Installed CLI results must match the requested suite's exact hash. A v1/v2 result
cannot substitute for v3. Reviews use the existing accept/edit/reject labels and
source/case/prediction bindings; selections and parsed abstentions are reviewable.
A meaningful edit may choose the other admitted document/comment candidate or
complete. Unadmitted targets, versions and stale labels are refused. Labels are
self-reported offline review, never signed live approval.

The existing [Admin review workspace](r6-evaluation-workbench-flow.md) and
[unified report](r6-evaluation-report-flow.md) use those same owners, retaining the
new envelope through import, review, comparison and independently validated
exports. Compatible comparisons use exact matched reviewed cohorts. A different
dataset version reports `SUITE_MISMATCH` with no pooled deltas. No new route,
schema, UI authority, browser persistence or application bootstrap is introduced.

## Acceptance boundary

This bundle adds a synthetic proposal benchmark, not detector replay for document
facts or production spam precision. The [content detector corpus](r6-moderator-content-evaluation-flow.md) separately
adds bounded synthetic document/comment replay. Member sources, live-model
quality, automatic moderation and full AP-606/R6 acceptance remain open. The per-policy/per-locale reviewed sample, confidence-bound and
production-shadow requirements in
[testing and evaluation](testing-and-evaluation.md#93-enablement-gates) still apply.

Versions, changesets, lockfile, schema, migrations and the pre-existing handoff
edit remain unchanged. No Runtime/provider/worker activation, credentials,
network provider calls or capability execution is added.

## Verification

Local acceptance on 2026-10-14 KST, based on `8106099f` (PR #1533). Its exact-head
PR checks and subsequent main CI/Release passed before this bundle.

- Full Core ESM/declarations built successfully. `pnpm verify --concurrency=2`
  passed all 113 tasks in 7m32.114s, including 62 repository checks, production
  builds/typechecks and Core 2,321, App 691, CLI 156, Admin 191 and Web 164 unit
  cases. Final `pnpm lint` passed all 41 tasks.
- Focused Core passed twenty V3/V1/V2 cases; App/installed CLI passed 23 cases
  across four files. Full Core/CLI test-inclusive typing, bounded App test typing
  and browser-spec typing passed. Both released suite hashes and the recipe
  definition hash stayed unchanged. V3 replay covered all 24 cases with eight
  selections and sixteen abstentions; representative composition fixtures avoided
  repeating the full corpus through every binding mutation.
- Exact kind, ID, Incident and version substitutions, private/verified or absent
  document report claims and relabeled facts were refused. Every retained
  unavailable/stale/empty/missing/truncated case independently refused a proposal.
  Either mixed target remained selectable, and poisoned expected answers did not
  change predictions. Grounded content edits, stale review bindings, matched
  reviewed cohorts and incompatible v2 baselines used the existing review/report
  and Workbench owners. Actual child v1/v2 substitutions for requested v3 failed
  closed through the installed CLI verifier.
- Production Chromium passed both existing workspace journeys without retries
  or skips against a separate task-owned PostgreSQL 18 database. The proposal
  journey imported three factory-derived v3 document/mixed/stale cases, preserved
  imported document and abstention labels, rejected an absent-target edit, applied
  the exact admitted comment alternative and independently validated downloads.
  Current staff admission/CSRF guards and the existing detector v2 journey were
  retained. The 320px capture was visually inspected; the overflow assertion
  passed.
- Fresh external scaffold passed forty public tarballs and 55 stages. Installed
  CLI v3 evaluation/self-comparison, project v1/v2 evaluation, document acceptance,
  exact mixed-comment edit and abstention review, review comparison and a v2
  report baseline passed. Installed Workbench composition used three bound cases;
  its review/report exports, strict V1 refusal, new public types, generated-project
  typecheck and production build passed. Eight shipped Core/App/CLI/Admin entry
  files matched producer bytes. Evaluation commands ran without DB/secret
  environment; build/typecheck used offline placeholder configuration only.

Initial probes corrected test-only fixture mistakes: the recipe definition must
be awaited before hashing, copied canonical references must remain independent,
and invalid installed child output uses the existing `EVALUATION_UNAVAILABLE`
fallback. Final workspace lint then found one unnecessary non-null assertion in
the new App test. Removing it changed no runtime/product code; the affected nine
App cases, their test-inclusive typing and all 41 lint tasks passed again.

Self-review and independent Core/whole-bundle production/QA reviews found no
remaining material regression; all delegated results were collected. Final
source hashes, formatting, relative links, protected-file scope and
`git diff --check` passed, preserving the pre-existing handoff edit.

Ordinary units retained thirteen Redis passes and three opt-in skips. Separate
PostgreSQL integration, live Redis, theme and native-preview suites were not
repeated for this offline extension. Browser SQL exercised existing staff
admission rather than live report resolution or Runtime attestation. Restarting
the disposable cluster initially inherited occupied default port 5432; explicit
loopback port 55491 was restored before creating the isolated browser database.
No global DB service was changed. These results do not close model quality or
full R6 acceptance, and local evidence does not replace exact-head PR checks.

Logs: `/tmp/np-content-proposal-v3-{core-build,verify,lint-final,app-regression-final,app-types-final,browser,consumer}.log`
and `/tmp/np-content-proposal-v3-{qa,cli}-*.log`.
