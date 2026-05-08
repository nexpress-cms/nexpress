---
"@nexpress/auth-pages": minor
"@nexpress/web": patch
---

**Phase 25.2 — staff auth route factory.**

Same factory model as #535's member-auth, applied to the staff
(admin) user pool. Each `apps/<app>/src/app/api/auth/<flow>/
route.ts` becomes 2 lines.

`@nexpress/auth-pages/server` now also exports
`createStaffAuthRoutes(config)` — parallel to
`createMemberAuthRoutes(config)`. The factory returns nine
handlers: `login`, `logout`, `refresh`, `forgotPassword`,
`resetPassword`, `changePassword`, `oauthStart`,
`oauthCallback`, `meGet`.

### Differences from member auth

The staff factory honors the existing reference-app behavior:

- **Different DB** — `np_users` (raw SQL via `db.$client.query`,
  matching the existing legacy code path).
- **Different fields** — `name` (vs `displayName`), `role` (vs
  `status`), no `handle`.
- **Different cookies** — `np-session`, `np-refresh`,
  `np-csrf`, `np-oauth-state` (vs the `np-mb-*` cookies).
- **No registration / verify** — staff are admin-provisioned, no
  pending state. The factory has no `register` or `verifyEmail`
  handler.
- **`changePassword` endpoint** — authenticated-user password
  change (member side handles this via `/me` PATCH instead).
- **Plugin hooks fire** — `auth:afterLogin` and
  `auth:beforeLogout` run as before; member auth has no
  equivalent.
- **Lockout config from env** — `getAuthRuntimeConfig()` reads
  `NP_MAX_LOGIN_ATTEMPTS` / `NP_LOCKOUT_DURATION`. Member uses
  hardcoded defaults (configurable via factory options).
- **`np-admin-site` cookie cleared on logout** — preserves the
  multi-site picker reset behavior (#15.7).
- **OAuth callback uses `resolveOAuthLogin`** — not
  `resolveMemberOAuthLogin`. Different identity-resolution
  policy (no email-match for staff, since staff accounts are
  pre-provisioned by admins).

### Reference app — fully migrated

All 9 staff routes shrunk from ~30-150 lines each to **2 lines**.
The `apps/web/src/lib/auth-routes.ts` bootstrap file now hosts
both `memberAuthRoutes` and `staffAuthRoutes` side-by-side; one
security patch landing in `@nexpress/auth-pages` fixes both pools
in every site at once.

### What's NOT in this PR (explicit defer to #3b)

- **Staff client form hooks** — `useStaffLogin`,
  `useStaffForgotPassword`, etc. The admin client forms
  (`apps/web/src/app/(admin)/admin/login/login-client.tsx` and
  friends) still ship hand-coded fetch logic. The route factory
  is the higher-impact security-patch surface; hooks follow in a
  separate PR once the routes prove stable.
- **Staff-specific scaffold updates** — `create-nexpress`
  templates still ship hand-coded staff routes. Updates to use
  the new factory follow once `@nexpress/auth-pages` clears one
  minor-version cycle (same pattern as the member-auth
  migration).

### Stability

`createStaffAuthRoutes`, `StaffAuthRoutes`,
`StaffAuthRoutesConfig`, `StaffAuthRoutesOptions`, and
`StaffAuthHelpersForRoutes` join v0.1's stable surface. Adding
optional fields to the config / options objects is non-breaking;
renaming or removing one rides a minor with a migration note.
