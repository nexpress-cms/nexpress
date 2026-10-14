# R6 member report Incident review

Actual member report filings can feed bounded advisory Incidents and staff Studio
review through explicit host installation. A filing is an unverified claim. It
supplies no abuse verdict, spam score, account restriction or response authority.
This extends the [Incident evidence flow](r6-incident-evidence-flow.md) alongside
the [document report flow](r6-incident-document-report-flow.md).

## Filing and immutable source

`fileReport` optionally uses `setCommunityMemberReportObserverV1`. Without that
owner, existing filing behavior remains unchanged. Installed observation holds
Runtime site control before the target global Member row, rechecks active status
and unresolved duplicates, then records the report and Event in one transaction.
A recording failure rolls both back. Existing report audit stays with its owner.

The new `community.member.reported` Event uses source component
`community.member-reports`, a Member subject, recorded active status and explicit
`unverified` claim. Its purpose-bound source key commits the actual report's
site, identity, reporter, target, reason and filing time separately from minimal
Member identity/status/update metadata. Report resolution is a current fact,
not part of the immutable filing base. Reason, profile, email, IP and account
sanction data are not copied into Agent evidence. Private Event actor attribution
stays outside the staff evidence wire.

Members are global. The real report supplies site scope; current account status
is therefore labelled global, while report resolution belongs to the site.
The observer does not infer site membership, site bans or account intent.

Migration `0068_tricky_rhodey.sql` is generated from the existing schema and
broadens only the Event and Trigger kind CHECK allowlists. It changes no table,
column, stored data, default installation or Trigger activation. Package
versions, changesets and lockfile remain unchanged. The closed Trigger JSON
schema now includes the new Event kind, so its containing Admin registry
aggregate fingerprint and `agents.configurations.activate` contract fingerprint
change; its golden expectation is updated. Removing only the added enum value
reproduces the previous registry digest exactly; all other operation contracts
are unchanged. Existing
canonical Event vectors and earlier detector dataset hashes remain unchanged.

## Explicit collection and proof

Hosts invoke `createAgentModeratorMemberReportCollectorV1` for one closed
ten-minute window. The ordered SQL scan allows at most 100 source Events; 101
rejects before source inspection or Incident writes. Facts require every actual
report/Event binding and an unchanged active account with an unresolved report.
A Member/window/site group produces the separate
`moderator.member-report-review` detector's advisory `abuse` Signal. Its severity
is `info`, confidence basis is `external`, and score is null. Report quantity and
reporter identity do not establish classifier quality or reporter independence.
The earlier comment/document deterministic spam detector remains unchanged.

The dedicated writer validates its strict member candidate, evidence digest and
site/Member/window fingerprint. It reuses the existing private Incident ingest
transaction, replay, correlation, CAS, timeline, retention and optional local
notification recording. Its injected resolver rechecks all actual source facts
before persistence; the collector also rechecks current staff authority after
all writes and rolls the transaction back on loss or drift.

Global target Member rows use `FOR NO KEY UPDATE`; collectors acquire all target
UUIDs in sorted order across sites. The writer then locks exact same-site Member
report rows with `FOR SHARE`, in report UUID order, before rereading all facts.
These locks fence account changes and report resolution until Signal commit.
A dismissal that finishes first makes captured evidence ineligible. Member
locks permit the resolution actor's FK `KEY SHARE`, including when actor and
target coincide. This proof remains valid after observer reset; legacy
`resolveReport` is unchanged. Read-only evidence acquires no row locks.

```ts
setCommunityMemberReportObserverV1(createAgentModeratorMemberReportObserverV1({ events }));
const incidents = createAgentMemberReportIncidentWriteServiceV1({
  resolveEvidence: ({ db, candidate }) =>
    npResolveAgentModeratorMemberReportEvidenceV1({ db, candidate, staffUserId }),
});
const collector = createAgentModeratorMemberReportCollectorV1({ staffUserId, incidents });
await collector.collect({ siteId, windowStartedAt });
```

Observer setter/resetter belong to framework-host `@nexpress/core/bootstrap`;
source, collector, writer and reader belong to server `@nexpress/core/agents`.
Construction and installation do not run collection, activate Runtime/workers,
call providers or enable any account action.

## Current evidence and Studio

Hosts compose `createAgentIncidentMemberReportEvidenceServiceV1` with the existing
staff reader's all-source visibility callback and Studio's optional
`memberReportEvidence` owner. Composition must route source callbacks to their
respective owners; the member owner refuses foreign or mixed source evidence.
Current staff identity must retain `admin.manage` and `community.moderate`.

| Source or current state                                                           | New collection                 | Staff evidence                                        |
| --------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| Exact unresolved filing, unchanged active Member                                  | Eligible                       | Filed active/unverified facts and current state       |
| Member updated or account status changed                                          | Ineligible                     | Current global status/update/version shown separately |
| Report resolved with valid chronology                                             | Ineligible                     | Current site resolution shown separately              |
| Event past retention eligibility but physically retained                          | Subject to exact-current proof | Still readable when all bindings hold                 |
| Physical source missing, base changed, wrong site, corrupt ref or Signal metadata | Ineligible or refused          | Entire Incident unavailable                           |

Readers verify every retained Signal's actual owner, canonical evidence and
`info`/`external`/null-score metadata, then all actual report/Event/Member sources.
An accessible subset never grants Incident review. Resolution before filing is
invalid. Physical absence does not imply a deletion status or retention outcome.

`GET /api/admin/agents/incidents/{id}/member-report-evidence` is a separate bounded
read operation. Missing installation returns 503. The pure
`np.agent-incident-member-report-evidence.v1` wire returns at most ten Events per
page, their Signal IDs, recorded claim/time/status and current global Member
status/update/version plus site report resolution. It excludes reporter/profile,
reason, report ID, raw Event, ban data and execution input. Every item has
`responseEligible: false`. Existing content wire remains strict and unchanged.
Current authorization, Incident generation and all source/current facts bind
signed continuation; access, version or source drift clears review state.

Studio separates filed and current facts, labels external claims with no score,
and offers no account or content response target. Existing human investigation
and closure remain available through their existing owners. No feedback-based
spam quality label is inferred from an abuse Incident. Even when a content
response owner is installed, member review projects no content response.

## Acceptance and remaining scope

Local acceptance on 2026-10-14 KST, based on `45fb68bf` (merged PR #1535).
The preceding PR's main CI and Release both succeeded before this bundle.

- `pnpm verify --concurrency=2`: 113 successful tasks, including Core 2,336,
  shared App 696, Admin 191, CLI 157 and Web 164 unit cases. Repository checks
  passed all 62 cases. `pnpm lint`: 41 successful tasks.
- Focused pure contracts: 15 cases, including nine new member contracts and six
  canonical Event cases. Shared Incident HTTP: 53 cases. App/Admin checks and
  separate browser/integration test-inclusive TypeScript checks passed.
- Actual PostgreSQL 18: Core 63 cases across ten suites; Web 141 cases across
  21 affected suites, without skips. Web includes all nine new member cases,
  existing Incident/source/write/workflow/response regressions, five theme cases
  and the explicitly enabled native preview browser case. A separately isolated
  nine-case member run confirmed the same coverage and is not added to 141.
- New DB cases exercise actual report/Event rollback and duplicate races,
  claim-only grouping/replay, current report/account drift, bound pagination,
  same-site source visibility, missing/corrupt/recomputed references, impossible
  resolution chronology, tampered Signal score/basis/severity, live authority
  rollback, 100/101 raw Event capacity, cross-site global Member lock order and
  observer-reset dismissal with the target also acting as resolver.
- Redis 7.4.7: all 16 cases passed on an isolated local server.
- Production browser: 19 distinct Incident journeys passed across 18 initial
  successes and the corrected new journey. The new case covers global account
  versus site resolution, unavailable facts, signed-cursor/version/access drift,
  no account/content action choices, zero Agent POSTs and the visually inspected
  320px layout. Browser HTTP fixtures test the strict consumer wire; actual
  persistence and proof are covered by the separate real DB tests.
- Fresh scaffold: 40 public package tarballs, 50 successful stages including
  installation, Member source/writer/bootstrap exports with no automatic work,
  strict member wire and original content refusal, unchanged V3 offline replay,
  configuration-inclusive typing, generated new Event checks, production build,
  operations journey, actual migrations and Agent foundation/disabled-runtime
  checks. Ten installed Core/Admin/App files match producer bytes exactly.
- Self-review and independent review passed; changed formatting, bounded document
  links, generated snapshot preservation and `git diff --check` passed. Original
  Moderator V1/V2 suite and artifact hashes are unchanged. Only the new Event
  allowlists changed in the schema snapshot; generated collection files retain
  their original bytes. Versions, changesets, lockfile and the user's pre-existing
  handoff edit remain unchanged.

Initial failures were confined to test/verification setup: canonical shared
object fixtures, member handle length and required fixture types, the Admin
aggregate fingerprint's expected value, a browser error fixture missing its
required HTTP status, and the final scaffold comparator using an unbuilt App
path. They were corrected and affected checks passed; already successful stages
were retained. The comparator checks published raw App source paths alongside
built Core/Admin exports. No product rebuild was needed for the browser fixture.

These are affected-slice checks and do not establish the full R6 gate or
real-model quality. Member restriction policy, any approved account response
workflow, external delivery and model-quality acceptance remain separate work.
