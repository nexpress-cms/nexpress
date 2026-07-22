# Multi-Site / Multi-Tenancy

> Phase 15 (sub-phases 15.1–15.8) ships NexPress's multi-site
> system. One deployment, many tenants — each with its own
> content, navigation, settings, theme activation, and access
> grants.

---

## Table of Contents

1. [What "Multi-Site" Means Here](#1-what-multi-site-means-here)
2. [Tenancy Model](#2-tenancy-model)
3. [Site Resolution](#3-site-resolution)
4. [Collection Scoping](#4-collection-scoping)
5. [Per-Site Settings](#5-per-site-settings)
6. [Permissions](#6-permissions)
7. [Admin Workflow](#7-admin-workflow)
8. [CLI](#8-cli)
9. [Operational Notes](#9-operational-notes)
   9.5. [What's NOT Site-Scoped (Yet)](#95-whats-not-site-scoped-yet)
10. [Single-Tenant Sites Are Unaffected](#10-single-tenant-sites-are-unaffected)

---

## 1. What "Multi-Site" Means Here

A single NexPress deployment can host **multiple independent
sites** keyed by hostname. Each site has its own:

- **Content rows** — every collection table carries a
  `site_id` column. Posts on `acme.example.com` are invisible
  to `partner-blog.example.com` and vice versa.
- **Navigation menus** — `np_navigation` is scoped per site.
- **Settings** — `np_settings` is scoped per site (active
  theme, theme tokens, SEO defaults, community config, plugin
  storage keys).
- **Memberships** — users can hold different roles on
  different sites via `np_site_memberships`.
- **UI string overrides** — Phase D's `np_string_overrides`
  is per-site too, so each tenant can re-translate plugin
  strings independently.

Shared across all sites:

- **Plugin and theme code** (installed once at deploy time)
- **User accounts** (`np_users`)
- **Media** (`np_media`) — uploaded files are global; each
  site's content references them via the same id.

---

## 2. Tenancy Model

WordPress Multisite-style (Polylang for content i18n,
Multisite for tenancy). Single-DB / single-schema; `site_id`
is a column on every tenant-scoped table.

```
np_sites          ← one row per tenant
  ├─ np_c_*       ← every collection table has site_id
  ├─ np_settings  ← composite PK (site_id, key)
  ├─ np_navigation
  ├─ np_site_memberships
  ├─ np_string_overrides
```

**Why this model**:

- One DB / schema simplifies migrations (no per-tenant
  schema drift).
- `site_id` columns + per-query filters give tenant
  isolation at the read/write layer.
- The framework's `getCurrentSiteId()` resolver makes
  scoping invisible to call sites — collection helpers
  auto-filter, write helpers auto-stamp.

**Tradeoffs**:

- Every collection query carries a `WHERE site_id = $1`
  clause. Index your collection tables on `(site_id, …)` for
  the columns you actually query (the codegen does this for
  the slug index automatically).
- Tenant data isolation is logical, not physical. A bug in
  the pipeline that bypassed the resolver would leak across
  tenants. The resolver path is heavily tested but operators
  with hard-isolation needs (regulated data, separate
  databases) should run separate NexPress instances per
  tenant instead.

---

## 3. Site Resolution

Per-request, in priority order:

1. **`x-np-admin-site` header** — the proxy forwards
   the `np-admin-site` cookie (set by the admin site-picker)
   on `/admin` and `/api/admin` paths only. Lets a super-
   admin operate on any site without changing the URL.
2. **`x-np-host` header** — the proxy forwards the request
   `Host`. The bootstrap resolver does
   `resolveSiteForHostname()` which queries `np_sites` for
   a matching row.
3. **Fallback to the default site** (`NP_DEFAULT_SITE_ID =
"default"`). Always exists — migration 0015 seeds it.

Sites match the hostname **case-insensitively**. Multiple
hostnames pointing at the same site are not supported in
v15 (one row, one hostname); add a redirect at your CDN /
reverse proxy if you need apex + www.

### Execution context

The Next adapter installs a process-level fallback resolver that reads the
current request headers. Explicit application, CLI, test, and worker work uses
`withCurrentSite(siteId, callback)`, which takes precedence over that fallback
and stores the site in Node's `AsyncLocalStorage`.

Async-local scopes are isolated across concurrent requests, restore the outer
site after nested calls, and follow async resources created inside the
callback. Resetting the fallback resolver does not erase active scopes. Site
ids from either source must use the canonical lowercase
`^[a-z][a-z0-9-]{0,62}$` contract; malformed values fail instead of selecting
the default tenant.

```ts
import { withCurrentSite } from "@nexpress/core";

await Promise.all([
  withCurrentSite("tenant-a", () => rebuildSiteIndex()),
  withCurrentSite("tenant-b", () => rebuildSiteIndex()),
]);
```

An async-local scope cannot cross a durable queue boundary: a pg-boss worker
claim is a new execution graph, potentially in another process. Site-aware
jobs therefore persist `siteId` in their exact payload and register a
`resolveSiteId` projection. The handler registry validates the payload again,
then wraps the entire dispatch in the resolved site scope. NexPress does this
for `content:afterSave` and `content:afterDelete`; scheduled publishing also
runs each document's hooks and follow-up job in that document's site.

---

## 4. Collection Scoping

Codegen unconditionally adds `site_id text NOT NULL DEFAULT
'default'` to every collection table. Slug uniqueness becomes
`(site_id, slug)` (or `(site_id, locale, slug)` for i18n
collections — Phase 12.1 slot stays).

Pipeline behavior:

- **Writes**: `site_id` is stamped from `getCurrentSiteId()`
  on creates; updates inherit the original row's site (body
  fields can't reassign).
- **Reads**: `findDocuments` auto-filters by current site.
  Pass `where: { siteId: "*" }` for super-admin cross-site
  reads (sentinel that drops the filter).

---

## 5. Per-Site Settings

`np_sites` owns the canonical site name, description, URL, default locale, and
timezone. `np_settings` is a closed framework registry keyed `(site_id, key)`.
Helpers (`getTheme`, `getNavigation`, `getActiveThemeId`, domain settings
services, and the settings/theme/navigation API routes) all auto-scope via
`getCurrentSiteId()`. See [settings.md](settings.md) for the exact key and value
inventory.

This means each site can:

- Pick its own active theme (Phase 11.4 switcher writes per-
  site `activeTheme`)
- Customize theme tokens independently (Phase 11.x token
  editor)
- Have its own header/footer menus (Phase 12.x navigation)
- Override plugin/theme UI strings per-site (Phase D)

---

## 6. Permissions

Three tiers, in priority order:

1. **Super-admin** — `npUsers.is_super_admin = true`. Can
   manage every site, including create/delete tenants.
   Bypasses every per-site membership check.
2. **Per-site membership** — explicit row in
   `np_site_memberships(site_id, user_id, role)`. The
   capability check uses this role for that site.
3. **Global default role** — `npUsers.role`. Used as the
   fallback only for the reserved `default` site. A global
   admin, editor, moderator, author, or viewer has no implied
   access to any non-default tenant.

Helper APIs:

- `canOnSite(user, capability, siteId?)` — the single
  site-scoped authorization entry point. It reads the persisted
  user and membership rows, confirms the site exists, and then
  applies the same named capability table as `can()`. When
  `siteId` is omitted it uses the current execution context and
  then the reserved default site.
- `resolveSiteAuthUser(user, siteId?)` — projects a verified staff
  user onto that site's effective persisted role. The app auth
  helpers apply this before route gates and collection access
  functions run, so downstream code never authorizes against a
  stale global role in a non-default tenant.

Global operator surfaces (for example cross-site jobs, staff identity
management, and plugin code reload) deliberately use the persisted global role
instead. Plugin activation and configuration are scoped to the selected site
and use its projected `admin.manage` capability. A per-site `admin` membership
never promotes its holder into a cross-tenant operator.

- `isSuperAdmin(user)` — quick boolean check.

Import server-side registry and authorization helpers from
`@nexpress/core/sites`. The root export remains available as the broad
compatibility surface.

For non-site-scoped checks (e.g. `/api/auth/*` routes that
don't care about tenant boundaries), use `can(user, capability)`
from `@nexpress/core/auth` (`"site.access"`, `"admin.manage"`,
`"content.publish"`, `"content.author"`,
`"community.moderate"`). The legacy global `hasRole(user,
minRole)` was retired in #273; capability strings replace it
because they describe the _behavior_ a route gates on rather
than a role-rank comparison.

There is deliberately no numeric site-role hierarchy. `author`
and `moderator` are parallel: both can satisfy `content.author`,
but only moderator satisfies `community.moderate`; neither can
publish. This prevents an apparently harmless rank comparison
from granting the wrong domain permission.

The client-safe `@nexpress/core/settings` subpath exposes the exact
site create/update, persisted/wire record, membership, and usage
contracts. Core registry calls and Admin API handlers use the same
normalizers, while Admin clients validate every returned wire row.

---

## 7. Admin Workflow

**Create a site** — Settings → Sites tab → "Add site". Set
the id (URL handle), name, and hostname. The hostname is
what the proxy matches request `Host` headers against.

**Switch site context** — admin topbar's site picker
(visible to super-admins always, and to non-super users when
they hold memberships on > 1 site). Selecting a site sets
`np-admin-site=<id>` (HttpOnly, SameSite=Lax, Secure-in-prod,
30-day TTL). The override is scoped to admin paths — public
site rendering still uses `Host`. The picker list, switch, and
clear endpoints authenticate outside the current site context and
then authorize the requested target. This lets an operator recover
when a saved site's membership has been revoked since the cookie
was issued.

**Manage memberships** — Settings → Sites → click "Members"
on a card. Search users by email, pick a role, click Grant.
On the default site, revocation exposes the user's global role
again. On every other site, revocation removes access entirely.

**Promote a super-admin** — Use the CLI (`pnpm super-admin
<email>`) for the first one (bootstrap chicken-and-egg).
Subsequent promotions go through the admin user page's
super-admin toggle (only existing super-admins can promote).

**Override UI strings** — Settings → Strings tab. Lists
every key registered by plugins and themes; admins can patch
them per-site.

---

## 8. CLI

```bash
# Promote a user to super-admin
pnpm super-admin alice@example.com
# Demote
pnpm super-admin --demote alice@example.com

# Seed sample content for a specific site
pnpm seed:content --site=acme
# (No flag → seeds the default site, matching pre-15.8
# behavior.)
```

The `super-admin` CLI bypasses the API gate (which requires
an existing super-admin) by writing directly via Drizzle —
that's the bootstrap path for the first promotion.

---

## 9. Operational Notes

**Site context cookie + load balancers**: the `np-admin-site` cookie is
HttpOnly and tied to the request's session. It works correctly across
load-balanced workers because the fallback resolver reads it on every request
and async-local execution state is never shared between processes — there's no
sticky-session requirement.

**Logout cookie hygiene**: `/api/auth/logout` clears
`np-admin-site` alongside the session cookies (Phase 15.7).
Prevents stale site context for the next user on shared
devices.

**Search across sites**: the cross-collection search at
`/api/search` filters by current site. Super-admins who want
to search every tenant pass through the `siteId: "*"`
sentinel (admin-only escape hatch).

**Caching** (Phase 14.8 + 15.10): cache wrappers and
invalidation are both site-scoped. `getCachedTheme()`,
`getCachedNavigation()`, the sitemap cache, the feed cache,
and the search cache all key on the resolved siteId, with
matching `nx:theme:<siteId>` / `nx:nav:<siteId>:<location>` /
`nx:sitemap:<siteId>` / `nx:feed:<siteId>:<collection>` /
`nx:search:<siteId>` tags. The legacy global tags are kept
alongside as a "blow away every site" big hammer for plugins
and external CDN purgers.

**Per-site origin** (Phase 15.11): `sitemap.xml` and
`robots.txt` resolve the absolute origin from the active
site's `hostname` row when one is configured. Multi-tenant
deploys emit the right URLs per tenant; single-tenant deploys
keep the `SITE_URL` env fallback.

**Deletion safety** (Phase 15.9): `deleteSite()` defaults to
the safe path — refuses if any site-scoped data exists
(registered collections plus every site-scoped framework/community table,
including slug history, in
the usage contract). Pass `cascade: true` (or `?cascade=true` on
the admin API) to delete the dependent rows alongside. The usage
scan, dependent deletes, and registry delete run in one transaction;
an unavailable collection table or any delete failure aborts and
rolls back the whole operation. Collection-owned revision history and
media-reference rows are also removed by collection/document id even
though those global tables do not carry `site_id`. The admin UI validates
and displays the same exact site-scoped count contract before asking for
confirmation.

`default` is a reserved, permanent id: its row must have
`isDefault=true`, every other row must have `isDefault=false`, and
there is no promotion/reassignment operation. `nexpress doctor` checks
this invariant together with malformed and orphaned membership and
settings rows.

---

## 9.5. What's NOT Site-Scoped (Yet)

A few system surfaces are intentionally global today.
Listed here so operators reasoning about multi-tenant
isolation know where the boundary stops:

- **`np_users`** — accounts are global. Memberships
  (Phase 15.5+) decide which sites a user has rights on,
  so the intent is "one identity, many tenants."
- **`np_media`** — uploads share a single bucket. Each
  site's content references media by id; the same image
  can be reused across tenants. A future "per-site media
  ownership" surface would need a new column +
  access-control hook. **Still a gap.**
- **`np_audit_events`** — Phase 17 added a nullable
  `site_id` column + index. `recordAuditEvent` fills it
  from the current request's resolved site, so the audit
  list can filter by tenant. Events without a request
  scope (super-admin actions, scripts) leave it null.
- **`np_plugin_storage`** — Phase 17 made the table
  site-scoped: PK is `(plugin_id, site_id, key)` with a
  default of `NP_GLOBAL_PLUGIN_SITE_ID` for plugins that
  want shared state. Plugins use `ctx.storage` and pass
  the active site through automatically.
- **`np_comments` / `np_reactions` / `np_follows` /
  `np_member_mutes` / `np_notifications` / `np_reports` /
  `np_bans`** — Phase 18 added `site_id` columns + indexes
  so per-site queues, mutes, mod reports, and notification
  inboxes are first-class. `np_members` is intentionally
  still global (one identity, many tenants); per-site
  member roles live in `np_member_roles` keyed on
  `(site_id, member_id)`.

---

## 10. Single-Tenant Sites Are Unaffected

Every multi-site mechanism degrades cleanly for single-tenant
deployments:

- The migration seeds a default site row, so existing single-
  tenant code keeps writing to `site_id = 'default'`
  transparently.
- The resolver falls back to `NP_DEFAULT_SITE_ID` when no
  `x-np-host` matches, so requests with no recognized
  hostname (e.g. local `localhost:3000`) resolve to default.
- The site picker hides itself when only one site is
  accessible, removing the noise.
- Global operator routes keep the persisted global role and use
  `can(user, capability)`. Site-scoped request auth projects the
  persisted effective site role before route and collection policy
  checks; explicit target checks call the canonical `canOnSite()`
  helper. Both use one named capability table rather than a numeric
  role tree.

Sites that don't need multi-tenancy can ignore Phase 15
entirely — the framework treats them the same as before.
