# @nexpress/plugin-sdk

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

- b9a4e08: Page builder editor — phase 3 (plugin block registration).

  Plugins can now contribute block types to the page builder.
  `definePlugin({ blocks: NpBlockDefinition[] })` accepts the same
  real `NpBlockDefinition` shape as the built-ins (icon, label,
  propsSchema, render function) — no string-component indirection
  or separate registration shape. The `@nexpress/next` bootstrap
  calls `registerBlock` on each plugin's blocks right after
  `loadPlugins`, so they merge into the shared registry that both
  the server-side `renderBlocks` and the admin's Add-block popover
  read from.

  Wiring details:
  - `@nexpress/blocks` exposes `registerBlock(definition)` and
    `getRegisteredBlocks()`. The shared registry is module-scoped
    and seeded with the defaults at module load. Re-registering a
    type overwrites silently so HMR / repeated boot in the same
    process don't blow up the editor.
  - `@nexpress/plugin-sdk` swaps the legacy
    `NpBlockRegistration` type (component-string, never wired) for
    the real `NpBlockDefinition` from `@nexpress/blocks` on
    `NpPluginDefinition.blocks`. The legacy interface stays
    exported as `@deprecated` for type compatibility.
  - `@nexpress/next` bootstrap iterates plugin defs and calls
    `registerBlock` for each block. Adds `@nexpress/blocks` as a
    direct dependency.
  - Admin's `field-renderer.tsx` reads from `getRegisteredBlocks()`
    instead of the frozen `getDefaultBlocks()`, so plugin blocks
    appear in the editor's Add-block popover.

  Existing plugins ship `blocks: []` in their manifest's `provides`
  metadata only — they don't contribute real block definitions, so
  nothing breaks. The first real plugin block can be added in a
  single PR now.

  Server → client wiring: `@nexpress/blocks` exposes a serializable
  `NpBlockMetadata` type (`Omit<NpBlockDefinition, "render">`) and
  a `getRegisteredBlockMetadata()` helper. The admin's protected
  layout calls it server-side after `ensureFor("plugins")` and
  mounts a `<BlocksRegistryProvider>` (new export from
  `@nexpress/admin/client`) that delivers the snapshot to the
  browser editor through React props. The page-builder reads from
  the provider via `useBlocksRegistry()`; `getRegisteredBlocks()`
  calls in browser-side code would only see the module-instance's
  defaults, never the plugin blocks the Node-side bootstrap pushed
  into the server instance.

- 65da716: feat(core, admin, next, plugin-sdk): G.1 — plugin config auto-form + storage migration to np_settings

  Plugin authors can now declare a Zod `configSchema` on their definition; the framework introspects it (mirroring the F.3 theme settings path) and renders an admin auto-form on `/admin/plugins/[pluginId]` with no per-plugin form code.

  **Plugin SDK** (`@nexpress/plugin-sdk`):
  - `NpPluginDefinition.configSchema` (already existed — wired up in G.1) now drives the admin auto-form.
  - New `configVersion` and `configMigrate` fields mirror theme `settingsVersion` / `settingsMigrate` for lazy schema migrations.

  **Core** (`@nexpress/core`):
  - New `getPluginConfig` / `getPluginConfigWithStatus` / `setPluginConfig` / `pluginConfigCacheTag` exports (in `packages/core/src/plugins/config.ts`). Match `getThemeSettings` semantics including the defensive try/catch on the migrator and `safeParse` fallback to schema defaults.
  - Auto-form introspector gained a `password` widget, opted into via `.meta({ sensitive: true })` on a Zod string. Both theme and plugin schemas can use it.
  - `np_plugins.config` jsonb column dropped (Drizzle migration 0034). Existing rows are copied to `np_settings (siteId, "plugin.config:<id>")` wrapped in the v1 versioned envelope. `np_plugins` is now a lean `(id, enabled, installed_at, updated_at)` meta row.
  - `getPluginState` / `updatePluginState` no longer return / accept a `config` field. Callers use `getPluginConfig` / `setPluginConfig` instead.
  - `ctx.settings.getPlugin` / `ctx.settings.setPlugin` (plugin runtime context) now read/write through the new path. Plugins with `configSchema` get validation; legacy plugins still work without it.
  - Plugins that declare BOTH `configSchema` and `admin.settings.fields` log a console warning at registration; the auto-form wins (per the locked precedence in `docs/design/plugin-config-auto-form.md` § 5.1.1).

  **Admin** (`@nexpress/admin`):
  - `<PluginAdminPage>` accepts new optional `configFields` and `initialAutoConfig` props. When `configFields` is non-empty, the auto-form `<Card>` replaces the legacy `admin.settings.fields` form.
  - `ZodForm` form-renderer dispatches `password` widget to `<Input type="password" autoComplete="new-password">`.

  **Next.js helpers** (`@nexpress/next`):
  - New `getCachedPluginConfig` wrapper (parallel to `getCachedThemeSettings`) tagged with `np:plugin:<id>`. Per-plugin tag scheme uses the `np` prefix (CLAUDE.md "Naming convention").

  **Reference app** (`@nexpress/web`):
  - `/admin/plugins/[pluginId]` page introspects `configSchema` server-side and passes the metadata to the client.
  - `PUT /api/plugins/[pluginId]` no longer accepts the `config` field — config writes moved to `PUT /api/admin/plugins/[pluginId]/config` (validates via schema, busts `np:plugin:<id>` cache tag).

  Migration recipe for existing plugins (each will land as its own G.2 PR):
  1. Add `configSchema: z.object({…})` to the plugin definition.
  2. Remove `admin.settings.fields` (or set to `[]`).
  3. Replace any `getPluginConfig` typed read with the `z.infer<typeof schema>` cast.

### Patch Changes

- 758092a: **PRT.1 — plugin page-route types + registry getter (#623).**

  Plugin authors can now declare `pageRoutes` on `definePlugin()`:

  ```ts
  definePlugin({
    manifest: { id: "forum" /* ... */ },
    pageRoutes: [
      { pattern: "/discussions", component: List },
      { pattern: "/discussions/new", component: New, surface: "member" },
      { pattern: "/discussions/:slug", component: Detail },
    ],
  });
  ```

  This phase wires:
  - **`@nexpress/plugin-sdk`** — `pageRoutes?: NpPluginPageRouteRegistration[]`
    on `NpPluginDefinition`. Each entry has `pattern`,
    `component`, optional `metadata`, plus `surface`
    (`"site" | "member"`) and `locale` (`"auto" | "none"`)
    knobs from §2.4 and §2.6 of the design doc.
  - **`@nexpress/core`** — same field on the structural
    `NpResolvedPluginLike` shape. Plugin host normalizes
    malformed entries away at registration time and stores
    the validated list on each `PluginRegistration`.
  - **`getPluginPageRoutes()`** — flat-array getter exported
    from `@nexpress/core` (and from `/plugins` subpath).
    Returns `Array<{ pluginId, route }>` in registration order.
    Enabled-state gating is left to the call site (the route
    dispatcher in PRT.2) so unit tests can assert the
    registered shape without mocking the enabled singleton.

  PRT.1 is the **types + registry layer only** — the dispatcher
  integration that actually serves these routes lands in PRT.2.
  After this PR, declaring a `pageRoutes` field on a plugin
  records it correctly but doesn't yet handle requests; that's
  intentional staging.

  8 new tests in `host.test.ts > getPluginPageRoutes`:
  - empty when no plugin declares routes
  - registers routes from a resolved plugin
  - defaults `surface: "site"` and `locale: "auto"`
  - preserves explicit `member` / `none`
  - drops malformed entries (missing pattern / component, wrong shape)
  - flattens routes from multiple plugins in registration order
  - legacy `init()`-shape plugins register zero routes

  411/411 in the core test suite.

- f590247: Page-builder medium tier (#467): plugin / theme contributed patterns flow through the bootstrap into the editor's command-menu pattern picker (`definePlugin({ patterns })` plus a shared pattern registry in `@nexpress/blocks`); favorites in the block palette pin a per-operator "Favorites" section above Recent (localStorage-persisted); a paste-import dialog in the command menu accepts a single block, an array of blocks, or a pattern object, validates, and inserts via `INSERT_PATTERN` so id-regeneration goes through the existing reducer.
- Updated dependencies [5103c65]
- Updated dependencies [c40cded]
- Updated dependencies [c40cded]
- Updated dependencies [ab9c759]
- Updated dependencies [2eb505d]
- Updated dependencies [b9a4e08]
- Updated dependencies [8bed938]
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
- Updated dependencies [cf5db32]
- Updated dependencies [580f0f2]
- Updated dependencies [225d6a1]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [ca1722e]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [b78dbbc]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [930d0d4]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [7b61ba8]
- Updated dependencies [463fe5f]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [41ac5d2]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [15aa1d4]
- Updated dependencies [89c7180]
- Updated dependencies [6483de7]
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0

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
