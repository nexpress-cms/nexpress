# Bootstrap runtime

`createBootstrap()` from `@nexpress/next` owns the process-wide NexPress
runtime. It is the only normal place that creates the database pool, installs
storage and observability adapters, registers collections/themes/plugins,
configures email, and starts the enqueue-only job producer.

```ts
import { createBootstrap } from "@nexpress/next";

import * as generatedSchema from "@/db/generated/collections";
import nexpressConfig from "@/nexpress.config";

export const {
  getDb,
  ensureFor,
  reloadPlugins,
  shutdown: shutdownBootstrap,
} = createBootstrap({
  config: nexpressConfig,
  generatedSchema,
});
```

Construction validates the project config and generated-schema module without
opening resources. Initialization is lazy, safe to race across requests, and
retryable after a failed startup. `getDb()` fails until the read intent has
completed; it never creates a second pool implicitly.

## Intents

| Intent    | Runtime guaranteed on return                                      |
| --------- | ----------------------------------------------------------------- |
| `read`    | observability, DB, storage, collections, themes, i18n, site scope |
| `plugins` | `read` plus enabled plugins, blocks, and patterns                 |
| `worker`  | `plugins` plus the email adapter; no enqueue-only producer        |
| `write`   | `worker` plus the pg-boss producer when jobs are enabled          |

Routes and server components should import the app's `ensureFor()` wrapper.
Standalone scripts may create a bootstrap directly, but must use the same
intent contract and call `shutdown()` in their exit path.

```ts
const bootstrap = createBootstrap({ config, generatedSchema });

try {
  await bootstrap.ensureFor("plugins");
  const db = bootstrap.getDb();
  // run the script
} finally {
  await bootstrap.shutdown();
}
```

Custom storage, observability, and email adapters are injected through the
factory options and require the matching `custom` environment/config intent.
Built-in intent rejects an injected adapter instead of silently selecting a
different implementation.

## Shutdown

`shutdown()` is terminal and idempotent. It waits for in-flight startup, then
attempts every cleanup in dependency order: producer, plugins, static
registries and email, storage, DB, and observability. Multiple cleanup failures
are returned as one `AggregateError`. A stopped bootstrap cannot be restarted;
create a new process/bootstrap instead.

The dedicated worker gives its signal-driven drain path the bootstrap shutdown
callback. Worker shutdown therefore stops heartbeat and pg-boss first, then
closes the rest of the runtime.

## Framework-host boundary

`@nexpress/core/bootstrap` exposes setters, registry mutation, and plugin hook
dispatch required by framework integration packages. It is a host-only,
experimental boundary. Application code should use `@nexpress/next`, the app
bootstrap, or domain subpaths such as `@nexpress/core/db`; raw singleton wiring
is intentionally absent from the `@nexpress/core` root export.

Migration mapping:

| Former root import                          | Current import                                |
| ------------------------------------------- | --------------------------------------------- |
| `createDbConnection`, `getDb`               | `@nexpress/core/db`                           |
| `setDb`, `setStorageAdapter`, `setJobQueue` | `@nexpress/core/bootstrap` (hosts/tests only) |
| `configureStorageRuntime`, storage shutdown | `@nexpress/core/bootstrap` (hosts only)       |
| `loadPlugins`, `runHook`, `teardownPlugins` | `@nexpress/core/bootstrap` (hosts only)       |

The proxy rate limiter has a separate execution entrypoint and lifecycle; it
does not share bootstrap process state.
