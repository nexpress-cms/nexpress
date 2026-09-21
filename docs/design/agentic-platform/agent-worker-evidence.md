# Agent worker subscription evidence

This bundle follows PR #1465 at `6217e0a1`. It extends the bounded observations in
[Admin Studio §20](admin-agent-studio.md#20-admin-release-acceptance),
[maintenance evidence](agent-maintenance-evidence.md) and
[budget measurement](agent-budget-evidence.md). Existing readiness and admission
semantics remain unchanged.

## Ownership and compatibility

The pg-boss adapter records successful queue subscriptions and removals through its
existing start, pause, resume and stop lifecycle. A transition or partial failure
cannot report active subscriptions. A successful retry skips subscriptions already
completed, avoiding duplicate consumers after partial resume. Overlapping lifecycle
operations invalidate positive evidence until a later coherent operation succeeds.
No handler is installed and no job or provider call is created by inspection.

The existing heartbeat owner samples this adapter state on each beat. The optional
reserved `meta.npWorkerSubscription` contains its own exact
`np.worker-subscription.v1` contract: lifecycle state, successful registered Agent
queue names, and currently confirmed Agent queue subscriptions. Queue names are
bounded to the nine known built-in Agent queues, sorted and unique. Confirmed
subscriptions are a subset of registrations and are empty outside active state.

This is an optional versioned extension inside the existing JSON metadata field;
existing exact heartbeat and Jobs response envelopes, columns and migrations do
not change. Older readers can retain opaque metadata. New readers treat absent,
malformed or unknown-version evidence as unknown. Custom adapters and old rows do
not acquire evidence from handler registration alone. Producer startup creates no
heartbeat or consumer; an explicitly observed producer cannot count as subscribed.

The public heartbeat writer and caller-supplied host metadata cannot supply the
reserved evidence. They retain the existing strict plain-JSON validation, then
remove the reserved key. Only the internal worker heartbeat source adds validated
owner evidence on each beat. A source failure removes evidence rather than reusing
a prior positive snapshot. This is a trusted framework/DB observation, not a
cryptographically authenticated attestation against a privileged DB writer.

## Projection and limits

`NpAgentWorkerHealthV1` exposes only counts for the 100 most recent retained
heartbeats, ordered by last-seen time descending and ID ascending; row 101 detects
truncation. No hostnames, IDs, raw metadata, queue payloads or credentials leave the
collector. Counts partition the sample:

| Category       | Required observation                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Subscribed     | Fresh running heartbeat and active owner evidence with at least one confirmed Agent queue                                           |
| Paused         | Fresh running heartbeat and paused owner evidence with registered Agent queues                                                      |
| Inactive       | Fresh active/paused evidence without Agent queues, or producer-only evidence                                                        |
| Stale          | Recognized active/paused/producer evidence whose running heartbeat has reached the existing stale threshold                         |
| Marked stopped | Valid owner evidence and a heartbeat marked stopped by the existing shutdown lifecycle                                              |
| Unknown        | Old/unsupported/malformed evidence, future timestamps, lifecycle transitions/failures, or a running row with stopped owner evidence |

A failed sample has null counts and unknown truncation; it is not an empty healthy
sample. An observed zero-worker sample is also not proof of readiness. Changes can
remain invisible until the next successful heartbeat; failed heartbeat writes can
leave an earlier observation until it becomes stale. A stop marker precedes queue
draining and does not prove completion. Fresh subscription observations do not
prove job progress, provider readiness, authority or coverage of every required
queue. The UI keeps these limits visible and Doctor uses the same formatter.

Health reuses the initialized DB singleton. Doctor passes its original connected
Client through Drizzle, independently of optional budget observations. The bounded
read uses a transaction-local statement timeout of at most 500ms or the host's
stricter timeout and restores the original setting. The collector requires a root
DB handle, performs no persisted writes and never initializes a worker or Runtime.
Existing check IDs, severity and Runtime readiness contracts remain intact.

## Verification

- Lifecycle/heartbeat focused tests: 24/24; aggregate contract tests: 2/2.
  Full Core unit suite: 2,116/2,116.
- Shared Health/Doctor focused tests: 12/12, including independent observation
  failures, original Client identity, malformed evidence and unchanged severity.
  Strict E2E TypeScript passed.
- Core PostgreSQL: 8/8, reusing the existing worker fixture to exercise actual
  startWorker heartbeat wiring and pg-boss subscribe/pause/resume/stop projection.
- Web PostgreSQL: 51/51 across six affected suites, including five new cases for
  mixed observations, stable 100+sentinel sampling, no writes/privacy, lock timeout
  restoration, Doctor Client ownership and live heartbeat source updates.
  Combined selected PostgreSQL: 59/59, no skips.
- Full build: 41/41 tasks. Final `pnpm verify --concurrency=2`: 113/113 tasks
  (94 cached); final `pnpm lint`: 41/41 tasks (39 cached).
- Production browser: 86/87 passed on the initial no-retry run. The existing
  mobile collection-list test timed out waiting for its draft-create POST;
  the targeted no-retry recheck passed unchanged in 2.6 seconds. This is
  86 initial passes plus one isolated pass, not an uninterrupted 87-pass run. The new Health region, refresh, overflow
  and six 320/768/1280 light/dark captures passed. All six captures were visually
  inspected; the real browser snapshot is an observed empty worker sample.
  Mixed/unavailable views have server-render and real PostgreSQL coverage.
- Fresh packed Core/App consumer: 8/8 stages, including installed typecheck,
  production build and operational journey. All 435 Core and 203 App dist files,
  plus changed App source files, match installed bytes. The other 38 unchanged
  package artifacts reuse PR #1465 evidence; not a new full 40-package gate.
- Logs and artifacts use `/tmp/np-worker-*`; packed summary is
  `/tmp/np-worker-scaffold/summary.json`. Broader Redis, theme and native-preview
  integration gates are unchanged and reuse prior evidence; no full R5 claim.

Self-review preserved strict metadata validation before removing the reserved key,
contained overlapping/partial lifecycle operations, and clarified that stop markers
and stopped polling do not prove job drain. Public host metadata cannot provide
owner evidence. Repeated producer initialization cannot overwrite existing worker
observations. All subagent results were collected and reviewed.

Early setup copied a redundant build cache and exhausted disk; only that new copy
was removed and the existing cache reused. An initial verification pass was stopped
to include the final lifecycle correction. Cold build/test overlap exposed missing
Forum self-package output, and an early lint read incomplete dependency output.
A complete dependency build followed by the final verification/lint passed without
changing product code, deleting tests or extending timeouts for those setup errors.

## Remaining boundary

This bundle improves subscription visibility, not end-to-end progress evidence or
full R5 acceptance. Actual spoken assistive-technology acceptance remains in the
[operator checklist](admin-assistive-technology-acceptance.md).
Versions, changesets and lockfile remain unchanged. There are no new credentials,
provider calls, automatic activation or publication. Commit, PR and merge follow the current user authorization in the handoff.
