# Plugin manifest reference

Every NexPress plugin starts with `definePlugin({ manifest, … })`. The
manifest is the metadata block — the host reads it to gate
capabilities, validate compatibility, and surface plugin info in admin
UIs and machine-readable catalogs (npm search, the Discover panel).

This page is a flat reference. For the procedural side see
[`plugin-quickstart.md`](plugin-quickstart.md). For capability ↔ ctx
mappings see [`plugin-capabilities.md`](plugin-capabilities.md).

## What you actually have to type

After `definePlugin`'s defaults + auto-derivation kicked in, the
minimum viable manifest is **seven fields**:

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "my-plugin",
    version: "0.1.0",
    name: "My plugin",
    description: "Does something useful.",
    author: { name: "Me" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  // ...your hooks / routes / blocks / admin / scheduled go here
});
```

Everything else (`capabilities`, `provides`, `agent`, `requires`,
`allowedHosts`, `usesTokens`, `styleSlots`, `apiVersion`) has a default
or is auto-derived from your declared surface. You add them when you
_need_ them, not because the type system forces you.

## Field reference

### Required (no default)

| Field                 | Type                     | Notes                                                                                                                      |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | string                   | npm-package-shaped slug. Also the row key in `np_plugins`.                                                                 |
| `version`             | semver                   | Authored by you, NOT the framework version.                                                                                |
| `name`                | string                   | Human label. Surfaces in `/admin/plugins`.                                                                                 |
| `description`         | string (1–500 chars)     | One-line summary. The agent block falls back to this when its own description is empty.                                    |
| `author`              | `{ name, email?, url? }` | At minimum, `name`.                                                                                                        |
| `license`             | string                   | SPDX id (`"MIT"`, `"Apache-2.0"`, etc.).                                                                                   |
| `nexpress.minVersion` | semver                   | Lowest framework version this plugin is known to work against. The host refuses to load it on older versions and logs why. |

### Auto-defaulted (you can omit)

| Field                                                                                                            | Default                       | What it's for                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`                                                                                                     | `"1"`                         | Plugin manifest schema version. Bumps on breaking shape changes; older plugins keep loading on a newer host until major.                                                                              |
| `capabilities`                                                                                                   | `[]` + auto-derived           | See "Capabilities" below — `routes` / `hooks` add entries automatically.                                                                                                                              |
| `provides.{blocks, fields, hooks, actions, apiRoutes, pageRoutes, scheduledTasks, adminExtensions, collections}` | derived from declared surface | Catalog metadata. Action-registry keys end up in `provides.actions`, block types in `provides.blocks`, route patterns in `provides.pageRoutes`, etc. Author-declared entries merge with derived ones. |
| `agent`                                                                                                          | empty descriptor              | AI / catalog metadata. Listing it explicitly with `category` / `tags` improves discoverability in the Browse panel.                                                                                   |
| `requires`                                                                                                       | `[]`                          | Other plugin ids this one depends on. The host topo-sorts the load order.                                                                                                                             |
| `allowedHosts`                                                                                                   | `[]`                          | Hostnames `ctx.http.fetch` may call. Supports exact hosts, `*.example.com`, and `*` for operator-configured endpoints. Empty = no outbound HTTP allowed.                                              |
| `usesTokens`                                                                                                     | `[]`                          | Theme tokens the plugin reads. Documentation only.                                                                                                                                                    |
| `styleSlots`                                                                                                     | `{}`                          | CSS custom-property slots the plugin's blocks render against. Documentation only.                                                                                                                     |

## Capabilities

`capabilities` declares what the host should let your plugin do at
runtime. Two kinds:

**Auto-derived from surface** — `definePlugin` adds these for you:

- `routes: [...]` ⟶ `api:route`
- `pageRoutes: [...]` ⟶ `site:route`
- `scheduled: [...]` ⟶ `hooks:scheduled`
- `hooks: { "<ns>:<event>": ... }` ⟶ `hooks:<ns>` (one per namespace)
- `admin.widgets/actions/tables/settings` ⟶ `admin:panel`
- `admin.collectionTabs` ⟶ `admin:collection-tab`
- `admin.dashboardWidgets` ⟶ `admin:dashboard`

**Author-declared** — you list these because the host can't statically
tell from the top-level definition that your handler will call them.
Examples: `storage:kv`, `media:read`, `network:fetch`, and `content:write`.
Full list + the matching `ctx.*` methods is in
[`plugin-capabilities.md`](plugin-capabilities.md).

A merge happens — author entries + derived entries with no duplicates.
You only ever add what auto-derive can't infer.

## Compatibility — `nexpress.minVersion` / `maxVersion`

The host parses these at boot, compares against its own framework
version, and refuses to load the plugin if it falls outside the range.

```ts
nexpress: {
  minVersion: "0.1.0",
  maxVersion: "0.5.0", // optional
}
```

If you only set `minVersion`, you implicitly support every later
framework version. Set `maxVersion` when you know a newer release ships
breaking changes you haven't tested against — the operator gets a
clean "skipping incompatible plugin" log line instead of a deep
runtime crash.

## Inter-plugin dependencies — `requires`

```ts
manifest: {
  // ...
  requires: ["@nexpress/plugin-forum"],
}
```

The host topologically sorts the load order so your `setup(ctx)` runs
_after_ every plugin in `requires` has finished its own setup. If a
required plugin is missing, the dependent is skipped with a `missing
required plugin(s)` warning — and the cascade continues, so a plugin
whose dep was skipped is also skipped (issue #464).

Cycles are detected and break with `dependency cycle — refusing to
load` warnings; the rest of the plugin set still loads.

## What auto-derivation does NOT touch

`capabilities` like `storage:kv`, `media:write`, `network:fetch`,
`content:write` aren't auto-derived because they require static
analysis of route handler / setup bodies — silently granting them
would be a privilege footgun. List them explicitly when you call
`ctx.storage.set()`, `ctx.media.upload()`, `ctx.http.fetch()`, etc.
The host throws at registration time if a hook / route hits a
namespace you didn't declare.

## Non-manifest definition fields

Some operator-facing surfaces live on the plugin **definition** —
the object you pass to `definePlugin()` — rather than the
manifest, because they carry runtime values (Zod schemas,
functions) that don't fit the manifest's "metadata-only" shape.

```ts
definePlugin<MyPluginConfig>({
  manifest: { /* the metadata block — id, version, name, etc. */ },

  // Non-manifest, definition-level fields:
  configSchema,                  // Zod schema → admin auto-form
  configVersion: 2,              // bump on non-additive schema change
  configMigrate: (old, from) => /* ... */,

  hooks: { /* ... */ },
  actions: { /* id: { kind, handler } */ },
  routes: [ /* ... */ ],
  pageRoutes: [ /* ... */ ],
  blocks: [ /* ... */ ],
  admin: { /* widgets, actions, tables, dashboardWidgets, collectionTabs */ },
  setup: (ctx) => { /* ... */ },
  // ...
});
```

The full list:

| Definition field | Purpose                                                                                                                                                        | When to use                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `configSchema`   | Zod schema for operator-tunable plugin config. Renders an auto-form on `/admin/plugins/<id>`.                                                                  | When you want the operator to tune plugin behavior at runtime. See [`plugin-quickstart.md`](plugin-quickstart.md) Step 2b.                       |
| `configVersion`  | Schema version (defaults to 1).                                                                                                                                | Bump when `configSchema` changes shape non-additively.                                                                                           |
| `configMigrate`  | `(old, fromVersion) => current` migrator.                                                                                                                      | Pair with a `configVersion` bump so existing operator data upgrades on first cold read.                                                          |
| `hooks`          | Lifecycle hook handlers keyed by hook name.                                                                                                                    | Most plugins start here.                                                                                                                         |
| `actions`        | Named `{ kind, handler }` registry for admin and inter-plugin dispatch.                                                                                        | Prefer this when an admin widget, table, or button references an `actionId`; `definePlugin` and plugin doctor can validate it before setup runs. |
| `routes`         | Typed plugin API routes mounted under `/api/plugins/<id>`. See [`plugin-api-routes.md`](plugin-api-routes.md).                                                 | When the plugin needs a static, namespaced HTTP surface.                                                                                         |
| `pageRoutes`     | Typed public-site URL routes the plugin owns. Definition, host, and doctor validate canonical patterns and handlers. See [`plugin-pages.md`](plugin-pages.md). | When the plugin ships its own pages (e.g. forum threads, calendar events).                                                                       |
| `blocks`         | Validated block definitions for the page builder. See [`plugin-blocks.md`](plugin-blocks.md).                                                                  | Block-shipping plugins.                                                                                                                          |
| `admin`          | Declarative admin extension (widgets, actions, tables, dashboard, collectionTabs).                                                                             | When the plugin contributes UI to `/admin`.                                                                                                      |
| `setup`          | `(ctx) => …` invoked once per plugin load.                                                                                                                     | Validate environment, log a startup line, or use the compatible `ctx.actions.register*` API for genuinely dynamic/legacy actions.                |
| `teardown`       | Cleanup callback for graceful shutdown.                                                                                                                        | When the plugin holds long-lived resources.                                                                                                      |
| `i18n`           | Locale string bundles.                                                                                                                                         | When the plugin renders user-facing copy.                                                                                                        |
| `templates`      | Page-template contributions per collection.                                                                                                                    | Plugins that ship templates for the dispatcher.                                                                                                  |
| `patterns`       | Page-builder pattern presets.                                                                                                                                  | When the plugin ships pre-shaped block trees.                                                                                                    |
| `fields`         | Custom field types for the admin field renderer.                                                                                                               | Plugins extending the field-config vocabulary.                                                                                                   |
| `scheduled`      | Validated typed scheduled tasks. See [`plugin-scheduled-tasks.md`](plugin-scheduled-tasks.md).                                                                 | Background jobs the plugin owns.                                                                                                                 |

`admin.settings.fields` (a hand-rolled NpFieldConfig array) is
the legacy version of `configSchema`. When BOTH are declared on
the same plugin, the auto-form wins and `admin.settings.fields`
is ignored — see
[`docs/design/plugin-config-auto-form.md`](design/plugin-config-auto-form.md)
§ 5.1.1 for the precedence contract. New plugins should use
`configSchema` exclusively.

`actions` deliberately lives beside `routes`, `scheduled`, and `hooks`, not
inside `manifest`: its handlers are runtime functions, while the manifest is
serializable catalog metadata. `definePlugin()` derives the action ids into
`manifest.provides.actions` automatically, so catalogs still get an inventory
without authors repeating ids in metadata and setup code.

## See also

- [`plugin-quickstart.md`](plugin-quickstart.md) — step-by-step from
  scaffold to running plugin.
- [`plugin-capabilities.md`](plugin-capabilities.md) — capability ↔
  `ctx.*` mapping table.
- [`plugin-api-routes.md`](plugin-api-routes.md) — API route definition,
  request, response, auth, and diagnostics contracts.
- [`plugin-reload.md`](plugin-reload.md) — what `/admin/plugins`
  "Reload all" does and what it doesn't.
- [`plugin-render.md`](plugin-render.md) — render-extension hook
  semantics.
- [`plugin-blocks.md`](plugin-blocks.md) — block definition, props schema,
  container, collision, and diagnostics contracts.
- [`plugin-pages.md`](plugin-pages.md) — `pageRoutes` field in depth:
  pattern grammar, server / client boundary, precedence, collisions.
- [`plugin-scheduled-tasks.md`](plugin-scheduled-tasks.md) — task ids,
  five-field UTC cron syntax, handler results, worker lifecycle, and diagnostics.
