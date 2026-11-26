# R6 Moderator document report recipe evidence

The explicitly installed `moderator.repeated-link-spam` v1 recipe now reads actual
document and community-thread report Incidents through the same current-evidence
source, exact quarantine proposal and human approval continuation as comments.
It reuses the [document report owner](r6-incident-document-report-flow.md),
[comment report recipe](r6-moderator-report-recipe-flow.md) and
[Runtime approval owner](r6-moderator-runtime-flow.md).

## Current evidence and exact proposals

The recipe source dispatches canonical `community.content.reported` Events with
component `community.document-reports` to the existing document report reader.
Other supported Events retain the existing comment readers. Every original
reference and attached Signal must pass canonical integrity, exact source and
same-site relationships, current report resolution, document/comment ACLs,
actual status and containment version checks. The existing detector reruns on
those complete facts with current selected settings. A missing, edited, hidden,
resolved, inaccessible or inconsistent source excludes its entire Incident;
references are not dropped to manufacture a supported subset.

Separate comment and document Signals may correlate into one Incident under the
existing fingerprint. Both Signals remain mandatory. This source extension does
not add a combined comment/document collector. The subsequent
[combined content flow](r6-moderator-content-collection-flow.md) joins real
sub-threshold activity through one explicitly invoked collector. Existing collection owners, author independence,
target deduplication and advisory scoring remain unchanged.

Each admitted candidate copies the actual fact's target kind, collection, ID and
version into the existing quarantine proposal contract. Stable target ordering,
kind-aware deduplication, ten Incident/Signal/candidate bounds and the 100 unique
Event bound remain unchanged. A truncated result cannot authorize a mutation.
The provider cannot change a document target into a same-ID comment or supply a
new version base.

Report evidence remains an unverified claim. `detector.reportClaims` counts
retained distinct reported targets within its Signal, not filings, reporters or
classifier verdicts. Only exact proposal bytes, Incident/Signal/Event references
and advisory aggregate metadata enter the existing `sensitive-approved` server
fact and attestation digest. Document body, title, report reason/ID, author and
reporter identities, link domains, configuration and restoration state are not
provider context. The recipe definition, instruction digest, response schema,
setup, scopes and version are unchanged.

## Dispatch, human approval and completion

The existing context owner rereads evidence with the capture timestamp before
provider dispatch. The same issued source checks candidate membership after
inference, during fresh human approval inspection and before approved execution.
Resolving a supporting report or editing a supporting document invalidates the
whole campaign even when the selected target is unchanged. Current requester and
approver authority, policy, target ACL/version, signed approval, budgets, CAS and
transaction ordering remain with their existing owners. Refused execution does
not consume approval or change content.

The document containment owner performs the approved quarantine through the
collection pipeline, preserving hooks and revisions. Approval consumption,
Action, invocation, containment and Incident timeline commit atomically. Exact
continuation replay reuses the existing completed receipt. Successful quarantine
makes its original candidate ineligible; completed receipt review keeps retained
integrity and current authority checks without requiring obsolete pre-effect
eligibility. Only the verified redacted completed receipt reaches the next
provider context. Restoration remains a separate existing approved operation;
this recipe still proposes at most one quarantine per Run.

## Installation and remaining boundaries

Hosts still explicitly install document/comment observers and collectors, the
Incident read owner and `createAgentModeratorRecipeSourceV1`, passing the same
issued source to Runtime context and moderation. Construction performs no reads,
collection, dispatch, activation or provider work. Absent installation stays
disabled. There is no new route, worker, credential, provider call, public API,
manual-input format, schema, version, changeset or lockfile change.

The subsequent [content proposal evaluation](r6-moderator-content-proposal-evaluation-flow.md)
adds versioned synthetic document/comment response fixtures. Member
report/restriction sources, document-specific detector benchmarks, real-model
quality, automatic moderation and the full R6 acceptance gate remain open. Local fake-provider
journeys establish orchestration and refusal behavior; they do not establish
production false-positive or usefulness thresholds.

## Verification

Local acceptance on 2026-10-14 KST, based on `c2ebf77a` (PR #1531):

- Final `pnpm verify --concurrency=1`: all 113 workspace tasks passed, including
  Core 2,312, shared App 690, CLI 155, Admin 191 and Web 164 unit cases.
  `pnpm lint`: all 41 tasks passed. Focused Core recipe/report/detector checks
  passed twelve cases. The three edited TypeScript files were frozen before
  final acceptance; a separate temporary test-inclusive TypeScript configuration
  also passed after all dependency builds completed.
- Actual PostgreSQL 18: all 113 cases across thirteen affected suites passed
  without skips, including five theme cases and one explicitly enabled native
  preview. All thirteen new cases and sixteen existing recipe cases passed.
  Real document-only and correlated comment/document campaigns reached exact
  proposals, distinct staff approval, one pipeline hook/content effect across
  replay, and a verified redacted completion receipt. Both target kinds remained
  available before drift; corruption or current changes in either retained Signal
  removed the whole Incident. Tests covered attestation refusal before dispatch,
  supporting resolution after inference, unconsumed approval after supporting
  document/report/access changes, and forged kind/ID/version refusal.
- Redis 7.4.7: all sixteen existing unit/live cases passed against a disposable
  loopback server compiled outside the workspace. The ordinary Turbo unit gate
  retained its three environment-gated skips; the separate explicit live run
  exercised all three successfully. No repository dependency or environment
  configuration changed.
- Production Chromium: both existing document evidence and Moderator setup
  journeys passed with automatic retries disabled. Four captures at 390/1280
  were visually inspected. These fixture-backed browser regressions preserve
  existing screen behavior; actual Runtime persistence and signed execution
  are established by the PostgreSQL journeys above.
- Fresh external scaffold: all forty public packages packed and installed
  through 46 successful stages. Installed recipe source construction performed
  no reads or effects, document proposal/setup exports passed, the existing
  offline v2 evaluation passed, and configuration-inclusive typecheck and
  production build succeeded. Eight installed Core/Admin runtime/declaration
  entry files matched the producer bytes. The initial final comparison used a
  nonexistent App entry path; only that temporary helper path was corrected and
  the eight comparisons rerun successfully. No install/build stage was repeated.
- Self-review and independent read-only production/QA/clock reviews found no
  remaining material regression. All delegated results were collected. Final
  source hashes, relative links, formatting, protected-file scope and
  `git diff --check` passed. The pre-existing handoff edit was preserved.

Initial new PostgreSQL cases were refused at filing because the fixture had not
explicitly enabled collection document reports. The document modes now use the
existing report/moderation configuration and restore it during cleanup. The first
positive hook assertion used a nonexistent `afterSave` hook; it now checks the
actual `afterUpdate` hook and returned data. Test-inclusive typechecking also
corrected the existing dummy admission facet and explicit transaction bridge.
An intermediate typecheck overlapped declaration regeneration and is not counted
as acceptance; the final test-inclusive run and complete database suite passed
against finished output.

The prior main CI `38498735892` passed. Its Release `38498735933` failed while
bridging Version PR #1366 CI `38498806465`: one old comment-report recipe fixture
moved its Runtime clock backwards before the bootstrap Run's queued time. The
shared fixture now advances monotonically. A regression deliberately initializes
its Runtime clock ahead of the actual report bucket, preserves real report/Event
timestamps, and verifies successful bootstrap cancellation, valid candidates and
no provider/content effects. This fixes the fixture in the current bundle; the
old remote Release result remains failed. No Version PR merge, publication or
remote CI rerun was performed.

These checks establish current evidence, orchestration and refusal behavior, not
document model quality or the full R6 gate. Schema, versions, changesets and
lockfile remain unchanged; no real provider call, automatic activation or new
handoff was introduced. Local acceptance does not replace exact-head PR checks.

Logs: `/tmp/np-document-recipe-{verify,lint,core-unit,owned-types,pg-regression,redis,browser,consumer}.log`.
