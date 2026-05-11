# @nexpress/oauth-providers

## 0.2.0

### Minor Changes

- f82ed03: **`@nexpress/oauth-providers` — framework-shipped OAuth provider factories.**

  Until now, OAuth providers were only available through the plugin
  lifecycle (`@nexpress/plugin-oauth-google`,
  `@nexpress/plugin-oauth-github`). Sites that wanted to register
  providers from their own boot code (or anywhere outside a plugin's
  `setup()`) had to copy the factory bodies into their codebase.
  The factories themselves were tested + shipped inside packages
  called `plugin-*`, which made the framework-vs-plugin boundary
  unclear.

  The new `@nexpress/oauth-providers` package extracts the pure
  factory functions into a framework-owned, plugin-free package:
  - **`createGoogleOAuthProvider({ clientId, clientSecret })`** —
    honors `email_verified === true` strictly so unverified Google
    addresses never reach the email-match identity path.
  - **`createGitHubOAuthProvider({ clientId, clientSecret })`** —
    falls back to `/user/emails` for the verified primary when
    `/user.email` is null (GitHub privacy default).
  - **`createDiscordOAuthProvider({ clientId, clientSecret })`** —
    NEW. Honors `verified === true`, prefers `global_name` over
    `username`, constructs CDN avatar URLs from the user's hash,
    drops default avatars (no stable URL).

  Each factory exposes its profile fetcher as a separate export
  (`fetchGoogleProfile`, `fetchGitHubProfile`, `fetchDiscordProfile`)
  so tests can exercise the provider-specific normalization logic
  without going through arctic's token-exchange dance.

  ### Plugin packages

  `@nexpress/plugin-oauth-google` and `@nexpress/plugin-oauth-github`
  are unchanged from a consumer's perspective — they still expose
  the same `googleOAuthPlugin` / `githubOAuthPlugin` exports for
  sites that wire OAuth through `nexpressConfig.plugins`. Internally,
  they now import the factories from `@nexpress/oauth-providers`
  instead of bundling their own arctic wrappers, and re-export the
  factory + helper names for back-compat with sites that imported
  them from the plugin package directly.

  ### Stability

  `@nexpress/oauth-providers@0.1.0` joins v0.1's stable surface:
  - Three factory functions: `createGoogleOAuthProvider`,
    `createGitHubOAuthProvider`, `createDiscordOAuthProvider`
  - Three profile fetchers: `fetchGoogleProfile`,
    `fetchGitHubProfile`, `fetchDiscordProfile`
  - Three option types: `GoogleOAuthOptions`, `GitHubOAuthOptions`,
    `DiscordOAuthOptions`

  Adding a new provider is a non-breaking minor; renaming or
  removing one rides a minor with a migration note. Adding optional
  fields to the option objects is non-breaking; new providers will
  follow the same `{ clientId, clientSecret, scopes?, fetch? }`
  shape.

  ### What's NOT in this PR
  - **Apple, Microsoft, Twitter/X** — arctic supports them but each
    has provider-specific quirks (Apple needs JWT-signed client
    secrets from a private key; X's API has stability issues; MS
    Entra needs tenant config). Add them when there's a concrete
    request, not preemptively.
  - **Member auth migration of existing OAuth plugin packages** —
    the plugin packages still register through `setup()` which
    works for both staff and member pools (the registry is
    shared). No action needed.

### Patch Changes

- Updated dependencies [5103c65]
- Updated dependencies [131be43]
- Updated dependencies [5203fd7]
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
- Updated dependencies [d3ea817]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [463fe5f]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [41ac5d2]
- Updated dependencies [3eeac73]
  - @nexpress/core@1.0.0
