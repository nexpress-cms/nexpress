---
"@nexpress/plugin-oauth-github": minor
"@nexpress/plugin-oauth-google": minor
---

feat(oauth-github, oauth-google): G.2.2 — declare configSchema with sensitive widget for clientSecret

Both OAuth plugins migrate to the G.1 auto-form path, exercising the `.meta({ sensitive: true })` widget end-to-end (introspector → form-renderer → `<Input type="password">`).

**Hybrid env-or-admin credential resolution.** Pre-G.2.2 the plugins read `NP_OAUTH_GITHUB_CLIENT_ID` / `NP_OAUTH_GITHUB_CLIENT_SECRET` (and Google equivalents) from env exclusively. The locked decision E (np_settings storage for plugin config) opens up a second path: operators can fill the admin form at `/admin/plugins/oauth-github` (or `/oauth-google`), and the plugin falls back to those values when env vars are unset.

**Env wins on a tie.** Existing 12-factor deploys upgrade unchanged — env-driven setup() takes precedence. The admin form acts as a fallback for self-service deploys that prefer DB-stored credentials.

Per-plugin schema:

```ts
// oauth-github
z.object({
  clientId: z.string().default(""),
  clientSecret: z.string().default("").meta({ sensitive: true }),
  scopes: z.array(z.string()).default(["read:user", "user:email"]),
})

// oauth-google (same shape, scopes default ["openid", "email", "profile"])
```

The scopes array introspects as `unsupported` in v0.2 of the F.3 introspector (only `z.array(z.object(...))` is supported). Operators can edit clientId/clientSecret via the form; scopes can be tuned via env override at startup or by a future introspector pass that handles `z.array(z.string())`.

**Reload required for admin-form changes.** `setup()` reads config once at boot. Updating the admin form saves to the DB but does NOT re-register the provider; operators must hit `/admin/plugins/reload` (or restart the process) for new credentials to take effect. Documented in both READMEs and the manifest description.

Manifest version bumped 0.2.0 → 0.3.0 in both plugins. Each plugin exports its config type (`GitHubOAuthConfig`, `GoogleOAuthConfig`) for plugin-author consumers; no `Np` prefix per the convention established in G.2.1.

**Atomic per-source credential rule.** When `NP_OAUTH_*_CLIENT_ID` is set but `NP_OAUTH_*_CLIENT_SECRET` is not (or vice versa), the plugin logs an error and refuses to register. Mixing env-managed clientId with DB-stored clientSecret (or any partial-env state) is almost always a misconfiguration; treating it as an explicit error stops Frankenstein credential pairs from quietly landing in production. Both env vars must be set together OR both unset (admin form fallback).

13 unit tests on oauth-github / 12 on oauth-google: schema defaults, populated credentials, scope defaults, sensitive-meta verification, manifest invariants, allowedHosts pinning, auto-form-replaces-fields rule, and the new credential-resolution suite (env source, admin source, env precedence on tie, partial-env error in both directions, no-credentials warn).

