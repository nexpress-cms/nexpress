# R6 document report Incident evidence

Explicitly installed document report observation connects actual filed document
and community thread reports to bounded advisory Incidents, current evidence
review and existing staff human approval quarantine/restore. It reuses the
[comment report flow](r6-incident-comment-report-flow.md),
[Incident evidence owner](r6-incident-evidence-flow.md) and
[staff response flow](r6-incident-response-flow.md).

## Filing and immutable evidence

The existing `fileReport` owner optionally dispatches collection-document reports
to `setCommunityDocumentReportObserverV1`. Without installation, filing behavior
is unchanged. Installation alone does not collect, dispatch a Run, activate a
worker or invoke a provider.

Collections must already enable reports and document moderation. Under the
existing document row lock, the source owner rechecks the exact same-site
published/public document, configured moderation-hidden field and reporter
community audience. Unresolved duplicates are checked before and after the
parent lock. Runtime site control is prepared before that lock; report reads add
no report row lock. The actual report and canonical Event share one transaction,
so recording failure rolls both back. Existing community audit remains owned by
the report service after successful filing.

The `community.document-reports` source uses the existing
`community.content.reported` Event, document subject and `DOCUMENT_REPORT_FILED`
code. Its canonical community status `visible` means the captured document was
published, public and not moderation-hidden; it is not a classifier verdict.
The source key binds the real report filing identity/base and the complete
canonical collection document plus configured hidden field through separate
purpose-bound digests. Resolution remains a current fact outside the immutable
filing base. Raw report reason and document body are not copied to Agent storage.

## Collection and current source integrity

Hosts explicitly invoke `createAgentModeratorDocumentReportCollectorV1` for one
closed ten-minute bucket. The ordered SQL scan is bounded at 100 source Events;
101 rejects before fact inspection or Incident writes. Existing settings, target
deduplication, three-author/five-target default threshold, advisory score,
fingerprint and Incident idempotency are unchanged. Different reporters on one
target do not create independent authors or additional targets.

Facts use the actual document `memberAuthorId`, including null when no member
owns it. Null authors cannot establish detector independence. Link-domain hashes
come from the existing moderation searchable-text projection and bounded local
URL parser; no fetch, classifier or fabricated pass/flag evidence is added.
Oversized or invalid text is refused rather than truncated. Only unknown/unknown
report claims enter this source.

`npResolveAgentModeratorDocumentReportEvidenceV1` checks every retained candidate
fact against the exact current source. Readers verify canonical Event integrity,
source component, document/report/site/time relationships and immutable filing
base. Current document ACL and community audience use the existing containment
read/lock/version owner. Edited, hidden, resolved, missing or inaccessible sources
cannot become new eligible facts. Every collection write and the final staff
recheck share the existing Runtime control transaction.

```ts
setCommunityDocumentReportObserverV1(createAgentModeratorDocumentReportObserverV1({ events }));
const incidents = createAgentIncidentWriteServiceV1({
  resolveEvidence: ({ db, candidate }) =>
    npResolveAgentModeratorDocumentReportEvidenceV1({ db, candidate, staffUserId }),
});
const collector = createAgentModeratorDocumentReportCollectorV1({ staffUserId, incidents });
await collector.collect({ siteId, windowStartedAt, settings });
```

The setter/resetter are framework-host bootstrap exports; collector/resolver are
server `@nexpress/core/agents` exports. Hosts own initialization, source identity,
settings and optional installation. Original comment and combined-comment
collectors keep their original boundaries.

## Studio review and human response

The existing Incident evidence route and pure wire add a document target without
changing comment projections. Recorded document report metadata identifies
published/public state and paired unknown verdicts. Current metadata separately
shows the actual document status, public/private visibility, configured
moderation-hidden value and update time. Hidden documents can have pending
status; hiding is not represented as an invented document lifecycle status.
Physical source removal is unavailable, not an inferred tombstone or retention
expiry. Report resolution is separate from current document state.

The wire excludes report IDs/reasons, authors, text, HTML, configuration and raw
Events. Current source/ACL facts bind authenticated pagination. All original
references must remain readable for Incident visibility; partial accessible
subsets do not grant review. The shared Content evidence view compares recorded
and current metadata and selects only an exact server-issued response target
and version. Loading, refresh, pagination, access loss and drift clear selection.
No page load or selection prepares or executes a plan.

An unchanged unresolved source on an active Incident may offer a new quarantine
plan. Staff intent, signed human approval, exact content version, collection
pipeline hooks/revisions, CAS, audit and compensation remain owned by the
existing response/moderation/containment services. Document editing or authority
loss still refuses stale approved execution. Resolving a report removes new
response choices; previously issued human approvals retain the existing
moderation owner's semantics. Restoration is the existing separate approved
flow and checks the installed containment version.

## Remaining boundaries

This bundle adds document report Incidents and staff response, not a new Runtime
recipe. The installed Moderator recipe source remains comment-only. Separate
comment/document Signals may correlate into one Incident under the existing
fingerprint; staff review checks every source. The comment-only recipe does not
discard document references to manufacture a smaller supported campaign. Member
restriction/report sources, combined comment/document collection, model-quality
thresholds, automatic action and the full R6 gate remain separate. No schema,
version, changeset, lockfile, credential, external delivery or activation change
is introduced. The existing handoff edit is preserved.

## Verification

Local acceptance on 2026-10-14 KST, based on `9a13f25e` (PR #1530). Its exact-head
PR CI and subsequent main CI/Release passed; those results precede this bundle.

- Final `pnpm verify --concurrency=1`: 113 successful tasks, including Core
  2,312, shared App 690, CLI 155, Admin 191 and Web 164 unit cases. `pnpm lint`:
  41 successful tasks. Repository checks passed all 62 cases.
- Focused Core parser/report/detector checks passed 15 cases; shared Incident
  HTTP checks passed 49. The new document wire goes through the existing route
  and rejects contradictory eligibility/private fields while preserving comment
  shapes.
- Actual PostgreSQL 18: 94 cases across twelve affected suites passed without
  skips, including five theme cases and the explicitly enabled native preview.
  All nine new document-report cases passed: actual member/staff document
  creation and reporting, absent installation, report/Event rollback, duplicate
  filings, target/author independence including null authors, 100/101 source
  bounds, current evidence and cursor drift, ACL/site/integrity denial, exact
  human approval quarantine/restore, hooks/revisions/replay, and refusal of an
  approved stale document version without consuming approval. Capacity padding
  rows are canonical persistence fixtures, not claims of actual report filings.
- Production Chromium: 18 existing Incident/Moderator setup journeys passed,
  followed by the corrected new document journey. All 19 unique journeys were
  verified with automatic retries disabled. Document 390/1280 captures were
  visually inspected: published/public, pending/hidden and draft/private remain
  distinct; only an exact eligible response target can be selected. Browser HTTP
  fixtures are separate from the actual persistence/approval evidence above.
- Fresh external scaffold: all 40 public packages packed and installed through
  46 successful stages. Installed document observer/collector/resolver exports,
  bootstrap types and document evidence wire checks passed. Construction caused
  no reads, installation or effects; the existing offline v2 evaluation passed.
  Configuration-inclusive typecheck and production build passed, and eight
  installed Core/Admin runtime/declaration files matched workspace bytes.
- Self-review and independent read-only domain/UI reviews found no remaining
  material regression. All delegated results were collected. Final source hashes,
  formatting, relative links, protected-file scope and `git diff --check` were
  checked; the previous handoff edit was preserved.

The first workspace invocation completed 108 tasks before App typecheck exited
137 without a type diagnostic while Web build also started. The final sequential
invocation reused those results and passed all 113 tasks without changing product
code. The initial new PostgreSQL failure was a missing fixture reauthentication
seam for restoration, fixed using the existing admission owner. Bounded fixture
retries delete discarded targets through their real document owners rather than
rewriting historical Events. The initial new browser failure was a shallow copy
sharing nested report objects; the canonical input guard refused it before HTTP
fulfillment. Only the fixture was corrected, then Web typecheck and that journey
passed against unchanged production output.

Redis units passed (13); three live cases skipped because no local Redis server
was available and Docker info did not respond. These checks establish this
source/review/response extension, not real-model quality, spoken assistive
technology or full R6 acceptance. Versions, changesets, lockfile and schema remain
unchanged; no real provider calls, activation, publication or new handoff occurred.
Local evidence does not replace exact-head PR checks for this new bundle.

Logs: `/tmp/np-document-report-{verify-final,lint-final,core-unit,http-unit,pg-final-exact,pg-regression,browser,browser-final,consumer}.log`.
