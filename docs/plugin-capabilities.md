# Plugin capabilities reference

NexPress plugins declare a coarse-grained `capabilities` array in their
manifest. The host gates every privileged operation against the list at
**registration time** (hooks, routes) and at **call time** (every
namespace on the runtime `ctx`). A plugin that declared
`capabilities: []` cannot reach into `ctx.content.find` or register a
`content:afterCreate` hook — the request fails with a clear
`NpForbiddenError` naming the missing capability.

## How declaration works

```ts
definePlugin({
  manifest: {
    // ...
    capabilities: ["storage:kv", "network:fetch"],
  },
});
```

`definePlugin` auto-derives capabilities from the declared surface so
you don't have to repeat yourself:

- **REST routes** — any entry in `routes: [...]` adds `api:route`. See
  [`plugin-api-routes.md`](plugin-api-routes.md) for the route contract.
- **Public site routes** — any entry in `pageRoutes: [...]` adds
  `site:route`.
- **Scheduled tasks** — any entry in `scheduled: [...]` adds
  `hooks:scheduled`. See
  [`plugin-scheduled-tasks.md`](plugin-scheduled-tasks.md) for the task contract.
- **Hooks** — every key in `hooks: { ... }` adds `hooks:<namespace>`
  (e.g. `content:afterCreate` → `hooks:content`).
- **Admin extensions** — `admin.settings`, `admin.widgets`,
  `admin.actions`, or `admin.tables` add `admin:panel`;
  `admin.collectionTabs` adds `admin:collection-tab`;
  `admin.dashboardWidgets` adds `admin:dashboard`.

Everything else stays explicit. The host can't safely tell from the
top-level definition whether a route handler will call `ctx.storage.set`,
`ctx.http.fetch`, `ctx.content.update`, or `ctx.media.upload`, so
silently granting those would be a privilege escalation bug.

## Capability → `ctx.*` mapping

The host exports `npCapabilityToCtxMembers` (from `@nexpress/plugin-sdk`)
as the runtime source of truth. The table here is the human-readable
form. Both stay in sync via a unit test
(`packages/plugin-sdk/src/capabilities.test.ts`).

| Capability             | `ctx.*` methods it gates                                                                                                                           | Notes                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `content:read`         | `ctx.content.find`, `ctx.content.findOne`, `ctx.content.count`                                                                                     | Public-page reads; collection access fns still run.               |
| `content:write`        | `ctx.content.create`, `ctx.content.update`                                                                                                         | Bypasses per-doc ACL — gated only by the capability.              |
| `content:delete`       | `ctx.content.delete`                                                                                                                               | Same caveat as `content:write`.                                   |
| `media:read`           | `ctx.media.list`, `ctx.media.getById`, `ctx.media.getUrl`                                                                                          |                                                                   |
| `media:write`          | `ctx.media.upload`                                                                                                                                 | Uploads attribute via plugin-storage, not `np_users`.             |
| `media:delete`         | `ctx.media.delete`                                                                                                                                 | Refuses when the doc has refs (`NpConflictError`).                |
| `settings:read`        | `ctx.settings.getSite`                                                                                                                             | Site-wide settings. `settings:write` is reserved.                 |
| `theme:read`           | `ctx.theme.getTokens`                                                                                                                              | Returns the fully resolved token tree.                            |
| `theme:write`          | `ctx.theme.setTokens`                                                                                                                              | Validates and deeply merges a nested token overlay.               |
| `network:fetch`        | `ctx.http.fetch`                                                                                                                                   | Hostname must be in `manifest.allowedHosts`.                      |
| `storage:kv`           | `ctx.storage.{get,set,delete,list,has}`                                                                                                            | Plugin-scoped, site-scoped key/value store.                       |
| `api:route`            | route registration in `routes: [...]`                                                                                                              | Auto-derived. See [`plugin-api-routes.md`](plugin-api-routes.md). |
| `site:route`           | route registration in `pageRoutes: [...]`                                                                                                          | Auto-derived. Required for public-site page routes.               |
| `admin:panel`          | `admin.settings`, `admin.widgets`, `admin.actions`, `admin.tables`                                                                                 | Auto-derived. Documents the plugin admin panel surface.           |
| `admin:dashboard`      | `admin.dashboardWidgets`                                                                                                                           | Auto-derived.                                                     |
| `admin:collection-tab` | `admin.collectionTabs`                                                                                                                             | Auto-derived.                                                     |
| `hooks:content`        | `content:before/afterCreate`, `content:before/afterUpdate`, `content:before/afterDelete`, `content:before/afterPublish`, `content:beforeUnpublish` | Auto-derived.                                                     |
| `hooks:auth`           | `auth:afterLogin`, `auth:beforeLogout`, `auth:afterRegister`                                                                                       | Auto-derived.                                                     |
| `hooks:render`         | `render:beforePage`                                                                                                                                | Auto-derived. See [`plugin-render.md`](plugin-render.md).         |
| `hooks:scheduled`      | scheduled task registration in `scheduled: [...]`                                                                                                  | Auto-derived.                                                     |
| `hooks:media`          | `media:before/afterUpload`                                                                                                                         | Auto-derived.                                                     |

Media reads and uploads return the SDK's `NpMediaItem`: its `size` maps the
canonical record's `filesize`, its URL is resolved by the active adapter, and
`metadata.sizes` uses the exact `NpMediaVariants` contract documented in
[`media.md`](media.md). `ctx.media.getUrl` selects a generated `variant`, may
disable original fallback, and returns `null` when no acceptable object exists.

Lifecycle hook payloads use `principal` as the single actor field. Staff
uploads carry `principal: { kind: "staff", user }` and `member: null`;
member uploads carry a member-kind `principal` plus the matching `member`
summary. Content scheduler events use `principal: null`. See the exact
per-hook shapes in [`plugin-hooks.md`](plugin-hooks.md).

Methods NOT in the table (`ctx.cache.*`, `ctx.log.*`, `ctx.errors.*`,
`ctx.next.*`, `ctx.actions.*`) are ungated — they're either in-process
bookkeeping (`cache`, `log`) or already gated upstream (`actions`
dispatch is `admin.manage` at the API layer).

Theme methods use the canonical `NpThemeTokens` / `NpThemeTokensOverlay`
contract. `setTokens({ colors: { accent: "#0f766e" } })` is valid; flat maps,
unknown keys, and unsafe CSS values fail before persistence. See
[`theme-tokens.md`](theme-tokens.md).

## What runtime errors look like

Calling a method without the matching capability throws an
`NpForbiddenError` from `@nexpress/core`:

```
NpForbiddenError: plugin:my-plugin attempted "storage:kv" but
manifest doesn't declare it. Add "storage:kv" to capabilities.
```

Registering a hook / route without the matching capability throws at
boot, with the plugin id and the missing requirement spelled out:

```
[plugin:my-plugin] declares capabilities ["api:route"] but is registering
something that requires "hooks:content". Add "hooks:content" to the
plugin manifest's capabilities array.
```

## Authoring tips

- Start with `capabilities: []` and let `definePlugin` derive what your
  surface needs. Add explicit entries only when the runtime tells you
  to.
- Route, hook, scheduled-task, and admin-surface capabilities all
  auto-derive — you should rarely type those yourself unless you are
  documenting a capability before adding the corresponding surface.
- `network:fetch` requires `allowedHosts` — list the exact hostnames
  your plugin will hit. `*.example.com` wildcards work, `*` allows
  operator-configured integration endpoints, and the empty list refuses
  every fetch.
- Capabilities are a runtime gate only — they don't change TypeScript
  types on `ctx`. SDK-level conditional typing is on the v2 wishlist.
