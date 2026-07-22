# Declarative plugin admin

Plugins extend the NexPress admin by **declaring** what they want, not by
writing UI. The host renders everything with its own design-system
primitives — so plugins never ship React code, never couple to the
admin's framework version, and can't leak CSS or scripts into the admin
bundle.

For the 5% case where you need bespoke UI (charts, WYSIWYG, live
dashboards): serve a separate page from a plugin route and link to it.

## Site activation

Plugin packages and handler registries are installed once per server process;
sites do not load separate copies of plugin code. `/admin/plugins` instead
controls a sparse `np_site_plugins(site_id, plugin_id, enabled)` activation
override for the currently selected site. A missing override means active, so
new sites automatically see configured plugins without one row per plugin.

Every runtime surface uses the same activation snapshot: hooks, API/page
routes, action execution, Dashboard widgets, collection tabs, public discovery
and OpenAPI, blocks, patterns, page templates, translation catalogs,
plugin-owned OAuth providers, content transfer, and scheduled executions.
Plugin inventory, configuration, and contract metadata remain inspectable in
the plugin-management page even while disabled. Turning a plugin off on site A
has no effect on site B and does not require “Reload all”. Config remains
separate in the site's `plugin.config:<id>` setting.

`np_plugins` is only the process-global installed/configured inventory. Ops
mutations therefore require an explicit site:

```bash
pnpm --silent run ops:plugins -- disable reading-time --site default --execute --approve plugin-disable --json
```

---

## Declaring the extension

In `definePlugin(...)`, put operator-tunable runtime config in the
definition-level `configSchema` field. Put non-config admin surfaces
in the `admin` block. Every `admin` section is optional; declare what
you actually need.

```ts
import { definePlugin, npAdminMetric, npAdminStatus, npAdminTable } from "@nexpress/plugin-sdk";
import { z } from "zod";

const configSchema = z.object({
  apiKey: z.string().min(1).meta({ sensitive: true }).describe("API key"),
  syncOnSave: z.boolean().default(true).describe("Sync on save"),
});

export default definePlugin({
  manifest: {/* ... */},
  configSchema,

  actions: {
    getQuota: {
      kind: "metric",
      handler: async () => npAdminMetric("4,200 calls", "-60 vs yesterday"),
    },
    healthCheck: {
      kind: "status",
      handler: async (_data, ctx) => {
        const res = await ctx.http.fetch("https://api.example.com/health");
        return res.ok
          ? npAdminStatus("ok", "All systems go")
          : npAdminStatus("error", `Provider returned ${res.status}`);
      },
    },
    fullResync: {
      kind: "action",
      handler: async () => {
        // … run the expensive job …
        return { ok: true, data: "Resync queued." };
      },
    },
    listFailures: {
      kind: "table",
      handler: async (_data, ctx) => {
        const result = await ctx.content.find("posts", { where: { status: "archived" } });
        const rows = result.docs.map((document) => ({
          documentId: document.id,
          reason: "stale",
          at: document.updatedAt,
        }));
        return npAdminTable(rows, result.totalDocs);
      },
    },
  },

  admin: {
    widgets: [
      { id: "quota", label: "Remaining quota", kind: "metric", actionId: "getQuota" },
      { id: "health", label: "Provider status", kind: "status", actionId: "healthCheck" },
    ],
    actions: [
      {
        id: "resync",
        label: "Force resync",
        actionId: "fullResync",
        confirm: "Will replay every post through the provider. Continue?",
      },
    ],
    tables: [
      {
        id: "failures",
        label: "Recent failures",
        columns: [
          { name: "documentId", label: "Document" },
          { name: "reason", label: "Reason" },
          { name: "at", label: "Time" },
        ],
        rowsActionId: "listFailures",
        emptyMessage: "Nothing has failed recently.",
      },
    ],
  },
});
```

---

## Admin surfaces

### Configuration forms

New plugins should use definition-level `configSchema`. The host
introspects the Zod schema into the same auto-form on both
`/admin/plugins` (Configure dialog) and `/admin/plugins/<id>`
(detail page), then saves through
`PUT /api/admin/plugins/:id/config`.
The schema must be a top-level `z.object(...)` (optionally wrapped by
`default`, `optional`, or `nullable`); scalar, array, and transform wrappers
are rejected before plugin registration.

Values persist as plugin config in `np_settings` under
`plugin.config:<id>`. The admin reads the current value from plugin state
and saves through `PUT /api/admin/plugins/:id/config` automatically.

`admin.settings.fields` is the legacy declarative form for plugins
authored before `configSchema`. It reuses the collection field system
(`NpFieldConfig`) and still renders when a plugin does not declare
`configSchema`. When both are declared on the same plugin, the
`configSchema` auto-form wins and `admin.settings.fields` is ignored at
render time with a startup warning. Remove `admin.settings.fields` in
the same diff that adds `configSchema`.

### `widgets` — dashboard cards

Small read-only cards shown at the top of the plugin's admin page. Two
kinds:

- **metric**: action returns `{ value: string | number, delta?: string }`.
  Renders as a big number with optional secondary line.
- **status**: action returns
  `{ level: "ok" | "warn" | "error", message: string }`. Renders a
  colored status indicator.

### `actions` — buttons

One-click operations. Admin calls the registered action handler; result
is surfaced as a toast. Optional `confirm` shows a dialog before dispatch
— use it for anything destructive or expensive.

### `tables` — read-only data

Action returns `{ rows: Array<Record>, total: number }`. Admin renders
using its built-in table primitive. Columns are declared up front; cells
render via `JSON.stringify` for object values, `String(...)` for scalars.

### `collectionTabs` — per-document widgets + actions

Injects widgets and actions into the **collection edit view** sidebar
(below the Revisions panel). Each tab declares which collections it
targets — either a list of slugs or `"*"` for every collection:

```ts
admin: {
  collectionTabs: [
    {
      id: "seo",
      label: "SEO audit",
      collections: ["posts"],
      description: "Live-audits the post you are editing.",
      widgets: [
        { id: "score", label: "SEO score", kind: "metric", actionId: "auditDocument" },
      ],
      actions: [
        { id: "rescan", label: "Re-scan this post", actionId: "auditDocument" },
      ],
    },
  ],
},
```

Each widget / action receives `{ collection, documentId }` as its payload,
so the handler can fetch the current doc via `ctx.content.findOne()` and
return a live score, status, or per-document action result. The same
`actionId` can back a widget and an action: the widget reads the metric
shape, the action shows a success toast.

A tab must declare at least one widget or action — an empty tab
renders as an empty card and is almost certainly an authoring mistake
(enforced by `definePlugin` at build time).

### `dashboardWidgets` — widgets on `/admin`

Widgets shown on the main admin dashboard, aggregated across every
installed plugin:

```ts
admin: {
  dashboardWidgets: [
    {
      id: "site-seo-score",
      label: "Avg. SEO score",
      kind: "metric",
      actionId: "lastAuditScore",
      description: "Rolling average across recent posts.",
      priority: 10,
    },
  ],
},
```

Same widget contract as the per-plugin page (`metric` / `status`), but
the referenced action is dispatched with an empty payload — dashboard
widgets are global, not per-document. Use `priority` to hint render
order (lower first); untyped widgets render last in registration order.

Requires the `admin:dashboard` capability.

---

## Wiring handlers

New plugins should declare handlers in the definition-level `actions`
registry. Each key is the `actionId` referenced by `admin`; `kind` binds the
handler return type to the primitive that consumes it:

- `kind: "metric"` for metric widgets.
- `kind: "status"` for status widgets.
- `kind: "table"` for tables.
- `kind: "action"` for general operations.

Admin-facing action ids may be any non-empty string except the URL dot
segments `.` and `..`; those are rejected by `definePlugin()` and plugin
doctor before an Admin request is constructed.

`definePlugin()` checks registry-backed widget/table references as soon as the
plugin module is evaluated. A missing id (when no `setup` callback can supply
it) or metric/status/table kind mismatch fails there instead of waiting for an
operator click. General buttons may reference any kind, so a status or metric
handler can still power both a widget and a manual refresh button.

The original setup-time API remains available for existing plugins and truly
dynamic registrations:

- `ctx.actions.registerMetric(actionId, handler)`
- `ctx.actions.registerStatus(actionId, handler)`
- `ctx.actions.registerTable(actionId, handler)`
- `ctx.actions.register(actionId, handler)`

The host records those kinds and validates them after `setup`. Because the
static CLI doctor deliberately does not execute setup code, definition-level
actions provide the strongest build-time and doctor coverage; setup-only
typed consumers are reported as legacy/unverifiable until runtime inspection.
During a gradual migration, registry entries are checked immediately while
references left for `setup` remain warnings until the runtime registry is
available.

Handlers have full `ctx` access (content, media, storage, settings, http,
…) and return the standard `{ ok, data?, error? }` shape. The SDK exports
`npAdminMetric()`, `npAdminStatus()`, `npAdminTable()`, and
`npAdminActionError()` for common results.

Both HTTP/Admin dispatch and plugin-to-plugin `ctx.actions.dispatch()` enforce
the target plugin's activation for the current site. Setup-registered handlers
also receive a freshly rebuilt request-site `ctx`, not the bootstrap site's
config snapshot.

The admin dispatches through `POST /api/plugins/:id/actions/:actionId`,
which is admin-only + CSRF-protected + rate-limited by the existing
`/api/plugins` bucket.

---

## What this **can't** do

- Live-updating dashboards (widgets fetch once on page load).
- Inline charts, timelines, drag-and-drop editors.
- Custom navigation, page templates, or theme overrides.

For these cases, serve a separate page from a plugin route
(`/api/plugins/:id/your-page`) and link to it. A future iframe escape
hatch is under consideration — open an issue if you hit the limit.

---

## Security

- **No plugin code runs in the admin**. Values are JSON the admin
  renders itself. XSS-escape happens in the admin's renderer.
- Plugin metadata and admin structure are validated with Zod at
  `definePlugin` time. Definition-level actions additionally catch provably
  missing ids and incompatible metric/status/table kinds before the admin
  renders.
- Action dispatch requires a staff session with `admin.manage` + CSRF
  token. Non-admin users can't trigger plugin actions even if they
  guess an actionId.
- Settings values are persisted in `np_settings` under
  `plugin.config:<id>` via the dedicated admin config route — same
  guardrails as the plugin config editor in `/admin/plugins`.
