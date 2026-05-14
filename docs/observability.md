# Observability

NexPress ships with two pluggable singletons so production deploys can
route logs and exceptions to whatever stack they already use without the
framework taking on a Sentry / Datadog / Axiom dependency:

- **Logger** (`setLogger` / `getLogger`) — replaces the default
  `console.*` output everywhere the framework emits structured
  diagnostics, including plugin `ctx.log` calls.
- **Error reporter** (`setErrorReporter` / `getErrorReporter`) — receives
  unhandled exceptions captured at API, plugin, and worker boundaries.
  Default is a no-op, so users who don't need error tracking pay
  nothing.

Both APIs are exported from `@nexpress/core`. Install your adapters
once at app boot — the framework's bootstrap lives in
`@nexpress/app/lib/init-core` and is surfaced through a thin wrapper
at `src/lib/init-core.ts` in every site (and `apps/web/src/lib/init-core.ts`
in the monorepo). Unwrap that file and install the adapters next to
the email setup; every downstream call site picks them up.

---

## Logger

```ts
import { setLogger, type NpLogger } from "@nexpress/core";

setLogger({
  debug: (msg, ctx) => myLogger.debug({ ctx }, msg),
  info: (msg, ctx) => myLogger.info({ ctx }, msg),
  warn: (msg, ctx) => myLogger.warn({ ctx }, msg),
  error: (msg, ctx) => myLogger.error({ ctx }, msg),
  // Optional — host code falls back to merging bindings inline if
  // `child` isn't provided.
  child: (bindings) => wrapWithBindings(myLogger, bindings),
});
```

Every log call carries the message string plus an optional
`Record<string, unknown>` of structured context. The framework adds
its own keys at known call sites:

| Call site | Context keys |
|---|---|
| Plugin `ctx.log` | `pluginId` |
| pg-boss handler error | `type`, `jobId`, `error`, `stack` |
| `revalidateCollection` skip | `target`, `error` |
| `npErrorResponse` 500 | `name`, `message`, `stack` |

### pino example

```ts
import pino from "pino";
import { setLogger } from "@nexpress/core";

const root = pino({ level: process.env.LOG_LEVEL ?? "info" });
setLogger({
  debug: (msg, ctx) => root.debug(ctx ?? {}, msg),
  info: (msg, ctx) => root.info(ctx ?? {}, msg),
  warn: (msg, ctx) => root.warn(ctx ?? {}, msg),
  error: (msg, ctx) => root.error(ctx ?? {}, msg),
  child: (bindings) => {
    const childLogger = root.child(bindings);
    return {
      debug: (msg, ctx) => childLogger.debug(ctx ?? {}, msg),
      info: (msg, ctx) => childLogger.info(ctx ?? {}, msg),
      warn: (msg, ctx) => childLogger.warn(ctx ?? {}, msg),
      error: (msg, ctx) => childLogger.error(ctx ?? {}, msg),
    };
  },
});
```

---

## Error reporter

```ts
import { setErrorReporter, type NpErrorReporter } from "@nexpress/core";

const reporter: NpErrorReporter = {
  captureException(error, context) {
    // Forward to your tracker. The framework guarantees `error` is an
    // Error instance and that this function is never called for handled
    // NpError responses (only for unexpected 500s).
  },
};
setErrorReporter(reporter);
```

`context` carries `tags` (always includes `source: "api" | "worker"`),
optional `user`, and optional `extra`. The framework auto-populates
`tags.jobType` for worker errors.

The reporter MUST NOT throw — `reportError` catches and logs reporter
failures via `console.error` (bypassing the logger to avoid a loop).

### Sentry example

```ts
import * as Sentry from "@sentry/node";
import { setErrorReporter } from "@nexpress/core";

Sentry.init({ dsn: process.env.SENTRY_DSN });

setErrorReporter({
  captureException(error, context) {
    Sentry.captureException(error, {
      tags: context?.tags,
      user: context?.user,
      extra: context?.extra,
    });
  },
});
```

---

## Where errors get reported

| Boundary | What's reported | Tags |
|---|---|---|
| API route 500 | Any non-`NpError` thrown from a handler. `NpValidationError`, `NpForbiddenError`, etc. are intentional 4xx responses and are **not** reported. | `source: "api"` |
| pg-boss job handler | Anything the registered handler throws. Re-thrown after reporting so pg-boss applies its retry policy. | `source: "worker"`, `jobType` |
| Plugin hook handler | Propagates to whoever called `runHook` / `runHookAndCollect`; reaches the API boundary above when a content write triggers it. | `source: "api"` |

---

## Defaults

- `consoleLogger` pretty-prints `[level] message {context}` via the
  matching `console.*` method. Good enough for `pnpm dev`; replace in
  production.
- `noopErrorReporter` does nothing. The cost of leaving error reporting
  unconfigured is zero — log lines still go through the logger so you
  can filter on `level: "error"` there if you don't have a separate
  tracker.

Reset to defaults in tests via `resetLogger()` / `resetErrorReporter()`.

---

## Worker observability — three stores, one matrix (#274)

Phase 19 + 20.3 added two NexPress-specific tables on top of pg-boss's
own metadata. There are now three distinct "where do I look?" stories
for queue / worker debugging. They cover different questions; the
issue tracker calls out that this can confuse new operators, so the
matrix below is the canonical reference until / unless they get
unified into one subsystem.

| Question                                            | Look here                                | Retention env                                                                                       |
| --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Is a job pending / completed / failed right now?    | pg-boss tables (`pgboss.job` + archive)  | pg-boss internal — controlled by pg-boss config, not NexPress envs                                  |
| Is *any* worker process actually attached?          | `np_worker_heartbeats`                   | `NP_WORKER_STALE_THRESHOLD_SECONDS` (default 90) — rows older than `STALE × 10` get GC'd by `purgeStaleWorkers` |
| What did handler X log while processing job Y?      | `np_job_logs`                            | `NP_JOB_LOG_RETENTION_DAYS` (default 14) — pruned by the `system:jobLogPrune` recurring job          |

### Cadence envs

| Env                              | Default | Effect                                                                  |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| `NP_WORKER_HEARTBEAT_SECONDS`    | `30`    | How often a running worker upserts its `np_worker_heartbeats` row.       |
| `NP_WORKER_STALE_THRESHOLD_SECONDS` | `90` | After this with no heartbeat, the worker reports `unhealthy`.            |
| `NP_JOB_LOG_RETENTION_DAYS`      | `14`    | Prune `np_job_logs` rows older than this (recurring job).                |

If you tune retention, tune all three to the same window if your
storage policy is uniform, or document the divergence — they don't
read from each other and a "we kept 30 days of pg-boss archive" claim
won't hold if `NP_JOB_LOG_RETENTION_DAYS` is still 14.

### Symptom → store

- **"My pending count looks high but nothing's processing"** —
  inspect `np_worker_heartbeats`. `aliveCount: 0` means no worker is
  attached; pg-boss alone won't tell you that.
- **"A job failed but the API response was vague"** — query
  `np_job_logs` for that `jobId`. The structured `level` + `message`
  + `context` triple is what `getLogger()` calls inside the handler
  tee'd into.
- **"A job completed but the side effect didn't fire"** — first check
  pg-boss state (`completed` vs. `expired`). If the job ran, then
  read `np_job_logs` for the handler's own diagnostics.
- **"A worker rebooted and now everything looks paused"** — the
  pause flag (`np_settings` `siteId="_system"` `key="jobs.paused"`)
  is process-wide and survives restarts. Resume via the admin UI or
  `setJobsPauseState({ paused: false })`. See `docs/jobs.md` for the
  fuller pause / resume story.
- **"One pod is processing while admin UI shows paused"** — the
  pause-sync loop on that pod failed to read the persisted flag
  (#312). The first failures are logged at `warn` with
  `consecutiveFailures` in the context; after 3 in a row
  (`PAUSE_SYNC_ESCALATE_AFTER`) the next failure is also reported
  to `getErrorReporter()` with `tags.subsystem: "pause-sync"`, so
  operators tracking Sentry / their tracker get one alert per
  failure run. The counter resets on the first successful tick.

### Why three stores?

pg-boss owns the queue itself; replacing it would mean reimplementing
visibility timeouts and retry semantics. Heartbeats + job logs are
operator-facing surfaces that pg-boss's archive doesn't give us:
heartbeats answer "is anything attached?", job logs let operators
read the handler's own logger output without grep'ing process
stdout. The three coexist intentionally; #274 tracks whether they
should later collapse into a single `worker-observability` module
with one retention knob.
