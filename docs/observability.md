# Observability

NexPress exposes one runtime contract for structured logs and captured
exceptions. The built-in modes are deliberately dependency-free:

- logger: `console` (default) or `custom`
- error reporter: `noop` (default) or `custom`

The environment declares intent and `createBootstrap()` installs the matching
implementations before storage setup or startup-safety warnings run. A custom
intent without a custom adapter, a built-in intent paired with a custom
adapter, or a malformed adapter fails during bootstrap instead of at the first
log or exception.

```dotenv
NP_LOGGER_ADAPTER=custom
NP_ERROR_REPORTER_ADAPTER=custom
```

All public APIs are exported from `@nexpress/core/observability`.

## Configure every process once

Scaffolded sites contain `src/lib/observability.ts`. The web bootstrap,
worker, translation CLIs, and seed script all import this one definition, so a
site cannot accidentally configure web telemetry but leave its worker on the
defaults.

```ts
// src/lib/observability.ts
import * as Sentry from "@sentry/node";
import pino, { type Logger } from "pino";
import type {
  NpLogContext,
  NpLoggerAdapter,
  NpObservabilityAdapters,
} from "@nexpress/core/observability";

const root = pino({ level: process.env.LOG_LEVEL ?? "info" });

function wrapPino(target: Logger): NpLoggerAdapter {
  return {
    kind: "pino",
    debug: (message, context) => target.debug(context ?? {}, message),
    info: (message, context) => target.info(context ?? {}, message),
    warn: (message, context) => target.warn(context ?? {}, message),
    error: (message, context) => target.error(context ?? {}, message),
    child: (bindings: NpLogContext) => wrapPino(target.child(bindings)),
    shutdown: () => target.flush(),
  };
}

Sentry.init({ dsn: process.env.SENTRY_DSN });

export const observabilityAdapters = {
  logger: wrapPino(root),
  errorReporter: {
    kind: "sentry",
    captureException(error, context) {
      Sentry.captureException(error, {
        tags: context?.tags,
        user: context?.user,
        extra: context?.extra,
      });
    },
    shutdown: () => Sentry.close(2_000).then(() => undefined),
  },
} satisfies NpObservabilityAdapters;
```

The matching bootstrap is intentionally small:

```ts
createBootstrap({
  config: nexpressConfig,
  generatedSchema,
  ...observabilityAdapters,
});
```

`setLogger()` and `setErrorReporter()` remain available for tests, embedded
hosts, and composition code. For a normal site, prefer the bootstrap options:
they validate the environment and both adapters as one transaction.

## Adapter contract

Every adapter has a canonical lowercase `kind` (`pino`, `sentry`,
`datadog-agent`; maximum 64 characters). Logger methods and
`captureException()` may return synchronously or as `Promise<void>`. Optional
`shutdown()` methods follow the same rule. A non-void result is a contract
failure.

Log messages are bounded non-empty strings. Context must be a plain object
with bounded alphanumeric keys; nested values remain opaque so structured
logger payloads can carry domain data. Error-report context is an exact outer
shape:

```ts
interface NpErrorReportContext {
  tags?: Record<string, string>;
  user?: { id?: string; email?: string; role?: string };
  extra?: Record<string, unknown>;
}
```

A logger `child()` must return a complete adapter with the same `kind` as its
parent. If it throws or returns a malformed child, NexPress records the failure
and safely falls back to merging bindings into the parent calls.

## Failure isolation and diagnostics

Telemetry never owns the business outcome. Synchronous throws, rejected
promises, malformed dispatch input, non-void results, and broken child adapters
are contained at a shared boundary. NexPress writes a last-resort message
directly to `console.error` (never back through the broken adapter) and records:

- logger and reporter failure counts
- failing component and operation
- concrete adapter kind
- bounded error message and timestamp

Read the process-local snapshot with `getObservabilityDiagnostics()`. Admin
Health shows the same information and also detects environment/live-adapter
mismatches. `pnpm run doctor` validates the pre-boot environment contract;
`doctor:prod` and deploy readiness warn while the reporter remains `noop`.

Counters are process-local and cumulative so swapping an adapter cannot erase
failure evidence or misattribute a late Promise rejection to its replacement.
Call `resetObservabilityDiagnostics()` for an explicit diagnostic reset;
`resetObservability()` restores both built-ins and clears the snapshot.

## Lifecycle

Normal NexPress processes call `createBootstrap().shutdown()`, which closes
observability last after producer, plugins, storage, and DB. An embedded host
that deliberately owns only this subsystem may call `shutdownObservability()`
to detach both adapters, attempt both shutdown hooks, and surface an
`AggregateError` if either flush fails. The dedicated worker drains pg-boss,
then invokes the full bootstrap shutdown on `SIGINT`/`SIGTERM`. Reset happens
before shutdown, so a failing flush cannot recursively route through the
adapter being closed.

Tests can restore built-ins without running hooks via `resetObservability()`
or the component helpers `resetLogger()` / `resetErrorReporter()`.

## Where reports originate

| Boundary              | Behavior                                                                            | Tags                                      |
| --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| API route 500         | Unexpected non-`NpError` failures are logged, reported, and hidden from the client. | `source: api`                             |
| Plugin hook           | Throw, timeout, or invalid hook result is isolated and reported.                    | `source: plugin-hook`, `pluginId`, `hook` |
| Built-in job handler  | Failure is logged, reported, then re-thrown for pg-boss retry.                      | `source: worker`, `jobType`               |
| Plugin scheduled task | Failure is logged, reported, then re-thrown for retry.                              | `source: worker`, `pluginId`, `taskId`    |
| Pause-state sync      | The third consecutive failure is reported once per failure run.                     | `source: worker`, `subsystem: pause-sync` |
| Plugin code           | `ctx.errors.report()` reports a caught/recovered error with plugin ownership.       | `source: plugin`, `pluginId`              |

## Worker observability stores

Queue state, worker liveness, and handler output answer different operational
questions:

| Question                                | Store                      | Retention/configuration                            |
| --------------------------------------- | -------------------------- | -------------------------------------------------- |
| Is a job pending, completed, or failed? | pg-boss job/archive tables | pg-boss configuration                              |
| Is any worker process attached?         | `np_worker_heartbeats`     | `NP_WORKER_STALE_THRESHOLD_SECONDS` (default `90`) |
| What did a handler log for this job?    | `np_job_logs`              | `NP_JOB_LOG_RETENTION_DAYS` (default `14`)         |

Every validated logger dispatch, including a custom logger dispatch, is tee'd
to `np_job_logs` while a job context is active. The tee has an async recursion
guard: if its own database write logs a failure, that secondary line does not
try to write itself back into the failed job-log store.

Heartbeat cadence is controlled by `NP_WORKER_HEARTBEAT_SECONDS` (default
`30`). Rows older than ten times `NP_WORKER_STALE_THRESHOLD_SECONDS` are
eligible for heartbeat cleanup. Job-log rows are pruned by the
`system:jobLogPrune` recurring job using `NP_JOB_LOG_RETENTION_DAYS`.

For a stalled queue, check `np_worker_heartbeats` before assuming pg-boss is
broken; pending jobs with no live heartbeat mean no worker is attached. For a
failed or unexpectedly completed job, inspect pg-boss state first and then its
`np_job_logs` stream. A persisted pause lives in `np_settings` under the
system site and survives worker restarts. Admin Jobs is the supported place to
inspect and resume it. Repeated pause-sync failures are logged and, after the
escalation threshold, sent to the configured error reporter with
`subsystem: pause-sync`.
