# @nexpress/plugin-oauth-github

"Sign in with GitHub" plugin for
[NexPress](https://github.com/nexpress-cms/nexpress). Wires GitHub as an
OAuth provider for both staff and member auth pools.

## Install

```bash
pnpm add @nexpress/plugin-oauth-github
```

```ts
// nexpress.config.ts
import githubOAuth from "@nexpress/plugin-oauth-github";

export default defineConfig({
  // ...
  plugins: [githubOAuth],
});
```

## Configuration

Two paths — pick whichever fits the operator's secret-management story.

### 1. Environment variables (recommended for production)

```bash
NP_OAUTH_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
NP_OAUTH_GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

Works with Doppler / 1Password CLI / AWS Secrets Manager / Kubernetes
secrets — anything that injects env at boot. Secrets never touch the
database.

### 2. Admin auto-form

Open `/admin/plugins/oauth-github` after the framework boots. The G.1
auto-form renders these editable fields:

| Field         | Type                | Default                          |
|---------------|---------------------|----------------------------------|
| Client ID     | text                | _empty_                          |
| Client secret | password (masked)   | _empty_                          |
| Scopes        | one item per line   | `read:user`<br>`user:email`      |

Saved values persist to `np_settings (key="plugin.config:oauth-github")`.

### Precedence

**Env wins on a tie.** When `NP_OAUTH_GITHUB_CLIENT_ID` /
`NP_OAUTH_GITHUB_CLIENT_SECRET` are non-empty, the admin-form values
are ignored — env-driven deploys upgrade safely without surprise. Set
the env vars to empty (or unset them) to switch to admin-form
control.

### Reload required for admin-form changes

`setup()` reads credentials once at boot. Updating the admin form
saves to the DB but does NOT re-register the provider; visit
`/admin/plugins/reload` (or restart the process) for the new values
to take effect.

## OAuth app callback URL

Register `${SITE_URL}/api/auth/oauth/github/callback` (staff pool)
and / or `${SITE_URL}/api/members/oauth/github/callback` (member
pool) in the GitHub OAuth app settings. The provider registry is
shared — a single registered provider works for both pools.

## License

MIT
