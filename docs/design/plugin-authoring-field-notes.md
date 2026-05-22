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

That keeps sample plugin manifests focused on the capabilities that cannot be
inferred from syntax, such as `storage:kv` and `network:fetch`.

## Remaining Friction

- Plugin package scaffolding still repeats the same `package.json`,
  `tsconfig.json`, and `tsup.config.ts` shape. The CLI generator covers this,
  but hand-authored in-repo examples still pay the copy cost.
- `render:afterPage` accepts body-end script contributions through the same
  contribution type as `render:beforePage`, but the naming makes examples look
  more surprising than they need to.
- CLI plugin scaffold tests now cover package-shape consistency and ensure
  admin scaffolds use the typed status helper instead of hand-built payloads.

## Follow-Ups

- Consider a future manifest-level action registry if we want to validate that
  a specific widget's `actionId` points to a compatible registered action id at
  plugin definition time.
