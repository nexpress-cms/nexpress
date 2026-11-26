# Agent retained queue backlog observations

This extends [worker queue observations](agent-worker-queue-evidence.md) with
read-only retained pg-boss facts in Health and Doctor. It does not establish
processing progress, stuck execution, tenant-specific state, current adapter
selection, required subscriptions, provider readiness or full R5 acceptance.

## Ownership and compatibility

`jobs/agent-queue-backlog.ts` owns the canonical pg-boss storage read using the
existing root DB handle. Doctor passes its original connected Client through
Drizzle. No producer, worker, provider or second pool is initialized. The pure
`jobs-contract/agent-queue-backlog-contract.ts` v1 envelope is additive; existing
worker health versions, heartbeat metadata, Jobs adapters and list/count APIs
are unchanged. Custom adapter data is not inferred from pg-boss storage.

The proposed optional adapter extension was unnecessary for this persistence
view: read-only Health and Doctor must work without installing an enqueue
adapter. The explicit `source: pg-boss` identifies the inspected storage even
when a different adapter is used elsewhere. Absence of `pgboss.job` is
`unsupported`; incompatible schema, permissions, malformed clocks and failed
reads are `unavailable`. Both return null facts, never manufactured zeros.

## Counts and time meaning

The exact envelope has one ordered row for each of the nine known Agent queue
names. Counts span retained live jobs across the host, including all sites.
Completed, failed, cancelled, expired, unrelated queues and removed history are
excluded. This is not a history ledger or a tenant attribution mechanism.

| Fact              | Definition                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Created ready     | Created jobs whose `start_after` is at or before the DB aggregate statement timestamp       |
| Created scheduled | Created jobs whose `start_after` is after that timestamp                                    |
| Retry ready       | Retry jobs whose current `start_after` is at or before that timestamp                       |
| Retry scheduled   | Retry jobs still waiting for their stored retry time                                        |
| Active            | Jobs stored as active                                                                       |
| Oldest ready age  | Whole elapsed seconds since the earliest ready `start_after`, across created and retry jobs |
| Oldest active age | Whole elapsed seconds since the earliest active `started_on`                                |

The `<=` boundary matches the resolved pg-boss 12.32 fetch predicate. An old
creation time does not make scheduled work overdue. Dependencies, priority, concurrency,
locks, policies and worker availability may still prevent dispatch; due time
alone does not promise execution. Active age is not evidence of useful progress.
Observed empty categories have zero counts and null ages (no matching jobs).
Unmeasurable active clocks make the entire observation unavailable rather than
silently omitting jobs. No payload, output, job ID or raw failure text is returned.

## Query and presentation bounds

One grouped read returns at most nine rows. It aggregates all matching retained
live rows rather than approximating the oldest from a newest-first page.
The read-only transaction applies a 500 ms statement timeout, or the existing
shorter timeout, and restores the original setting on success; rollback restores
it on failure. This bounds SQL execution, not pool acquisition or all wall time.
Large or locked stores may be unavailable rather than return partial counts.
The fixed known-queue filter and exact validator bound the output.

Health and Doctor share labels, validation and limitations. The new Health
section uses named queue regions, responsive definition lists and the existing
Refresh action. Legacy summaries without this additive field show unavailable
facts. Doctor preserves the existing persistence check ID and severity; these
optional observations do not grant readiness or authority.

## Verification

- Contract tests: 2 passed. Focused App tests: 39 passed. PostgreSQL: 9 passed
  across the new backlog suite and corrected worker lifecycle suite, with no skips.
- Final `pnpm verify --concurrency=2`: 113 tasks passed (3 cached), including
  Core 2,126, App 588 and Web 174 unit tests. Existing opt-in Redis units retain
  13 passes / 3 skips; no broader Redis integration result is claimed here.
- Final lint: 41 tasks passed (39 cached). Production browser: 88/88 passed,
  no retries/skips, 2.5 minutes. Six backlog captures at 320/768/1280 light/dark
  were inspected for clipping and overflow. They show actual unsupported storage;
  mixed/empty/unavailable facts have server-render and real PostgreSQL coverage.
- Forty fresh tarballs supplied an independent consumer: install, typecheck,
  production build and operational journey passed. Core 438 / App 203 dist files
  and five changed App runtime sources match packed and installed bytes. The
  consumer resolved Next 16.3.6; the workspace remains unchanged at 16.3.4.
- Formatting, local documentation links and `git diff --check` passed. Browser
  generated media was moved to task-owned temporary artifacts. Logs and consumer
  output use `/tmp/np-backlog-*`.

This does not repeat the full extension/migration scaffold matrix, broader theme,
Redis or native-preview integration gates. Spoken assistive-technology and full
R5 acceptance remain open.

Review corrected the SQL array parameter expansion and matched the resolved
pg-boss due boundary (`<=`). The aggregate statement clock is shared by counts,
ages and generatedAt, avoiding a false future-clock failure when a job starts
between transaction setup and the aggregate read. Real PostgreSQL validation
was repeated after both corrections. The pure validator also rejects state
coercion and private/malformed fields.

The bundle also fixes the preceding worker lifecycle integration fixture's
wall-clock race. Date alone is fixed while real heartbeat interval and PostgreSQL
timers run normally; future evidence remains unknown in the product collector.
Existing lifecycle assertions are preserved.
