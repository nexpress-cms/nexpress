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
once at app boot (e.g. inside `apps/web/src/lib/init-core.ts` next to
the email setup) and every downstream call site picks them up.

---

## Logger

```ts
import { setLogger, type NxLogger } from "@nexpress/core";

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
| `nxErrorResponse` 500 | `name`, `message`, `stack` |

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
import { setErrorReporter, type NxErrorReporter } from "@nexpress/core";

const reporter: NxErrorReporter = {
  captureException(error, context) {
    // Forward to your tracker. The framework guarantees `error` is an
    // Error instance and that this function is never called for handled
    // NxError responses (only for unexpected 500s).
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
| API route 500 | Any non-`NxError` thrown from a handler. `NxValidationError`, `NxForbiddenError`, etc. are intentional 4xx responses and are **not** reported. | `source: "api"` |
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
