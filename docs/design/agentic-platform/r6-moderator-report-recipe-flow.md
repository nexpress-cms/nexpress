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

This connects retained comment report evidence to the existing recipe. General
document/member report sources, production/model quality thresholds, automatic
moderation and the full R6 evaluation gate remain open.

## Verification

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
