# @nexpress/plugin-oauth-google

"Sign in with Google" plugin for
[NexPress](https://github.com/nexpress-cms/nexpress). Wires Google as an
OAuth provider for both staff and member auth pools. Honors
`email_verified` strictly — never links unverified Google addresses
to existing NexPress users by email.

## Install

```bash
pnpm add @nexpress/plugin-oauth-google
```

```ts
// nexpress.config.ts
import googleOAuth from "@nexpress/plugin-oauth-google";

export default defineConfig({
  // ...
  plugins: [googleOAuth],
});
```

## Configuration

Two paths — pick whichever fits the operator's secret-management story.
The plugin is safe to leave installed with no credentials; in that
case it logs an informational setup hint and registers no provider.

### 1. Environment variables (recommended for production)

```bash
NP_OAUTH_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
NP_OAUTH_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxx
```

Works with Doppler / 1Password CLI / AWS Secrets Manager / Kubernetes
secrets. Secrets never touch the database.

### 2. Admin auto-form

Open `/admin/plugins/oauth-google` after the framework boots. The G.1
auto-form renders these editable fields:

| Field         | Type              | Default                          |
| ------------- | ----------------- | -------------------------------- |
| Client ID     | text              | _empty_                          |
| Client secret | password (masked) | _empty_                          |
| Scopes        | one item per line | `openid`<br>`email`<br>`profile` |

Saved values persist to the current site's
`np_settings (key="plugin.config:oauth-google")` row.

### Precedence

**Env wins on a tie.** Set env to empty (or unset) to switch to
admin-form control.

Set both env vars or neither. A partial env source is treated as a
misconfiguration and the provider is not registered; run
`pnpm run doctor -- --fix-plan` to surface the same problem before boot.

### Request-time site isolation

The provider resolves activation, credentials, and scopes inside the current
site scope for each OAuth request. Admin-form changes take effect without
reload, and concurrent sites can use different OAuth apps without sharing
secrets.

## OAuth redirect URI

Register `${SITE_URL}/api/auth/oauth/google/callback` (staff pool)
and `${SITE_URL}/api/members/oauth/google/callback` (member pool) in
Google Cloud Console when both login surfaces should show Google.
Google OAuth web clients allow multiple Authorized redirect URIs, so
the bundled provider declares both audiences and one client can cover
both pools when both URLs are registered exactly.

## License

MIT
