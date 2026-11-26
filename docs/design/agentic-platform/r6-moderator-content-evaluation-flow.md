# R6 Moderator document and comment detector evaluation

`moderator.v3` replays document reports and mixed document/comment facts through
`npDetectAgentRepeatedLinkSpamV1`. It extends the existing
[detector evaluation](r6-moderator-evaluation-flow.md) after the
[combined content collector](r6-moderator-content-collection-flow.md).
The separate [proposal dataset](r6-moderator-content-proposal-evaluation-flow.md)
continues to evaluate recipe responses; neither dataset substitutes for the other.

## Fixed synthetic corpus

The factory `createAgentModeratorEvaluationCasesV3` supplies 32 Korean/English
cases, sixteen per locale. The pure case/result/artifact contracts use version 3
and `np.agent-moderator-eval.v3`. Live Fact, settings, signal candidate and actual
detector contracts remain v1; their thresholds and behavior are unchanged.
The fixed expected domain hashes are authored independently of the extractor
under test. Mutating extraction must fail conformance rather than mutate its oracle.

The corpus checks document-only reports and combined three-document/two-comment
activity at five targets and three content authors. It covers identical UUIDs
across target kinds, insufficient targets/authors, a missing author, duplicate
document filings, comment observation/report deduplication, replayed evidence,
newer document/comment link removal and rejected observations. A document's
newer rejected revision and a comment's newer moderation Event each suppress the
older report candidate. Order and duplicate delivery cannot inflate a campaign.
Reported verdicts remain paired unknown values; content authors establish
independence. This offline Fact corpus does not reproduce reporter resolution,
ACL changes, live collector scans or Runtime attestation.

Benign repeated reference links intentionally produce advisory signals. Their
fixture-authored classification label remains legitimate even though signal
conformance passes. Insufficient-volume/author spam remains a synthetic false
negative; clean legitimate facts provide a true negative. Hostile prose cannot
create a verdict, approval or execution authority. The 32-case outcome is twelve
signals: ten authored spam and two legitimate; eighteen false negatives and two
true negatives. Synthetic precision is 8,333 basis points and recall 3,571; these
are case-level corpus outcomes, not production quality estimates.

Both earlier fixed corpora and artifacts remain byte-equivalent under canonical
hashing. V1 suite/artifact hashes remain
`cj1:sha256:qQOsU5IOZje82cFDhm9Q3X2iqgoJ_oC81V0zHCLgJHI` and
`cj1:sha256:iM8KbtwzAzJbUHgGV8k-WXLvnzzC5UREMmQkS8bztUM`.
V2 retains `cj1:sha256:CQ7QqSmF1iLN_LjBQLH6GhRbnAXkgmJh8qf1vECfzgE` and
`cj1:sha256:f0jvigopUg8m95e6bX9l8E53P7X4k6yY-YOxFJKre6M`.

## CLI, review and report

```bash
pnpm agent:evaluate --dataset moderator.v3 --out content-detector.json --json
nexpress agent evaluate --dataset moderator.v3 --compare content-detector.json --json
nexpress agent evaluate --review content-detector.json --out content-review-template.json --json
```

Network, model and provider-budget flags are refused for this deterministic
dataset. No application bootstrap, DB, credentials or provider calls are needed.
App/installed CLI use versioned evaluation/review command envelopes ending `.v3`.
The installed verifier independently replays the requested corpus and rejects
an earlier version's success or error envelope in its place.

Unsuffixed artifact/review/compare helpers dispatch the exact installed version;
caller-rehashed expectations, predictions and summary fields cannot replace the
installed corpus. Original suffixed V1 APIs still reject new versions. Historical
outputs of a changed detector implementation remain outside this fixed-version
verifier; longitudinal detector comparison is not established.

Review artifacts use `np.agent-moderator-eval-review.v3` with the existing
confirmed-spam/false-positive labels. Source, case and prediction bindings are
exact, only a single advisory signal makes a case eligible, and unreviewed
coverage stays visible. Labels are self-reported offline attribution, never live
Incident feedback, a spam verdict or human execution approval. Comparisons use
only the same reviewed case/prediction cohort; earlier corpora explicitly return
`INCOMPATIBLE_SUITE` with null comparison rates/deltas.

The existing [Admin workspace](r6-evaluation-workbench-flow.md) and
[unified report](r6-evaluation-report-flow.md) preserve document/comment evidence,
versioned reviews and their bindings through import, recomputation and export.
No new route or UI authority is introduced. Reports still have four recipe rows
and always leave full R6 unestablished.

## Acceptance boundary

This bundle closes the bounded synthetic document/comment detector benchmark.
Member report sources, real-model usefulness, production spam precision,
longitudinal detector comparisons, automatic moderation and full AP-606/R6
acceptance remain open. The reviewed sample, confidence bound and production
shadow requirements in [testing guidance](testing-and-evaluation.md#93-enablement-gates)
still apply.

Versions, changesets, lockfile, schema and migrations remain unchanged. The
pre-existing handoff edit is preserved; no new handoff is created. No Runtime,
provider or worker activation, new credentials or capability execution is added.

## Verification

Local acceptance on 2026-10-14 KST against `65a95dbd` (PR #1534). Baseline main
was synchronized with the remote when this local acceptance was recorded.

- Full Core ESM/declarations built successfully. `pnpm verify --concurrency=2`
  passed all 113 tasks in 7m40.105s, including 62 repository checks,
  builds/typechecks and Core 2,327, App 692, CLI 157, Admin 191 and Web 164 unit
  cases. `pnpm lint` passed all 41 tasks in 33.689s.
- Focused owner checks passed Core 32 cases across four files, App eleven and
  CLI seventeen across three files each. Full Core/App/CLI test-inclusive typing
  and the browser spec typing passed. Both earlier suite/artifact hashes matched
  their pre-change snapshots. Independent extraction failure produced twelve
  missing expected signals; caller-rehashed source/prediction substitutions and
  strict V1 imports failed closed. Exact reviewed cohorts, incompatible V2
  baselines and Workbench/report round trips used the existing owners.
- Production Chromium passed both evaluation workspace journeys without retries
  or skips against an isolated task-owned PostgreSQL 18 database. The proposal V3
  journey stayed intact; the detector journey imported the full V3 corpus,
  displayed actual three-document/two-comment evidence, applied an offline label
  and independently validated review/report downloads with an incompatible V2
  baseline. Existing staff admission/CSRF guards remained. The 320px detector
  screenshot was visually inspected and the overflow assertion passed.
- Fresh external scaffold passed forty public tarballs and 55 stages. Installed
  CLI V3 replay/self-comparison, project V1/V2 replay, exact false-positive review,
  review comparison and a V2 report baseline passed. Installed Workbench source,
  review and report exports, strict V1 refusal, new public types, generated-project
  typecheck and production build passed. Eight Core/App/CLI/Admin entry files
  matched producer bytes. Evaluation ran without DB/secret environment;
  typecheck/build used offline placeholder configuration only.

Self-review and independent production/QA reviews found no remaining material
regression; all delegated results were collected. Final source hashes, formatting,
relative links, protected-file scope and `git diff --check` passed. The existing
handoff diff was preserved exactly. The task-owned DB was stopped after browser
verification; global DB services were unchanged.

Ordinary units retained thirteen Redis passes and three opt-in skips. Separate
PostgreSQL integration, live Redis, theme integration and native-preview suites
were not repeated for this offline-only extension. Browser SQL exercised existing
staff admission; these synthetic replay checks do not reproduce live report
resolution, source ACL changes or Runtime attestation. Local acceptance does not
replace exact-head PR checks, production quality or full R6 acceptance.

Logs: `/tmp/np-detector-v3-{core-build,verify,lint,browser,consumer}.log`,
`/tmp/np-detector-v3-qa-{core-tests,core-typecheck,web-typecheck}.log` and
`/tmp/np-detector-v3-{app,cli}-{tests,types,lint}.log`.
