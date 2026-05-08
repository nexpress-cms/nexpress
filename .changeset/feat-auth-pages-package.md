---
"@nexpress/auth-pages": minor
"@nexpress/web": patch
---

**Phase 24 — `@nexpress/auth-pages` package: framework-owned member auth.**

Until now, every nexpress site copied the full `/members/*` auth
flow (10 API routes + 6 page forms, ~700 lines of boilerplate)
out of the reference app and maintained it forever. Security
patches landing in core required sweeping every site's
`app/api/members/*` and `app/(site)/members/*`. New OAuth
provider, tightened rate limit, CSRF refinement — every change
rippled across N codebases.

The new `@nexpress/auth-pages` package owns layers 2 (HTTP) and
3 (form lifecycle) of the auth stack. Sites still own layer 4
(JSX, copy, brand) and layer 1 stays in `@nexpress/core/auth`
(crypto primitives, JWT, OAuth state). Result: routes shrink to
two lines, page forms become hooks + your own JSX, and security
patches flow through one package version bump.

### `@nexpress/auth-pages/server` — route factories

Bootstrap once per app:

```ts
// apps/<app>/src/lib/auth-routes.ts
export const memberAuthRoutes = createMemberAuthRoutes({
  getDb,
  ensureFor,
  authHelpers: { setMemberAuthCookies, clearMemberAuthCookies, getMemberAuthRuntimeConfig, requireMember },
  site: { name, url },
  options: { /* per-flow knobs — all optional */ },
});
```

The factory returns one handler per flow:
`login`, `register`, `logout`, `refresh`, `verifyEmail`,
`forgotPassword`, `resetPassword`, `oauthStart`, `oauthCallback`,
`meGet`, `mePatch`, `meDelete`. Each route file becomes:

```ts
// app/api/members/login/route.ts
import { memberAuthRoutes } from "@/lib/auth-routes";
export const POST = memberAuthRoutes.login;
```

Behavior is **byte-for-byte identical** to the existing reference
app: same anti-enumeration responses, same 5-attempt / 15-min
lockout, same 24h email-verify TTL, same OAuth state-cookie
flow, same JWT mint + session-row persistence, same logout
revocation, same `?oauth_error=<code>` failure redirects. All
configurable knobs (max attempts, password min length, token
TTLs, OAuth redirects) have defaults that match what the
reference app already shipped.

### `@nexpress/auth-pages/client` — headless hooks

Six React hooks, one per form page:

- `useMemberLogin` — email/password sign-in
- `useMemberRegister` — handle/email/password/displayName signup
- `useMemberLogout` — POST /logout, clear cookies
- `useMemberVerifyEmail({ token, autoVerify? })` — consumes verify token on mount
- `useMemberForgotPassword` — request reset email
- `useMemberResetPassword({ token })` — set new password from email link

Each returns `{ fields, errors, isSubmitting, isSuccess, submit }`
(or the relevant subset). `fields.email` is `{ value, onChange }`
spread directly onto an `<input>`. `errors._form` carries the
top-level error string; `errors.email` / `errors.password` etc.
carry per-field validation messages from the server's
`error.details` array.

Customizable per call:
- `endpoint?: string` — default `/api/members/<flow>`, override
  for sites that mount differently
- `messages?: Partial<Record<NpAuthErrorCode, string>>` — i18n
  override for any of the 10 stable error codes
- `onSuccess?`, `onError?` — analytics / redirect callbacks

### Reference app migration

All 10 routes + all 5 form components migrated to the new
package. Each route file went from ~50-150 lines to 2 lines;
each form component dropped its inline `fetch` + error-mapping
boilerplate (~30-50 lines each) for one hook call.

Net diff: ~700 lines removed from `apps/web`, ~1500 lines added
to `@nexpress/auth-pages` (most of which is the factory
implementation that used to live in apps).

### Stability

`@nexpress/auth-pages` is published at `0.1.0` and joins v0.1's
stable surface:

- The 12 route handlers and their config option shapes
- The 6 hooks and their `Use*Options` / `Use*Result` types
- `NpAuthErrorCode` union (10 codes — adding a new code is a
  non-breaking minor; renaming or removing one rides a minor
  with a migration note)
- `DEFAULT_AUTH_MESSAGES` shape

The `MemberAuthHelpersForRoutes` interface (the subset of
`@nexpress/next.MemberAuthHelpers` the factory consumes) is
also stable — sites that don't use `createMemberAuthHelpers`
verbatim can still wire the factory by supplying matching
methods.

### What's NOT in this PR

- Default OAuth providers (Google/GitHub/etc.) — `getOAuthProvider`
  registry stays as-is; framework-shipped providers are a
  separate decision (which providers, what config defaults, who
  pays the dependency cost) for a follow-up PR.
- Staff auth (`/api/auth/*`) migration — same pattern, separate
  scope. Member auth is the higher-traffic surface; staff auth
  follows after this validates.
- CLI scaffold update — `create-nexpress` templates still ship
  the full hand-coded flow; once `@nexpress/auth-pages` is
  stable across one minor cycle, the scaffold flips to the new
  pattern (separate PR).
- Notification preferences (`/api/members/me/notification-prefs`)
  — domain-specific (sites add custom kinds), stays app-side.
