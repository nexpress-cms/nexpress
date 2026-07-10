# Plugin scheduled tasks

Plugins declare recurring work with the definition-level `scheduled` registry.
The SDK, core host, pg-boss adapter, and plugin doctor share one contract, so a
bad task fails during module evaluation or plugin load instead of disappearing
from the worker silently.

```ts
import { definePlugin, type NpScheduledTask } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "daily-reports",
    version: "0.1.0",
    name: "Daily reports",
    description: "Builds the daily report summary.",
    author: { name: "Acme" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  scheduled: [
    {
      id: "daily-rollup",
      cron: "5 0 * * *",
      description: "Roll up the previous UTC day's events.",
      handler: async (ctx) => {
        await ctx.storage.set("last-rollup", new Date().toISOString());
      },
    },
  ] satisfies NpScheduledTask[],
});
```

Add every capability used inside the handler, such as `storage:kv` in this
example. `definePlugin()` derives `hooks:scheduled` from a non-empty registry.
A hand-built definition that bypasses the SDK must declare that capability
itself, and the core host still validates the tasks before registration.

## Definition contract

Each task contains only these fields:

| Field         | Contract                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`          | 1–128 characters; starts alphanumeric; then ASCII letters, numbers, `.`, `_`, or `-`; cannot be `.` or `..` |
| `cron`        | Five fields separated by single ASCII spaces: minute, hour, day-of-month, month, day-of-week                |
| `handler`     | Function receiving the normal typed plugin context; it must resolve to `void`                               |
| `description` | Optional non-empty string of at most 500 characters                                                         |

Task ids must be unique within one plugin. They may repeat across plugins
because the worker queue is namespaced as
`plugin.scheduledTask.<pluginId>.<taskId>`.

Cron schedules use pg-boss's default **UTC** timezone. NexPress validates the
same `cron-parser` syntax used by pg-boss, including ranges, lists, steps, and
month/day names, after enforcing the canonical five-field shape. A six-field
expression with seconds is not accepted.

String or module-path handlers are not supported. They were previously present
in the SDK type but were never loaded by the host; use an imported function
value instead. A handler that returns data is diagnosed at dispatch time so an
accidental API-style result cannot pass silently.

## Validation and diagnostics

`definePlugin()` validates the complete registry before deriving
`manifest.provides.scheduledTasks`. The core host repeats the validation for
definitions that bypass the SDK. Run:

```bash
nexpress ops plugins doctor --json
```

Doctor reports stable checks:

- `plugins.schedule_invalid` — non-array registry or malformed task fields.
- `plugins.schedule_duplicate` — repeated task id within one plugin.

The runtime error includes the plugin id, task id or array index, and the exact
field failure. Fix the definition and restart the process before retrying.

## Worker and reload behavior

At worker startup, each definition becomes one pg-boss schedule row and one
worker queue. `/admin/plugins` → “Reload all” reconciles schedule rows, but a
new task added in another worker process still needs a worker restart so that
process installs its `boss.work()` loop. `/admin/jobs` → Scheduled labels the
registered rows as plugin schedules.

Use `boss.schedule()` directly only for application-local work. Plugin authors
should prefer `scheduled` so capabilities, catalog metadata, reload, doctor,
and the Admin Jobs inventory remain aligned.
