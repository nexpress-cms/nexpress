# Plugin Page Routes — Design Plan

> Version: draft 1
> Date: 2026-05-10
> Status: design lock pending — implementation hasn't started.
> Prerequisites:
>   - F.2 theme route dispatcher
>     (`packages/next/src/route-dispatcher.ts`, `NpThemeRoute` in
>     `packages/theme/src/define-theme.ts`)
>   - Plugin manifest contract (`docs/plugin-manifest.md`)
>   - F.4–F.6 source-precedence pattern (theme overrides plugin
>     contributions for blocks, patterns, nav locations)

---

## 0. Position statement

NexPress is a full-stack CMS — it ships its own frontend (themes,
catch-all router, page builder, member surfaces). Plugins today
already contribute presentation: blocks (`provides.blocks`),
patterns (`provides.patterns`), admin UI (`adminExtensions`), and
API routes (`provides.apiRoutes`).

The one presentation surface plugins **cannot** contribute is
**public page routes**. The forum plugin
(`packages/plugins/forum`) demonstrates the gap: it ships a
`defineDiscussionsCollection()` helper and an admin dashboard
widget, but the actual `/discussions/*` UI lives in
`apps/web/src/app/(site)/discussions/` — outside the plugin.

An operator who installs `@nexpress/plugin-forum` in their own
project gets the data shape and admin widget but not the
public-facing UI. They must either copy the routes from `apps/web`
by hand or implement them themselves. That breaks the operator
contract every other plugin currently honors ("install the
package; it works").

This doc proposes letting plugins contribute page routes, using
the same shape `NpThemeRoute` already established in F.2 and the
same source-precedence pattern F.4–F.6 already established for
blocks, patterns, and nav locations.

---

## 1. Inventory of the surface

### 1.1 What exists today

- **Theme routes (F.2)** — `theme.routes: NpThemeRoute[]` plus
  archive sugar (`theme.archives`). Resolved by
  `packages/next/src/route-dispatcher.ts`'s catch-all on `(site)`.
- **Plugin API routes** —
  `definePlugin({ ... routes: [{ method, path, handler }] })`.
  Mounted at `/api/plugins/<id>/<path>` by
  `apps/web/src/proxy.ts`. Server-only — no React component.
- **Plugin admin extensions** — `adminExtensions` register settings
  panels, dashboard widgets, custom admin views. Bounded to
  `/admin/*`.
- **Apps/web hand-rolled routes** —
  `apps/web/src/app/(site)/discussions/{,new,[slug]/{,edit/}}page.tsx`
  is the forum public surface today. Lives in the reference app,
  not the published plugin.

### 1.2 The missing piece

A plugin that wants to ship a public page (forum's discussions,
hypothetical e-commerce's product detail, gallery's image grid)
has no surface to contribute it. The dispatcher checks:

1. Page-document slug (`pages` collection)
2. Theme routes
3. Theme archives sugar
4. Collection-derived URLs (e.g. `posts.seo.urlPath`)
5. 404

There's no step that consults plugin-contributed routes.

---

## 2. Locked decisions (final unless re-opened)

These eight answers gate implementation. They're called out
explicitly so the lock surface for plugin authors stays narrow.

### 2.1 Plugins MAY contribute page routes

YES. Reasoning: NexPress is full-stack (not headless); plugins
already contribute blocks/patterns/admin UI; theme override
mechanism (F.4–F.6) preserves operator control. Saying no would
make plugins second-class for the public surface and force
operators to copy/paste UI from reference apps — the gap the
forum plugin already exhibits.

### 2.2 Route shape is **identical to** `NpThemeRoute`

Plugin routes reuse the same TypeScript interface. Same
`pattern`, same `component: ComponentType<NpRouteRenderProps>`,
same optional `metadata` builder. This means:

- The route-dispatcher walks plugin routes the same way it walks
  theme routes (no parallel implementation).
- Plugin authors who already contribute theme routes (rare today)
  get familiar shape.
- Future "route" features (e.g. middleware, prefetching) added to
  `NpThemeRoute` apply to plugin routes for free.

The plugin SDK exposes the route under a new field on
`definePlugin`:

```ts
import { definePlugin } from "@nexpress/plugin-sdk";

definePlugin({
  manifest: { id: "forum", /* ... */ },
  pageRoutes: [
    { pattern: "/discussions", component: DiscussionsList },
    { pattern: "/discussions/new", component: NewDiscussion, surface: "member" },
    { pattern: "/discussions/:slug", component: DiscussionDetail },
    { pattern: "/discussions/:slug/edit", component: EditDiscussion, surface: "member" },
  ],
});
```

Field name is `pageRoutes` (not `routes`) so it doesn't collide
with the existing `routes` (API routes).

### 2.3 Source precedence: **theme > plugin > collection**

When the same path resolves to more than one source, the
dispatcher picks in this order:

1. **Theme route** — operators who pick a theme that overrides
   `/discussions` win. The theme is the operator's explicit
   presentation choice; it can't be silently overridden by a
   plugin.
2. **Plugin route** — when no theme owns the path, plugin's
   default surface renders.
3. **Collection-derived URL** — auto-generated from
   `<collection>.seo.urlPath`. Loses to plugin and theme because
   plugins/themes are intentional overrides; the auto-generated
   surface is the fallback.
4. **Page-document slug match** — kept at the top of the chain
   for now (operator-authored pages win over everything).

Boot-time validation: the dispatcher logs a `warn` when the same
path is registered by two sources, naming all three for the
operator. No throw — the precedence above resolves the conflict
silently at request time, but the warning gives the operator a
heads-up that one of their plugins is being shadowed.

### 2.4 Layout slot: default `impl.shell`, opt into `impl.members.shell`

Each plugin route declares which shell wraps its component:

```ts
{ pattern: "/discussions", component: List, surface: "site" }    // default
{ pattern: "/discussions/new", component: New, surface: "member" }
```

- `surface: "site"` (default) — plugin route renders inside
  the active theme's `impl.shell` (Header / Footer / nav).
  Operators editing `/discussions` get a discussion list that
  visually matches the rest of their site.
- `surface: "member"` — plugin route renders inside the active
  theme's `impl.members.shell` (member-aware shell, F-track).
  Use for routes that require login or only make sense for
  authenticated members. Triggers the same membership gate
  the existing `(member)` route group does — unauthenticated
  request redirects to `/members/login?next=…`.

### 2.5 Styling: tokens-only, no plugin CSS bundle in v1

Plugin route components emit semantic markup with theme-token
references — `var(--np-color-brand)`, `var(--np-radius-md)`, etc.
No per-plugin CSS bundle the framework auto-includes.

Rationale:
- Theme tokens are the v0.2 commitment surface; plugins reading
  them inherit the operator's visual customization for free.
- Plugins shipping their own CSS would compete with theme styles
  (specificity wars, dark-mode mismatches, font fallbacks).
- The `--np-plugin-<id>-*` namespace is RESERVED but not yet
  consumed in v1 — it's the escape hatch for plugin-owned
  variables when a plugin's surface really doesn't fit the
  theme's existing tokens.

If a plugin needs styles a theme can't express via tokens, the
plugin route is the wrong layer — it should ship a block instead
(blocks already have a styling story).

### 2.6 i18n: routes inherit the site's locale config

If `getI18nConfig()` returns a config (the site is i18n-enabled),
plugin routes are automatically reachable at both `/<path>` and
`/<locale>/<path>` for every configured locale. Same behavior
the page collection's `urlPath` already produces.

Plugin routes opt out by declaring `locale: "none"` per route:

```ts
{ pattern: "/discussions", component: List }                  // i18n auto
{ pattern: "/forum-admin", component: Admin, locale: "none" } // never localized
```

Default is `"auto"`. Plugin authors who don't think about i18n
get the right default; advanced plugins that handle locale
themselves (e.g. via their own param) opt out explicitly.

The route component receives `params.locale` when reached via the
prefixed path; it's `undefined` for the default-locale path.

### 2.7 Hot-reload: routes follow the plugin's enabled state

A plugin disabled via the existing enabled-gate
(`packages/core/src/plugins/enabled-gate.ts`) returns 404 from
its routes. The dispatcher checks `isPluginEnabled(pluginId)`
before invoking the component.

This mirrors how plugin hooks behave today: a disabled plugin's
hooks don't fire (`packages/core/src/plugins/host.ts`'s
`runHook` skips disabled plugins). Routes get the same gate so
operators can disable a plugin's UI without uninstalling the
package.

In v1, "disable" is admin-driven (the existing admin Plugins UI).
A future **install/uninstall** flow that adds/removes packages is
a v1.x concern.

### 2.8 Stability promise

Plugin routes follow the same semver shape as the rest of the
plugin SDK:

- The `pageRoutes` field on `definePlugin` is **stable** once
  shipped. Adding optional fields to each route entry is
  non-breaking.
- The `NpRouteRenderProps` shape is **shared** with theme routes
  — changes ride the existing v0.2 theme contract evolution.
- The source-precedence rule (theme > plugin > collection) is
  **stable**. Changing it would silently re-route URLs and is a
  major-bump-only change.

---

## 3. Goals

1. Plugin authors who today contribute blocks/patterns can also
   ship full public pages without writing route handlers in the
   reference app.
2. Operators who install a plugin via `pnpm add` get the
   plugin's UI working without copy-pasting from `apps/web`.
3. Themes retain full override authority (F.4–F.6 precedent).
4. The `apps/web/src/app/(site)/discussions/` routes move into
   `@nexpress/plugin-forum` as the first proof point.
5. The framework adds zero new abstractions — plugin routes
   reuse the F.2 dispatcher and `NpThemeRoute` shape.

## 4. Non-goals

- **Filesystem-based plugin routes.** Plugins don't put files in
  `apps/web/src/app/`; routes register through the SDK only.
- **Per-route caching control.** Same as F.2 — plugin authors
  use `unstable_cache(...)` inside their data fetches.
- **Middleware contribution.** Plugins can't intercept other
  plugins' or theme routes' requests in v1.
- **Plugin → plugin route override.** Two plugins shipping the
  same `/discussions` path log a warning and the dispatch order
  picks one (manifest order). Operators resolve by disabling
  one plugin.
- **Member route group injection beyond `surface: "member"`.**
  Plugins can't add new `(member)`-style scopes; they pick
  `"site"` or `"member"` from the existing two.

## 5. Contract additions

### 5.1 Plugin SDK type additions

```ts
// packages/plugin-sdk/src/types.ts (new fields on NpPluginConfig)

export interface NpPluginPageRoute extends NpThemeRoute {
  /**
   * Which shell wraps the rendered component. Defaults to
   * `"site"` (the theme's `impl.shell`). `"member"` uses the
   * theme's `impl.members.shell` and triggers the membership
   * gate (unauthenticated → /members/login).
   */
  surface?: "site" | "member";
  /**
   * Locale handling. `"auto"` (default) makes the route
   * reachable at both `/<path>` and `/<locale>/<path>` for
   * every configured locale. `"none"` keeps the path verbatim
   * (no locale prefix accepted).
   */
  locale?: "auto" | "none";
}

export interface NpPluginConfig {
  // ...existing fields...
  /**
   * Public page routes the plugin contributes. Resolved by the
   * site catch-all (`(site)/[[...slug]]`) after page-document
   * slug match and theme routes, before collection-derived
   * URLs. Plugin routes follow the plugin's enabled state.
   */
  pageRoutes?: NpPluginPageRoute[];
}
```

### 5.2 Core plugin host getter

```ts
// packages/core/src/plugins/host.ts

export function getPluginPageRoutes(): Array<{
  pluginId: string;
  route: NpPluginPageRoute;
}>;
```

Returns the flat list of registered routes from enabled plugins.
The dispatcher reads this once per request.

### 5.3 Route-dispatcher integration

```ts
// packages/next/src/route-dispatcher.ts (additions)

const themeRoutes = activeTheme?.impl.routes ?? [];
const pluginRoutes = getPluginPageRoutes();
const allRoutes = [
  ...themeRoutes.map((r) => ({ source: "theme", route: r })),
  ...pluginRoutes.map(({ route, pluginId }) => ({
    source: "plugin", pluginId, route,
  })),
];
// Match in order; theme entries appear first → win on collision.
```

The dispatcher logs a `warn` once-per-process per collision.

## 6. Reference implementation plan

Forum plugin is the first user.

### 6.1 Migration shape

Source files to move:

```
apps/web/src/app/(site)/discussions/
├── page.tsx              → packages/plugins/forum/src/routes/list.tsx
├── new/page.tsx          → packages/plugins/forum/src/routes/new.tsx
├── [slug]/page.tsx       → packages/plugins/forum/src/routes/detail.tsx
└── [slug]/edit/page.tsx  → packages/plugins/forum/src/routes/edit.tsx
```

Each file becomes a React component (no `export default async function Page()` wrapper — that's filesystem-routing convention; the plugin SDK takes a component directly).

`packages/plugins/forum/src/index.ts` adds:

```ts
import { DiscussionsList, NewDiscussion, DiscussionDetail, EditDiscussion } from "./routes/index.js";

export const forumPlugin = definePlugin({
  // ...existing manifest...
  pageRoutes: [
    { pattern: "/discussions", component: DiscussionsList },
    { pattern: "/discussions/new", component: NewDiscussion, surface: "member" },
    { pattern: "/discussions/:slug", component: DiscussionDetail },
    { pattern: "/discussions/:slug/edit", component: EditDiscussion, surface: "member" },
  ],
});
```

### 6.2 apps/web cleanup

After the plugin migration:

- Delete `apps/web/src/app/(site)/discussions/`
- Update `apps/web/tests/e2e/publish.spec.ts` if any spec
  navigates to `/discussions` (audit needed).
- The `forumPlugin` is already in `apps/web/src/nexpress.config.ts`
  (assumption — verify at implementation time). Routes show up
  for free.

## 7. Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Plugin authors expecting React Server Component lifecycle (`generateStaticParams` etc.) might be surprised by the SDK route shape (single component prop) | Doc the limitation; F.2 had the same trade-off and shipped |
| 2 | Style collision between plugin routes and theme tokens not catching every operator's customization | Reserve `--np-plugin-<id>-*` namespace early; document the escape path |
| 3 | Two plugins shipping the same path → the warn-and-resolve approach picks one silently at request time | Boot warning + admin Plugins surface flag for collisions; longer-term: explicit precedence config |
| 4 | i18n auto-prefix breaks for plugins that handle locale internally | The `locale: "none"` opt-out covers this; tested via at least one example in the implementation phase |
| 5 | Disabling a plugin yanks its routes — bookmarked links 404 | Documented behavior; admin UI can show "this URL came from plugin X" on the Plugins page |
| 6 | Theme override of plugin route silently overrides — operator confusion | Boot collision warning lists all sources; admin Health page mirrors |

## 8. Phasing

Six PRs, ordered:

1. **PRT.1** — `NpPluginPageRoute` type + `pageRoutes` field on
   `definePlugin` + `getPluginPageRoutes()` getter in plugin
   host. No dispatcher integration yet — types only, with
   isolation tests for the registry.
2. **PRT.2** — Route-dispatcher integration. Plugin routes
   resolved by the catch-all under the documented precedence.
   Boot-time collision warning. Includes the i18n auto-prefix
   handling and `surface: "member"` membership gate.
3. **PRT.3** — Forum plugin migration. Routes move into
   `packages/plugins/forum/src/routes/`. apps/web's
   `(site)/discussions/` deleted. e2e specs updated.
4. **PRT.4** — Admin Health page row + Plugins UI surface for
   plugin routes. Operator visibility into "what plugin owns
   what URL."
5. **PRT.5** — Documentation. `docs/plugin-quickstart.md`
   gains a "page routes" section; `docs/plugin-manifest.md`
   documents `pageRoutes`. Cross-references to F.2's theme
   route doc.
6. **PRT.6** — Stability promotion. After running the four PRT
   phases on at least one plugin (forum), promote the
   `pageRoutes` SDK field to **Stable** in AGENTS.md.

## 9. Deferred (record, don't lose)

- **Per-route middleware** — plugins can't intercept requests
  outside their own routes today. v1.x.
- **Plugin → plugin route override** — explicit precedence
  config (an operator-set `pluginRouteOverrides` map). Today's
  manifest order resolves implicitly. v1.x.
- **Filesystem-based plugin routes** — adding files to
  `apps/web/src/app/` from a plugin (à la WordPress
  drop-in directories) would let plugin authors use Next's
  full route conventions. Not worth the complexity in v1;
  programmatic registration covers the cases that matter.
- **Plugin route prerendering / ISR hints** — tied to F.2's
  same deferred item. v0.3+ for theme routes will likely
  bring plugin routes along.

## 10. Open questions (must resolve before implementation)

1. Does the plugin's `surface: "member"` route inherit the
   operator's theme's `impl.members.shell` in real-world themes?
   `theme-magazine` shipped F-track member-surface skinning; the
   other reference themes fall back to `impl.shell`. Verify the
   fallback chain works for plugin-served member routes too.
2. The `forumPlugin.manifest.provides.collections: []` is
   informational today. Should `pageRoutes` show up in
   `provides` for symmetry? Lean: yes, populate `provides.pageRoutes`
   so admin / agent surfaces can introspect.
3. Catch-all wildcard patterns (e.g. `/discussions/:slug*` for
   nested replies) are not in F.2's grammar. Forum doesn't need
   them; defer.

---

## 11. NOT in scope

- Plugin admin routes (different layer; `adminExtensions` already
  covers it).
- Plugin error boundaries (default same as theme routes — error
  bubbles up to the framework's error.tsx).
- Plugin route data fetching helpers beyond what `NpRouteRenderProps`
  already exposes.

## 12. Success criteria

- Forum plugin works end-to-end via `pnpm add @nexpress/plugin-forum`
  in a fresh `create-nexpress` project — `/discussions/*`
  routes resolve, render, and respond to member-only gates.
- Operator can override `/discussions/*` from a custom theme by
  declaring the same path in `theme.routes` — theme wins.
- Disabling forum plugin via admin UI 404s `/discussions/*`
  immediately on next request.
- Boot warning lists collisions; admin Health surfaces the same
  info.
- Contract surface stays small: one new field (`pageRoutes`) on
  `definePlugin`; one new type (`NpPluginPageRoute`); one
  dispatcher integration point.
