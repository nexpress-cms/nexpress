# @nexpress/next

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

- 4ebf2b4: **`cachedPluginFetch` helper** — plugin parallel of
  `cachedThemeFetch`, closing one of the v0.3 G-track follow-ups
  (see `docs/design/plugin-config-auto-form.md` § 10).

  ```ts
  import { cachedPluginFetch } from "@nexpress/next";

  const data = await cachedPluginFetch(
    "my-forum", // plugin id
    ["list", String(page)], // caller-supplied key parts
    () => findDocuments("discussions", { page, limit: 20 }),
    { revalidate: 60, extraTags: ["nx:collection:discussions"] },
  );
  ```

  Wraps a plugin route's data fetch in `unstable_cache` with the
  plugin's config tag (`np:plugin:<pluginId>`) auto-attached. Saving
  the plugin's config in `/admin/plugins/<id>` or disabling /
  reloading the plugin busts the cache automatically (the framework
  already revalidates this tag inside `setPluginConfig`).

  **Why this lands now:** the plugin-route track (#623) ships
  plugin-owned URLs. Forum's list / profile-discussions routes are
  the first plugin pages doing real DB work on every render — they
  work today without caching, but a busy site benefits from
  deduping. Adding the helper now means new plugin route authors
  don't roll their own `unstable_cache` wrappers (and forget the
  cache-tag plumbing that makes admin "Save config" propagate).

  **Same shape as `cachedThemeFetch`:**
  - Per-site cache keying via `getCurrentSiteId()` so multi-tenant
    deployments don't leak across sites.
  - 60-second default `revalidate`; caller can override.
  - `extraTags` slot for content-driven invalidation. Note: tags
    are advisory — they invalidate only when something else fires
    `revalidateTag` against them. The framework auto-fires the
    `np:plugin:<id>` tag (always-on) but NOT collection-scoped
    tags; the host's `RevalidationMap` is responsible for those.
  - Falls back to the uncached fetcher when Next's incremental
    cache is unreachable (integration tests, scripts, background
    workers).

  7 new tests in `cache.test.ts`: per-site/per-plugin keying,
  default revalidate, override, extraTags merge, fallback on
  incremental-cache miss, error propagation, distinct namespaces
  across plugins.

  Doc update: `docs/plugin-pages.md` gains a "Caching expensive
  reads" section showing the recipe.

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

- 98d3a4e: **Phase C dogfood pass — fixes found while migrating real pages onto the new primitives.**

  Wrote `/u/[handle]`, `/u/[handle]/discussions`, and `/discussions`
  against the primitives shipped in #531; the migration surfaced
  three friction points worth fixing in the primitive surface
  (rather than working around them in every caller) and one
  cookbook gap.
  - **`getMemberProfile(idOrHandle)` now lowercases the input.**
    Member handles are stored lowercase by the registration path
    (`api/members/register/route.ts:49`), so visiting
    `/u/HANDLE` returned `null` even though `/u/handle` worked.
    The lookup now mirrors what every existing read site already
    does explicitly. UUID ids are unaffected (lowercase hex is
    idempotent).
  - **New `getMemberProfiles(ids[], opts?)` batch helper** in
    `@nexpress/core/community`. Looping `getMemberProfile` over a
    list-page's authors would issue N queries plus N avatar
    resolutions. The batch fetches the rows in a single SELECT
    and resolves avatars in parallel, returning
    `Map<id, NpMemberProfile>`. Callers like the discussions
    index can drop their ad-hoc Drizzle author-lookup boilerplate
    (`apps/web/src/app/(site)/discussions/page.tsx` now uses the
    batch and is shorter + correct on the avatar field that was
    previously dropped).
  - **Cookbook: documented the listing pattern + the
    `joinedAt: Date` serialization caveat.** RSC code that passes
    a profile to a client component crosses the JSON boundary —
    call `.toISOString()` first, or accept `string` on the client
    and parse there.
  - **`@nexpress/next` re-exports `buildPageMetadata`** as a
    thin Next-typed wrapper so `generateMetadata` accepts the
    result without an `as Metadata` cast. The core function still
    exists (framework-agnostic, returns `NpPageMetadata`) for
    static-site exporters and other non-Next consumers.
    Reference-app pages migrated. Cookbook updated to recommend
    the wrapper for page authors.

  The dogfood pass also fixed a pre-existing bug in
  `/u/[handle]/page.tsx`: the old code passed `member.avatar` (a
  UUID FK to `np_media`) directly to `buildPersonJsonLd`'s
  `image` field, which expects a URL. The migration to
  `getMemberProfile` (which returns `avatarUrl` already resolved)
  silently fixes the JSON-LD output. Profile pages now also
  actually render the avatar image — the old code only showed
  the initial-letter fallback because no URL was available.

  Stable in v0.1 — adding optional fields to the option object
  is non-breaking; removing or renaming the function rides a
  minor with a migration note. `getMemberProfiles` joins
  `getMemberProfile` on the v0.1 stability list.

- 9f3a81b: **PRT.3a — `@nexpress/next` gains a `./client` subpath + lifts
  host helpers (#623).**

  Foundational refactor for PRT.3b (forum-plugin route migration).
  The forum plugin (and any other plugin that wants to register
  `pageRoutes`) needs Server-Component-friendly access to member
  identity, JSON-LD output, and the comment widget. Those used to
  live in `apps/web/`; they're now part of `@nexpress/next`'s
  public surface.

  **New on the root entry (server-safe):**
  - `getSiteMember()` — Server-Component variant of the existing
    `optionalMember` helper. Reads the `np-mb-session` cookie via
    `next/headers`, verifies the JWT, returns the active member or
    null. Caller must have already bootstrapped the framework
    (`ensureFor("read")` or equivalent); the helper reads `getDb()`
    directly. Returns null silently if the DB singleton hasn't
    been set, so a misordered call fails closed rather than
    throwing.
  - `JsonLd` — `<script type="application/ld+json">` wrapper.
    Identical implementation to the previous `apps/web` version.

  **New `./client` subpath (with `"use client"` banner injection):**
  - `Comments` — public-site comment block. Lists visible comments
    under a document, lets a logged-in member post / react /
    report. Self-contained (only React imports, no host paths).

  The new entry follows `@nexpress/admin`'s tsup pattern: a
  second build target with `esbuildOptions.banner = { js: '"use
client";' }` and externals for React + Next.js. Output is
  `dist/client.js` + matching `.d.ts`.

  **Breaking-ish: removed from `apps/web`:**
  - `apps/web/src/lib/site-member.ts` — call sites updated to
    import from `@nexpress/next`. The old wrapper called
    `await ensureFor("read")` internally; the new helper does not,
    so `apps/web/src/app/(member)/members/me/notifications/page.tsx`
    gained an explicit `await ensureFor("read")` call (the only
    site that didn't already do it).
  - `apps/web/src/components/json-ld.tsx` — deleted.
  - `apps/web/src/components/comments.tsx` — deleted (moved into
    `@nexpress/next/src/comments.tsx`).

  Routes touched (import-path swap only):
  - 3 member routes (login, register, me/notifications)
  - 4 discussion routes (list, new, [slug], [slug]/edit)
  - blog [slug], u [handle], catch-all [[...slug]]

  This commit is a **prerequisite for the actual route migration
  to the forum plugin** (PRT.3b). Without `@nexpress/next/client`
  exposing `Comments`, the forum plugin wouldn't be able to
  render the discussion-detail page; without `getSiteMember` on
  the public surface, plugin route components couldn't do member
  auth in a Server Component context.

- f239ce0: **v0.3 (H) — `cachedThemeFetch` helper for per-route theme
  cache.**

  Closes the last v0.3-deferred item from
  `docs/design/theme-v0.2-extension.md`'s
  `feat-theme-routes.md` changeset:

  > Per-route `revalidate` cache hint — considered, dropped.
  > Next's route-segment `revalidate` is a static export; we
  > can't vary it per URL pattern from a single catch-all. Theme
  > routes that want caching wrap their data fetches in
  > `unstable_cache(...)` themselves. **Tracked as a v0.3
  > candidate** if a future SSG pass needs it.

  ### Problem

  Theme routes (archives like `/category/:slug`, custom URL
  patterns) render through the framework's catch-all dispatcher.
  Next's route-segment `revalidate` operates at the segment
  level — `/category/:slug` and `/author/:slug` share one
  segment, so per-pattern caching can't be expressed.

  Magazine theme's `CategoryArchive` did `findDocuments` on
  every request — every visit to `/category/tech` was a fresh
  DB query.

  ### API

  `@nexpress/next` ships `cachedThemeFetch<T>(keyParts, fetcher,
options?)`. The wrapper:
  - Auto-tags with `nx:theme:<siteId>` so theme switch /
    settings save / theme uninstall bust the cache (same tag
    the existing `getCachedTheme` / `getCachedThemeSettings`
    share).
  - Keys by site + caller-supplied parts so `/category/tech`
    and `/category/design` cache independently.
  - Defaults `revalidate: 60` — theme route data is more dynamic
    than tokens / active id, so a tight default keeps freshness
    reasonable while cutting the per-request DB hit on hot URLs.
  - Falls back to the uncached fetcher when Next's incremental
    cache isn't reachable (integration tests, scripts).

  ### Options

  | Option       | Default | Purpose                                                                                                                                                                                                                     |
  | ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `revalidate` | `60`    | Cache TTL in seconds.                                                                                                                                                                                                       |
  | `extraTags`  | `[]`    | Tags appended after `nx:theme:<siteId>`. Pass `["nx:collection:posts"]` so a posts edit busts the matching cached archive too — `revalidateCollection` already calls `revalidateTag("nx:collection:<slug>")` on every save. |

  ### Reference implementation

  `packages/themes/magazine/src/archives.tsx` — `CategoryArchive`
  and `AuthorArchive` migrated:

  ```ts
  const data = await cachedThemeFetch(
    ["magazine.category-archive", slug, String(settings.postsPerPage)],
    async () => {
      const cats = await findDocuments("categories", {...});
      const posts = await findDocuments("posts", {...});
      return { category: cats.docs[0] ?? null, posts };
    },
    { revalidate: 60, extraTags: ["nx:collection:posts"] },
  );
  ```

  The key parts include `postsPerPage` so when the operator
  changes the setting, the archive rebuilds at the new page
  size on next read (settings save busts `nx:theme:<siteId>`
  which is one of the cache's tags).

  ### Tests

  6 new unit tests in `cache.test.ts` (71 total in
  `@nexpress/next`):
  - per-site key composition with caller parts
  - default `revalidate: 60`
  - caller-overridden revalidate
  - `extraTags` appended after the auto-applied theme tag
  - incremental-cache-unavailable fallback to uncached fetcher
  - non-cache-related errors propagate (don't silently swallow)

  ### v0.3 queue closed

  This is the last v0.3-deferred item from the theme-system
  extension cluster. Remaining bigger-scope items (F = member
  surface skinning, G = plugin auto-form) deferred to the
  post-v0.3 phase.

- 930d0d4: **Phase F.4 — `impl.blocks`: theme-shipped block types + source identity contract.**

  Fourth implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.4). Themes can ship
  their own block types (`magazine.hero-feature`,
  `magazine.three-col-grid`, etc.) that participate in the
  page-builder and resolve during server render exactly like
  plugin blocks. Every contributor's blocks now carry a concrete
  source identity so the admin / renderer can correctly attribute
  them in a multi-site, multi-theme process.

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.blocks?: NpBlockDefinition[]` — theme-shipped
    block definitions. The bootstrap auto-stamps each block's
    `source` with `theme:<manifest.id>` so the activation filter
    can distinguish (e.g.) magazine's blocks from portfolio's.

  #### `@nexpress/blocks`
  - `parseBlockSource(source)` — parses the source string into
    `{ kind, id? }`.
  - `isBlockSourceActive(source, ctx)` — filter predicate.
  - `getRegisteredBlocksForActiveSources(ctx)` — full definitions.
  - `getRegisteredBlockMetadataForActiveSources(ctx)` —
    serializable metadata for the admin.
  - `NpBlockRenderContext.activeSources?: { themeId }` — when
    set, `renderBlocks` filters block instances whose source
    doesn't match and renders a "from inactive theme" placeholder.

  #### `@nexpress/next`
  - `createSiteScopedBlockRenderContext()` — async variant that
    resolves the active theme id and embeds it in
    `activeSources`. The catch-all `[[...slug]]` and theme route
    components now use this so multi-site processes get per-site
    filtering.

  ### Source identity contract

  Per design doc §4.4, every block contribution carries a
  concrete source:

  | Contributor              | Auto-stamped `source`        |
  | ------------------------ | ---------------------------- |
  | Built-in (registry seed) | undefined → parsed as `core` |
  | Plugin (via bootstrap)   | `plugin:<plugin.id>`         |
  | Theme (via bootstrap)    | `theme:<theme.manifest.id>`  |

  Bootstrap **overwrites** any author-supplied `source` field —
  authors don't pass it manually. The activation filter uses
  concrete identity to distinguish contributors; broad legacy
  labels (`"plugin"` / `"theme"`) parse as kind-only and the
  filter treats them as always-active for back-compat.

  ### Asymmetry: plugins vs themes

  Plugin blocks already get pruned at registry-write time (the
  `resetSharedBlockRegistry` flow on plugin reload re-registers
  only enabled plugins). Theme blocks stay **append-only** because
  themes have per-site activation — site A active=magazine and
  site B active=portfolio must coexist in the same process.

  So the active-source filter only checks theme sources at read
  time; plugin / core sources always pass. This keeps the filter
  cost minimal (one string parse + one theme-id comparison per
  block).

  ### Activation filter integration
  - **Admin Add-block popover**: layout fetches active theme id,
    passes filtered metadata through `BlocksRegistryProvider`. A
    multi-tenant admin only shows blocks for the current site's
    theme.
  - **Renderer**: `renderBlocks` consults `ctx.activeSources` —
    when present and the block source is filtered out, a
    placeholder div renders with `<strong>{type}</strong> is from
a theme or plugin that isn't active for this site`. Catch-all
    - theme routes both use the site-scoped ctx variant so this
      fires automatically.

  ### Tests

  11 unit tests in `packages/blocks/src/source.test.ts` covering:
  - `parseBlockSource`: undefined, broad labels, concrete ids,
    empty-id-after-colon, unrecognized schemes.
  - `isBlockSourceActive`: core / built-in always active, plugin
    always active, concrete theme matches themeId, no-active-theme
    filters all theme blocks, broad theme label passes,
    unrecognized passes conservatively.

  Total `@nexpress/blocks` tests: 11 (new package test surface).

  ### What's not in this phase
  - **Page builder red error card UI for stale instances** — the
    page builder's existing "unknown block" rendering covers the
    basic case; a richer error card (last-known props JSON,
    "remove" / "reactivate theme" actions) is a polish pass for
    a follow-up. Server-side render correctly emits the
    placeholder today.
  - **Bulk "cleanup unknown blocks" admin action** — already
    recorded in design doc §10 as a v0.3 candidate.
  - **Plugin source filter at read time** — plugins are
    process-global and pruned at write time, so a runtime filter
    would be redundant. If plugins gain per-site activation in a
    future phase, the filter extends to check pluginIds.

  ### Dependency note

  No new external dependencies. `@nexpress/blocks` gains a
  `vitest` test script (was build-only). `@nexpress/theme` already
  imports `NpBlockDefinition` from `@nexpress/blocks` for the new
  field type.

- 1f8fbdf: **Phase F.6 — `impl.navLocations` + `<NavMenu>`: theme-declared nav mount points.**

  Sixth implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.6). Themes declare
  the semantic nav locations they consume in their shells / slots
  (`primary`, `footerLinks`, `mobileDrawer`, etc.); the admin nav
  editor populates its location dropdown from this declaration so
  operators see friendly labels instead of having to type a
  location string from memory.

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.navLocations?: Record<string, NpThemeNavLocation>`
  - `NpThemeNavLocation` — `{ label, description?, maxItems? }`

  #### `@nexpress/core`
  - `extractNavLocationsFromImpl(impl)` — pure extractor for unit
    testability (no DB roundtrip).
  - `getActiveThemeNavLocations()` — async wrapper that resolves
    the active theme then extracts.
  - `NpThemeNavLocationDescriptor` — flat output shape with
    `{ key, label, description?, maxItems? }`.

  #### `@nexpress/next`
  - `<NavMenu location="..." />` server component. Reads
    `getNavigation(location)` for the current site and renders an
    `<ul>` of items. Themes that need richer markup (mega-menus,
    mobile drawer) call `getNavigation` themselves.

  #### `apps/web`
  - `/api/navigation/locations` now merges theme-declared
    locations alongside framework defaults and operator-authored
    customs. Each entry carries `source: "default" | "theme" |
"custom"` so the editor can distinguish them; theme-declared
    keys win on collision (e.g. magazine relabeling `header` →
    "Site Header").

  ### Operator-no-code flow

  Today the operator types location strings (`header`, `footer`,
  `main`, plus whatever they remember). With F.6, themes that
  declare `navLocations` push their slot names into the dropdown
  with descriptive labels — no string memorization required.

  ### Theme component usage

  ```tsx
  import { NavMenu } from "@nexpress/next";

  export function MagazineHeader() {
    return (
      <header>
        <h1>Magazine</h1>
        <NavMenu location="primary" />
      </header>
    );
  }
  ```

  Themes can also pass `renderItem` for custom item rendering or
  omit `<NavMenu>` entirely and call `getNavigation` directly when
  the markup gets richer.

  ### What's not in this phase (deferred)
  - **Nav editor "Location assignments" panel** — design doc §4.6
    envisions a dedicated panel listing each theme location with
    a menu-id dropdown (`navAssignments[themeId][locationKey] =
menuId`). Today's editor surfaces the locations through the
    existing dropdown; a redesign with descriptions, maxItems
    hints, and a "filled vs empty" indicator is **F.6.1
    follow-up**. Operators can already author all locations
    through the existing editor — this is UX polish.

  ### Tests

  6 new unit tests in `packages/core/src/themes/nav-locations.test.ts`:
  - Empty when impl undefined / no navLocations / wrong type
  - Extracts declared locations with all fields
  - Skips entries missing a label (duck-type guard)
  - Ignores non-string description / non-number maxItems

  Total core tests: 314 (was 308).

  ### Dependency note

  `@nexpress/next` gains a `react` peer dep (`^19.0.0`) and JSX
  configured in tsconfig — required for `<NavMenu>`. Existing
  non-component exports unchanged. `@nexpress/next` was already
  in the host app's `serverExternalPackages` list, so adding
  React doesn't risk dragging server-only modules into the
  client bundle.

- 09a7b75: **Phase F.2 — `impl.routes` + `archives` sugar: theme-declared dynamic routes.**

  Second implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.2). Themes can now
  register URL patterns the framework's catch-all dispatches to,
  closing the dynamic-archive gap (`/category/[slug]`,
  `/tag/[slug]`, `/author/[id]`, `/:year/:month`, `/search`) and
  unlocking theme-only routes (`/lookbook`).

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.routes?: NpThemeRoute[]` — declared dynamic routes
    with `pattern`, `component`, optional `metadata` and `revalidate`.
  - `NpThemeImpl.archives?: NpThemeArchives` — sugar over routes
    for the common archive shapes (`byCategory`, `byTag`,
    `byAuthor`, `byDate`, `search`). Default patterns expand at
    boot; per-entry `pattern` override possible.
  - `NpRouteRenderProps` — props passed to a route component
    (`{ params, searchParams, blockCtx }`).

  Pattern syntax is a small path-to-regexp subset (no new
  dependency): literal segments match exactly, `:name` captures any
  segment, `:name(regex)` constrains the captured segment.

  #### `@nexpress/next`
  - `dispatchThemeRoute(theme, path)` — pure linear-scan matcher.
    Returns `{ route, params }` on first hit, null otherwise.
  - `collectThemeRoutes(theme)` — concatenates explicit routes
    with expanded archives. Explicit routes come first so a theme
    can override an archive pattern by declaring an explicit route
    earlier.
  - `buildRouteRenderProps(...)` — small helper that constructs
    `NpRouteRenderProps` from a match + searchParams + blockCtx.

  #### `apps/web/(site)/[[...slug]]/page.tsx`

  Catch-all integrates the dispatcher into both the page render
  path and `generateMetadata`, with the precedence locked in the
  design doc:
  1. App-explicit Next.js routes (always win — Next handles them
     before the catch-all sees the request).
  2. Page document slug lookup.
  3. Slug redirect history (operator's renamed pages).
  4. Theme route dispatcher.
  5. `/` empty-state (DefaultHomePage).
  6. 404.

  Operator-authored content always wins over theme contributions:
  a theme route can never silently shadow a CMS page or its
  rename history. Both `Page` and `generateMetadata` share the
  dispatcher — theme-rendered URLs get the route's `metadata`
  builder, not page-fallback SEO (which would be a real bug per
  design doc §4.2).

  ### Open question resolved

  Design doc §11.1 left "where does `getArchiveQuery` helper
  live?" open. Resolution: **skip for v0.2 F.2.** Theme route
  components can call `findPosts({ where: { categories: id } })`
  directly — F.E (#542) already made `hasMany` filtering work
  natively, so the boilerplate is minimal. If multiple themes end
  up sharing identical query construction, we add the helper as a
  follow-up.

  ### Tests

  14 unit tests in `route-dispatcher.test.ts` cover: null theme,
  no match, literal route, single param, multiple params, regex
  constraint enforcement, declaration-order first-match-wins,
  segment-count mismatch, leading-slash normalization, and 6
  archive expansion cases (byCategory default pattern, byDate
  year/month/day granularities, per-entry pattern override,
  explicit-routes-first ordering, empty-archives no-op).

  Total `@nexpress/next` tests: 62.

  ### What's not in this phase
  - Search-results UI is a route the theme can declare; the
    framework doesn't pre-resolve search hits for it (theme
    component calls `searchCollections` directly).
  - `getArchiveQuery` helper — see open-question resolution above.
  - **Per-route `revalidate` cache hint** — considered, dropped.
    Next's route-segment `revalidate` is a static export; we
    can't vary it per URL pattern from a single catch-all. Theme
    routes that want caching wrap their data fetches in
    `unstable_cache(...)` themselves. Tracked as a v0.3 candidate
    if a future SSG pass needs it.

  ### Multi-collection archive collision

  `archives.posts.byCategory` and `archives.products.byCategory`
  both default to `/category/:slug`, so without a per-entry
  `pattern` override only the first declaration matches. The
  framework now logs a one-time dev warning when
  `collectThemeRoutes` detects two routes sharing the same
  pattern. Themes with multi-collection archive sugar must
  override the pattern for at least N-1 of the collisions
  (documented in the `NpThemeArchives` JSDoc).

  ### Dependency note

  `@nexpress/theme` gained an optional `next` peer dependency
  (themes inherently target Next routes; the typed `metadata`
  builder uses `next.Metadata`). Existing themes are unaffected
  unless they declare `routes`/`archives`.

  `@nexpress/next` now depends on `@nexpress/theme` (was: only
  core + blocks). No cycle: theme → core, next → theme + core.

- 5efa580: **Phase F.3 — `manifest.settingsSchema` + admin auto-form: operator-tunable theme options.**

  Third implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.3). Themes can now
  expose Zod-described operator settings; the admin renders the
  form fields automatically. Closes the no-code-customization
  loop for theme-shipped variants like "hero style", "show
  byline", or "newsletter signup URL".

  ### Surface added

  #### `@nexpress/core`
  - `NpThemeManifest.settingsSchema?: unknown` — typed loose
    (theme authors construct via `z.object({...})` and get full
    Zod inference at the call site; framework narrows back to
    `ZodTypeAny` at introspection / validation).
  - `getThemeSettings(themeId?)` — read parsed settings; defaults
    to active theme.
  - `getThemeSettingsWithStatus(themeId?)` — same plus `hasPersisted`
    - `parseError` so admin can show "settings reset" banners
      when the persisted value fails the current schema.
  - `setThemeSettings(themeId, value, updatedBy?)` — validates
    via the schema, writes the row, returns the parsed value.
    Throws `NpValidationError` on failure with field-level issues.
  - `introspectThemeSettingsSchema(schema)` — server-side walker
    that emits JSON form metadata.
  - `NpThemeSettingsField` (and per-type variants) — the metadata
    shape the admin consumes. Browser doesn't need zod at runtime.
  - `activeThemeContributesSeo()` — structural check on
    `impl.seo`. The settings save path uses this to decide
    whether to additionally bust `nx:sitemap:*` / `nx:feed:*` tags.

  #### `@nexpress/next`
  - `getCachedThemeSettings(themeId?)` — `unstable_cache` wrapper
    that reuses the existing `nx:theme:<siteId>` tag (shared with
    tokens + active theme id). Per design doc §5.3 — settings
    read on the same paths as tokens, so a shared bust avoids
    fragmenting the tag namespace.

  #### `apps/web`
  - `GET/PUT /api/admin/themes/[id]/settings` — list returns
    `{ fields, value, hasPersisted, parseError }`; PUT validates
    - persists + invalidates `nx:theme:<siteId>` (and SEO tags
      when the active theme declares `impl.seo`).
  - Theme settings page now renders the new `ThemeSettingsPanel`
    below the existing `ThemeEditor` (token editor).

  #### `@nexpress/admin`
  - `packages/admin/src/zod-form/` — generic auto-form generator
    consumed by the theme settings panel. Same primitive will
    serve plugin config UIs in a follow-up.
  - `ThemeSettingsPanel` — fetches schema + value, renders
    `ZodForm`, PUTs on save. Shows the "schema mismatch reset"
    banner when `parseError` is set.

  ### Field type coverage (v0.2 initial)

  | Zod type                              | Auto-form widget         |
  | ------------------------------------- | ------------------------ |
  | `z.string()`                          | text input               |
  | `z.string().url()`                    | URL input                |
  | `z.string().regex(/^#[0-9a-f]{6}$/i)` | color picker (heuristic) |
  | `z.number().int().min().max()`        | number input with range  |
  | `z.boolean()`                         | toggle                   |
  | `z.enum([...])`                       | select                   |
  | `z.object({...})`                     | nested fieldset          |
  | `z.array(z.object({...}))`            | repeating subform        |

  `.default(value)` and `.describe("...")` are honored. Anything
  else introspects as `unsupported` and falls back to a JSON
  textarea (operator can still edit; coverage widens in a
  follow-up).

  ### Storage

  `np_settings` row at `(siteId, "theme.settings:<themeId>")`,
  value JSONB. Coexists with the v0.1 `theme` (tokens) and
  `activeTheme` rows; per design doc §4.3 coexistence table.

  ### Cache invalidation
  - Reuses existing `nx:theme:<siteId>` tag on every save
    (settings live on the same read paths as tokens — splitting
    the tag would force two evictions on every change).
  - Additionally busts `nx:sitemap:<siteId>` + `nx:feed:<siteId>`
    when `activeThemeContributesSeo()` returns true.

  ### Schema evolution

  v0.2 ships strict `parse()`. Mismatch → returns schema defaults
  - surfaces `parseError` so admin shows a "settings reset"
    banner. Migration helpers (`migrate(old, fromVersion)`)
    deferred to v0.3 unless F.9 reference rebuild surfaces real
    demand.

  ### Tests

  15 unit tests covering: empty / non-object schema, text, url,
  color (regex heuristic), number constraints, boolean, enum
  options, default value capture, optional → required:false,
  description capture, nested object, array of objects, plus
  two unsupported-type fallbacks (string-array, date).

  Total core tests: 306 (was 291).

  ### What's not in this phase
  - Plugin config auto-form migration — F.3 builds the
    zod-to-form primitive in `@nexpress/admin/zod-form`; plugins
    keep their hand-coded config UIs until a follow-up migrates
    them. (Already recorded in design doc §10.)
  - `migrate(old, fromVersion)` schema-evolution helpers — v0.3
    candidate.
  - Type-narrowing the form value at submit — v0.2 PUTs the raw
    draft and lets the server re-validate. Client-side validation
    before submit is a polish pass.

### Patch Changes

- 9f3a81b: **PRT.3b — forum plugin owns its public routes (#623).**

  The forum plugin now registers all four `/discussions/*`
  routes via the `pageRoutes` field added in PRT.1, served by
  the dispatcher landed in PRT.2. The host app no longer has
  file-based routes for `/discussions`.

  **Routes the plugin now owns:**
  - `/discussions` — list page (paginated, "All / My threads"
    toggle for logged-in members)
  - `/discussions/new` — create form, `surface: "member"`
  - `/discussions/:slug` — detail page (with comments + JSON-LD)
  - `/discussions/:slug/edit` — author-only edit form,
    `surface: "member"`

  Order matters in the registration array: more-specific
  patterns (`/discussions/new`, `/discussions/:slug/edit`)
  precede the parametric `/discussions/:slug`. The dispatcher
  is first-match-wins.

  **Plugin layout:**

  ```
  packages/plugins/forum/
    src/
      index.ts           # plugin definition + pageRoutes
      client.ts          # ./client subpath aggregator
      next-shim.d.ts     # minimal Next.js type stubs (matches @nexpress/admin)
      client/
        discussion-form.tsx              (moved from apps/web/src/components/)
        discussion-author-actions.tsx    (moved from apps/web/src/components/)
      components/
        pagination-nav.tsx               (duplicated from apps/web — only
                                          ~50 lines, plugin-local)
      routes/
        list.tsx, new.tsx, detail.tsx, edit.tsx
  ```

  **Build pipeline.** Two-entry array config (matches
  `@nexpress/admin`'s pattern) so source-side `"use client"`
  directives in `src/client/*.tsx` get preserved when tsup emits
  chunks. **`clean: true` lives in the npm `build` script as
  `rm -rf dist && tsup`, NOT inside the tsup config**: an
  in-config clean races with the parallel dts builds — when index
  DTS happens to finish after client DTS, the cleanup wipes
  `client.d.ts` that was already written. Same fix applied to
  `@nexpress/next` (also a dual-entry package).

  **Server / client boundary.** Route components (server-side)
  import client widgets via the package's own subpath:

  ```ts
  import { DiscussionForm } from "@nexpress/plugin-forum/client";
  ```

  `@nexpress/plugin-forum/client` is in tsup's `external` list, so
  the index bundle leaves the import alone. At runtime, Node
  resolves the import via the package's `exports` map → loads
  `dist/client.js` (which carries the `"use client"` banner) →
  React's RSC compiler treats `DiscussionForm` as a client
  component. Importing the same file via a relative path
  (`"../client/discussion-form.js"`) would have bundled it INTO
  `dist/index.js` without the directive, breaking the boundary.

  **Adapter shape.** Plugin route components take
  `NpRouteRenderProps` (from `@nexpress/next` — re-exported
  from `@nexpress/theme` for plugin-author convenience): `params`
  and `searchParams` arrive already resolved (the dispatcher
  unwraps the Next.js `Promise<...>` form). This differs from
  file-based Next.js routes, where `params` is a Promise.

  **Untyped reads.** The plugin can't import the host's generated
  `findDiscussions` (codegen lives per-app). Routes call
  `findDocuments<DiscussionsDocument>("discussions", ...)` with a
  locally-defined shape. The plugin owns the schema
  (`defineDiscussionsCollection`), so the type definition is the
  source of truth, not a copy.

  **Removed from `apps/web`:**
  - `src/app/(site)/discussions/` (4 files)
  - `src/components/discussion-form.tsx` (moved)
  - `src/components/discussion-author-actions.tsx` (moved)

  The catch-all (`apps/web/src/app/(site)/[[...slug]]/page.tsx`)
  needs no change — its `dispatchPluginRoute` call from PRT.2
  already serves these routes.

  **Deferred from PRT.2 still applies:** `surface: "member"`
  plugin routes render inside the site shell (not a member
  shell). Wrap awaits PRT.4 (the parallel `(member)` catch-all
  for `impl.members.shell`).

- 580f0f2: Page builder palette — categories, recent picks, keyword search (#467, "Better block palette organization").

  Fourth PR off the #467 phase 2-4 queue. The Add-block popover now
  groups blocks by category, floats the operator's recent picks to
  the top, and matches against a richer set of search tokens. Helps
  discovery as plugin / theme blocks accumulate.

  `@nexpress/blocks` — three new optional fields on
  `NpBlockMetadata`:
  - `category?: string` — group key for the palette (e.g. "Layout",
    "Content", "Media", "Commerce", "Community"). Free-form so
    themes / plugins can add their own sections without lobbying
    for a hard-coded slot.
  - `keywords?: readonly string[]` — fuzzy-match tokens beyond
    `label` / `type` / `description`. Operators who don't remember
    the exact label still find the block (e.g. `["call to action",
"button banner"]` on CTA).
  - `source?: "built-in" | "plugin" | "theme" | (string & {})` —
    ownership scope. Drives a small "plugin" badge in the palette
    and lets the framework group plugin contributions. The
    `@nexpress/next` bootstrap auto-tags `source: "plugin"` on every
    block registered through `pluginBlocks(plugin)` (both initial
    load and `reloadPlugins()`), so plugin authors don't have to
    set it manually unless they want a different scope.

  Wired on the nine built-in blocks:
  - Layout: `grid`
  - Content: `hero`, `cta`, `faq`, `feature-grid`, `rich-text`
  - Media: `image-gallery`
  - Commerce: `pricing`
  - Community: `contact-form`

  `@nexpress/admin` `BlockPalette`:
  - Renders sectioned headers per category. Order:
    Recent → Layout → Content → Media → Commerce → Community →
    Plugin → Other → custom-categories alphabetical.
  - Recent section pulls the last 5 picks from `localStorage`
    (`np-page-builder.recent-blocks`). Stale types (plugin disabled,
    theme swap) get filtered out at render time.
  - Search filter now matches `label` + `type` + `description` +
    `category` + `keywords`.
  - Plugin contributions show a small "plugin" badge.

  Backward compatible. All metadata fields are optional; blocks
  without `category` fall into "Other" so existing definitions keep
  showing up unchanged. Pre-PR plugin blocks without `source` get
  auto-tagged "plugin" by the bootstrap. No wire-format changes.

- ad7ea4e: **PRT.2 — plugin page-route dispatcher + catch-all integration (#623).**

  Plugin-contributed `pageRoutes` declared via PRT.1's `definePlugin({ pageRoutes })`
  now actually serve requests. The `(site)` catch-all dispatches in this
  order:
  1. **Page slug** — operator-authored content always wins.
  2. **Slug history redirect** — renames don't break links.
  3. **Theme route** — F.2 dispatcher (existing behavior).
  4. **Plugin route** — new in this phase.
  5. `/` empty-state → `notFound()`.

  Same precedence applies in `generateMetadata` so plugin-rendered
  URLs emit plugin SEO instead of falling back to page metadata
  defaults.

  Public surface added on `@nexpress/next`:
  - `dispatchPluginRoute({ localeAwarePath, themeRoutes })` — async,
    walks `getPluginPageRoutes()` in registration order, skips
    disabled plugins via `isPluginEnabled`, returns the first match.
  - `buildPluginRouteRenderProps({ match, searchParams, blockCtx })`
    — symmetric with `buildRouteRenderProps`; produces the same
    `NpRouteRenderProps` shape so theme + plugin routes share the
    component contract.
  - `NpPluginRouteMatch` interface — narrows the registry's
    `unknown` component to `ComponentType<NpRouteRenderProps>`. The
    `@nexpress/core` plugin host stays React-free at the type level
    (peer-dep boundary); the dispatcher is the right seam to assert
    it.

  Kept module-internal (not on the public surface) to avoid
  committing to APIs no consumer needs yet:
  - `dispatchPluginRouteSync` — sync variant with a callback-driven
    `enabled` gate. Used by the dispatcher's own tests; can be
    promoted later if a real consumer surfaces (e.g. an admin
    preview).
  - `__resetPluginCollisionWarnings` — test hook for the once-per-
    pattern-per-process dedup; matches F.2's
    `__resetCollisionWarnings` (also internal-only).

  **Boot/runtime warnings.** The dispatcher logs once-per-process
  when:
  - a theme pattern shadows a plugin pattern (theme > plugin
    precedence — locked decision §2.3 of the design doc), or
  - two plugins claim the same pattern (first registered wins).

  Both warnings name the conflicting pattern + plugin id(s) so an
  operator can diagnose without spelunking through the registry.

  **Scope deliberately tightened.** PRT.2 ships the dispatcher and
  catch-all wiring; two pieces from the design doc are deferred:
  - `surface: "member"` shell wrap — needs a parallel `(member)`
    catch-all because `impl.shell` ≠ `impl.members.shell`. Lands
    in PRT.4 alongside the admin Plugins UI surface. For PRT.2,
    `surface: "member"` routes still match and render, but inside
    the site shell. Operators get the route working today; the
    shell distinction lands once the member catch-all is in.
  - `locale: "none"` — only the catch-all's locale-stripped path is
    forwarded today. Almost no real plugin needs `"none"`;
    promoting it requires plumbing the raw path through bootstrap.
    Deferred to v1.x.

  19 new tests in `packages/next/src/route-dispatcher.test.ts`:
  - match (literal, :param, normalized leading slash, segment count)
  - first-registered-wins, disabled-plugin-skip, enabled fall-through
  - defense against primitive `component` value
  - preserve `surface` / `locale` on the match
  - async variant with the production `isPluginEnabled` gate
  - collision warnings (theme-shadows-plugin, plugin-vs-plugin)
  - once-per-pattern-per-process dedup

  92/92 in `@nexpress/next`.

  Drive-by fix: `bootstrap.test.ts`'s `vi.mock("@nexpress/core")`
  was missing `getOptionalRateLimiter` (added in #621). Two
  pre-existing test failures cleared.

- 7b61ba8: **Phase F.5 — `impl.patterns`: theme-shipped block patterns + active-source filter.**

  Fifth implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.5). Themes can ship
  pre-shaped block subtrees that operators drop into pages in one
  click. Patterns participate in the same `theme:<id>` source
  identity model as F.4 blocks, so multi-site processes filter
  patterns per active site exactly like blocks.

  ### Surface added

  #### `@nexpress/blocks`
  - `NpPattern.preview?: string` — optional preview image path
    (typically served from the theme's `public/`). Picker UI
    thumbnail rendering is tracked as a follow-up; the field
    persists today regardless.
  - `NpPattern.category?: "homepage" | "page" | "section" | string`
    — optional grouping label.
  - `getRegisteredPatternsForActiveSources(ctx)` — sister of the
    F.4 block filter. Theme patterns are scoped by `themeId`;
    plugin / built-in / custom patterns always pass.

  #### `@nexpress/theme`
  - `NpThemeImpl.patterns?: NpPattern[]` — theme-shipped patterns.

  #### `@nexpress/next`
  - Bootstrap auto-stamps `source: "theme:<theme.manifest.id>"` on
    each pattern at registration. Theme patterns survive plugin
    reload (re-registered after `resetSharedPatternRegistry`)
    exactly like F.4 theme blocks.

  #### `apps/web`
  - Admin layout now filters patterns through
    `getRegisteredPatternsForActiveSources` so the page-builder's
    pattern picker only shows the current site's patterns. Same
    `getCachedActiveTheme()` resolution as F.4 — admin and
    renderer agree on the active theme.

  ### Plugin/theme parity

  Plugin patterns already get `source: "plugin:<plugin.id>"`
  (stamped in F.4). Theme patterns now get `source: "theme:<id>"`.
  The activation filter follows the same rule as for blocks —
  plugin / core / custom patterns always pass; only theme
  patterns are gated by the active theme id.

  ### Tests

  3 new unit tests in `packages/blocks/src/source.test.ts`:
  - Filters theme patterns by active theme id
  - Filters out all theme patterns when no theme active
  - Preserves `preview` + `category` fields through the filter

  Total `@nexpress/blocks` tests: 17 (was 14).

  ### What's not in this phase (deferred — explicit follow-up)

  The design doc §4.5 promises a redesigned **picker UI** with
  category grouping + preview thumbnails. Today's Cmd-K command
  menu lists patterns under a flat "Pattern" group label —
  operators CAN insert theme patterns through it, but the
  visual experience is plain.

  The picker UI redesign is **F.5.1**, a follow-up PR within
  the F.5 phase. Splitting it off keeps this PR focused on the
  contract surface (which downstream phases F.6+ depend on)
  without ballooning into a UI redesign. The deferred work:
  - Replace flat list with category-grouped sections
  - Render `preview` image thumbnails next to pattern entries
  - Filter / search by category in the picker

  Recorded here because the user-visible operator experience
  isn't fully shipped until F.5.1 lands.

- ab55980: Fix `findOne` on the block render context bypassing anonymous-visibility and published-status filters (#475).

  `createDefaultBlockRenderContext().content.findOne` was calling
  `getDocumentById` directly, which only enforces tenant scoping and
  the collection's `access.read({ user, doc })`. For collections
  whose `access.read` returns `true` for unauthenticated users (the
  reference `posts` collection is the canonical example), a draft
  or `visibility = "private"` doc id reaching a block plugin —
  plugin author input, query string, or persisted block prop —
  would render the doc on a public page.

  `findOne` now routes through `findDocuments(collection, { where:
{ id, ... applyPublishedDefault } })`. Going through that path
  fires the pipeline's anonymous-visibility default
  (`visibility = "public"` when no `user` is passed) and the
  existing `applyPublishedDefault()` status guard, so:
  - Drafts no longer leak through `findOne`.
  - Private (`visibility = "private"`) rows no longer leak through
    `findOne`.
  - Per-collection `access.read` semantics are unchanged — block
    plugins keep the same surface they had before.

  Added a unit test pinning the wire shape of the `findDocuments`
  call so future refactors can't silently skip the filters.

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

- b42d8ff: Retry bootstrap initialization after transient plugin registration or job producer startup failures.
- e66e922: Fix `reloadPlugins()` leaving disabled plugins' block definitions in the shared block registry (#477).

  `resetPlugins()` clears hooks / routes / actions / scheduled tasks
  on reload, but block definitions live in the separate shared block
  registry (`@nexpress/blocks`'s `sharedDefinitions` map). After an
  operator disabled a block plugin and clicked "Reload all", the
  disabled plugin's blocks would still:
  - Surface in the admin's Add-block popover.
  - Resolve during server render so existing pages kept rendering
    the disabled plugin's blocks instead of falling back to the
    unknown-block placeholder.

  `@nexpress/blocks` now exports `resetSharedBlockRegistry()`, which
  clears the registry and re-seeds the built-ins. The
  `@nexpress/next` bootstrap calls it inside `reloadPlugins()` right
  after `resetPlugins()` and before re-registering blocks from
  currently-enabled plugins. The post-reload registry settles on
  `built-ins + currently-enabled plugin contributions`.

  Added a regression test in `bootstrap.test.ts` that pins both
  `resetPlugins` and `resetSharedBlockRegistry` getting called once
  per reload.

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
- Updated dependencies [6672371]
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
- Updated dependencies [9942779]
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
- Updated dependencies [41ac5d2]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [45020fd]
- Updated dependencies [6fd0332]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [15aa1d4]
- Updated dependencies [89c7180]
- Updated dependencies [6483de7]
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0
  - @nexpress/theme@1.0.0

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

- 952483c: Phase 22.2 — surface known-unsafe configurations at boot via the
  structured logger.

  `@nexpress/core` adds `verifyStartupSafety(input)` (re-exported from
  the package root) — a pure function that takes the resolved storage
  adapter id, the auth secret, `NODE_ENV`, and the `NP_MULTI_NODE` flag,
  and emits warnings through `getScopedLogger({ subsystem: "boot" })`
  for the two operationally-bitten cases:
  - `LocalStorageAdapter` running with `NP_MULTI_NODE=true` (or `=1`),
    which silently drops uploads as nodes diverge on the local
    `./uploads` dir.
  - `NODE_ENV=production` with `NP_SECRET` unset or shorter than 32
    characters, which lets sessions be forged with a weak key.

  `@nexpress/next` calls the helper once per process from
  `createBootstrap()`'s `ensureServices`, so any app using the standard
  bootstrap (apps/web, scaffolded sites) picks the warnings up
  automatically. Operators with `setLogger(...)` already in place get
  the warnings in their structured-log pipeline; others see them on
  stdout via the default `consoleLogger`.

  Returns the list of emitted warning ids so tests can assert on them;
  nothing in production reads the return value.

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
