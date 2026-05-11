# @nexpress/plugin-oauth-google

## 1.0.0

### Major Changes

- 5103c65: **BREAKING — `nx` prefix migrated to `np` everywhere.**

  The `nx`/`Nx`/`NX_`/`nx_`/`nx-`/`--nx-` prefix that NexPress used in
  TypeScript identifiers, CSS tokens, environment variables, database
  tables, cookies, HTTP headers, localStorage keys, and HTML data
  attributes is now `np`/`Np`/`NP_`/`np_`/`np-`/`--np-`. The `@nexpress/*`
  package namespace is unchanged — the brand "NexPress" is independent of
  the `nx` abbreviation. There is no compat shim.

  Shipped in five sequential PRs to keep each layer independently
  revertable; this changeset is the rollup migration guide.

  | Phase    | What renamed                                                                                                                                                                               |
  | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | 1 (#454) | TypeScript symbols (`Nx*` types/classes/interfaces, `nx*` Drizzle vars + helper functions)                                                                                                 |
  | 2 (#455) | CSS layer (`--nx-*` custom properties, `.nx-*` classes, `@layer nx-*`)                                                                                                                     |
  | 3 (#456) | ENV vars (`NX_*`) + DB tables (`nx_*` framework + collection tables)                                                                                                                       |
  | 4 (#457) | Cookies (`nx-session`/`-refresh`/`-csrf`/`-admin-site`/`-mb-*`/`-oauth-state`) + HTTP headers (`x-nx-*`) + localStorage (`nx-theme`/`nx-color-scheme`) + HTML attributes (`data-nx-theme`) |
  | 5 (this) | Documentation + this rollup                                                                                                                                                                |

  ## Migration steps for plugin / theme / site authors

  ```diff
  # 1. TypeScript imports
  -import type { NxAuthUser, NxCollectionConfig, NxBlockDefinition } from "@nexpress/core";
  +import type { NpAuthUser, NpCollectionConfig, NpBlockDefinition } from "@nexpress/core";

  -import { nxUsers, nxMedia, NxForbiddenError } from "@nexpress/core";
  +import { npUsers, npMedia, NpForbiddenError } from "@nexpress/core";

  -import { nxFetch } from "@nexpress/admin/client";
  +import { npFetch } from "@nexpress/admin/client";

  # 2. CSS overrides
  :root {
  -  --nx-color-primary: oklch(0.4 0.15 250);
  +  --np-color-primary: oklch(0.4 0.15 250);
  }
  -.nx-form-input { … }
  +.np-form-input { … }
  -@layer nx-theme { … }
  +@layer np-theme { … }

  # 3. data attribute selectors
  -:root[data-nx-theme="default"] { … }
  +:root[data-np-theme="default"] { … }
  ```

  A find/replace across the consumer's repo with these patterns covers
  the bulk:

  ```sh
  # TS symbols (compile-time only)
  perl -pi -e 's/\bNx([A-Z])/Np$1/g; s/\bnx([A-Z])/np$1/g;' \
    $(rg -l '\bNx[A-Z]|\bnx[A-Z]' --type ts --type tsx)

  # CSS tokens + classes
  perl -pi -e 's/--nx-/--np-/g; s/\bnx-/np-/g;' \
    $(rg -l -- '--nx-|\bnx-' --type css --type ts --type tsx)

  # ENV vars + DB tables
  perl -pi -e 's/\bNX_([A-Z])/NP_$1/g; s/\bnx_([a-z])/np_$1/g;' \
    $(rg -l '\bNX_|\bnx_')
  ```

  ## Migration steps for operators
  1. **Pull main + rebuild.** Every package's `dist/` regenerates with the
     new symbol names.
  2. **Update `.env`.** Rename every `NX_*` to `NP_*` in every environment
     (.env / .env.local / secrets manager / k8s / fly / etc.). The shipped
     `.env.example` lists every name; the boot zod error now points at
     `NP_*`.
  3. **Generate + apply the table-rename migration.**
     ```sh
     pnpm db:generate     # produces apps/web/drizzle/0031_*.sql
     # Review the SQL — every line should be ALTER TABLE nx_X RENAME TO np_X.
     pnpm db:migrate      # runs the rename in a transaction
     ```
     Indexes and FK constraints stay functional after the rename
     (Postgres tracks them by oid). Their NAMES still contain `nx_` until
     a subsequent `db:generate` cleans them up — purely cosmetic.
  4. **Restart the process.** `defineConfig` reads env vars at boot.
  5. **Active sessions invalidate once.** Every staff + member user with
     a browser holding `nx-session`/`nx-mb-session` reauths on next
     request — the new code reads `np-session`/`np-mb-session` only. No
     compat shim. Plan a maintenance window if logged-out alerts to every
     operator on deploy is unwelcome.
  6. **External tooling** that set or read `nx-*` cookies, the
     `x-nx-admin-site` header, or `data-nx-theme` attribute must update.

  For multi-node operators: stage the migration. Old-code nodes will 500
  on every query against the renamed tables; reading the new cookies
  fails on old binaries.

  ## What is NOT renamed
  - **Package names.** `@nexpress/*` stays — the brand "NexPress" is the
    product identity, not the `nx` abbreviation.
  - **Display strings.** "NexPress" in UI copy / documentation prose is
    unchanged.
  - **Existing migration SQL.** The `0000–0030_*.sql` history files in
    `apps/web/drizzle/` are frozen — they record what the old schema
    looked like. The new rename migration sits on top.

### Minor Changes

- 86de2e4: feat(oauth-github, oauth-google): G.2.2 — declare configSchema with sensitive widget for clientSecret

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
  });

  // oauth-google (same shape, scopes default ["openid", "email", "profile"])
  ```

  The scopes array introspects as `unsupported` in v0.2 of the F.3 introspector (only `z.array(z.object(...))` is supported). Operators can edit clientId/clientSecret via the form; scopes can be tuned via env override at startup or by a future introspector pass that handles `z.array(z.string())`.

  **Reload required for admin-form changes.** `setup()` reads config once at boot. Updating the admin form saves to the DB but does NOT re-register the provider; operators must hit `/admin/plugins/reload` (or restart the process) for new credentials to take effect. Documented in both READMEs and the manifest description.

  Manifest version bumped 0.2.0 → 0.3.0 in both plugins. Each plugin exports its config type (`GitHubOAuthConfig`, `GoogleOAuthConfig`) for plugin-author consumers; no `Np` prefix per the convention established in G.2.1.

  **Atomic per-source credential rule.** When `NP_OAUTH_*_CLIENT_ID` is set but `NP_OAUTH_*_CLIENT_SECRET` is not (or vice versa), the plugin logs an error and refuses to register. Mixing env-managed clientId with DB-stored clientSecret (or any partial-env state) is almost always a misconfiguration; treating it as an explicit error stops Frankenstein credential pairs from quietly landing in production. Both env vars must be set together OR both unset (admin form fallback).

  13 unit tests on oauth-github / 12 on oauth-google: schema defaults, populated credentials, scope defaults, sensitive-meta verification, manifest invariants, allowedHosts pinning, auto-form-replaces-fields rule, and the new credential-resolution suite (env source, admin source, env precedence on tie, partial-env error in both directions, no-credentials warn).

### Patch Changes

- f778e80: feat(core, admin): introspector — `z.array(z.string())` support, dedicated `string-array` widget

  Closes the G-track follow-up tracked in `docs/design/plugin-config-auto-form.md` § 10. `z.array(z.string())` schemas (e.g., OAuth scopes, category allowlists) previously fell through to the `unsupported` JSON-textarea fallback — operators had to type literal JSON like `["read:user","user:email"]` to edit them.

  This release wires a typed widget through the F.3 / G.1 introspector + form-renderer:

  **Schema introspection** (`packages/core/src/themes/settings-schema.ts`):
  - New `NpThemeSettingsStringArrayField` type (`{ type: "string-array" }`) added to the `NpThemeSettingsField` union.
  - `introspectField`'s `array` branch now discriminates on element type — `z.array(z.object(...))` keeps emitting the existing typed-row form (`type: "array"`); `z.array(z.string())` emits `type: "string-array"`. Other element types (`z.array(z.number())`, nested arrays) still fall through to `unsupported`.

  **Form renderer** (`packages/admin/src/zod-form/form-renderer.tsx`):
  - New `StringArrayField` component renders a `<textarea>` with one item per line. Lines are trimmed + non-empty-filtered on commit so trailing returns / whitespace don't introduce blank entries.

  **OAuth README updates** (`@nexpress/plugin-oauth-github` / `oauth-google`):
  - "Scopes are not yet editable in the auto-form" callout removed. Scopes table row now shows the editable `one item per line` widget with the actual default values.

  3 new unit tests cover the discriminator (string-array, object-array, unrecognized fallback). 364 core tests pass; existing test "returns unsupported for non-object array element" updated to use `z.array(z.array(...))` since `z.array(z.string())` is now supported.

  Verified: `pnpm typecheck` (58/58), `pnpm build` (31/31).

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

- Updated dependencies [5103c65]
- Updated dependencies [b9a4e08]
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
- Updated dependencies [f82ed03]
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
- Updated dependencies [f590247]
  - @nexpress/core@1.0.0
  - @nexpress/plugin-sdk@1.0.0
  - @nexpress/oauth-providers@0.2.0

## 0.1.0

### Minor Changes

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.

### Patch Changes

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
  - @nexpress/plugin-sdk@0.1.0
