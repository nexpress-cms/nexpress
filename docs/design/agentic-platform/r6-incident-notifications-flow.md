# R6 Incident Admin notifications

Incident notifications record supported persisted state changes in an Admin feed.
They preserve the status and severity at notification time while current Incident
permissions determine whether a viewer can see the notification and follow its
local detail link. They do not send email, Slack messages or external requests.

## Source and installation

Hosts explicitly inject the optional notification owner into the Incident writer
and human workflow service, and its read owner into Studio. No default bootstrap,
worker or provider is enabled. Notification reads never create or repair records.
A missing owner is unavailable, not an empty feed.

Only existing persisted source transitions are supported:

| Severity | Notifications                                         |
| -------- | ----------------------------------------------------- |
| Low      | None                                                  |
| Medium   | Incident opened                                       |
| High     | Incident opened or resolved                           |
| Critical | Incident opened, investigating, resolved or dismissed |

Correlation, feedback and assignment do not represent a new qualifying status
transition. Existing owners do not yet record material severity escalation or
failed-containment transitions, so this slice cannot produce those notifications.
Historical timeline rows do not establish exact prior version/severity snapshots;
installation does not invent a backfill from them.

## Local persistence and deduplication

The local Admin record shares the source Incident transaction. It uses the
existing notification table and canonical delivery contract: `sent`, attempt
zero, `confirmed_local`, canonical digest and no external adapter/connection
fields. Site, channel, Incident version and transition bind its identity.
New source timeline entries freeze the transition version and severity; recording
requires those facts to match the persisted Incident. An older timeline entry
cannot be reused with a later version. A matching replay cannot create another
notification or a time-based repeat.

The projection contains only server-generated summary, source identifiers,
recorded status/severity, version, timestamp and a bound local Admin path. It
excludes content, raw logs, author identities, credentials, provider prompts and
approval tokens. This installs no containment notification hook or external
transport; notification delivery cannot roll back a containment action.

## Read and Admin behavior

`GET /api/admin/agents/incidents/notifications` accepts only an optional cursor.
The feed is bounded and checks current staff authority plus the existing complete
Incident evidence ACL for every returned item. Hidden rows may yield an empty
page with continuation; no global or unread count is inferred from that page.
Stored canonical delivery integrity is verified before projection.

The feed appears with Incident review and remains independent of Incident list
filters. Recorded facts are labelled as historical notification facts; following
the link opens the current authorized Incident. Pagination, stale cursor recovery,
missing installation and access loss use the shared read helpers. V1 adds no
read/unread or notification-only acknowledgement state.

## Boundaries and verification

External delivery, severity-escalation and failed-containment source owners,
additional recipes and full R5/R6 acceptance remain separate. Versions,
changesets, lockfile and schema remain unchanged.

Independent review covered transition provenance, canonical deduplication,
current ACL filtering, safe links, optional installation and UI access-loss
recovery. It identified an older timeline/newer Incident version mismatch;
recording now requires the frozen source version and severity. The regression
uses the same status and severity with a synthetic later version, so only the
source-version check can reject it.

Local verification:

- `pnpm verify --concurrency=1`: all 113 workspace tasks passed, including
  Core 2,177 and App 638 unit cases (44 Incident HTTP cases).
- `pnpm lint`: all 41 tasks passed.
- PostgreSQL: all 42 cases across eight notification, Incident Studio/workflow/
  assignment/evidence and Moderator collection/persistence/execution suites.
  Five new cases cover transaction rollback, supported severity/transition
  policy, exact replay, historical facts with current visibility, forged
  metadata, cross-site access, hidden-page continuation and cursor expiry.
- Production browser: 13 unique Incident journeys passed without retries or
  skips (11 initial passes and two corrected-fixture passes). The initial
  failures were a now-ambiguous error locator and an inconsistent workflow
  fixture. Screenshot animation capture was then stabilized and that journey
  passed again. Product source was unchanged. Screens at 390/1280px were
  visually reviewed without overlap, overflow or clipped controls.

The final PostgreSQL regression and browser fixture corrections were test-only
changes after the full workspace gate; the affected tests and Web typecheck
were rerun. Initial lint against incomplete build output retained a stale type
error. A cache-free check passed; rechecking all shared App files exceeded the
configured 6 GiB heap and passed with a one-off 8 GiB limit. No lint rules or
repository memory settings were changed.

Fresh packed-consumer verification passed for all 40 public packages: isolated
installation, configuration-inclusive typecheck, schema generation/migrations,
Agent foundation, production build and operations journey. Installed Core agents,
App Incident handler and Admin client bytes matched the verified producer
artifacts. Changed-file formatting, documentation links and `git diff --check`
passed. The existing handoff was preserved.

This is affected-slice validation, not full R5/R6 acceptance. Dedicated Redis,
theme, native preview and spoken assistive-technology gates were not rerun;
opt-in unit skips do not count as integration coverage.
