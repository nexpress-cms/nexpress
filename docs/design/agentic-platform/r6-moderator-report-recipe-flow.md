# R6 Moderator comment report recipe evidence

The explicitly installed Moderator recipe can review Incidents supported by
actual filed comment reports through its existing current-evidence source and
human approval flow. It reuses the [report source owner](r6-incident-comment-report-flow.md)
and [observed-evidence recipe](r6-moderator-recipe-flow.md); reports remain
unverified claims, not classifier verdicts or execution authority.

## Shared source and provider metadata

The existing recipe source reads canonical reported Events through
`npReadAgentModeratorCommentReportFactV1`. Other Events retain the observed-comment
reader. Both owners check the exact immutable source, current domain and staff
ACLs, target relationship and version before the existing repeated-link detector
reruns. An edited, hidden, deleted, resolved, inaccessible or tampered report
source excludes its entire Incident, including correlated observation Signals.
References are not silently discarded to construct a smaller valid campaign.

The existing scan, Signal, Event and candidate bounds, target deduplication,
settings, fingerprint and advisory scoring are unchanged. Distinct comment
authors establish independence; reporter counts do not. Separate observation and
report Signals can support the same Incident, and each must validate completely.

For a candidate whose matched facts include reports, `detector.reportClaims`
contains `unverified: true` and the distinct reported target count. This is part
of the existing `sensitive-approved` server-fact metadata and its attestation
digest. Observation-only candidates omit it, preserving their existing wire
shape. The recipe definition, instruction text/digest, response schema and v1
identity are unchanged. No spam/profanity pass or flag is manufactured.

Raw report reasons, report IDs, reporter/member identities, comment text/HTML and
link domains remain outside provider metadata. The provider can only select an
exact admitted proposal; it cannot provide evidence or manufacture a target.

## Combined observed and reported collection

`createAgentModeratorCombinedCommentCollectorV1` reads the two existing comment
source owners in one explicitly invoked, closed ten-minute window. Three current
observed targets and two distinct report-only targets can now reach the existing
five-item/three-author detector threshold even when neither separate collector
would produce a Signal. The original observation-only and report-only collectors
remain available with their original contracts.

One ordered SQL scan matches the exact source-component/event-kind pairs and
bounds the entire combined batch at 100 source Events. A 101st Event rejects the
window before fact inspection or Incident writes; this is not two independent
100-Event allowances. Selected collections and current source eligibility use
the existing readers. Resolved, edited, hidden, inaccessible or missing current
facts do not become evidence. Historical corruption fails closed. The detector
still deduplicates targets, uses current comment authors rather than reporters,
and retains unknown report verdict pairs and advisory scores. Contradictory
same-time snapshots remain rejected by the existing detector; collection does
not reinterpret them as compatible observations.

`npResolveAgentModeratorCombinedCommentEvidenceV1` is the corresponding
host-injected Incident evidence resolver. It dispatches every retained Event to
its original owner and compares the complete current fact with its exact
candidate fact. It never validates a smaller subset of an invalid Signal.
The writer retains its canonical hash/fingerprint checks, transaction and
idempotency. Source reads, all candidate writes and final staff authorization
recheck share the existing Runtime control transaction; failure rolls back the
whole collection invocation. Collection does not change content, resolve a
report, dispatch a Run or invoke a provider.

Hosts wire the matching resolver and collector explicitly:

```ts
const incidents = createAgentIncidentWriteServiceV1({
  resolveEvidence: ({ db, candidate }) =>
    npResolveAgentModeratorCombinedCommentEvidenceV1({ db, candidate, staffUserId }),
});
const collector = createAgentModeratorCombinedCommentCollectorV1({ staffUserId, incidents });
await collector.collect({ siteId, windowStartedAt, settings });
```

Both APIs are exported from `@nexpress/core/agents`. The surrounding host still
owns bootstrap, observers, the current authorized staff identity and settings;
construction performs no installation or work. No automatic worker is added.

The recipe source shares the same source dispatch helper. One Signal can now
retain both observed and reported facts. Its report claim count describes only
retained reported targets, not every filing or an authoritative spam label.
Every original reference is rechecked before proposals and approved execution;
resolving a supporting report invalidates the whole candidate campaign. Existing
separate observation/report Signals attached to one Incident remain fully
validated as before.

## Current facts across dispatch and approval

Context attestation already rereads the source before provider dispatch. The same
source is checked after inference before proposal persistence, during fresh
approval inspection and before execution. Report resolution or supporting target
changes therefore invalidate a stale candidate even if its selected target is
unchanged. Current authority and collection access remain mandatory.

These checks reuse the existing transaction, domain lock ordering, CAS, signed
Approval, budget and moderation owners. Report inspection adds no report row
lock or write. The report owner's historical filing integrity remains separate
from current resolution, and no read repairs or reopens a report.

Quarantine still requires human approval and a separate approved continuation.
Exact execution replay and completed receipt projection retain their existing
semantics: successful quarantine changes the source's eligibility, so receipt
review checks retained evidence and authority without demanding pre-effect
candidate eligibility. Restoration remains the existing separate staff or
approved Runtime flow; the shipped recipe does not gain a restore proposal.

## Installation and remaining boundaries

Hosts still explicitly install the report observer and collector, Incident read
owner, issued recipe source, Runtime context, moderation and approval owners.
Construction does not observe, collect, enqueue, activate or call a provider.
Absent owners remain disabled. Schema, versions, changesets and lockfile are
unchanged, and no new worker, credentials or real provider calls are introduced.

This connects retained comment report evidence to the existing recipe. The
subsequent [document report recipe flow](r6-moderator-document-recipe-flow.md)
adds actual document reports and correlated comment/document Incident review.
Member report sources, combined comment/document collection, production/model
quality thresholds, automatic moderation and the full R6 evaluation gate remain
open.

## Verification

### Combined collection acceptance

Local acceptance on 2026-10-14 KST, based on `d1d69014` (PR #1529; its main
CI and Release subsequently passed):

- Final `pnpm verify`: 113 successful tasks, including Core 2,311, shared App
  689, CLI 155, Admin 191 and Web 164 unit cases. `pnpm lint`: 41 successful
  tasks. Focused detector/collector/report-source checks passed all 13 cases.
- Actual PostgreSQL 18: 77 cases across ten affected suites passed without
  skips, including five theme cases and one explicitly enabled native preview.
  The combined collector has four cases covering real 3-observation/2-report
  campaigns, duplicate target and reporter handling, current source integrity
  and ACL checks, the global 101-Event refusal and transactional rollback after
  staff demotion. Extra rows in the capacity test are canonical persistence
  fixtures, not claims of actual report filings.
- All 16 recipe cases passed. The two new combined journeys use real observed
  Events and filed reports: human approval leads to exactly-once quarantine and
  a redacted completion receipt, while resolving a retained supporting report
  invalidates the entire campaign and refuses approved execution without
  consuming approval or changing content. Provider invocations are test mocks.
- Fresh scaffold: 40 public packages packed and installed outside the workspace
  through 46 successful stages. The installed combined collector and resolver
  exports, interface typecheck and production build passed. Construction
  performed no automatic work, the existing offline v2 evaluation passed, and
  six installed Core/App/CLI runtime/declaration files matched workspace bytes.
- Production Chromium: the existing Moderator setup journey passed without
  retries; 390/1280 captures were visually inspected. This is a fixture-backed
  HTTP/browser regression. Actual combined source persistence and approved
  recipe execution are established by the PostgreSQL journeys above.
- Self-review and independent read-only review found no remaining material
  regression. Fixture preparation handles real bucket rollover without editing
  historical evidence; invalid retry targets are deleted through the content
  owner. The supporting-report refusal test selects a retained Signal reference
  rather than a detector-discarded duplicate.

An initial integration invocation included an extra `--`, so Vitest ignored the
intended file/worker bounds and ran unrelated suites with excessive concurrency;
existing Publisher/approval cases timed out before that run was stopped. The
corrected invocation used `pnpm --filter @nexpress/web exec vitest run` with the
ten explicit files and two workers; all 77 cases above passed after the complete
dependency build. The two previously timed-out suites were then rerun with two
workers: all 15 Publisher recipe/approval-resume cases passed without skips.
Total completed PostgreSQL verification is 92 cases. The interrupted run is not
acceptance evidence.

Redis unit cases passed (13); three live cases skipped because no local Redis
server was available. Versions, changesets, lockfile and schema remain unchanged.
These results cover combined collection and its existing recipe flow, not
real-model quality or the full R6 gate. No real provider call or activation was
performed. The existing handoff edit was preserved.

The final repository checks passed all 62 cases. Formatting, relative
documentation links, final source hashes and `git diff --check` were checked.
Local acceptance does not replace exact-head PR checks.

Logs: `/tmp/np-mixed-collection-{verify,lint,core-unit,pg-final-corrected,pg-timeout-recheck,browser,consumer,repo-final}.log`.

### Original report recipe acceptance

Local acceptance on 2026-10-13 KST, based on `37e1ae5f` (PR #1525's subsequent
main CI and Release both passed before this bundle started):

- Final `pnpm verify --concurrency=2`: 113 successful tasks, including Core 2,301,
  shared App 687 and Web 164 unit cases. `pnpm lint`: 41 successful tasks.
  Focused recipe/report/detector contracts passed all 12 cases.
- Actual PostgreSQL 18: all 14 recipe cases passed, comprising nine existing and
  five new report journeys. The new fixtures use six actual reports on five
  targets from three comment authors and separately seeded reporters. They
  verify unknown-claim metadata and redaction, target/author deduplication,
  mixed observation/report Signals with strict provenance, exactly-once approved
  quarantine and completion receipts, and refusal before dispatch (no provider
  call), after inference (no approval), and after approval (unconsumed approval)
  when supporting reports, current ACL or comments change.
- Another 53 cases across seven affected PostgreSQL suites passed without skips:
  actual report filing/evidence, observation collection, Incident evidence,
  Runtime context attestation and existing approved execution/restoration.
  Theme rendering (five cases) and native preview (one case with
  `NP_TEST_PREVIEW_BROWSER=1`) also ran. Total PostgreSQL acceptance: 67 cases.
- Production Chromium: all 18 Moderator setup/Incident journeys passed without
  retries. Existing 390/1280 setup and report evidence captures were visually
  inspected. These are fixture-backed HTTP/browser regressions; actual report
  persistence and recipe orchestration are established by PostgreSQL tests.
- Fresh scaffold: all 40 public packages packed and installed outside the
  workspace, with 46 successful stages. Installed source construction performed
  no reads or effects; recipe authority remained manual/quarantine-only. The
  public optional claim type passed configuration-inclusive typechecking and
  production build. Installed Core contracts/agents/bootstrap and Admin client
  artifacts matched final workspace bytes.
- Self-review and independent read-only review found no remaining material
  regression. Initial new-test failures were fixture errors: escaped receipt
  text, an omitted executor claim during attestation inspection, and the existing
  domain ACL `FORBIDDEN` classification. The fixture also handles real timestamp
  bucket boundaries and chooses distinct reporters during bounded retries;
  final 14-case verification followed those repairs. Production/test source
  hashes were checked after the final gates.

Formatting, relative documentation links, secret/generated-file scope and
`git diff --check` passed. Versions, changesets, lockfile and schema remain
unchanged. The existing handoff edit was preserved and no new handoff written.

Redis unit cases passed (13); three live cases skipped because no local Redis
server was available and Docker did not respond. These checks cover this source
extension, not the full PostgreSQL/browser/scaffold operational gate, spoken
assistive-technology acceptance, real-model quality or full R6 completion. No
real provider calls or activation occurred. Local results do not replace the
exact-head PR checks.

Logs: `/tmp/np-report-recipe-{verify,lint,unit,pg-recipe-final,pg-regression,browser,consumer}.log`.
