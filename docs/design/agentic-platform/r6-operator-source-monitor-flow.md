# R6 Operator sources and recovery monitoring

Installation is explicit. These owners emit measured events and retain recovery
comparisons; they enable no Agent, schedule, provider, credential, queue or worker.

## Installation and source authority

Create [the Core source owner](../../../packages/core/src/agent/operator-event-source.ts)
with the existing Runtime event service, an `isInstalledSite` allowlist and an
`authorize` callback enforcing current site **and deployment** permission. Authority
is checked around reads and writes; uninstalled sites perform neither. Select `jobs: "pg-boss"` only for a canonical deployment;
[the reader](../../../packages/core/src/agent/operator-event-observation.ts) uses the
existing DB and retained Agent queues, without initializing a producer or worker.
Custom queues require an actual host-owned `observeJobs` implementation.

The canonical producers cover:

- `jobs.handler.failed`: retained failures, paged in batches of 100 with a persisted cursor and an initial 15-minute lookback.
- `jobs.worker.stale` and `jobs.backlog.threshold`: complete, unpaused observations
  meeting the configured pending-count and age thresholds. Future scheduled work
  is excluded. A stale heartbeat is advisory.
- `ops.check.changed`: an observed change after an initial baseline.
- `ops.backup.stale` and `ops.backup.failed`: recorded freshness or an actual
  owning operation result; missing storage never becomes a failed execution.

Event timestamps and deduplication keys bind stable source evidence. Raw payloads,
paths and errors are excluded. The optional
[App status adapter](../../../packages/app/src/lib/agents/operator-event-source.ts)
provides configuration/storage checks and bounded backup-manifest declarations.
Its optional `backupResult` reader accepts a recent, completed, approved isolated
restore-drill failure, identified as `BACKUP_RESTORE_DRILL_FAILED`. These
checks do not prove external health or restore success.

For retained Doctor or release coverage, explicitly pass
`reportSources: { doctor: { path }, release: { path } }` to the App source adapter
or Operator host. [The concrete reader](../../../packages/app/src/lib/agents/operator-report-sources.ts)
accepts shipped `np.doctor.v1` / `np.release.v1` JSON, validates its summary and
preserves the owning check/step IDs. Files must be regular, non-symlink, unchanged
during a bounded 64 KiB read and recent (300 seconds by default; configurable
1–86,400). Invalid, stale or unavailable evidence becomes a warning/unknown
observation; absent selectors perform no reads. Only IDs, states and fixed
descriptions leave the owner. Paths, errors and command text remain private.
Core source authorization must surround this deployment-wide read; App host
status includes it only for explicitly authorized `readiness` observations.

Pass this service as the optional `operator` facet to the explicitly registered
[Runtime jobs](../../../packages/core/src/agent/runtime-jobs.ts). Reconciliation
calls `observe` and `sampleDueMonitors`; optional-source failures do not prevent
other recovery/enqueue work. Adopt the explicit
[V3 registry](../../../packages/core/src/agent-contract/r6-recipe-registry.ts) for
Operator event eligibility. V1/V2 profiles and existing Agent versions remain immutable.

## Local plans and recovery evidence

Set `queuePlans: "pg-boss"` on
[the App Operator host](../../../packages/app/src/lib/agents/operator-host.ts).
[Its concrete adapter](../../../packages/app/src/lib/agents/operator-queue-plan.ts)
uses current queue facts and the shipped `worker-not-draining` runbook. It executes no commands. The three approved
`ops.execute` actions are unchanged.

The host explicitly calls `startMonitor({ siteId, planId })` for a current,
same-site persisted queue-drain runbook plan. Audit records pin its digest
and private before/after snapshots. `sampleMonitor` or `sampleDueMonitors` can
resume after process replacement. Recovery requires lower due-plus-
active backlog **and** a fresh worker subscription for the selected queues;
moving ready jobs into active is insufficient. This does not prove command causality or application readiness.

`paused` and `unknown` remain distinct from `monitoring`; expiration becomes
`timed-out`. `recovered` and `timed-out` are terminal replay-only outcomes. Windows
are 60–3,600 seconds (default 900); ordinary samples are at least 30 seconds apart, with
128 retained revisions and at most 25 active monitors per maintenance call.

## Retained Activity review

Explicitly supply `authorizeReview` to the App host and pass the Operator service
as the Activity service's optional `operator` facet. The
[safe projection](../../../packages/core/src/agent/operator-review.ts) rechecks
current staff/site/target authority around reads and verifies retained action,
invocation, capability, output, plan and monitor bindings. The
[Activity view](../../../packages/admin/src/agents/agent-activity-view.tsx) displays
stable check IDs, plan digest/expiry, the fixed local planning command, aggregate
queue facts and recorded recovery state/counts/times. Private artifacts,
snapshots, paths and worker metadata are excluded. A recorded recovery is
historical evidence; it grants no execution authority or proof of current health.

## Focused verification

[PostgreSQL coverage](../../../apps/web/tests/agent-operator-source-monitor.integration.test.ts)
passed 7 cases, including 105-failure pagination, authority loss, persisted recovery
and source-to-V3 queued Run admission with zero inference/executions. Recovery
contract tests passed 5 cases; App Operator regressions passed 35. Separately,
[fingerprint-budget coverage](../../../apps/web/tests/agent-moderator-assessment-budget.integration.test.ts)
passed 5 cases against real journals without inference. These are focused checks, excluding
actual-provider Runtime acceptance and the complete repository gate.

The 2026-10-15 retained-review/source update additionally passed Core contract
16/16, App 30/30 and three new real-PostgreSQL cases covering persisted recovery
projection, authority/integrity loss and mutation preflight before approval
consumption. Existing Activity/execution/Runtime PostgreSQL regressions passed
22/22. The [dedicated browser fixture](../../../apps/web/tests/e2e/agent-operator-review.spec.ts)
is assigned to the coordinated production-browser gate; these focused results
alone do not claim that gate or actual-provider acceptance.
