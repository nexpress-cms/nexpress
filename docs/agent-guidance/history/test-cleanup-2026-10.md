# October 2026 integration reset cleanup

This test-only follow-up starts from `cb27fbc9` (PR #1543). It reduces repeated
database reset work while preserving the existing assertions, fixture sizes,
two-fork limit, deadlines and real multi-connection PostgreSQL boundaries.

## Reset ownership and storage

Eleven Web suites already reset after each case. They now reset once before the
first case rather than also before every later case. Their per-case teardown,
async drain and mock/collection/theme restoration remain in place. Their 99 case
expressions, including parameterized cases, are unchanged.

The private Core reset locks the current complete FK/inheritance closure, repeating
discovery under those locks. It skips rewriting an ordinary heap only when its
physical main fork is empty. Deleted/rolled-back tuples still require truncation;
owned sequences retain `RESTART IDENTITY`. Unknown storage remains included, and
custom `ON TRUNCATE` triggers select the original full command and trigger order.
The site cleanup remains in the same transaction. PostgreSQL durability settings
are unchanged.

Seven small real-DB regressions cover empty-parent nullable descendants, sequence
restart, old snapshots/deleted tuples, inheritance, trigger order, concurrent
writes/DDL, and atomic failure/identifier quoting. The existing cancelled-body
drain regression remains intact.

## Matched comparison

The comparison uses the same 17 Web files, 150 registered cases, Node runtime,
PostgreSQL 16.15 container and two-fork configuration. No build or other test job
runs alongside it. Both runs use fresh migrated namespaces and pass every case.
A private Vite loader supplies the original Core setup and eleven original suite
hooks for the baseline without rewriting the working tree. Loader receipts verify
all twelve original modules, and the before/after case-name cohorts match exactly.

| Measurement                           |     Before |     After |
| ------------------------------------- | ---------: | --------: |
| Reset calls                           |        253 |       161 |
| Worker reset aggregate                | 121,970 ms | 65,275 ms |
| Vitest elapsed, before final teardown |   153.04 s |  124.00 s |
| Complete command wall time            |  158.341 s | 127.349 s |
| Final database drop                   |   3,778 ms |  1,851 ms |

The observed reset aggregate falls 46.5%; command wall time falls 19.6% for this
cohort. Worker aggregates overlap and must not be added to elapsed time. Vitest
uses its normal scheduling, and hardware/load/cache effects remain separate.
This is not a whole-suite or hosted-CI speedup claim.

## Time-dependent fixtures found during the full run

The Operator source test started from wall time and advanced one second while
asserting deduplication inside a five-minute bucket. Starting at the bucket's last
second reproduces the same extra valid event with both original and new reset
implementations. The corrected test starts inside a bucket, retains every old
assertion, then explicitly crosses the boundary and checks the next bucket and
its repeated poll.

Two synthetic Incident inserts mixed app-clock observation dates with DB-default
creation/update dates. A DB-default clock one second behind reproduces
`INCIDENT_NOT_FOUND` through the unchanged chronology validator with the original
fixture/reset. Supplying all four fixture timestamps from one captured instant
passes the same controlled case. Production validation and authority are unchanged.
The failing controlled reproductions are diagnostic evidence, not successful gates.

## Cross-file isolation found in hosted CI

The initial [PR #1544 CI run](https://github.com/nexpress-cms/nexpress/actions/runs/38997310934)
found one Activity failure after the Operator Runtime suite. Operator resets
before its cases and may leave its final fixture behind; Activity previously
reset only after its cases. Its first unfiltered Action read could therefore
select another site's row, which the unchanged Activity owner correctly denies.

An ordered two-file replay reproduces the same failure with both the original
full TRUNCATE and the optimized reset. Activity now resets once before its first
case and keeps its seven cases and per-case cleanup unchanged. The corrected
ordered replay passes all fourteen cases. This fixes the file's missing initial
isolation without adding repeated per-case resets or weakening visibility.

## Verification and limits

- Final `pnpm verify --concurrency=1`: 113 tasks passed, including 2,458 Core unit
  cases. Final `pnpm lint`: 41 tasks passed. The private reset helper and new DB
  tests also passed a separate typecheck because integration files are outside
  the normal package typecheck scope.
- Core PostgreSQL 16: 12 files / 71 cases passed without skips.
- Full Web PostgreSQL 16: 208 files / 1,809 cases passed, with the two fixture
  failures above and the one expected native-preview opt-in skip. Both corrected
  files then passed all 12 cases without skips. The ordinary-case coverage claim
  combines that full run with the corrected-file rerun; it is not a second
  all-green full Web execution. All twelve theme files / 79 cases passed in the
  full run, and all six unattended journeys retained their original limits.
- Enabled native preview: one real-browser case passed without skips. Redis:
  sixteen cases passed without skips. Every verification process completed normal
  teardown.
- All 652 public JS/declaration files in forty rebuilt packages have identical
  inventories and bytes to the frozen accepted consumer archives. Production
  browser and packed-scaffold journeys were not repeated for these test-only
  edits; their existing runtime evidence remains applicable to those same bytes.
- Self-review, case preservation, formatting, link/repository checks and
  `git diff --check` passed. No versions, changesets, lockfile or migration files
  changed; the pre-existing handoff edit is preserved.

No live provider/model call or external message was run. These results do not
establish new production Runtime/model acceptance or automatic-action enablement.
Controlled reproductions are not successful acceptance gates; the final exact-head
hosted checks must pass before merge.

## Moderator retention lock follow-up

After PR #1544, its exact-head PR and main CI passed, but the
[Version PR CI](https://github.com/nexpress-cms/nexpress/actions/runs/39000441129)
failed the mixed Moderator collector's successful retention assertion with
`55P03` at `LOCK TABLE np_settings IN SHARE MODE NOWAIT`. The CI log does not
identify the lock holder. It cannot establish that another test, a writer or
autovacuum was responsible.

[PostgreSQL's lock contract](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-TABLES)
makes that share lock incompatible with both an ordinary writer's row-exclusive
lock and the share-update-exclusive lock used by VACUUM. A private reproduction
keeps the original 151-target fixture, starts an actual `VACUUM (TRUNCATE FALSE)`
on its settings table, and records the vacuum command and granted lock from
`pg_locks`/`pg_stat_activity` before invoking the unchanged owner. It reproduces
the exact SQL and `55P03` error. This proves a legal competing operation can
cause the failure; it does not retrospectively identify the CI lock holder.

The success fixture now acquires the existing control/source fence in the same
order as the owner, then waits at most five seconds for the settings share lock
in that transaction. The actual pruning owner still runs with `NOWAIT`.
The corrected actual-VACUUM replay observes the fixture's blocked share request,
releases only its owned diagnostic vacuum, and passes the original 151-target
assertions. Its initial diagnostic had waited for an artificially slowed vacuum
to finish and hit the original 90-second deadline; that attempt is not a passing
gate. Corrected diagnostic cleanup cancels its owned vacuum after recording the
expected error or wait. No committed fixture starts or disables VACUUM.

One small combined regression uses two actual connections and a protected
setting. It exercises writer and VACUUM-class locks, requires the original
NOWAIT error rather than a statement timeout, checks unchanged settings after
denial, and observes the success fixture waiting for the exact blocker before
release. Its polling barrier is scoped to the worker database, relation and
blocking PID. A local one-second statement timeout bounds an accidental blocking
regression; the success fixture's five-second lock timeout is transaction-local.
There is no retry or higher case deadline.

All six original collector cases, their 151-target cardinality and retention,
source, ACL and replay assertions remain. The added lock case uses one small
setting rather than rebuilding the large fixture. Production services, policy,
retention rules, versions, changesets, lockfile and migrations are unchanged.

Local follow-up verification passed all seven mixed collector cases and fourteen
cases in the three adjacent Moderator/Incident/Runtime retention suites, without
skips. The changed integration file passed an explicit Node-targeted typecheck;
the first temporary project inherited the Web ES2017 target and rejected existing
Core BigInt literals, so only that diagnostic project's target was corrected.
Final `pnpm verify --concurrency=1` passed 113 tasks and `pnpm lint` passed 41.
The actual-VACUUM replays select one case; their other cases are intentionally
filtered, not counted as full-suite passes. Hosted validation belongs to the
follow-up PR's exact head and does not retroactively turn the failed Version PR
run into a pass.
