# Agent maintenance execution evidence

This bundle follows PR #1463 at `6aa44749`. Admin Health and Doctor now distinguish
retention execution receipts from registration, generic worker heartbeats and
retained queue failures. This narrows the unmeasured maintenance boundary in
[Agent diagnostics](admin-agent-diagnostics.md); it does not establish complete
Admin Studio §20.10 readiness or full R5 acceptance.

## Ownership and evidence

| Fact                        | Owner                                | Meaning and limit                                                                                                                                 |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process registration        | Existing job handler registry        | `agent:retentionPrune` is registered in the inspecting process; does not describe another worker process.                                         |
| Worker heartbeat            | Existing jobs heartbeat service      | Generic alive/recorded worker counts and latest heartbeat; does not prove an Agent consumer is running.                                           |
| Queue failures              | Optional existing `listJobs` adapter | Host-wide retained failed/retry/expired retentionPrune job counts; zero cannot prove no historical failures. No tenant attribution.               |
| Committed batch             | Explicit retentionPrune job          | Last committed batch start/completion and examined/pruned counts, persisted together with pruning and cursor advancement.                         |
| Completed sweep             | Continuous cursor traversal          | A pass starting at null, continuing the expected cursor and returning to null. Protected records remain; new lower IDs may wait for a later pass. |
| Missing or invalid evidence | Versioned read projection            | Never-recorded, unsupported and unavailable remain distinct; unknown counts/timestamps are null.                                                  |

The new pure `maintenance-evidence-contract.ts` owns receipt and Health schemas.
The private receipt uses site-owned setting `agents.runtime.maintenance` with
schema `np.agent-maintenance-receipt.v1`. The settings validator recognizes this
key. No table, migration, job payload or existing v1 cursor schema changed.

`runtime-maintenance-job.ts` reuses the existing bounded retention evaluator,
site control transaction and retention statement budget. Cursor read, pruning,
cursor write and receipt write share that transaction and lock. Concurrent jobs
serialize. A final receipt-write failure rolls everything back and preserves the
previous successful receipt. A legacy partial cursor or mismatched continuation
cannot claim a complete pass. Empty explicit invocations can record an empty pass;
reading Health/Doctor never creates a receipt. Import and construction do not
register or schedule a worker.

`maintenance-evidence.ts` reads at most 101 receipt rows ordered by site, aggregates
the first 100 and reports `hasMore`. Counts and latest timestamps describe only
that sample of receipt-bearing sites, not all configured sites or global maxima.
It excludes site IDs, private cursor, worker identity/metadata, payloads and raw
errors. Queue failure observations never replace or relabel a successful receipt.
The receipt is operational evidence, not an immutable audit ledger.

Shared App Health presents a separate `agentMaintenance` projection. Doctor uses
its existing database client with runtime observation disabled: receipt evidence
is available while in-process registration and worker observations stay unknown.
Both render the same validated facts and scope limits. Existing check IDs,
readiness severity and activation behavior are unchanged. Invalid optional evidence
does not manufacture a healthy zero or a new deployment blocker.

## Verification

- Focused Core contracts/collector/registration/retention/settings: 28/28 tests.
  Focused App Health/Doctor/system-health: 54/54. Final full Core unit run:
  2,104/2,104. Queue observation disabled in Doctor is unavailable, not unsupported.
- PostgreSQL: 53/53 cases across the new six-case suite and eight existing
  retention/job/diagnostics suites. Covers committed receipt reads, no writes on
  read, partial/full sweep, concurrent cursor serialization, prior-success
  preservation on forced receipt-write failure, legacy cursor and corrupt receipt.
  Logs: `/tmp/np-maintenance-receipt-final.log` and
  `/tmp/np-maintenance-postgres.log`. No selected cases skipped.
- `pnpm verify --concurrency=2`: 113/113 tasks passed (111 cached on final
  environment-corrected run); strict NodeNext E2E TypeScript passed.
- `pnpm lint`: 41/41 tasks passed (39 cached) against completed dependency output.
- Production browser: 87/87 passed without retries (2.7 min). The actual protected
  Health section preserves keyboard disclosure/refresh behavior and has no
  horizontal overflow at 320/768/1280px in light/dark themes. Six maintenance
  captures were inspected; these show an actual never-recorded receipt snapshot.
  Populated/error receipt variants are covered by server-render tests and real
  persistence by PostgreSQL tests. Log: `/tmp/np-maintenance-browser.log`;
  screenshots: `/tmp/np-maintenance-browser-artifacts`. Generated browser media
  was moved to `/tmp/np-maintenance-generated-public` after the run.
- Fresh installed packed consumer: 8/8 stages passed (two repacks, fresh scaffold,
  relink, install, typecheck, production build and operational journey). Core's
  434 dist files, App's 203 dist files and changed App sources match installed
  bytes. The other 38 unchanged package artifacts reuse the prior packed baseline;
  this is not a new 40-package full gate. Summary:
  `/tmp/np-maintenance-scaffold/summary.json`.
- Changed-file formatting, documentation links, self-review and `git diff --check`
  passed. Unchanged broader PostgreSQL, Redis, theme and native-preview behavior
  reuses evidence linked from [Admin state acceptance](admin-state-accessibility.md).
  Those separate gates were not rerun or claimed as a new full R5 acceptance.

Self-review corrected the DB client's type adaptation to use the existing
collector pattern and kept unobserved queue support distinct from known absence
of adapter support. The initial PG fixture violated the event expiry ordering;
its expiry was corrected without product changes. An initial concurrent unit
run timed out during module loading; the corrected focused and full runs passed
without raising test timeouts. The first broad gate was terminated with exit 137;
bounded concurrency completed it. Reference production build initially lacked
the test database/authentication environment; the configured final gate passed.
An early lint run read incomplete dependency declarations; its persisted script
cache was moved aside before checking completed builds again.

## Remaining boundary

The subsequent [budget measurement evidence bundle](agent-budget-evidence.md)
adds actual measurement observations. Agent-specific remote consumer liveness
and overall maintenance readiness still require evidence from their owning services. Generic
heartbeats and successful cursor passes cannot prove those properties. Actual
spoken assistive-technology acceptance remains open in the
[operator checklist](admin-assistive-technology-acceptance.md). No provider calls,
credentials, automatic activation or publication are part of this bundle.

Versions, changesets, lockfile, schemas and migrations remain unchanged.
