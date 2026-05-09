# @nexpress/plugin-oauth-google

"Sign in with Google" plugin for
[NexPress](https://github.com/hahabsw/nexpress). Wires Google as an
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

| Field         | Type                | Default                              |
|---------------|---------------------|--------------------------------------|
| Client ID     | text                | _empty_                              |
| Client secret | password (masked)   | _empty_                              |
| Scopes        | one item per line   | `openid`<br>`email`<br>`profile`     |

Saved values persist to `np_settings (key="plugin.config:oauth-google")`.

### Precedence

**Env wins on a tie.** Set env to empty (or unset) to switch to
admin-form control.

### Reload required for admin-form changes

`setup()` reads credentials once at boot. Updating the admin form
saves to the DB but does NOT re-register the provider; visit
`/admin/plugins/reload` (or restart the process) for the new values
to take effect.

## OAuth redirect URI

Register `${SITE_URL}/api/auth/oauth/google/callback` (staff pool)
and / or `${SITE_URL}/api/members/oauth/google/callback` (member
pool) in Google Cloud Console. The provider registry is shared — a
single registered provider works for both pools.

## License

MIT
