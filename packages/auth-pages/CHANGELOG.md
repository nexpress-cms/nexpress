# @nexpress/auth-pages

## 0.2.0

### Minor Changes

- 6dcb8ee: **Phase 24 — `@nexpress/auth-pages` package: framework-owned member auth.**

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
    authHelpers: {
      setMemberAuthCookies,
      clearMemberAuthCookies,
      getMemberAuthRuntimeConfig,
      requireMember,
    },
    site: { name, url },
    options: {
      /* per-flow knobs — all optional */
    },
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

- aa7796d: **Phase 25.2 — staff auth route factory.**

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

### Patch Changes

- f5df65e: **Security: fix host-header injection in password-reset / email-verify links + tenant smuggling via `?where=` (#598).**

  Two HIGH-severity findings from the security review, both closed at the trust boundary.

  ### Vuln 1: Host-header injection (password-reset poisoning)

  When `SITE_URL` is unset, `siteUrl(config, request)` in
  `@nexpress/auth-pages` fell back to `new URL(request.url)`. In
  Next.js, an API route's `request.url` is constructed from the
  attacker-controlled `Host` header. The `forgotPassword` and
  member-`register` flows embedded that base URL as `resetUrl` /
  `verifyUrl` in the email-job payload, so an attacker could spoof
  `Host: attacker.example` on `POST /api/auth/forgot-password` and
  get the framework to mail a real password-reset token inside an
  `https://attacker.example/...` URL — full account takeover.

  **Fix.** New `siteUrlStrict(config)` helper (in a small
  testable `site-url.ts` module) throws when `config.site.url` is
  unset — never falls back to `request.url`. Email-link builders
  (`buildResetUrl`, `buildVerifyUrl`) call the strict variant.
  Same-origin redirects (OAuth callbacks, post-login bounces) keep
  using the lenient variant — the Host fallback is safe there
  because the user's browser is going back to the same host they
  came from.

  The `forgotPassword` and `register` route handlers also call
  `siteUrlStrict()` upfront, BEFORE any account-existence check,
  so the failure mode is uniform for real and fake emails when
  `SITE_URL` is unset (avoids a regression where missing config
  would leak account existence via differential responses).

  8 unit tests in `site-url.test.ts` pin both the lenient and
  strict semantics including the Host-injection regression.

  ### Vuln 2: Tenant + visibility smuggling via `?where=`

  `parseWhere` in `@nexpress/next/collections` accepted any JSON
  object as the `?where=` query parameter without filtering
  reserved keys. The pipeline interprets `where.siteId === "*"`
  and `where.visibility === "*"` as trusted-caller sentinels for
  admin-side cross-site / cross-visibility queries. With no
  caller-side capability check, an anonymous request could send
  `GET /api/collections/posts?where={"siteId":"*","visibility":"*","status":"published"}`
  to read `visibility=private` posts from sibling tenants on a
  multi-tenant deployment.

  **Fix.** `parseWhere` now strips the reserved keys (`siteId`,
  `visibility`) from user-supplied JSON before forwarding. The
  pipeline still honors the wildcards when an INTERNAL caller
  passes them programmatically (admin export tools build the
  where dict in TypeScript, not from a request); the gate lives
  at the trust boundary where it's auditable.

  4 new test cases in `collections.test.ts` pin the strip
  behavior and confirm non-reserved keys pass through verbatim.

- Updated dependencies [5103c65]
- Updated dependencies [b9a4e08]
- Updated dependencies [131be43]
- Updated dependencies [4ebf2b4]
- Updated dependencies [5203fd7]
- Updated dependencies [9f3a81b]
- Updated dependencies [65da716]
- Updated dependencies [0c59b98]
- Updated dependencies [f778e80]
- Updated dependencies [89c32db]
- Updated dependencies [53627e1]
- Updated dependencies [98d3a4e]
- Updated dependencies [6657059]
- Updated dependencies [ae0c053]
- Updated dependencies [a107c8a]
- Updated dependencies [f98fe9c]
- Updated dependencies [9f3a81b]
- Updated dependencies [d3ea817]
- Updated dependencies [580f0f2]
- Updated dependencies [f239ce0]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [ad7ea4e]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [930d0d4]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [7b61ba8]
- Updated dependencies [463fe5f]
- Updated dependencies [09a7b75]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [ab55980]
- Updated dependencies [41ac5d2]
- Updated dependencies [f5df65e]
- Updated dependencies [b42d8ff]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [f590247]
  - @nexpress/core@1.0.0
  - @nexpress/next@1.0.0
