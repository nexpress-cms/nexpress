---
"@nexpress/core": patch
"@nexpress/plugin-sdk": patch
---

**PRT.1 — plugin page-route types + registry getter (#623).**

Plugin authors can now declare `pageRoutes` on `definePlugin()`:

```ts
definePlugin({
  manifest: { id: "forum", /* ... */ },
  pageRoutes: [
    { pattern: "/discussions", component: List },
    { pattern: "/discussions/new", component: New, surface: "member" },
    { pattern: "/discussions/:slug", component: Detail },
  ],
});
```

This phase wires:

- **`@nexpress/plugin-sdk`** — `pageRoutes?: NpPluginPageRouteRegistration[]`
  on `NpPluginDefinition`. Each entry has `pattern`,
  `component`, optional `metadata`, plus `surface`
  (`"site" | "member"`) and `locale` (`"auto" | "none"`)
  knobs from §2.4 and §2.6 of the design doc.
- **`@nexpress/core`** — same field on the structural
  `NpResolvedPluginLike` shape. Plugin host normalizes
  malformed entries away at registration time and stores
  the validated list on each `PluginRegistration`.
- **`getPluginPageRoutes()`** — flat-array getter exported
  from `@nexpress/core` (and from `/plugins` subpath).
  Returns `Array<{ pluginId, route }>` in registration order.
  Enabled-state gating is left to the call site (the route
  dispatcher in PRT.2) so unit tests can assert the
  registered shape without mocking the enabled singleton.

PRT.1 is the **types + registry layer only** — the dispatcher
integration that actually serves these routes lands in PRT.2.
After this PR, declaring a `pageRoutes` field on a plugin
records it correctly but doesn't yet handle requests; that's
intentional staging.

8 new tests in `host.test.ts > getPluginPageRoutes`:
- empty when no plugin declares routes
- registers routes from a resolved plugin
- defaults `surface: "site"` and `locale: "auto"`
- preserves explicit `member` / `none`
- drops malformed entries (missing pattern / component, wrong shape)
- flattens routes from multiple plugins in registration order
- legacy `init()`-shape plugins register zero routes

411/411 in the core test suite.
