# R6 Incident notification recording recovery

A verified, rolled-back quarantine failure remains a stored failed outcome even
when its local Admin notification cannot be recorded. An explicitly installed
recovery owner now preserves bounded retry work beside that outcome. It never
repeats quarantine, consumes another approval, delivers externally or changes
Incident response authority.

## Explicit installation and source admission

The host opts into `createAgentIncidentNotificationsServiceV1` with
`recoverFailures: true`, supplies the current failed-action target review owner,
and passes the same notifications owner to the Incident writer and Studio.
Without that option, existing immediate recording and isolated failure behavior
remain unchanged and no recovery methods are exposed.

Only a new high/critical `containment_failed` source entry admitted by the
existing writer is marked for recovery. Initial admission rechecks its current
Incident version/status/severity and the existing actual Action, canonical
proposal/output, execution invocation and rolled-back audit proof. Approval
failures, uncertain effects, lower severity and unmarked historical entries do
not become recovery work. Execution replay returns its existing outcome before
notification admission; it cannot reset the retry budget.

The source failure and Incident version remain authoritative. Recovery uses the
existing `notification` timeline kind for an append-only private journal, with
no schema, migration or parallel application pool. Each journal entry binds a
purpose-separated canonical digest to the frozen site, Incident, source timeline,
transition version, severity/status, Action, audit, execution, source fingerprint
and observation time. These facts are rechecked against their owning evidence
before any attempt or visible projection.

## Atomic local recording and bounded maintenance

Initial admission stores pending work at attempt zero before trying local
recording. The Admin notification and a verified sent journal entry commit
inside one savepoint. A recording failure rolls both back and appends the fixed
`NOTIFICATION_RECORDING_FAILED` code with the next eligible time. The original
quarantine failure survives that savepoint rollback. If even the recovery
journal cannot be persisted, the writer isolates that failure too and Studio
cannot claim recorded recovery work.

There are at most five recording attempts in total, including the immediate
attempt. Delays after attempts one through four are 30 seconds, two minutes,
ten minutes and thirty minutes. The fifth recording failure stops recovery.
Invalid or changed owning source evidence instead stops with
`SOURCE_EVIDENCE_INVALID`; corrupt journals are never repaired or used to
fabricate notification evidence. Unknown database errors while checking the
source remain unavailable job failures rather than invented proof failures.

Recovery reuses site controls and the Incident lock before allocating timeline
sequence numbers. A bounded scan visits at most 25 explicitly marked source
entries per site, advances a persisted UUID cursor and resets it at the end so
later or earlier sources remain reachable. Not-due, terminal and invalid entries
do not reset another source's budget. Canonical site-scoped cursor state is
private; empty/default sites do not acquire it simply from scanning.

The host may pass `incidentNotifications` to its existing
`createAgentRuntimeJobsV1` installation. Its existing fair site reconciliation
then invokes the optional `recover({ siteId })` owner with that persisted site
context; failure is sanitized and does not suppress independent pending Run
or Event enqueue attempts. Construction registers or starts nothing. There is
no new job type, worker activation, credential or provider call.

The existing site/channel/Incident-version/transition deduplication key and
canonical Admin receipt remain unchanged. Retry uses the original observation
metadata even after later Incident changes; the ordinary `record()` seam still
requires a fresh current transition. Concurrent recovery serializes and a
terminal sent journal requires the exact retained, verified local receipt.

## Authorized Studio state and retention

Studio filters private recovery journal rows before timeline pagination and
annotates the original verified failure entry with only state, bounded attempt
count, last/next attempt time and a fixed error code. Current Incident and Action
target visibility are required. Missing, denying or failing target review,
changed source proof, malformed journal or a missing/invalid sent receipt cannot
produce a claimed recovery state. Reads neither persist nor repair work.

An absent optional field means no installed recovery owner; null means recovery
evidence is unavailable. Pending means retained work eligible for host
maintenance, not a running worker. Sent means local Admin recording, not
external delivery. Admin reuses the existing refresh flow and adds no execution
or retry authority.

The original timeline and journal retain their same-site Action references and
logical execution/audit/source references. Existing Runtime retention considers
all site-owned timeline JSON references, so required source evidence remains
pinned. This slice adds no Incident/journal pruning or new retention exception.

## Verification and remaining boundaries

Local verification passed:

- `pnpm verify --concurrency=2`: all 113 tasks, including Core 2,295, Admin 191,
  App 686 and Web 164 unit cases. The companion workbench fixture correction
  passed in this full Core run.
- Final `pnpm lint`: all 41 tasks. The first lint runs retained diagnostics from
  incomplete dependency declarations during rebuilding; fresh focused checks
  passed, and clearing only the affected Admin lint cache produced the final
  complete pass. No source suppression or lint rule change was introduced.
- Affected PostgreSQL: 51 cases across six selected suites, including the complete
  24-case execution suite, corrected five-case Runtime job suite and existing
  notifications/Studio/workflow/evidence suites. Real notification INSERT failures
  used a temporary database constraint removed in `finally`; hooks established
  the actual rolled-back quarantine. Coverage includes due times, concurrent
  recovery, preserved execution facts, frozen later history, five-attempt stopping,
  ACL denial, invalid proof/journal/receipt and no historical backfill.
- Production Chromium: all 16 Incident journeys, with zero retries or skips.
  The existing failed-response journey now verifies pending recording and a
  refreshed sent state. Reviewed 390px/1280px captures have no horizontal
  overflow or clipped recovery fields.
- Fresh packed consumer: all 40 public packages and 46 stages, including isolated
  installation, installed pure contract and explicit owner construction,
  configuration-inclusive typecheck and production build. The selected shipped
  Core and Admin artifact bytes matched the final producer.

Initial integration failures were fixture conditions: multi-site scan counts,
resolved-state metadata, authorization expiry and duplicate fixture site creation.
They were corrected without weakening product checks or increasing deadlines.
Changed-file formatting, relative documentation links, independent read-only
review, preservation of the preexisting handoff and `git diff --check` passed.
The isolated database used PostgreSQL 18.3; hosted CI uses PostgreSQL 16.

Three opt-in live Redis checks remained skipped because no Redis fixture was
available. Standalone theme/native-preview gates and full PostgreSQL/browser
inventories were not rerun for this local recording slice. Hosted CI for the
current bundle is not established before commit/push. These limits do not close
full R5/R6 acceptance.

External notification transports, automatic escalation, unmarked historical
backfill, unknown execution outcomes and journal pruning remain separate work.
Versions, changesets, lockfile and migration sources remain unchanged.
