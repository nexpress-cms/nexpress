# R6 Operator operational observations

An explicitly installed Operator can inspect bounded Jobs and media-storage
observations and audit the running plugin registry through their actual owners.
This extends the [diagnostics flow](r6-operator-diagnostics-flow.md); approved
maintenance stays with the [execution owner](r6-operator-execution-flow.md).
No collector grants authority, repairs data or starts a provider or worker.

## Installation and authority

`npCreateAgentOperatorAppHostV1`, published at
`@nexpress/app/lib/agents/operator-host`, accepts optional `observationOwners`:

- `jobs: "pg-boss"` explicitly identifies the host's canonical queue source.
  Finding a table does not select a queue adapter automatically.
- `storage` supplies the installed adapter, a bounded `selectMedia(context,
maxTargets, collections)` callback and current `authorizeMedia` callback.
  The selector must honor the requested collection restriction and current
  media/referenced-item ACLs. An empty collection list permits the authorized
  site sample. Item IDs alone do not grant access.
- `plugins: true` enables registry audits. Current deployment permission is
  required before and after collection, at final return and on retained audit
  access. Existing deployment status also uses this bounded registry owner.

The host's existing `authorize` callback must grant current access to site
aggregate operational evidence, including retained results; media callbacks
add record and referenced-item checks during collection. Explicit custom
`scopedReaders`/`auditReaders` retain precedence and their existing ACL/evidence
responsibilities. New custom readers can report `targetCount` independently
of their number of evidence references; legacy readers retain that default.
Absent sources stay unavailable. Initialization remains the host's existing
`ensureFor` responsibility.

## Meaning and limits

| Family    | Actual source                                                | Bound and interpretation                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs      | Read-only canonical pg-boss rows                             | Newest retained 24-hour cohort, ten fixed framework queues, explicit matching `payload.siteId`, at most 1,000 rows and a 500 ms statement timeout. State counts and oldest due age describe that cohort, not throughput, all-time backlog or worker health. Global/custom/unattributed jobs are excluded.                       |
| Storage   | Existing media rows and `npStorageObjectExists`              | At most 100 selected records and 100 original/variant probes. Same-site ready rows and canonical record-owned keys only. Current authority and row versions are checked around probes and before release; changed observations are discarded. Completeness covers only the selected sample, not inventory or content integrity. |
| Plugins   | Existing in-process registry diagnostics                     | At most the remaining audit plugin budget, or 100 plugins for status. Oversized registries report unavailable coverage without running diagnostics. Results concern registration contracts, not plugin code security or external connectivity.                                                                                  |
| Backup    | Host-configured manifest directory                           | Status inspects at most 1,000 directory entries, 100 manifests and 64 KiB per manifest. Sequential capped reads reject oversized, malformed, symlink or special-file manifests. Recorded verification remains a manifest claim; status does not verify current artifacts or restore success.                                    |
| Readiness | Existing configuration and in-process collection diagnostics | Fixed configuration checks; no database, queue, network or external-service health claim.                                                                                                                                                                                                                                       |

Audit budgets count inspected Jobs rows, attempted storage probes (including
failed/discarded attempts), plugins and contract collections. Evidence strings
are not charged as targets. Partial observations never pass as complete.
Unsupported or failed Jobs observations retain unknown counts rather than
zero. Adapter errors and paths are not projected. In-flight storage requests
remain governed by the installed adapter's timeout; the existing Operator
execution timeout and abort checks cannot forcibly cancel arbitrary adapters.

## Retained transition progress

The App host's separate `progressDiagnostics: "pg-boss"` option explicitly
selects `npCollectOperatorProgressObservationV1`. Finding queue storage or
installing an observation owner alone does not enable this additional read.
It reads the newest retained rows whose latest `started_on` or `completed_on`
falls within a fixed 15-minute interval. An observed interval uses PostgreSQL
`statement_timestamp()` for both its end and its start; status text and audit
evidence include those exact source times. A fallback clock on an unavailable
result does not attest source freshness.

- With `observationOwners.jobs: "pg-boss"`, `ops.status` adds
  `operator.jobs.progress` for the ten fixed site framework queues. Attribution
  requires an object payload with an explicit matching string `siteId`.
  The current site/caller authorizer runs before and after collection and at
  final release. Custom, global and unattributed rows remain outside this scope.
- With `workerDiagnostics: "pg-boss"`, the same option adds
  `operator.worker.progress` for the nine deployment Agent queues. The host
  must independently grant current `authorizeDeployment` permission before and
  after the read and at release. Losing that permission withholds deployment
  evidence without withholding separately authorized site evidence.
- Each read inspects at most 1,000 retained rows with a statement timeout of
  at most 500 ms, preserving any tighter existing timeout. `audit.run` adds a
  separate site `operator.jobs.progress` check, sharing `maxTargets` with the
  existing snapshot and other families. Both samples charge inspected rows;
  evidence tokens are not targets. If the snapshot exhausts that budget, the
  additional read is omitted and its check remains unknown. Explicit custom
  audit readers retain precedence.

Started, completed, failed and cancelled row counts remain separate. A row can
contribute both a start and a completion; these are the latest timestamps still
retained on that row, not cumulative retry-attempt counters. Scheduled jobs with
no actual transition do not create progress evidence. Cancellation alone is
not evidence that a worker progressed. A complete retained sample with starts
or completions can report sampled progress; it does not verify capability effects.

Zero counts, partial samples, missing or incompatible storage, malformed clocks,
source database permission failures and timeouts leave progress unknown. Positive partial counts
describe only that bounded sample. Completeness concerns matching retained rows,
not rows already removed by queue maintenance. Neither zero nor positive counts
prove stalled workers, draining, readiness, throughput or complete history.
No baseline store, independent retention job, queue mutation or migration is
introduced.

## Retained evidence

The existing exact audit wire is unchanged. Concrete collectors write bounded,
fixed-format `observation:`, `basis:`, `coverage:`, `state:`, `complete:`,
`observed:`, `window-start:`, `queue:` and `fact:` tokens as applicable into
`checks[].evidenceRefs`. These are inline safe aggregate facts, retained in the
existing invocation output. The existing digest binds them to the site,
audit ID and exact request. Replay verifies that output and current authority.
They are not links to nonexistent snapshots; raw queue payloads, object keys,
plugin metadata and selected record versions are not persisted in this wire.
The private media result digest is not advertised as a retrievable artifact.
Existing invocation/audit references and retention remain responsible for the
receipt; no independent store, migration or purge job is introduced.

Progress checks use `observation:job-progress:v1`, a retained-timestamp basis,
site/deployment coverage, exact observation/window times, `window-seconds:900`,
state/completeness, `progress:observed` or `progress:unknown` and aggregate fact/queue tokens.
The site audit check is retained by the same invocation digest and current-access
owner. IDs, payloads and outputs are never projected. No reference pretends that
an independent snapshot artifact exists.

## Acceptance boundary

This supplies bounded operational sources and retained transition evidence for
AP-602. The [Operator recipe](r6-operator-recipe-flow.md) owns setup and planning;
the separate [unattended profile](r6-unattended-flow.md) owns explicit schedule
eligibility and Runtime orchestration. Whole-site inventory, backup restore
drills, custom queue support and real-model usefulness remain outside these
observations. They do not close the full R6 quality gate. The existing browser/API
output shapes and execution behavior are unchanged.

## Local verification (2026-09-30)

- `pnpm verify --concurrency=1`: all 113 tasks passed, including Core 2,194,
  App 660, Admin 174 and Web 174 unit tests and the reference production build.
- `pnpm lint`: all 41 tasks passed. Final repository checks passed 62 tests;
  modified-document links, formatting and `git diff --check` passed.
- PostgreSQL: all 13 cases in the new Jobs/media observation suites and existing
  Operator suite passed with an explicit isolated database. These cover actual
  pg-boss rows, canonical site attribution, bounds, timeout recovery, real media
  rows and variants, access revocation, concurrent row changes and retained
  Operator behavior. No PostgreSQL cases were skipped in this run.
- App tests use the actual plugin registry and diagnostic owner for registration
  failures, budget overflow and authority loss; real bounded manifest files
  demonstrate that recorded verification does not prove artifact existence.
- A fresh project outside the workspace installed all 40 packed public packages,
  imported the new Core functions and published App host, passed configuration-
  inclusive typechecking, generated/applied migrations to a fresh database,
  verified the Agent foundation (52 tables, 365 critical and 17 deferred
  constraints), and passed production build and the scaffold command journey.
  Installed Core Jobs/media and App host JavaScript/declaration bytes matched
  the verified producer files.

Redis integration (including three optional cases skipped by the ordinary unit
run), theme PostgreSQL, native preview and production browser suites were not
rerun for this server observation slice. The ordinary theme checks and packed
build do not substitute for those full acceptance gates. Versions, changesets,
lockfile, repository migrations and the pre-existing handoff edit were preserved.

## Focused progress verification (2026-10-15)

- App: 26 cases across the host, progress-projection and existing observation
  suites passed after independent review. They cover explicit installation,
  site/deployment separation, current authority, cancellation, zero/partial
  unknowns, bounded status text and shared audit target budgets. Unknown reads
  reserve their allocated inspection ceiling internally; their factual count
  remains unknown. Later sources cannot reuse that attempted budget, and custom
  readers keep their existing measured-count contract.
- Core and App test-inclusive typechecks passed. A focused Web test-inclusive
  typecheck included the new PostgreSQL suite, the unattended Runtime suite
  and their imported fixtures. Focused production ESLint, formatting and
  `git diff --check` passed.
- PostgreSQL: all three new progress cases passed with no skips in a separate
  isolated PostgreSQL 18 test cluster. They exercise actual pg-boss rows and
  partitions, starts/completions/failures/cancellations, site/deployment scope,
  unchanged source rows, empty/missing/incompatible storage, capacity,
  malformed transition clocks and timeout restoration.

These are focused contract/source checks, not real-model usefulness or the full
R6 gate. The earlier verification record above remains a separate checkpoint;
the coordinator records the complete bundle gate separately. This extension
adds no provider calls, activation, credentials, migrations, versions, changesets
or lockfile changes.
