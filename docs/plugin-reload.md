# Plugin reload semantics

`/admin/plugins` ships a "Reload all" button. This page documents what
that button does and — crucially — what it **doesn't** do, so you
don't trust it for changes it can't actually pick up.

## The endpoint

`POST /api/admin/plugins/reload` (admin.manage). Calls
`createBootstrap().reloadPlugins()` from `@nexpress/next`.

The response shape:

```ts
{
  reloaded: true,
  schedules: {
    added: number,
    updated: number,
    removed: number,
    workerOwnsRegistrations: boolean | null,
  } | null,
}
```

The admin toast renders a one-line summary:

> Re-registered every plugin. Code edits to plugin handlers still need a
> dev-server restart. Schedules: +1 added, 0 cron updated, -0 removed.
> Note: this process isn't the worker — restart your worker process to
> pick up newly-added schedules.

## What reload does

| Surface                                                  | Reload picks it up?                                    | How                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `np_plugins.enabled` toggle                              | Already live                                           | Caches via `enabled-gate.ts` (5s TTL); `updatePluginState` invalidates the gate so the very next dispatch sees the new value. Doesn't even need a reload.                                                                             |
| `np_settings` plugin config edits (`plugin.config:<id>`) | Yes                                                    | `setup(ctx)` re-runs against the freshly-read `ctx.config`. Hooks read from `ctx.config` already see the new value on every invocation.                                                                                               |
| Hook / route / action registry                           | Yes                                                    | The host awaits plugin teardown in reverse load order, clears the runtime registries, then runs `loadPlugins(enabled)` again.                                                                                                         |
| Blocks and patterns                                      | Yes                                                    | Plugin contributions are cleared and the currently enabled set is registered again with concrete source ownership.                                                                                                                    |
| Page templates and translations                          | Yes                                                    | Source-aware registries remove disabled/stale contributions. If an override disappears, the previous plugin or app/theme value becomes effective again.                                                                               |
| `pgboss.schedule` rows                                   | Yes (added / updated / removed counts in the response) | `reconcilePluginSchedules()` diffs the registry against rows under `plugin.scheduledTask.*` and applies the delta.                                                                                                                    |
| pg-boss **work loops** for new schedules                 | **No** (multi-process limit)                           | `boss.work()` registrations live in the worker process. The web process can update cron rows but can't install / drop work loops in another process — you must restart the worker for newly-added schedules to actually be processed. |
| Plugin handler code edits                                | **No**                                                 | Reload doesn't touch the Node module cache. `setup` / route handlers / hook handlers retain whatever they were when the process imported them.                                                                                        |
| New plugin packages added to `nexpress.config.ts`        | **No**                                                 | `nexpress.config.ts` is imported once at boot. Adding entries needs a server restart so the new modules get loaded.                                                                                                                   |

## Why work loops can't reconcile across processes

In a typical production deploy:

- The Next.js web server runs as one process (or a fleet behind a load
  balancer). It's a pg-boss **producer** — it can `boss.send` and
  `boss.schedule` against the DB, but doesn't run any `boss.work`
  loops.
- A separate worker process (`scripts/worker.ts`) runs as a
  pg-boss **consumer** — its boss instance has every
  `boss.work(queueName, handler)` loop live.

When an operator clicks "Reload all" in the admin, the call lands on
the _web_ process. The web's boss instance can write new rows to
`pgboss.schedule` (so the cron will fire) and unschedule stale ones,
but the work loops that actually pick up the resulting jobs live in
the **worker** process. The web server has no way to install a work
loop there.

For freshly-added schedules: pg-boss enqueues the cron-fired job into
its `pgboss.job` table, but no worker is listening for the new queue
name. The job sits there until the worker restarts and registers the
new `boss.work()` during its own `start()` pass.

## Honest copy

The admin toast adapts to the situation:

- **Same process for web + worker** (e.g. `pnpm dev` with the worker
  inlined): no warning. The reconcile rebuilds schedules; the work
  loops belong to the same boss instance and survive the rebuild.
- **Web ≠ worker** (the production case) AND a schedule was added: the
  toast appends _"Note: this process isn't the worker — restart your
  worker process to pick up newly-added schedules"_. Removed schedules
  don't need a worker restart because the worker simply never receives
  more jobs for that name.

## Limits on the reload itself

- **`teardown()` runs before the reset.** Callbacks run in reverse plugin load
  order and must resolve to void. A failing teardown is logged but does not
  prevent the remaining plugins from cleaning up or reloading.

- **The Node module cache is untouched.** Editing
  `packages/plugins/my-plugin/src/index.ts` and clicking reload won't
  re-import the plugin module — `setup` runs against the same handler
  closures that were captured at boot. To pick up code edits, restart
  the dev server.
- **Adding a brand-new plugin to `nexpress.config.ts` requires a
  restart.** The config file itself is imported once. Reload sees the
  same plugin list.
- **Enabling / disabling is faster than reload.** Toggling the row in
  `np_plugins.enabled` propagates within ~5s through the enabled-gate
  cache (or instantly via the gate's `invalidatePluginEnabled`
  hook). Reload only matters when you've edited config or want
  `setup(ctx)` to re-run against fresh state.

## Related

- [`plugin-quickstart.md`](plugin-quickstart.md) — getting from zero
  to a running plugin.
- [`plugin-manifest.md`](plugin-manifest.md) — what each manifest field
  affects.
- [`plugin-capabilities.md`](plugin-capabilities.md) — capability ↔
  `ctx.*` mapping.
- Admin Jobs surface — `/admin/jobs` shows pg-boss schedule rows;
  use it to verify a reconcile applied.
