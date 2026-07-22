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
The plugin is safe to leave installed with no credentials; in that
case it logs an informational setup hint and registers no provider.

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

| Field         | Type              | Default                     |
| ------------- | ----------------- | --------------------------- |
| Client ID     | text              | _empty_                     |
| Client secret | password (masked) | _empty_                     |
| Scopes        | one item per line | `read:user`<br>`user:email` |
| Audience      | select            | `staff`                     |

Saved values persist to the current site's
`np_settings (key="plugin.config:oauth-github")` row.

### Precedence

**Env wins on a tie.** When `NP_OAUTH_GITHUB_CLIENT_ID` /
`NP_OAUTH_GITHUB_CLIENT_SECRET` are non-empty, the admin-form values
are ignored — env-driven deploys upgrade safely without surprise. Set
the env vars to empty (or unset them) to switch to admin-form
control. The Audience field still comes from plugin config and
defaults to `staff`.

Set both env vars or neither. A partial env source is treated as a
misconfiguration and the provider is not registered; run
`pnpm run doctor -- --fix-plan` to surface the same problem before boot.

### Request-time site isolation

The provider resolves activation, credentials, scopes, and Audience inside the
current site scope for each OAuth request. Admin-form changes take effect
without reload, and concurrent sites can use different OAuth apps or audiences
without sharing secrets.

## OAuth app callback URL

Register exactly the callback URL for the configured Audience:

- `staff`: `${SITE_URL}/api/auth/oauth/github/callback`
- `member`: `${SITE_URL}/api/members/oauth/github/callback`

GitHub OAuth Apps accept one Authorization callback URL. The bundled
plugin therefore exposes one `github` provider to one login surface at
a time, defaulting to staff. Switch Audience to `member` only when the
GitHub OAuth App is registered for the member callback.

## License

MIT
