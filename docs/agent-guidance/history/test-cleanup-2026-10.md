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
establish new production Runtime/model acceptance, automatic-action enablement or
a hosted CI run for the pending working-tree changes.
