# Background Jobs Guide

> Phase 13 ships NexPress's job queue surface — pg-boss as the
> backing store, a worker bootstrap, an admin UI for
> introspection / retry / cancel / bulk retry / manual enqueue,
> and registered cron schedules. This guide covers running the
> queue in production, writing handlers, and using the admin
> tooling.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Enabling the Queue](#2-enabling-the-queue)
3. [Producer vs Worker](#3-producer-vs-worker)
4. [Built-in Handlers](#4-built-in-handlers)
5. [Writing a Handler](#5-writing-a-handler)
6. [Enqueueing Jobs](#6-enqueueing-jobs)
7. [Cron / Scheduled Jobs](#7-cron--scheduled-jobs)
8. [Admin UI](#8-admin-ui)
9. [Manual Enqueue](#9-manual-enqueue)
10. [Bulk Retry](#10-bulk-retry)
11. [Operations Playbook](#11-operations-playbook)
12. [What's Not Built (Yet)](#12-whats-not-built-yet)

---

## 1. Architecture

NexPress uses [pg-boss](https://github.com/timgit/pg-boss) as
the only job queue. No Redis, no Sidekiq, no separate broker —
pg-boss stores everything in Postgres and uses `SKIP LOCKED`
plus advisory locks for safe concurrent claims.

Tables (in the `pgboss.*` schema):

- `pgboss.job` — pending / active / retry rows
- `pgboss.archive` — completed / failed / expired rows
  (auto-rolled from `job` after `keepUntil`)
- `pgboss.schedule` — registered cron entries
- `pgboss.subscription`, `pgboss.queue` — pg-boss internals

The framework wraps pg-boss with a thin `NpJobQueue`
interface (`packages/core/src/jobs/queue.ts`) so a future
swap to a different broker only touches the adapter layer.

---

## 2. Enabling the Queue

Set the environment variable:

```bash
NP_ENABLE_JOBS=1
```

Without this, the producer and worker are no-ops. `enqueueJob()`
silently returns an empty job id, no migration is run on
`pgboss.*`, and the admin Jobs view shows the
"Background jobs disabled" empty-state.

The connection string is reused from `DATABASE_URL` — no
separate queue DB. pg-boss's first start will create the
`pgboss` schema + tables automatically.

---

## 3. Producer vs Worker

Two separate roles, both backed by the same pg-boss tables:

- **Producer** — the Next.js web/API process. Calls
  `enqueueJob(type, data)` to push work onto the queue.
  Started lazily via `ensureFor("write")` on the first
  request that needs the queue (mutating API routes,
  server actions, import scripts).
- **Worker** — a dedicated long-running process that
  registers `boss.work()` loops for every handler in the
  registry and runs them. Started via `startWorker()`.

In a single-node deployment you can run both in the same
process. The reference deploy uses two containers (one for
the web app, one for the worker) so deploys can replace the
web container without dropping in-flight jobs.

```ts
// Worker entrypoint — `scripts/worker.ts` in a scaffolded site (a thin
// wrapper around `@nexpress/app/scripts/worker`), or
// `apps/web/scripts/worker.ts` in the monorepo. The framework's stock
// runner handles the boilerplate below; this is what it does
// underneath if you ever need to roll your own.
import { startWorker } from "@nexpress/core/jobs";

await startWorker(process.env.DATABASE_URL!);

process.on("SIGTERM", async () => {
  const { stopWorker } = await import("@nexpress/core/jobs");
  await stopWorker();
  process.exit(0);
});
```

Multi-node deployments scale the worker container
horizontally — pg-boss's advisory locks keep concurrent
claims correct.

---

## 4. Built-in Handlers

The framework registers a handful of system handlers via
`registerBuiltinHandlers()` (called by `startWorker()`):

- `content:afterCreate` / `content:afterUpdate` /
  `content:afterDelete` — post-write hooks (cache
  invalidation, plugin `afterX` hooks, search reindex)
- `media:processImage` — Sharp-driven resize pipeline
  (decoupled from the upload request)
- `media:cleanup` — delete orphaned storage files
- `system:revisionPrune` — prune old revisions per
  retention policy (cron: `0 3 * * *`)
- `system:sessionCleanup` — delete expired sessions
  (cron: `0 * * * *`)
- `system:jobLogPrune` — sweep `np_job_logs` rows older
  than 14 days (cron: `30 3 * * *`, Phase 20.3a)
- `notifications:sendDigest` — send daily / weekly member
  notification digests for members who opted in
- `import:wordpressApply` — apply an admin-uploaded WXR export
  in the background and write the final report back to
  `np_import_runs`
- `plugin:scheduledTask` — fan-out for plugin-registered
  scheduled tasks

The full registered list is visible at runtime in
`/admin/jobs` → Scheduled tab → "Registered handlers" card.

---

## 5. Writing a Handler

Handlers live in plugins or in your app's bootstrap code. The
contract is `(data: unknown) => Promise<void>` and the type
key is a string (typically `"namespace:action"`).

```ts
// In a plugin
import { registerJobHandler } from "@nexpress/core/jobs";

registerJobHandler("myplugin:cleanup", async (data) => {
  const { sites } = data as { sites: string[] };
  for (const siteId of sites) {
    await cleanupSiteCache(siteId);
  }
});
```

Handler errors:

- **Throw to retry.** pg-boss applies its retry policy
  (defaults: 3 retries with exponential backoff).
- **Throw with no recovery path** to land in `failed` after
  retries exhaust. The admin Failed tab surfaces the last
  error inline.
- **Don't catch silently.** A handler that swallows errors
  reports as `completed` and the queue can't notice the
  problem.

Handler errors are logged via `getLogger()` and forwarded to
the configured error reporter (`getErrorReporter()`) — see
`docs/observability.md`.

---

## 6. Enqueueing Jobs

```ts
import { enqueueJob } from "@nexpress/core/jobs";

const id = await enqueueJob("media:processImage", {
  mediaId: "01HM...",
  sizes: ["thumb", "small", "large"],
});
```

- Without a queue wired (`NP_ENABLE_JOBS=0`), `enqueueJob`
  returns an empty string and the call is a no-op. The web
  process won't crash — the work just doesn't happen.
- Job names use `:` as a namespace separator
  (`media:processImage`). The pg-boss adapter translates
  this to `.` internally because pg-boss 12+ rejects `:` in
  queue names.

---

## 7. Cron / Scheduled Jobs

Recurring jobs are registered via pg-boss's
`boss.schedule(name, cron, data)`. The framework's
`scheduleRecurring()` method (called by `startWorker()`)
registers the two system crons:

```ts
// packages/core/src/jobs/pg-boss-adapter.ts
async scheduleRecurring(): Promise<void> {
  await this.boss.schedule(toQueueName("system:revisionPrune"), "0 3 * * *", {});
  await this.boss.schedule(toQueueName("system:sessionCleanup"), "0 * * * *", {});
}
```

Plugins that want to add their own crons currently extend
this method (or call `boss.schedule()` directly via the
exposed `getBoss()` accessor on `PgBossAdapter`). A first-
class plugin API for cron declarations is a documented
follow-up.

The full schedule list is visible at runtime in
`/admin/jobs` → Scheduled tab → "Cron schedules" card.

---

## 8. Admin UI

`/admin/jobs` (admin-only) shows five tabs:

- **Pending** — `created` + `retry` jobs waiting to run.
  Per-row Cancel button.
- **Active** — currently being processed by a worker.
- **Completed** — successfully finished.
- **Failed** — `failed`, `cancelled`, `expired`. Each row
  shows the last error inline; per-row Retry button +
  bulk "Retry all failed" header button.
- **Scheduled** — registered cron schedules and the list
  of registered handlers. The "Run a handler" form
  enqueues a one-off job (see §9).

Top-right toggle switches the four state tabs between
"All time" and "Last 24 h" (forwarded to the API as
`?since=...`).

A worker-health card sits above the tabs (Phase 20.4 / 23.5):

- Worker liveness (alive count, last heartbeat age).
- Pause pill when `getJobsPauseState().paused` is true.
- **Recent failures** — the same card lists the most recent failed,
  expired, or retrying jobs with their latest captured log message, so
  operators can jump from "the queue needs attention" to the likely
  handler / payload without opening each row first.
- **Stuck-job warning** — a red `AlertTriangle` pill appears when
  the count of `failed` or `expired` jobs (UNION across
  `pgboss.job` and `pgboss.archive`) crosses the configured
  threshold. Defaults are `failed: 10` and `expired: 50`; override
  from `nexpress.config.ts`:

  ```ts
  export default defineConfig({
    // …
    jobs: {
      stuckThreshold: { failed: 25, expired: 200 },
    },
  });
  ```

  The widget reads from `/api/admin/jobs/health`, which calls
  `NpJobQueue.countByState()` under the hood for counts and includes
  the `recentFailures` block from the same ops contract used by
  `nexpress ops jobs status --json`.

Plugin authors building their own monitoring can call
`countByState({ since })` on the queue directly for counts, or
`listRecentJobFailures(queue)` from `@nexpress/core/jobs` for a curated
failure summary joined with the latest `np_job_logs` entry.

---

## 9. Manual Enqueue

Scheduled tab → "Run a handler" card:

1. Pick a handler from the dropdown (populated from the
   registered handler list).
2. Enter a JSON payload (defaults to `{}`).
3. Click **Enqueue**.

The payload is parsed client-side; invalid JSON surfaces a
clear error before the request fires. The endpoint
(`POST /api/admin/jobs/enqueue`, admin + CSRF) rejects
unknown handler types with the registered list in the error
message — defensive UX so a typo doesn't sit in the queue
forever with no consumer.

Common one-off runs:

- `media:cleanup` with `{}` — sweep orphaned files
- `system:revisionPrune` with `{}` — fire the prune now
  instead of waiting for 03:00

---

## 10. Bulk Retry

Failed tab → "Retry all failed" button (visible when there's
at least one failed job).

Each call retries up to 200 jobs. The response includes
`{ retried, failed, total, remaining }`; if `remaining > 0`
the operator can click again to chip away at the rest.
Backed by `POST /api/admin/jobs/retry-all?state=failed`
(admin + CSRF).

`?state=cancelled` and `?state=expired` are also accepted
for completeness, but no UI button surfaces them yet — call
the endpoint directly if needed.

---

## 11. Operations Playbook

**Worker silently stopped processing**

- Check the worker process is alive (e.g. `docker ps`)
- Confirm `NP_ENABLE_JOBS=1` is set in the worker env
- Confirm `NP_ENABLE_JOBS=1` is also set in the web/API env
  for routes that enqueue work such as WordPress import Apply
- Watch the Pending tab — if jobs are stuck in `created`
  for a long time, the worker isn't draining
- `GET /api/admin/jobs/health` (editor+) returns the live
  heartbeat snapshot — `aliveCount: 0` plus stale
  `newestHeartbeat` confirms a dead worker (Phase 19).
  `pause.paused: true` (Phase 20.2) means the worker is
  alive but the operator paused the queue.
- `/admin/import/wordpress` also surfaces the same worker
  heartbeat state because Apply stores uploaded WXR XML in
  `np_import_runs.source_xml` until the background run finishes.
  Queued runs older than `NP_IMPORT_RUN_STALE_AFTER_SECONDS`
  (default 24 hours) are marked failed and cleared by the
  admin sweep. Running runs are swept only when no live worker
  heartbeat exists.

**Maintenance window — pause processing**

- `POST /api/admin/jobs/pause` (admin + CSRF). Optional
  `{ "reason": "DB migration #123" }` body for the audit
  trail. The flag persists in `np_settings` so a worker
  restart while paused stays paused.
- In-flight jobs run to completion; producers keep
  enqueueing. The pg-boss queue accumulates pending jobs.
- `POST /api/admin/jobs/resume` to start draining again.
- Multi-pod deployments converge in ≤ 30 s — each worker
  pod polls the persisted flag on its heartbeat tick and
  applies any state change locally.

**Backlog after an outage (hundreds of failed jobs)**

- Fix the upstream issue first (don't retry into a still-
  broken dependency)
- Use Failed tab → "Retry all failed" repeatedly until the
  backlog is empty
- Watch Active / Completed to confirm jobs are draining

**Misconfigured cron**

- Scheduled tab → "Cron schedules" card shows the registered
  cron expressions. If a job you expect isn't there, it
  hasn't been registered with `boss.schedule()` — check
  worker startup logs.

**Job stuck in `active` forever**

- Typically means the handler crashed without releasing the
  lock, or the worker was killed mid-job. pg-boss has a
  built-in expiration that flips long-running active jobs
  to `failed`; default is 15 minutes. Check
  `pgboss.job.expire_in`.

**Investigating a single failure**

- Failed tab → click the row's `<details>` toggle to see
  the payload + the inline error message. Cross-reference
  the worker logs (filter on `jobId`).

---

## 12. What's Not Built (Yet)

The Phase 20 jobs operability sweep closed every original §12
entry. Add new items here as they surface — keep the list
honest about what's missing rather than letting it drift.

### Recently closed

- **Per-job logs admin UI** — Phase 20.3b. Each job row in
  `/admin/jobs` now has a collapsible "Logs" section that
  lazy-fetches `GET /api/admin/jobs/{id}/logs` (editor-only,
  paged via `?limit=` / `?offset=`, default 500 / max 1000).
  Entries render as `[time] [level] message` with
  per-entry collapsible context payloads. Empty state shows
  "No log entries for this job."
- **Per-job log capture** — Phase 20.3a. `np_job_logs` table
  - `recordJobLog(level, message, context?)` helper. The
    pg-boss adapter wraps every handler invocation in an
    AsyncLocalStorage context so `getLogger()` calls inside
    the handler are auto-tee'd into the job's log stream
    (alongside the configured global logger). Handler errors
    are recorded automatically. Retention defaults to 14
    days, swept by `system:jobLogPrune` cron daily at
    03:30 UTC.

- **Pause / resume queue** — Phase 20.2. `POST /api/admin/jobs/pause`
  and `POST /api/admin/jobs/resume` (admin + CSRF) flip a
  `np_settings("_system", "jobs.paused")` flag and call
  `boss.offWork()` / `boss.work()` on every registered
  queue. In-flight jobs run to completion; producers keep
  enqueueing while paused. The state is read on worker
  startup so a paused worker stays paused after a restart.
  Multi-pod deployments converge automatically: each worker
  re-reads the persisted flag every 30 s (piggy-backed on
  the heartbeat tick) and applies any divergence locally.
- **Rate-limit on retry / enqueue endpoints** — Phase 20.1.
  `apps/web/src/proxy.ts` now imposes tighter buckets above
  the general `/api/admin/` 60/min limit:
  `retry-all` 5/min, `enqueue` 10/min, per-row `retry`
  30/min. Each call still requires admin role + CSRF — the
  rate limit is defense-in-depth against accidental loops
  and runaway scripts.
- **Worker heartbeat / liveness** — Phase 19 (#212). The
  worker upserts to `np_worker_heartbeats` every 30s; alive
  = `running` AND last-seen within 90s. Surfaced via
  `GET /api/admin/jobs/health`. Operations playbook above
  should be updated when the admin UI exposes the health
  endpoint visually.
- **Plugin-declared cron schedules** — Phase 19 (#212).
  `definePlugin({ scheduled: [...] })` is now read by the
  host; pg-boss adapter registers the cron rows on worker
  start. `boss.schedule()` via `getBoss()` still works as
  the escape hatch.
- **Dead-letter queue inspection** — Phase 20.4. The admin
  Jobs page has a dedicated **Archive** tab that reads from
  `pgboss.archive` only, with a banner explaining that
  retrying an archived row re-enqueues a fresh row in
  `pgboss.job` (the archive itself is read-only). Other tabs
  pin `?source=live` so a row that pg-boss has already
  rolled out doesn't double up under both Failed (live) and
  Archive.
- **Worker health widget** — Phase 20.4. A small card above
  the tabs surfaces `aliveCount / totalCount`, the most
  recent heartbeat age, and the global queue-paused pill.
  Refresh fires another `/api/admin/jobs/health` round trip
  on demand.

These aren't blockers — every shipped feature works without
them. They're the obvious next steps if a real production
deployment hits them.
