# Explicit external Incident notification delivery

## Scope and installation

AP-604 adds an optional durable external outbox to the existing
[local Admin notification owner](r6-incident-notifications-flow.md). No transport,
connection, credential, Runtime, worker or schedule is installed automatically.
The reference/scaffold remain disabled by default. This bundle exercises fake
transports only; it does not send email, Slack, webhook or SIEM messages.

The host supplies the existing Connection/vault services and adapter registry,
an explicit installation cutoff, trusted route selection and current recipient
and policy resolution. The optional notification facet belongs to the same
immutable adapter id/version/fingerprint as authentication and destination
projection. Its channels, idempotency declaration and callbacks are frozen at
registration. Missing facets cannot send.

The new Incident delivery view is read-only. It has no send, retry, connection
creation or credential form. Existing local feed/recording recovery contracts
remain separate from external delivery confirmation.

## Frozen routing and current admission

Only a verified existing local Admin notification can become a delivery source.
The owner reproduces its canonical digest, exact source transition and fixed
metadata payload. The installation cutoff excludes historical backfill.
At most eight trusted routes are selected once. A durable routing timeline marker
prevents replays or later configuration from adding another destination to the
same source. Queue admission shares the source transaction through an independent
savepoint: outer rollback drops both records; optional routing failure preserves
the local notification and remains eligible for explicit recovery.

Each external row freezes the exact Connection config snapshot, adapter identity,
account-subject tuple, destination descriptor/key/HMAC and adapter idempotency.
The current recipient session is separately fingerprinted. Neither model output,
job payload nor notification content chooses recipients or credentials.
The existing current Incident reader checks recipient ACLs; resolved policy
channels, severity, category and collection restrictions apply across the whole
canonical Signal/Event source union. The fixed metadata payload is classified as
`internal-redacted`, so a `public-only` policy or Connection ceiling cannot send it.
Failed-containment sources also require current Action visibility.

Connection owns destination verification and retained key resolution. Before a
lease and again before dispatch, it reparses immutable/current config, reproduces
the descriptor and HMAC, verifies current ready/probe/secret facts and compares
all frozen fields. Same-destination credential rotation uses the new current
secret; destination/account/config drift suppresses the old delivery. No key bytes
or plaintext credential resolver is added. The ordinary vault lease must be
disposed after every attempt.

## Durable attempts and recovery

The existing `agent:eventReconcile` owner optionally scans a bounded site batch
and registers `agent:notificationSend` only when explicitly given this delivery
owner. Jobs contain exactly `siteId`, `notificationId` and `expectedAttempt`;
their registered site resolver ignores ambient request context. No scan/send is
performed during a read or factory construction.

Creation persists an outbox row. The explicitly registered sweep enqueues only
committed rows, including sources whose original routing or enqueue notification
was lost. Durable per-site cursors advance before I/O and wrap fairly. This
design deliberately uses the sweep rather than assuming every caller supplies a
post-commit callback scope; a new row can wait until the next sweep.

Claim uses the persisted attempt/state CAS before credential I/O. Dispatch is
bounded to ten seconds; at most five attempts use fixed delays of 30, 120, 600
and 1,800 seconds. Only a validated `confirmed` result reaches `sent`. A proven
pre-dispatch failure remains not-sent and may retry. A throw, timeout or malformed
transport result after dispatch is ambiguous. Ambiguous results retry with the
same deduplication key only when the frozen adapter enforces downstream
idempotency; otherwise they become terminal unknown failures for review.

Stale `sending` attempts recover conservatively as ambiguous after their bounded
deadline/grace. Late results cannot replace a different attempt or terminal row.
A confirmed result is retained for its frozen attempt even if authority changes
after the external effect. Delivery result digests retain the exact immutable
observation time; row state, attempt, error and retry clock must agree with that
receipt before dispatch or projection.

The existing site/control fence precedes Incident/notification/source locks.
Final result persistence retains the site/deletion lock order without reapplying
new-work controls after an effect. Transport and vault I/O occur outside database
transactions. Delivery updates
append bounded notification timeline facts without changing Incident status or
granting moderation authority.

## Visibility and retention

`GET /api/admin/agents/incidents/[id]/deliveries` uses existing staff admission,
read initialization and no-store headers. A cursor is bound to the current
site/session/authority and Incident. Reads independently check current complete
Incident/Action visibility and canonical result integrity. They expose bounded
channel, connection id, state, attempt, safe error and timestamps. They exclude
recipient addresses, destination descriptors, provider receipts, credential
references and canonical execution bodies. Hidden rows can produce an empty page
with continuation; no total is inferred.

The Incident panel distinguishes pending, confirmed, not-sent, unknown and
suppressed results. Access loss clears the detail and requires explicit recovery.
It does not poll or perform a mutation.

External queued/sending/unknown records remain retained. A local source receipt
referenced by any external row cannot be pruned independently. Existing snapshot,
Connection and Incident references continue to protect dependent evidence. A
broader terminal external-delivery retention policy remains separate. Legacy site
cascade deletion rejects queued, sending, missing-proof and unknown external
deliveries, and rolls back the whole deletion without creating a deletion saga.

## Verification and limits

Local verification on 2026-10-16 KST is recorded against the frozen implementation working tree:

- `pnpm verify`: 113 tasks passed, including 62 repository checks and 2,424 Core
  unit cases. `pnpm lint`: all 41 tasks passed without relaxing rules or heap
  settings. The final Core and test-inclusive TypeScript checks also passed.
- Focused contracts/job registration: 26 cases passed. Shared Incident HTTP:
  71 cases passed. Pure contracts reject unbounded attempts, false confirmation,
  secret-bearing shapes and malformed transport results.
- Focused real PostgreSQL: the two new delivery/deletion files passed all 26
  cases; existing local-notification and source-monitor files passed 12 cases.
  They exercise real Connection/vault/configuration owners with fake transports,
  concurrent replay, rollback, exact retry exhaustion, ambiguous/stale attempts,
  current secret rotation, destination/config/account drift, pre/post-lease
  admission, whole canonical Event/Signal resource limits, recipient changes,
  post-dispatch result convergence, source-retention references and cascade
  deletion rollback. Invalid fixture clocks/categories/Event kinds and generic
  queue-payload assertions were corrected without weakening product guards.
- Core PostgreSQL: 63 cases passed. Explicit live Redis: 16 cases passed; root
  unit opt-in skips do not substitute for that live run.
- Production browser: 128 journeys passed with no retries or skips. The new
  delivery journey covers unknown/confirmed results, pagination, unavailable
  service and complete access-loss clearing. Captures at 390/1280px were inspected
  without clipped controls or horizontal overflow.
- Full Web PostgreSQL: all 1,785 test bodies passed across 208 files, including
  the five theme-render cases and explicitly enabled native preview. The initial
  command returned failure because the reference-fence protocol file timed out
  in `afterAll` while its `DROP DATABASE` waited for a shared-cluster checkpoint;
  the other 207 suites passed. That test-only fixture now places its independent
  database in the existing run namespace, closes all clients in `afterAll`, and
  lets existing global teardown remove it after workers stop. The corrected file
  passed all 28 cases and global cleanup, and its owned DBs were confirmed absent.
  This is complete full/corrected-run coverage, not a claim that the original full
  command returned green. No product source, assertion or timeout changed.
- Forty freshly packed packages passed all 60 installed-consumer stages:
  isolated installation, notification contract imports, configuration-inclusive
  typecheck, schema generation, production build, extension matrix, operations
  journey, fresh database migration and Agent foundation. Installed Core agents,
  pure contracts, Admin client and App handler/new delivery route bytes matched
  producer artifacts. An initial scratch-only import incorrectly assumed the
  private Incident HTTP decoder was a public App lib subpath; that probe was
  corrected to use supported contracts and the actual scaffold route. Checks
  resumed from typecheck with the same frozen tarballs; no public export changed.

Independent implementation review was collected and addressed before the full
code gate. Product sources stayed frozen during the final checks; the final reference-fence
cleanup change was test-only and its TypeScript/format/affected PostgreSQL checks
passed. Versions,
changesets, lockfile and application schema/migrations are unchanged. The existing
handoff is preserved; this bundle does not create another handoff.

Logs use `/tmp/np-notification-*`, including `final-verify`, `final-lint`,
`final-corepg`, `final-webpg`, `final-redis`, `final-browser` and the initial/resumed
installed-consumer logs.

The post-merge main CI for PR #1539 passed. Its Release workflow failed because
the separately generated Version PR reused a worker database containing pg-boss
storage in a test that assumed storage was absent. The affected fixture now
explicitly removes that worker-local schema while preserving its unknown-state
assertions. No production reader, migration or release version was changed.

Actual channel integration, recipient configuration, real external delivery,
model/Runtime trials and production automatic-quarantine qualification remain
outside this bundle. The optional extension does not establish full R6 model or
operating acceptance. Versions, changesets, lockfile, schema and migrations remain
unchanged.
