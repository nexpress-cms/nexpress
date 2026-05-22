# Declarative plugin admin

Plugins extend the NexPress admin by **declaring** what they want, not by
writing UI. The host renders everything with its own design-system
primitives — so plugins never ship React code, never couple to the
admin's framework version, and can't leak CSS or scripts into the admin
bundle.

For the 5% case where you need bespoke UI (charts, WYSIWYG, live
dashboards): serve a separate page from a plugin route and link to it.

---

## Declaring the extension

In `definePlugin(...)`, add an `admin` block. All four sections are
optional; declare what you actually need.

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    /* ... */
  },

  admin: {
    settings: {
      title: "API credentials",
      fields: [
        { type: "text", name: "apiKey", label: "API key", required: true },
        { type: "checkbox", name: "syncOnSave", defaultValue: true },
      ],
    },
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

  setup: async (ctx) => {
    ctx.actions.register("getQuota", async () => ({
      ok: true,
      data: { value: "4,200 calls", delta: "-60 vs yesterday" },
    }));

    ctx.actions.register("healthCheck", async () => {
      const res = await ctx.http.fetch("https://api.example.com/health");
      return {
        ok: true,
        data: res.ok
          ? { level: "ok", message: "All systems go" }
          : { level: "error", message: `Provider returned ${res.status}` },
      };
    });

    ctx.actions.register("fullResync", async () => {
      // … run the expensive job …
      return { ok: true, data: "Resync queued." };
    });

    ctx.actions.register("listFailures", async () => ({
      ok: true,
      data: {
        rows: await ctx.content.find("posts", { where: { status: "archived" } }).then((r) =>
          r.docs.map((d) => ({
            documentId: d.id,
            reason: "stale",
            at: d.updatedAt,
          })),
        ),
        total: 42,
      },
    }));
  },
});
```

---

## The six extension kinds

### `settings` — configuration form

Reuses the collection field system (`NpFieldConfig`), so every field type
supported in collections works here: `text`, `textarea`, `number`,
`checkbox`, `date`, `select`, `radio`, `relationship`, `array`, `group`,
and layout fields (`row`, `collapsible`).

Values round-trip through `GET /api/plugins/:id` (load) and
`PATCH /api/plugins/:id` (save). The admin calls both automatically.

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

Every widget / action / table references a handler registered during
`setup`. Use the typed helpers when the action backs a known admin
surface:

- `ctx.actions.registerMetric(actionId, handler)` for metric widgets.
- `ctx.actions.registerStatus(actionId, handler)` for status widgets.
- `ctx.actions.registerTable(actionId, handler)` for tables.
- `ctx.actions.register(actionId, handler)` for general buttons.

Handlers have full `ctx` access (content, media, storage, settings, http,
…) and return the standard `{ ok, data?, error? }` shape. The SDK also
exports `npAdminMetric()`, `npAdminStatus()`, `npAdminTable()`, and
`npAdminActionError()` to build the common result payloads.

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
- Plugin manifest is validated with Zod at `definePlugin` time — typos
  in widget kinds or missing field properties fail the plugin build,
  not the user's page load.
- Action dispatch requires `admin` role + CSRF token. Non-admin users
  can't trigger plugin actions even if they guess an actionId.
- Settings values are persisted in `np_plugins.config` via the existing
  `PATCH /api/plugins/:id` path — same guardrails as the plugin
  config editor in `/admin/plugins`.
