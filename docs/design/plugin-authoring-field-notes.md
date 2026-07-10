# Plugin Authoring Field Notes

These notes come from building two bundled example plugins in May 2026:

- `@nexpress/plugin-analytics-lite` — render hook, API routes, scheduled task,
  plugin storage, admin widgets, and admin tables.
- `@nexpress/plugin-webhook-relay` — content hooks, outbound fetch, plugin
  storage, sensitive config, admin status widget, and manual admin action.

## Improvements Made

- `definePlugin()` now derives `site:route` from `pageRoutes`.
- `definePlugin()` now derives `hooks:scheduled` from `scheduled` tasks.
- `definePlugin()` now derives admin capabilities from the declared admin
  surface:
  - `admin:panel` for plugin settings/widgets/actions/tables.
  - `admin:collection-tab` for collection tabs.
  - `admin:dashboard` for dashboard widgets.
- `manifest.provides` now includes derived `pageRoutes` and
  `scheduledTasks` entries so catalogs can show those surfaces.
- `@nexpress/plugin-sdk` now exports admin action result helpers:
  `npAdminMetric()`, `npAdminStatus()`, `npAdminTable()`, and
  `npAdminActionError()`.
- `ctx.actions` now includes typed registration methods for common admin
  result shapes: `registerMetric()`, `registerStatus()`, and
  `registerTable()`.
- `ctx.storage` now includes `append()` and `listValues()` for event-log style
  plugin data. `analytics-lite` uses those helpers instead of rewriting an
  array under one key.
- Definition-level `actions: { [actionId]: { kind, handler } }` now binds
  handler result types to admin consumers. `definePlugin()` catches provably
  missing ids and incompatible metric/status/table kinds during module evaluation,
  while plugin doctor reports missing, mismatched, duplicate, untyped, and
  admin-unreferenced actions. The setup-time `ctx.actions.register*` API
  remains compatible for existing and dynamic plugins.
- Render contributions now use one typed `render:beforePage` hook. Its
  result separates `head` and `bodyEnd`; `definePlugin()` rejects unknown
  hook names and malformed descriptors, and the host validates returned
  contribution shapes before rendering them.
- Content, auth, and media lifecycle hooks now have exact per-name payloads.
  Content phases share `document`, `documentId`, `originalDocument`,
  `operation`, `source`, and `principal`; media uploads expose one normalized
  result. The core dispatcher validates payloads and diagnoses non-void
  lifecycle returns before plugin mistakes can pass silently.
- CLI plugin scaffold tests cover package-shape consistency, the canonical
  hook inventory, and typed Admin status helpers instead of hand-built
  payloads.

That keeps sample plugin manifests focused on the capabilities that cannot be
inferred from syntax, such as `storage:kv` and `network:fetch`.

## Remaining Friction

- Plugin package scaffolding still repeats the same `package.json`,
  `tsconfig.json`, and `tsup.config.ts` shape. The CLI generator covers this,
  but hand-authored in-repo examples still pay the copy cost.

The action registry landed at definition level rather than inside `manifest`.
Handlers are runtime functions, so keeping them beside `routes` and
`scheduled` preserves the live manifest's metadata-only contract and avoids
repeating each id in admin, manifest metadata, and setup.
