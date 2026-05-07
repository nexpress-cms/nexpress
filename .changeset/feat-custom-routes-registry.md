---
"@nexpress/core": minor
"@nexpress/admin": minor
---

**Custom routes registry — surface hand-coded Next.js routes in the admin.**

Hand-coded site routes (e.g. `apps/web/src/app/(site)/blog/page.tsx`)
were invisible to the framework: the catch-all `[[...slug]]` only knows
CMS pages, plugins declare their own routes via `definePlugin({ routes })`,
and operators had to type `/blog` into the navigation editor's link
field by hand with no discovery surface.

A new minimal registry closes the gap without scanning the filesystem
(too brittle given Next's route-group / parallel-route / intercepting-route
expressiveness — a static manifest would lie):

- **`@nexpress/core/routes`** — a new domain subpath exposes
  `registerCustomRoute({ path, label, description?, icon?, group? })`,
  `getCustomRoutes()`, `clearCustomRoutes()`, and the `NpCustomRoute`
  type. Re-registering the same `path` overwrites silently (HMR-safe,
  matching the block registry convention). Symbols are also re-exported
  from the root `@nexpress/core` for back-compat. Stable in 0.x — adding
  optional fields to `NpCustomRoute` is non-breaking; renaming or
  removing one rides a minor with a migration note.
- **App boot** registers each navigable route once. The reference app
  declares `/blog`, `/search`, `/discussions`, `/discussions/new`,
  `/members/login`, `/members/register`, and `/members/me` from
  `apps/web/src/lib/custom-routes.ts`, called by `ensureFor("read")`.
- **Settings → Routes** (read-only list, capability-gated on
  `admin.manage`) shows every registered route grouped by `group`.
  No write operations — routes are code-owned by definition.
- **Navigation editor** attaches a native `<datalist>` to the link URL
  input so operators can pick `/blog` from a dropdown instead of
  typing. Dynamic routes (`/u/[handle]`) are excluded from the
  autocomplete because a literal href can't be derived without input,
  but they still appear in the Routes tab tagged `dynamic`.

Plugin-contributed routes are not affected — they continue to be
listed under each plugin's "Show details" panel in the Plugins
manager.
