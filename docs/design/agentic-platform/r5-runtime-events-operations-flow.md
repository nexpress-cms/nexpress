# R5 Runtime events and operations

This slice implements AP-503 event/trigger/schedule dispatch and the related
AP-508 queue recovery, bounded diagnostics and conservative retention foundation.
It extends the existing Runtime admission and Run executor. AP-507 management
surfaces, the remaining AP-508 scope and full R5 acceptance remain open.

## Ownership and activation

The host explicitly constructs the event service and installs the six Runtime
job handlers through the existing worker registry. Installation does not start a
worker, register an automatic schedule, enable Runtime, create an Agent or call
a provider. An absent service remains unavailable. Global jobs require an explicit
`coordinationSiteId`; no ambient default site becomes a coordination authority.

Triggers bind one real active Agent/version. Only selected, retained recipes
whose `triggerKinds` include the source are eligible. The current executor still
requires the installed `interactive-capability` task. R6 detector, target recipe
and integrity-signal execution is not synthesized from a recipe name. Existing
Run authority, delegation, policy, budgets, item access and approval owners remain
authoritative.

## Events and triggers

The existing canonical event envelope owns the exact kind, payload, privacy and
source inventory. Recording hashes canonical bytes and uses the existing
site/source/kind/deduplication key. Identical replay returns its durable id;
conflicting bytes fail closed. Expiry is bounded to 14 days and replay does not
extend it. Provided causation must match the same site's parent Run, root, depth
and source action. Admission increments that exact depth, without choosing a
different ancestor or resetting it. Trusted source adapters remain responsible
for supplying causation; valid canonical root events are not rewritten.

Trigger registration requires an explicit enabled boolean and immutable version
binding. There are at most 100 trigger rows per site, including disabled and
historical rows. The exact event filter reuses only approved fields and bounded
equality, membership, integer comparison and logical operations. Arbitrary code,
regex and event prose are not predicates. A replay cannot change a trigger's
Agent/version, definition or enabled state.

Dispatch captures the complete bounded site trigger inventory and admits each
trigger/recipe in its own transaction. Successful Run progress survives another
candidate's current authority or budget denial. A final site-locked inventory
recheck marks the event dispatched only when every captured candidate resolves
and the trigger inventory remains unchanged. Unresolved events remain pending,
while already admitted Runs are notified and recoverable. Stale or inactive Agent
versions are counted as skipped. Coalescing partitions by trigger, recipe, fixed
recording-time window, exact subject and causal parent/action. A zero window
uses the individual event id. The first admitted event reference remains frozen;
subsequent coalesced events do not overwrite its evidence.

The existing Run stores `triggerId`, bounded event id/hash reference, and exact
lineage before its admission fingerprint is computed. Direct admission validates
the source against current persisted trigger/event evidence and the same recipe,
authority and budget path. Queue notification occurs after commit. Failed or
missing queue delivery leaves a durable queued Run for reconciliation.

## Schedule outbox

A validated five-field UTC cron uses the existing parser. `skip` discards older missed
occurrences and admits the matching current UTC minute, so a bounded global
revisit does not starve frequent schedules; `once` admits at most one occurrence per
trigger/recipe before advancing. Each recipe admission commits independently, so a bad row or a one-Run
concurrency budget cannot roll back healthy progress. Once any Run exists, the
chosen occurrence remains frozen across retries, including later UTC minutes.
A final locked definition/recipe inventory check advances the occurrence only
after all recipe admissions resolve. A fixed cursor advances over attempted
rows, while a failed row retains its due occurrence for a later sweep.

The earlier planning text described a normalized schedule event. The closed
canonical event inventory contains no schedule kind. This implementation uses
the existing Run as the schedule outbox: `triggerId` and exact `scheduledFor`
reference are frozen at admission. Existing Run rows retain per-recipe
progress, and `nextRunAt` advances under the shared site lock only after the
complete selected recipe inventory resolves. It adds no synthetic event kind, event table or migration.

## Jobs and recovery

| Job                    | Exact payload         | Owner                             |
| ---------------------- | --------------------- | --------------------------------- |
| `agent:eventDispatch`  | `{ siteId, eventId }` | Site event admission              |
| `agent:runExecute`     | `{ siteId, runId }`   | Existing Run executor             |
| `agent:eventReconcile` | `{}`                  | Bounded global recovery fan-out   |
| `agent:scheduleTick`   | `{}`                  | Bounded global schedule selection |
| `agent:retentionTick`  | `{}`                  | Bounded global retention fan-out  |
| `agent:retentionPrune` | `{ siteId }`          | Site retention sweep              |

Site jobs validate their closed payload before enqueue and dispatch and resolve
the same explicit site for the entire handler. Global traversal stores bounded
private cursors under the explicit coordination site; site cursors live in
private Runtime operations settings excluded from content transfer. A bad
candidate does not pin subsequent candidates behind it. Initial Run job quota
accounting uses the existing audit receipt in the admission transaction; queue
redelivery does not charge another optional-work admission.

Retention removes only expired, dispatched events with no retained reference.
Unresolved Runs, action evidence, causal links, approvals and other retained
objects continue to fence deletion. This is not a claim that the complete R5
retention or Admin readiness product is finished.

## Self-review corrections

Review and actual PostgreSQL execution found and corrected these issues before
acceptance:

- Partial event and schedule admissions formerly rolled back healthy siblings
  under concurrency budgets. Per-recipe Run progress now survives retries.
- Frequent `skip` schedules could starve during bounded site traversal. Selection
  uses the matching current UTC minute until an occurrence starts, then retains
  that occurrence until all selected recipes resolve.
- Empty cursor end pages now persist their reset, so lower ids become eligible.
- Source unions reject a supplied event id on manual/schedule admission even
  when the referenced event does not exist. Canonical causation must equal all
  four stored lineage columns; Doctor also detects stripped projections.
- All event/trigger/schedule mutators reuse the existing preview effect guard.
- Agent payload parsing and handler failures have a fixed safe outer queue error.
- Actual worker tests exposed obsolete private pg-boss database access and reads
  from a removed archive table. The adapter now uses the supported database API
  and current retained-job storage. Existing live/archive projections represent
  active/terminal lifecycle partitions; real PostgreSQL tests cover list, count,
  quota, plugin statistics, cancel and retry behavior.

## Verification checkpoint

| Gate                                                                 | Current status                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Exact contracts, fingerprint and hostile inputs                      | Passed within Core 1,894 unit cases                                                                           |
| Event sources, schedules, worker recovery, retention and diagnostics | Passed; corrected PostgreSQL suite 71 cases across 9 files                                                    |
| Core PostgreSQL                                                      | 68 passed, including actual pg-boss storage and worker behavior                                               |
| Full web PostgreSQL                                                  | 1,400 passed; one stale-build worker failure passed in the corrected suite, covering all 1,401 ordinary cases |
| Workspace lint                                                       | 41 tasks passed                                                                                               |
| Workspace typecheck/unit/build                                       | 113 tasks passed, including the reference app build                                                           |
| Live Redis and theme rendering                                       | Redis 16 and theme 5 passed                                                                                   |
| Native preview                                                       | 1 browser case passed                                                                                         |
| Production Playwright                                                | 62 passed                                                                                                     |
| Packed fresh scaffold                                                | 40 packages / 56 stages passed                                                                                |
| Format, self-review, diff, versions and secrets                      | Passed; changed/new files, verification logs and 56 packed logs scanned with zero configured-secret matches   |

The full web run used the pre-correction Core build and exposed the same obsolete
pg-boss private access as the Core worker test. After rebuilding, all 71 targeted
cases passed, including WordPress import, job management/logs, theme rendering
and the final Runtime source/diagnostics tests. The full suite's gated native
preview case ran separately and passed. The ordinary workspace's three gated
Redis integration cases also ran against an ephemeral Redis instance as part
of its complete 16-case suite.

An initial workspace attempt encountered a broken npm installation in the
external temporary Node 22 toolchain. Restoring the exact official distribution
after checksum verification resolved the CLI's seven tests without a repository
change or relaxing its safe output boundary. The successful workspace run
reported a final Turbo cache-write warning because local disk space was low;
removing only older ignored, regenerable Turbo cache files recovered about
20 GiB without changing source or build outputs.

No package versions, changesets, lockfile, database schema or migrations changed.
The first PR CI run exposed a separate connection-lifecycle fixture isolation
issue: a reused PostgreSQL worker retained a Runtime usage invocation, and the
connection assertion selected by operation alone. The lifecycle suite now also
truncates before each test and selects evidence by site, operation and exact
idempotency key. A shared-worker shuffled run of both suites passed all 29
cases; the changed test also passed lint and formatting checks.
These are local implementation results; hosted CI is verified separately during
the PR and merge workflow. AP-507 management surfaces, broader retention and the full R5 gate
remain later work. Host installation and source adapters remain explicit.
