# R6 Incident manual severity escalation

An authorized administrator can raise an active Incident's severity after
recording a bounded human explanation. The existing Moderator detector still
emits medium-severity advisory observations; it does not infer new thresholds.
This change is bundled with the [confirmed containment failure flow](r6-incident-containment-failure-flow.md).

## Write and review boundary

The existing Incident workflow owns the mutation. Its read snapshot supplies
only higher `availableSeverities`; missing older-host fields offer no operation.
Resolved and dismissed Incidents have no choices. Equal or lower severity,
blank or oversized notes, stale versions and injected authority are rejected.
The note is trimmed plain text of 1–2,000 characters.

`POST /api/admin/agents/incidents/{id}/severity` decodes
`np.agent-incident-severity-input.v1` through the shared App handler. Reference
and scaffold routes are wrappers. Registry operation `agents.incidents.escalate`
reuses staff admission, current Incident/target visibility, version CAS,
idempotency and audit. There is no new execution capability or policy authority.

The mutation changes severity, version and update time; status, assignments,
approvals, content and containment remain unchanged. A staff `human_note`
records the before/after severity and reason. Source invocation, audit and
recorded transition facts bind the readable decision and notification to the
actual mutation. The UI shows human judgment separately from detector evidence.

Exact retries recheck current access before returning the original result.
Active-state and upward-only conditions apply to new mutations, allowing an
already completed request to replay after later escalation or closure. Unknown
responses retain the exact command and key; conflict requires a fresh read,
and access loss clears the displayed detail.

## Notifications and limits

A recorded escalation to medium, high or critical creates the fixed local
summary `Incident severity escalated.` with the actual unchanged status and
resulting severity. Escalation to low has no notification. Notification identity
includes the persisted Incident version; replay does not duplicate the source
history or notification. Free-text reasons do not enter the notification feed.
The escalation and its installed notification write commit atomically.

Existing approvals remain necessary for quarantine. A manually raised Incident
can subsequently produce a confirmed failure notification only through the
separate verified rollback owner. Manual severity never executes that action.

Automatic escalation policy, external delivery, unknown execution outcomes,
failed restoration and complete R5/R6 acceptance remain outside this slice.
No package version, changeset, lockfile, schema or migration changes are required.

## Bundled verification

Independent review tightened the exact staff Invocation/audit binding and the
active-status notification contract. Browser review found same-version refresh
could discard a draft reason and duplicate sibling keys could accumulate
evidence sections. Drafts now survive unchanged versions, and evidence/assignment
keys are distinct. Existing browser journeys verify these regressions.

Final bundled checks:

- `pnpm verify --concurrency=1`: 113/113 tasks, including Core 2,180 and
  App 641 unit cases. The first run reached 112/113 because Web's incremental
  type cache retained pre-build exports; a clean typecheck passed, and removing
  that derived cache produced 113/113. The final UI key correction was rebuilt
  and the complete command passed again with 101 cached tasks.
- `pnpm lint`: 41/41 tasks on final source.
- Affected PostgreSQL: 47/47 across six suites, including actual manual
  medium-to-high escalation followed by verified quarantine rollback,
  notification/history binding, CAS competitors, exact replay after closure,
  current access loss and atomic notification failure.
- Production browser: 16/16, zero retries or skips, rerun after the key fix.
  Four form/history captures at 390/1280px show one evidence section, readable
  judgment text and no horizontal overflow.

Fresh packed-consumer verification passed with all 40 public packages: isolated
installation, configuration-inclusive typecheck, generated schema/migrations,
Agent foundation, production build and operations journey. Installed Core, App
and Admin bytes matched the final producer. Source hashes remained unchanged
through final verification; formatting, local documentation links and
`git diff --check` passed. The existing handoff was preserved.

Dedicated Redis, theme PostgreSQL,
native preview and spoken assistive-technology acceptance were not rerun for
this slice; optional checks skipped by ordinary unit commands are not counted
as covered. These results do not close full R5/R6 acceptance.
