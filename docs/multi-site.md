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
10. [Single-Tenant Sites Are Unaffected](#10-single-tenant-sites-are-unaffected)

---

## 1. What "Multi-Site" Means Here

A single NexPress deployment can host **multiple independent
sites** keyed by hostname. Each site has its own:

- **Content rows** — every collection table carries a
  `site_id` column. Posts on `acme.example.com` are invisible
  to `partner-blog.example.com` and vice versa.
- **Navigation menus** — `nx_navigation` is scoped per site.
- **Settings** — `nx_settings` is scoped per site (active
  theme, theme tokens, SEO defaults, community config, plugin
  storage keys).
- **Memberships** — users can hold different roles on
  different sites via `nx_site_memberships`.
- **UI string overrides** — Phase D's `nx_string_overrides`
  is per-site too, so each tenant can re-translate plugin
  strings independently.

Shared across all sites:
- **Plugin and theme code** (installed once at deploy time)
- **User accounts** (`nx_users`)
- **Media** (`nx_media`) — uploaded files are global; each
  site's content references them via the same id.

---

## 2. Tenancy Model

WordPress Multisite-style (Polylang for content i18n,
Multisite for tenancy). Single-DB / single-schema; `site_id`
is a column on every tenant-scoped table.

```
nx_sites          ← one row per tenant
  ├─ nx_c_*       ← every collection table has site_id
  ├─ nx_settings  ← composite PK (site_id, key)
  ├─ nx_navigation
  ├─ nx_site_memberships
  ├─ nx_string_overrides
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

1. **`x-nx-admin-site` header** — the middleware forwards
   the `nx-admin-site` cookie (set by the admin site-picker)
   on `/admin` and `/api/admin` paths only. Lets a super-
   admin operate on any site without changing the URL.
2. **`x-nx-host` header** — middleware forwards the request
   `Host`. The bootstrap resolver does
   `resolveSiteForHostname()` which queries `nx_sites` for
   a matching row.
3. **Fallback to the default site** (`NX_DEFAULT_SITE_ID =
   "default"`). Always exists — migration 0015 seeds it.

Sites match the hostname **case-insensitively**. Multiple
hostnames pointing at the same site are not supported in
v15 (one row, one hostname); add a redirect at your CDN /
reverse proxy if you need apex + www.

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

`nx_settings` is keyed `(site_id, key)`. Helpers
(`getTheme`, `getNavigation`, `getActiveThemeId`,
`getSetting`, the settings/theme/navigation API routes)
all auto-scope via `getCurrentSiteId()`.

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

1. **Super-admin** — `nxUsers.is_super_admin = true`. Can
   manage every site, including create/delete tenants.
   Bypasses every per-site membership check.
2. **Per-site membership** — explicit row in
   `nx_site_memberships(site_id, user_id, role)`. The
   resolver returns this role for any check on that site.
3. **Global default role** — `nxUsers.role`. Used as the
   fallback when no membership exists. Single-tenant sites
   (no memberships) operate entirely off this.

Helper APIs:
- `resolveUserRoleOnSite(user, siteId)` — full chain.
- `hasRoleOnSite(user, minRole, siteId?)` — site-scoped
  variant of `hasRole()`.
- `isSuperAdmin(user)` — quick boolean check.

The framework's existing `hasRole(user, minRole)` keeps
working as a global check (used by routes that don't care
about site context, like `/api/auth/*`).

---

## 7. Admin Workflow

**Create a site** — Settings → Sites tab → "Add site". Set
the id (URL handle), name, and hostname. The hostname is
what the middleware matches request `Host` headers against.

**Switch site context** — admin topbar's site picker
(visible to super-admins always, and to non-super users when
they hold memberships on > 1 site). Selecting a site sets
`nx-admin-site=<id>` (HttpOnly, SameSite=Lax, Secure-in-prod,
30-day TTL). The override is scoped to admin paths — public
site rendering still uses `Host`.

**Manage memberships** — Settings → Sites → click "Members"
on a card. Search users by email, pick a role, click Grant.
Revoke flips back to the user's global default role.

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

**Site context cookie + load balancers**: the
`nx-admin-site` cookie is HttpOnly and tied to the request's
session. It works correctly across load-balanced workers
because the resolver reads it on every request — there's no
sticky-session requirement.

**Logout cookie hygiene**: `/api/auth/logout` clears
`nx-admin-site` alongside the session cookies (Phase 15.7).
Prevents stale site context for the next user on shared
devices.

**Search across sites**: the cross-collection search at
`/api/search` filters by current site. Super-admins who want
to search every tenant pass through the `siteId: "*"`
sentinel (admin-only escape hatch).

**Caching**: tag-based invalidation (Phase 14.1) is
unaffected by site scoping — `revalidateTag("nx:sitemap")`
busts the sitemap cache for every site at once. Per-site
caches can be added later via `nx:sitemap:{siteId}`-style
tags if traffic patterns warrant.

**Deletion safety**: deleting a site does NOT cascade to its
collection rows. The default site can never be deleted
(framework invariant). Operators retiring a tenant should
either soft-archive its content first, or drop the rows
manually before removing the row from `nx_sites`.

---

## 10. Single-Tenant Sites Are Unaffected

Every multi-site mechanism degrades cleanly for single-tenant
deployments:
- The migration seeds a default site row, so existing single-
  tenant code keeps writing to `site_id = 'default'`
  transparently.
- The resolver falls back to `NX_DEFAULT_SITE_ID` when no
  `x-nx-host` matches, so requests with no recognized
  hostname (e.g. local `localhost:3000`) resolve to default.
- The site picker hides itself when only one site is
  accessible, removing the noise.
- `hasRole()` keeps working as a global check; nothing in
  the existing role tree changed.

Sites that don't need multi-tenancy can ignore Phase 15
entirely — the framework treats them the same as before.
