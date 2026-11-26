# Retained Runtime outcome observations

Health and Doctor expose the same aggregate `np.agent-runtime-outcome.v1`
projection from the Runtime Run owner. It complements worker subscriptions and
queue backlog; neither a completed queue job nor a fresh heartbeat establishes
a successful Runtime outcome.

## Ownership and scope

`agent/runtime-outcome-health.ts` reads `np_agent_runs` through the existing root
DB handle. Doctor reuses its original connected Client through Drizzle. The
collector initializes no worker, Runtime service, producer or provider. It reads
only lifecycle fields and returns no site/run IDs, goals, inputs, results, errors,
credentials or provider identities. `origin=runtime` excludes Gateway runs.
The projection is host-wide across sites; it is available through the existing
admin-only Health and local Doctor owners, not a new public route.

The pure validator is in `agent-contract/runtime-outcome-contract.ts`. One App
presentation module supplies Health and Doctor with matching labels and limits.
Absent evidence from an older Health summary stays unavailable. Doctor retains
the existing `agents.contract` ID and severity; these optional observations do
not grant readiness or add a blocker. Versions, schemas, migrations and execution
contracts are unchanged.

## Counts and time

For observed evidence, a single database statement clock, truncated to
milliseconds, supplies the snapshot and an inclusive preceding 24-hour window.
Unsupported or unavailable projections use the diagnostic host clock for
generation time; this is not a measurement of source freshness. Each of `succeeded`, `failed`,
`cancelled`, `policy_blocked` and `budget_blocked` has its own retained count and
latest `finished_at` within that window. Zero and no matching timestamp mean no
retained match, not proof that no work ever happened. Retention can remove history.
An outcome records the Run owner's result, not independently verified external
effects or complete end-to-end delivery.

Current unfinished counts span all retained Runtime runs, including ones queued
before the outcome window. Deadline elapsed uses `deadline_at <= snapshot`.
Executing means `running` or `verifying`; lease elapsed uses a recorded
`lease_until <= snapshot`, while lease not recorded counts a missing lease.
Those executing states match the existing Runtime dispatcher; queued, retry and
approval waits are not mislabeled as missing execution leases. Deadline and lease
counts can overlap. These are stored facts, not a new stale threshold, assertion
of worker death, automatic recovery decision or proof of useful progress.

A read-only transaction applies at most a 500 ms statement timeout, preserving a
stricter existing value and restoring it afterward. Missing storage is
`unsupported`; incompatible storage, invalid chronology, timeout or unavailable
DB access yields null facts. SQL execution is bounded, not connection acquisition
or total wall time. The collector aggregates retained rows rather than sampling
only the newest rows. No complete-history or retention-readiness claim follows.

## Investigation

Health links explicitly to the existing Runtime Activity view and the
`agent.runExecute` Jobs queue. Native links do not prefetch either view or execute
work. Activity retains current-site and viewer permissions, so its list need not
match a host-wide aggregate. Opening either destination retains its existing
authorization and host-service availability checks. Refresh collects new facts;
it never activates or retries a Run.

## Verification boundary

- Pure contract: 2 tests passed. Real PostgreSQL: 3 journeys passed, confirmed
  again on the final unchanged production code and settled fixture. Stored
  lifecycle transitions cover all five outcomes, two sites, old unfinished runs,
  empty storage, deadline/lease subsets, unchanged records and timeout recovery.
  A temporary view over real rows provides deterministic statement-time boundary
  and origin-exclusion cases; it is not evidence of Gateway admission behavior.
- Focused Health/Doctor: 5 tests passed. Final workspace
  `pnpm verify --concurrency=2`: 113 tasks passed (5 cached), including Core 2,128,
  App 592, Admin 174 and Web 174 tests. Final lint: 41 tasks passed (40 cached).
- Production browser: 93 passed in the full run, then the extended Health journey
  passed after its request assertion was scoped to the new investigation links.
  The original assertion also captured prefetch from the existing unfiltered
  sidebar Jobs link. Product code was unchanged. Six 320/768/1280 light/dark
  captures were inspected; they show observed empty records, while mixed and
  unavailable facts have server-render and real PostgreSQL evidence.
- Forty packed packages supplied a fresh consumer: install, typecheck, production
  build and operational journey passed. Core 438 and App 203 dist files plus all
  five changed App runtime source files matched workspace, tarball and installed
  bytes. The consumer resolved Next 16.3.6; the workspace lockfile is unchanged.
- Self-review and independent review found no outstanding concrete defect.
  Formatting, local documentation links and `git diff --check` passed. Logs,
  captures and the independent consumer use `/tmp/np-runtime-outcome-*`.

The first workspace run exceeded the unchanged 5-second limit in an existing
Runtime registration test while build, lint and fixture work overlapped. Core
was built first, then final verify passed with task concurrency two; no test
limit or assertion was weakened. A stale lint cache retained errors from the
interrupted declaration build. A cache-free check passed, and refreshing only
that cache made the complete lint gate pass.

One intermediate PostgreSQL fixture-development run failed and its log was
mistakenly overwritten before inspection; its cause is not established. There
was no production-code change in that interval. The settled three-case fixture
passed twice, with the final confirmation preserved separately in
`/tmp/np-runtime-outcome-pg-confirm.log`.

This slice does not repeat unrelated full PostgreSQL, live Redis or native
preview gates and does not complete full R5 or the six actual assistive-technology
workflows. Existing Redis opt-in unit coverage remains 13 passed / 3 skipped;
those skips are not a live Redis acceptance result.
