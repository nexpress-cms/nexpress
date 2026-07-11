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
- Plugin API routes now share one typed core/SDK request and response contract.
  `definePlugin()` rejects malformed methods, non-canonical static paths, and
  duplicates before boot; the host repeats validation for bypassed definitions
  and validates every handler result. `GET` routes support `HEAD`, no-body
  statuses stay bodyless, and plugin doctor scopes duplicate checks to the
  owning plugin id instead of warning on valid cross-plugin namespaces.
- Plugin page routes now share one pattern and definition contract across the
  SDK, core host, Next dispatcher, and plugin doctor. Invalid or duplicate
  patterns fail during module evaluation or boot instead of being dropped;
  `locale: "none"` matches the raw URL without automatic hreflang aliases, and
  the CLI ships a typed `page-plugin` starter.
- Plugin blocks now share one definition and props-schema contract across the
  blocks package, SDK, Next bootstrap, shared registry, and plugin doctor.
  Invalid definitions fail instead of disappearing during bootstrap;
  same-plugin duplicate types are errors while cross-plugin ownership remains
  an operator-visible warning. The CLI and six bundled block plugins exercise
  the same contract.
- Plugin page-builder patterns now share one recursive definition contract
  across blocks, the SDK, Next bootstrap, the shared registry, and plugin
  doctor. Invalid trees, duplicate ids, unavailable block references, and
  cross-plugin ownership surface before an Admin insertion can silently drop
  content. Pattern ids are derived into `manifest.provides.patterns`, and the
  block scaffold plus bundled callout plugin exercise the source-less authoring
  shape.
- Plugin scheduled tasks now share one definition contract across the SDK,
  core host, pg-boss registration, and plugin doctor. Invalid cron expressions,
  unsafe or duplicate ids, non-function handlers, and non-void results fail
  explicitly; schedules are documented as five-field UTC cron expressions, and
  the CLI plus `analytics-lite` use the typed `NpScheduledTask` registry.
- Plugin page templates and translations now have definition-time and host-time
  validation, derived catalog inventories, source-aware reload behavior, and
  static/runtime doctor diagnostics. Template ownership restores the previous
  contributor when an override unloads; ICU syntax fails before first render.
- Plugin config and lifecycle callbacks now have one remaining-definition
  contract. Invalid schema/version/migrator combinations fail early, setup and
  teardown must resolve to void, teardown runs in reverse load order before
  reload/replacement, and partial setup failures scrub every contribution.
- The never-implemented `NpFieldRegistration` / `definition.fields` surface was
  removed. Collection field types remain codegen-owned; plugin admin settings
  use `configSchema` rather than string component indirection.
- CLI plugin scaffold tests cover package-shape consistency, the canonical
  hook inventory, and typed Admin status helpers instead of hand-built
  payloads.

That keeps sample plugin manifests focused on the capabilities that cannot be
inferred from syntax, such as `storage:kv` and `network:fetch`.

## Remaining Friction

- Plugin package scaffolding still repeats the same `package.json`,
  `tsconfig.json`, and `tsup.config.ts` shape. The CLI generator covers this,
  but hand-authored in-repo examples still pay the copy cost.

The runtime plugin contribution surfaces are now contract-complete. Further
work in this area should add product capability, not another parallel registry.

The action registry landed at definition level rather than inside `manifest`.
Handlers are runtime functions, so keeping them beside `routes` and
`scheduled` preserves the live manifest's metadata-only contract and avoids
repeating each id in admin, manifest metadata, and setup.
