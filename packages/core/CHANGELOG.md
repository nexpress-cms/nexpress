# @nexpress/core

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

- 131be43: **Three new boot-time prod warnings (#597).**

  `verifyStartupSafety` gains three optional inputs and three new
  warning ids that fire when `NODE_ENV=production`:
  - `emailAdapterEnv` — when `null` (env var unset) or `"noop"`
    in production, warn that transactional mail (password reset,
    email verify, member digests) is silently dropped. Warning id:
    `noop_email_in_prod`. Note: this checks the operator's
    **intent** via the env var rather than the live adapter,
    because the email adapter is wired AFTER this safety check
    runs in the boot sequence — a live-adapter check would always
    see the default noop. Programmatic `setEmailAdapter()` calls
    surface a false positive; the warning text calls that out.
  - `databaseHost` — when loopback (`localhost` / `127.0.0.1` /
    `::1` / `0.0.0.0`) in production, warn that the operator
    likely shipped a stale dev DATABASE_URL. Warning id:
    `loopback_database_in_prod`.
  - `siteUrl` — when explicitly `null` (caller checked, env unset)
    warn `missing_site_url`; when loopback-shaped warn
    `loopback_site_url`. Both anchor on broken share links / OAuth
    round-trips / outbound mail links.

  The existing input fields are unchanged. Older callers that don't
  supply the new fields continue to behave exactly as before — the
  new checks treat `undefined` inputs as "caller didn't provide
  info, skip the check" rather than firing on every old call site.

  `packages/next/src/bootstrap.ts` is updated to gather the three
  new inputs from `getEmailAdapter().kind`, the parsed
  `DATABASE_URL` host, and `process.env.SITE_URL`. Operators on
  nexpress's reference bootstrap get the new warnings automatically.

- 5203fd7: **Custom routes registry — surface hand-coded Next.js routes in the admin.**

  Hand-coded site routes (e.g. `apps/web/src/app/(site)/blog/page.tsx`)
  were invisible to the framework: the catch-all `[[...slug]]` only knows
  CMS pages, plugins declare their own routes via `definePlugin({ routes })`,
  and operators had to type `/blog` into the navigation editor's link
  field by hand with no discovery surface.

  A new minimal registry closes the gap without scanning the filesystem
  (too brittle given Next's route-group / parallel-route / intercepting-route
  expressiveness — a static manifest would lie):
  - **`@nexpress/core/routes`** — a new domain subpath exposes
    `registerCustomRoute({ path, label, description?, icon?, group? })`,
    `getCustomRoutes()`, `clearCustomRoutes()`, and the `NpCustomRoute`
    type. Re-registering the same `path` overwrites silently (HMR-safe,
    matching the block registry convention). Symbols are also re-exported
    from the root `@nexpress/core` for back-compat. Stable in 0.x — adding
    optional fields to `NpCustomRoute` is non-breaking; renaming or
    removing one rides a minor with a migration note.
  - **App boot** registers each navigable route once. The reference app
    declares `/blog`, `/search`, `/discussions`, `/discussions/new`,
    `/members/login`, `/members/register`, and `/members/me` from
    `apps/web/src/lib/custom-routes.ts`, called by `ensureFor("read")`.
  - **Settings → Routes** (read-only list, capability-gated on
    `admin.manage`) shows every registered route grouped by `group`.
    No write operations — routes are code-owned by definition.
  - **Navigation editor** attaches a native `<datalist>` to the link URL
    input so operators can pick `/blog` from a dropdown instead of
    typing. Dynamic routes (`/u/[handle]`) are excluded from the
    autocomplete because a literal href can't be derived without input,
    but they still appear in the Routes tab tagged `dynamic`.

  Plugin-contributed routes are not affected — they continue to be
  listed under each plugin's "Show details" panel in the Plugins
  manager.

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

- 0c59b98: **Phase E — `hasMany` relationship filtering on `findDocuments` + typed wrappers.**

  Closes the friction surfaced in #540's `/blog/category/[slug]`
  dogfood. Sites can now write the natural query directly:

  ```ts
  const result = await findPosts({
    where: { status: "published", categories: category.id },
    sort: "-publishedAt",
    page: pageNum,
    limit: 20,
  });
  ```

  …instead of dropping into raw Drizzle to subquery the join
  table by hand (and remembering to re-apply the `siteId` /
  `visibility` / `access.read` gates that `findDocuments` would
  have applied for free).

  ### Three pieces
  1. **`NpFindWhere<T>` accepts arrays per field** — the type
     `Partial<T>` is now `{ [K]?: Unwrap<T[K]> | Unwrap<T[K]>[] }`.
     Hand-typed scalars stay scalar; hasMany arrays unwrap so
     `categories: string[] | null` reads as `string | string[]`
     in where clauses (single target or OR-list of targets).
  2. **`findDocuments` runtime auto-detects array values** — when
     `where[field]` is an array, the pipeline emits `inArray(col,
value)` instead of `eq(col, value)`. Empty arrays
     short-circuit to a `false` SQL clause (Postgres rejects
     `IN ()` with a syntax error otherwise).
  3. **Codegen typed wrappers pre-resolve hasMany fields** —
     `generateDocumentsModule` now detects top-level relationship
     fields with `hasMany: true` on each collection. Their
     `find${Pascal}` wrapper queries the join table for matching
     parent ids, intersects across multiple hasMany filters
     (`categories: x AND tags: y` matches rows that have BOTH),
     strips the hasMany keys from the where clause, adds
     `id: idList`, and delegates to `findDocuments`.

  ### Critically: gates preserved

  Because the wrapper goes through `findDocuments`, all the
  hardening that `findDocuments` already applied keeps applying:
  - `siteId` scoping (multi-site)
  - `visibility = "public"` for anonymous viewers
  - `access.read({ user, doc })` callback per row

  The cookbook §2.1 (raw Drizzle escape hatch) is rewritten —
  the natural typed-wrapper path is now the recommended one,
  with a much smaller "when you still need raw Drizzle" callout
  for exotic shapes (full-text ranking, JSON-column queries).

  ### Reference app migration

  `apps/web/src/app/(site)/blog/category/[slug]/page.tsx` is
  refactored from ~70 lines of raw Drizzle (with the security-
  critical gate-restoration code) to a single 8-line `findPosts`
  call. Same behavior, much smaller surface to reason about.

  ### Tests

  5 new unit tests in `type-generator.test.ts` assert:
  - Simple wrapper for hasMany-free collections (no async, no
    drizzle imports)
  - Hasn't-aware async wrapper for collections with hasMany
  - Multiple hasMany fields produce multiple descriptors
  - Intersect short-circuit behavior is documented in the output
  - `getDb` import only appears when at least one collection
    needs it

  Total core tests: 280 (5 new).

  ### Stability

  `NpFindWhere<T>` shape change is backwards-compatible: with
  the default `T = Record<string, unknown>` the per-field type
  is `unknown | unknown[]` which subsumes the previous
  `Record<string, unknown>` (no caller could pass an array
  before; now they can). Joins v0.1's stable surface as the
  recommended hasMany-filter path.

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

- 89c32db: feat(theme, core, web): M.3 — `impl.members.notFound` / `impl.members.error` slots

  Third phase of the F-track member-surface skinning. Themes can now ship a member-tree-specific 404 page and error boundary, mirroring the v0.2 `impl.notFound` / `impl.error` slots (F.7 / F.7.1) for the `(member)/members/*` subtree.

  **Theme contract additions** (`@nexpress/theme` `NpThemeImpl.members`):

  ```ts
  members?: {
    shell?: ComponentType<NpThemeShellProps> | null;
    pageTitle?: { ... };
    notFound?: ComponentType;                      // NEW (M.3)
    error?: ComponentType<NpThemeErrorProps>;      // NEW (M.3) — forward-compat marker
  };
  ```

  **Fallback chain** for `members.notFound`:
  1. `impl.members.notFound` declared → use it
  2. `impl.members.notFound === undefined` → fall back to `impl.notFound`
  3. `impl.notFound === undefined` → framework default (the JSX in `(member)/not-found.tsx`)

  The framework default is tuned for the member surface — the CTA points to `/members/login` rather than the public site's "go home" default. Most "page not found" hits inside `/members/*` are stale auth links (expired verify tokens, old reset-password emails opened twice); a "go home" CTA misroutes those.

  **Core API surface** (`@nexpress/core`):
  - `extractMembersNotFoundComponent(impl)` — pure structural narrower with the fallback chain (member-level → top-level → null). Mirrors `extractNotFoundComponent` shape, treats `impl` as opaque (`unknown`); the consumer in `apps/web` casts to `ComponentType` at the JSX site.
  - `getActiveThemeMembersNotFound()` — async sugar over the active theme. Returns the resolved component reference (or `null` when neither slot is declared).

  **Files**:
  - `apps/web/src/app/(member)/not-found.tsx` (NEW) — server component, delegates to `getActiveThemeMembersNotFound()`, falls through to the framework default
  - `apps/web/src/app/(member)/error.tsx` (NEW) — `"use client"` + lazy `THEME_MEMBER_ERRORS` registry shape (parallel to `(site)/error.tsx`'s F.7.1 pattern). Registry starts empty — reference theme adoption (`./components/members-error` subpath in magazine) lands in M.ref.
  - `(member)/error.tsx` keeps its OWN registry rather than inheriting `(site)/error.tsx`'s `THEME_ERRORS` map. Coupling the two would force every theme that ships a public-site error subpath to also ship a members-error subpath even when the public default is fine for both.

  **5 unit tests** added covering the fallback chain (no impl / no slots / member-level wins / top-level fallback / non-function rejection). 361 tests pass total (was 356).

  **Reference theme adoption** (magazine shipping `./components/members-error` + a custom `members.notFound`) lands in M.ref. Existing themes with no `impl.members.notFound` declared continue to work — the fallback chain hits step 2 or 3.

- 53627e1: Page builder — server-side media search + hierarchy moves in row header (#467 follow-ups).

  Two improvements flagged in the post-merge audit of the #467
  work.
  - **Server-side media search.** `listMedia()` (and the
    `/api/media` route via a new `q` query param) now runs an
    `ILIKE` over `filename` + `alt`, OR-joined, with `%` / `_`
    escaped so filenames containing them aren't misread as
    wildcards. The page-builder block-image picker drops its
    client-side filter and passes `q` to the API instead, so
    search hits the whole library instead of only the loaded
    pages.
  - **Hierarchy moves in the row header.** Each
    `SortableBlockItem` header gets a new "More actions"
    dropdown (lucide `MoreHorizontal`) with three sections:
    - "Move out of <parent>" when the row has a parent.
    - "Move into <container>" — one entry per valid target
      (resolved lazily on dropdown open via
      `getMoveIntoCandidates(id)`).
    - "Wrap in <container>" — one entry per available container
      type that isn't the row's own type.
      Mirrors the Cmd-K commands so mouse operators discover the
      same set of cross-hierarchy moves.

  Backward compatible. `listMedia()`'s new `q` field is
  optional; admin / web clients that don't pass it see the
  existing list-everything behavior. The dropdown is purely
  additive — same row layout, same actions reachable from
  Cmd-K stay where they were.

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

- 6657059: Three follow-ups to the nav editor (cluster 1 from the post-#429 triage):
  - **Cache invalidation on page slug change.** `apps/web`'s `pages`
    collection now ships an `afterUpdate` hook that calls
    `revalidateTag(navCacheTag(siteId, location))` for every nav
    location when `data.slug !== originalDoc.slug`. Without it,
    rename a page slug and the menus kept rendering the old URL
    until the nav cache TTL expired.
  - **Unsaved-changes warning on location switch.** Switching the
    Header/Footer/Main selector while edits are pending now opens a
    Discard / Cancel dialog instead of silently blowing away the
    in-progress changes. The `dirty` check compares serialized items
    against the last loaded/saved snapshot.
  - **`type: "collection"` support.** The editor's type select gains
    a `Collection` option backed by a picker populated from
    `/api/meta/collections`. `getNavigation()`'s URL resolver maps
    `type: "collection"` + slug to `/{slug}` so themes' renderers
    don't change. Collections without a registered slug fall back to
    `#` for the same cache-stability reason as missing pages.

- ae0c053: The page-edit "In navigation" panel now works for any
  page-shaped collection, not just the reference `pages`
  collection. Adding a doc from a `landing-pages` or
  `static-pages` collection produces a nav item that resolves to
  the doc's correct public URL — previously, the URL resolver
  was hardcoded to look up doc ids in the `pages` collection,
  silently returning `#` when the panel was opted into elsewhere.

  How it works:
  - `NpNavItem` gains an optional `collectionSlug` field. When
    set on a `type: "page"` item, the URL resolver looks the doc
    up in that collection instead of `pages`.
  - The resolver now drives URLs through each collection's
    `seo.urlPath` (the same contract the sitemap and RSS feed
    use), so the per-collection URL convention is honored
    automatically. The reference `pages` collection's existing
    `seo.urlPath` produces the same URLs it always did — fully
    back-compat.
  - The `NavMembershipPanel` accepts a `collectionSlug` prop
    (defaults to `"pages"`), passes it through to the membership
    endpoint as `?collection=<slug>`, and stamps it on new nav
    items only when it differs from `"pages"` so the wire format
    for the common case stays minimal.
  - The `create-nexpress` page template gains an explicit
    `seo.urlPath` definition. This was previously implicit — the
    resolver hard-coded the same logic as a fallback — but with
    the resolver now generic, the template needs to declare its
    own URL contract. Sitemap support comes along for free.

- a107c8a: Generalize the page edit view's "In navigation" panel: it now renders
  for any collection that opts in via `admin.navMembership: true` on
  its `defineCollection()` config, not only the hardcoded `pages`
  slug. The reference `pages` collection ships with the flag on, so
  existing sites see no change. Sites with a `static-pages` or
  `landing-pages` collection can flip the same flag on and the panel
  will read/write the same `np_navigation` rows.

  The panel also gains a success flash after add/remove so the
  operator gets explicit feedback (the silent membership reload was
  hard to read against a long page form). The flash auto-dismisses
  after 2.5s and stays out of the error region.

- f98fe9c: Navigation editor wires up two missing pieces:
  1. **Page picker** — selecting `type: "page"` for a nav item now lets
     the operator pick from the live pages list (`/api/collections/pages`)
     and stores `pageId` instead of a hardcoded URL. `getNavigation()`
     resolves `pageId` → current page slug → URL on read, so renaming a
     page slug doesn't silently break header/footer links. Items whose
     linked page was unpublished or deleted fall through to `#` rather
     than dropping out of the cached menu.
  2. **Location switcher** — the editor exposes a Header / Footer / Main
     selector (the `np_navigation` table has always keyed by location;
     the UI was hardcoded to `"main"`). Each location's items load and
     save against its own `(siteId, location)` row.

  `NpNavItem`'s shape is unchanged — `pageId` and `url` were already
  declared on the type. Editor migration: existing items with
  `type: "page" + url` keep working because the page-typed branch falls
  back to `#` only when `pageId` is absent and `url` is empty.

- d3ea817: **Page author primitives — fill in the four gaps theme / custom-page developers were hitting.**

  `@nexpress/core` already covers most of what someone writing a hand-coded
  Next.js route under `app/(site)/*` (or shipping a theme package) needs:
  `findDocuments`, `getPageBySlug`, `searchCollections`, `getNavigation`,
  `getSetting`, `getMediaById`, `t`, `tSync`, `requireAuth`, `getTheme`,
  `renderBlocks`, `renderRichText`, `buildPageMetadata`, `buildSitemap`,
  JSON-LD builders, and so on. Four primitives were missing and forced
  either internal-API spelunking or hardcoded paths — this changeset
  adds them with v0.1 stability commitment.
  - **`getMediaUrl(id, { variant?, fallbackToOriginal? })`** in
    `@nexpress/core/media`. Resolves a media record's public URL through
    the active storage adapter (handles local-vs-S3 transparently) and
    picks the right sized variant from the row. Falls back to the
    original by default; pass `fallbackToOriginal: false` to get `null`
    when the variant is missing instead. Built-in variant names mirror
    `DEFAULT_IMAGE_SIZES` (`thumbnail`, `small`, `medium`, `large`,
    `xlarge`, `og`); plugin-defined variants are accepted as plain
    strings. Returns `null` for unknown / soft-deleted ids.
  - **`getPluginConfig<T>(pluginId)`** in `@nexpress/core` (root and
    `@nexpress/core/plugins` via `./plugins/index.js`). Reads the
    persisted config from `np_plugins.config`. Returns `null` when the
    plugin isn't installed (so themes can detect "feature not available"
    without a separate `isPluginEnabled` round-trip), `{}` when
    installed with no config saved, and the typed object otherwise. The
    generic parameter is unchecked at runtime — callers should
    Zod-validate before trusting the shape since the framework can't
    see the plugin's schema. Internal `loadPluginConfig` now delegates
    to the public function so there's a single source of truth.
  - **`resolveLocale(input)` + `getCurrentLocale(input)`** in
    `@nexpress/core/i18n`. Same conventions the reference app's
    `[[...slug]]` route uses, so theme / page authors don't reimplement
    them: pathname prefix beats `Accept-Language`, which beats the
    default locale. `resolveLocale` returns `{ locale, source,
pathnameWithoutLocale }` (so callers building hreflang / canonical
    URLs know whether to issue a 301), `getCurrentLocale` is the thin
    wrapper that returns just the locale string with an `"en"` hard
    fallback when i18n isn't configured. Returns `null` from
    `resolveLocale` for monolingual sites. 12 unit tests cover quality
    factors, primary-subtag matching, wildcard rejection, and the
    path-beats-header precedence.
  - **`getMemberProfile(idOrHandle, { avatarVariant? })`** in
    `@nexpress/core/community`. Public-facing member fetcher that hand-
    picks safe-to-render columns from `np_members` (id, handle,
    displayName, avatarUrl, bio, reputation, joinedAt) and excludes
    PII (email, password hash, login attempts, reset tokens,
    notification prefs, plugin meta bag). Resolves the avatar through
    `getMediaUrl` so the caller doesn't see storage-adapter details.
    Filters out `suspended` / `deleted` members. Accepts either id or
    handle in a single argument because callers don't always know
    which form they have (UUID-shape checks fail for synthetic /
    imported ids).

  All four are stable in v0.1 — adding optional fields to the option
  objects is non-breaking; renaming or removing one rides a minor with
  a migration note.

- 9c3cd89: Slug renames now permanently redirect (HTTP 308) instead of 404. When an operator renames a page (e.g. `/old-page` →
  `/new-page`), search-engine indices, external links, and
  bookmarks for the old URL stay working — the public-site
  catch-all looks up the rename history and issues a permanent
  redirect to the current path. (Next's `permanentRedirect` emits
  308; semantically equivalent to the classic 301 for SEO and
  preserves the request method.)

  Implementation:
  - New table `np_slug_history` records every slug change for
    collections that declare `slugField`. Indexed on
    `(siteId, collection, oldSlug)` for the read path.
  - The content pipeline writes a history row inside the same
    transaction as the doc UPDATE — half-applied state isn't
    possible. Skipped on creates and on updates that don't
    change `slug`.
  - New helper `findSlugRedirect(collection, oldSlug)` walks the
    history chain (capped at 5 hops) and returns the most recent
    target. Cycle-safe.
  - The `(site)/[[...slug]]` catch-all calls the helper before
    emitting `notFound()`. Locale prefixes survive the redirect.

  Wire-compat: existing slugs unchanged. Empty history table on
  upgrade — sites get redirects only for renames that happen
  after the migration runs.

- 2c31d26: **Phase F.7 — error / 404 / SEO surface contributions.**

  Seventh implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.7). Themes can now
  contribute the public-site 404 page, plus extra sitemap / feed
  entries and a custom `robots.txt` body.

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.notFound?: ComponentType` — public-site 404
    component. Used by `(site)/not-found.tsx`.
  - `NpThemeImpl.error?: ComponentType<NpThemeErrorProps>` —
    public-site error boundary fallback. Currently typed for
    forward-compatibility; the framework's `error.tsx` ships a
    client default because Next requires error.tsx to be a
    client component (see deferred section).
  - `NpThemeImpl.seo?: NpThemeSeoHooks` — sitemap / feed / robots
    contributions.

  #### `@nexpress/core`
  - `extractNotFoundComponent` / `extractErrorComponent` /
    `extractSeoHooks` — pure structural narrowers (testable
    without DB).
  - `getActiveThemeNotFound` / `getActiveThemeError` /
    `getActiveThemeSeoHooks` — async wrappers.
  - `BuildAtomFeedOptions.extraEntries?: NpFeedEntry[]` — feed
    builder accepts theme-supplied entries; merged with the
    collection walk, deduped by id (framework wins), re-sorted
    newest-first, capped by limit.

  #### `apps/web`
  - `(site)/not-found.tsx` — delegates to active theme's
    `impl.notFound` when defined; framework default otherwise.
  - `(site)/error.tsx` — framework default (client component;
    see deferred section).
  - `sitemap.xml` route merges theme entries from
    `seo.sitemapEntries`; deduped by `loc` (framework wins).
  - `feed.xml` route passes theme entries to
    `renderAtomFeed({ extraEntries })`.
  - `robots.txt` route uses theme's `seo.robotsTxt` when defined
    (whole-body replacement); framework default otherwise.
  - `PUT /api/admin/themes/active` busts `nx:sitemap:<siteId>` +
    `nx:feed:<siteId>` when the new active theme contributes
    SEO hooks (parallel to F.3 settings save invalidation).

  ### Caching contract

  Per design doc §4.7:
  - Theme switch (`activeTheme` row write) → busts theme cache
    always; busts SEO tags when new active theme has
    `impl.seo.*`. Implemented in this phase.
  - Theme settings save (`theme.settings:<themeId>` row write)
    → already wired in F.3 via `activeThemeContributesSeo`.
  - Theme tokens save (`theme` row write) → no SEO bust. Tokens
    don't affect sitemap/feed content.

  ### What's not in this phase (deferred)
  - **Generic delegation from `(site)/error.tsx` to theme's
    `impl.error`** — Next requires `error.tsx` to be a client
    component, but theme components are server-defined. React's
    server→client boundary blocks the generic wiring. The type
    exists for forward-compat (a future Next API for
    server-rendered error fallbacks would let the framework
    delegate transparently) and themes that want a fully custom
    error surface can ship their own `(site)/error.tsx`
    override. Recorded as **F.7.1 follow-up** when the Next API
    shape settles.

  ### Tests

  7 new unit tests in `packages/core/src/themes/error-seo.test.ts`:
  - `extractNotFoundComponent` / `extractErrorComponent` —
    null on undefined / non-function, returns ref when present
  - `extractSeoHooks` — empty on missing seo, picks up
    individual hooks, ignores non-function members, partial
    declaration only fills present fields

  Total core tests: 321 (was 314).

  ### Dependency note

  `@nexpress/theme` declares `NpSitemapEntry` / `NpFeedEntry`
  local-mirror types instead of importing from `@nexpress/core` —
  same tsup DTS bundler workaround already used for
  `NpThemeTokensOverlay` (the bundler intermittently fails to
  resolve named cross-package types even when present in the
  consumed dist). Structural identity is enough; theme authors
  get the right shape and runtime values pass through unchanged.

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

- 463fe5f: **Phase F.1 — `manifest.requires`: theme data-shape declaration + admin warning surface.**

  First implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md`). Themes whose
  components assume specific collection fields can now declare
  those expectations in their manifest, and the admin theme
  switcher reads the declarations to surface mismatches before the
  operator clicks "activate".

  ### Surface added
  - `NpThemeManifest.requires` — optional declaration of expected
    collections + fields per collection.
  - `NpThemeCollectionRequirement` / `NpThemeFieldRequirement` —
    the type building blocks. Field `type` strings match
    `NpFieldConfig` variants exactly (`"checkbox"`, `"upload"`,
    `"richText"`, etc.) so the runtime check can compare without
    translation.
  - `checkThemeRequirements(manifest, collections)` — pure function
    that compares a theme's declared requirements against the
    site's registered collections. Returns structured
    `missingCollections` / `missingFields` / `typeConflicts` /
    `relationConflicts` plus `hasMismatches` and
    `hasHardMismatches` summaries.
  - `NpThemeRequirementResult` and friends — the result types,
    exported.

  ### Admin integration
  - `GET /api/admin/themes` now includes a `requirements` field per
    theme entry summarizing the check result. The check runs
    in-memory only (no DB), so listing cost is unchanged.
  - The theme switcher (`packages/admin/src/settings/theme-switcher.tsx`)
    surfaces a warning chip + summary line on each theme card
    with mismatches, including a copy of the
    `pnpm nexpress theme:install <id>` command operators will run
    in Phase F.8 to resolve. Hard requirements show as destructive
    (red); soft (`hard: false`) as amber.

  ### Soft vs hard

  Field requirements default to `hard: true`. Set `hard: false`
  when the theme degrades gracefully without the field — admin
  shows a softer warning, and the future Phase F.8 CLI may treat
  soft fields as opt-in patches.

  ### What's not in this phase

  Per the design doc:
  - The `pnpm nexpress theme:install` CLI that AST-patches
    collections to satisfy these requirements is **Phase F.8**.
    F.1 only ships the contract type + admin warning surface.
  - Activation is not blocked by mismatches — the operator can
    still activate a theme with warnings (and might choose to do
    so during dev). The warning is informational.

  ### Tests

  9 unit tests covering: no-requires no-op, missing collection,
  missing field, soft-vs-hard severity routing, type conflict on
  existing field, relationship target mismatch, relationship
  target subset acceptance, row+collapsible field walker, and
  array/group sub-record non-descent.

  Total core tests: 291 (was 282).

- ea608af: **v0.3 (D) — `settingsSchema` migration helpers.**

  Closes a v0.3-deferred item from
  `docs/design/theme-v0.2-extension.md` §10 + the
  `feat-theme-settings.md` changeset:

  > `settingsSchema` migration helpers — v0.2 falls back to
  > defaults on mismatch. Real migration helpers tracked here.

  ### Problem

  In v0.2, when a theme's `settingsSchema` evolved (renamed a
  field, removed one, tightened a default), the
  `getThemeSettingsWithStatus` read path's `safeParse` would fail
  and the runtime fell back to schema defaults — silently blowing
  away the operator's customizations on a theme upgrade.

  ### Solution

  Two new optional fields on `NpThemeManifest`:

  ```ts
  defineTheme({
    manifest: {
      settingsSchema: z.object({
        accentColor: z.string().regex(...).optional(),
        ...
      }),
      settingsVersion: 2,
      settingsMigrate: (old, from) => {
        if (from === 1) {
          const o = old as { accent?: string };
          return { ...o, accentColor: o.accent };
        }
        return old;
      },
    }
  })
  ```

  | Field                                | Purpose                                                                                                                                                                                                                         |
  | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `settingsVersion?: number`           | Theme bumps this when `settingsSchema` changes shape non-additively. Absent / undefined treated as `1` (the v0.2 baseline).                                                                                                     |
  | `settingsMigrate?(old, fromVersion)` | Pure function bringing a value from `fromVersion` up to `settingsVersion`. Called on read when stored < target. Defensive try/catch — a buggy migrator falls back to the raw value, schema parse decides what to do downstream. |

  ### Storage

  Settings now persist as a versioned envelope:

  ```json
  {
    "__npVersion": 2,
    "__npSettings": { "accentColor": "#abc123", ... }
  }
  ```

  Sentinel keys (`__npVersion`, `__npSettings`) avoid collision
  with theme-owned settings fields. Legacy v0.2 unwrapped values
  (written before this PR) are detected by the absence of the
  sentinels and treated as v1 — the migrator runs on first read,
  and the operator's NEXT save through the admin form persists
  the new envelope.

  ### Read path behavior

  | Scenario                                                   | Behavior                                                                 |
  | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
  | No row stored                                              | Schema defaults (unchanged from v0.2)                                    |
  | Wrapped envelope, version matches                          | Parse + return (no migration)                                            |
  | Wrapped envelope, version < manifest                       | `settingsMigrate(old, from)` → parse migrated value → return             |
  | Legacy unwrapped value, manifest at v1                     | Parse as-is — fully back-compat                                          |
  | Legacy unwrapped value, manifest at v2+                    | Treat as v1 → migrate → parse                                            |
  | Wrapped envelope, version > manifest (operator downgraded) | No-op → parse → if fails, defaults + parseError                          |
  | Migrator throws                                            | Fall back to raw value → parse → if fails, defaults + parseError         |
  | Migrated value still doesn't pass schema                   | Defaults + parseError (admin shows the existing "settings reset" banner) |

  ### Auto-write?

  Read paths don't auto-persist the migrated value. The
  migration recomputes on each read until the operator saves
  through the admin form, at which point `setThemeSettings` wraps
  in the current envelope. This keeps read paths pure (matches
  every other cached read in the framework) and avoids
  write-amplification on cold reads.

  ### Tests

  12 new unit tests in `settings-migration.test.ts` covering:
  - `isVersionedSettings` shape detection (wrapped / legacy /
    primitives / partial sentinel)
  - `applyMigration` for: same-version no-op, downgrade no-op,
    no-migrator no-op, single-step + multi-step migrations,
    absent `settingsVersion`, defensive throw handling

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

- 8790088: PR B of 3 in the "make defaults look properly designed" cluster.
  Themes now ship distinct palettes that actually reach the rendered
  page, and the built-in section blocks pick those palettes up via
  CSS variables.

  **Token wiring**

  `getTheme()` in `@nexpress/core` now layers three sources before
  serving tokens, last-writer-wins:
  1. `DEFAULT_THEME` — framework baseline.
  2. The active theme's `impl.tokens` — author-shipped overrides
     (e.g. magazine's warm cream palette, portfolio's dark surface).
  3. The DB row in `np_settings.theme` — admin overrides via the
     theme settings tab.

  Each layer is a `NpThemeTokensOverlay` (sub-tree-Partial), so a
  theme that sets only `colors.primary` doesn't blow away the rest
  of `colors`. Previously the active theme's tokens were ignored at
  runtime — `getTheme()` only read the DB row, so swapping themes
  changed the layout but every theme rendered with the framework
  default's indigo+gray palette.

  The page-builder preview API (`apps/web/src/app/api/admin/preview-blocks`)
  already merged tokens, but did so with a shallow spread that lost
  sub-objects whenever a theme overrode only a handful of fields.
  Now it calls `getTheme()` so preview and public render resolve to
  identical tokens for the same active theme.

  **New type**

  `NpThemeTokensOverlay` (`@nexpress/core/theme`) — `{ colors?:
Partial<NpThemeColors>; typography?: Partial<NpThemeTypography>;
shape?: Partial<NpThemeShape> }`. Replaces the `Partial<NpThemeTokens>`
  shape on `NpThemeImpl.tokens` so authors don't have to copy
  unset sub-trees.

  **Theme palettes**
  - `@nexpress/theme-magazine` ships a warm cream + serif palette
    (terracotta primary, deep brown text on cream background, Source
    Serif Pro fonts). Editorial sites read more comfortably on the
    warm off-white than on pure white.
  - `@nexpress/theme-portfolio` moves its dark surface from
    hardcoded `#0b0b0c` CSS into `impl.tokens` (`oklch(0.16 0.005
285)` background, light foreground). The theme's own CSS now
    reads `var(--np-color-*)` and `color-mix(in oklab, ...)` for
    semi-transparent dividers, so admin token overrides reflow the
    whole shell — flipping to a light variant is a token edit, no
    longer a theme fork.

  **Block tokenization**

  The five PR-A built-ins (`section-header`, `testimonials`,
  `stats-grid`, `logos-cloud`, `tabs`) plus `feature-grid`, `cta`,
  `faq` now read brand colors via `var(--np-color-*)` with the
  previous hex as the fallback. Drop a `cta` into a portfolio-themed
  page: it uses portfolio's primary, not the framework default.

  `hero` keeps its hardcoded dark gradient (the gradient is a
  readability overlay over a background image, not a brand surface).
  `pricing`, `image-gallery`, `contact-form`, `rich-text`,
  `grid` weren't visually brand-driven; they're untouched in this
  pass.

  Existing pages render identically when the active theme doesn't
  override tokens — the merge falls through to `DEFAULT_THEME`.

- fe45743: **Phase D — typed collection reads + small DX wins from Phase C dogfooding.**

  Phase C surfaced four friction points; the big one (#7+#8) gets a
  proper codegen-typed surface, and the smaller two (#9, #11) get
  reference patterns documented + demonstrated.

  ### #7 + #8 — typed collection reads

  `pnpm db:generate` now also emits
  `apps/<app>/src/db/generated/documents.ts` alongside the existing
  `collections.ts` (Drizzle schema). The new file declares one
  `${Pascal}Document` interface per collection plus
  `find${Pascal}` / `get${Pascal}Document` wrappers that bind the
  type generic. Result: read-site casts disappear.

  ```ts
  // before
  const result = await findDocuments("discussions", { ... });
  const slug = doc.slug as string;
  const title = doc.title as string;
  const createdAt = doc.createdAt as Date;

  // after
  import { findDiscussions } from "@/db/generated/documents";
  const result = await findDiscussions({ ... });
  // doc.slug, doc.title, doc.createdAt — typed, no casts
  ```

  The framework surface that supports this:
  - **`NpFindOptions<T>`** is now generic. With the default
    `T = Record<string, unknown>` it behaves exactly as before
    (back-compat). With a typed `T`, `where: Partial<T>` rejects
    field-name typos at compile time.
  - **`NpFindWhere<T>` + `NpFindWhereSystemTokens`** — the where
    clause merges the document fields with system-level escape
    hatches (`siteId`, `visibility`, `locale`) so advanced callers
    don't lose access to those.
  - **`findDocuments<T>(collection, options, user?)`** propagates
    the generic through to `Promise<NpFindResult<T>>`. Uses
    `NoInfer<T>` on the options parameter to prevent TS from
    inferring T from a partial where clause — callers either pass
    the generic explicitly (typed) or accept the
    `Record<string, unknown>` default.
  - **`getDocumentById<T>(collection, id, user?)`** same generic
    propagation.
  - **`generateDocumentsModule(collections)`** — new exported
    generator that produces the full `documents.ts` content
    (imports + interfaces + read-helper wrappers).

  The untyped `findDocuments(slug, options)` from `@nexpress/core`
  still works for back-compat and stays the right call when you
  genuinely need an untyped escape hatch.

  ### #11 — dedupe expensive primitive calls across `generateMetadata` + page

  `apps/web/src/lib/cached-content.ts` wraps `getMemberProfile`
  with React's `cache()`. Pages that call the same primitive in
  both `generateMetadata` and the page body get a single fetch for
  free. `/u/[handle]/discussions/page.tsx` migrated to demonstrate.

  Cookbook documents the pattern; covers the argument-tuple
  caveat (different `avatarVariant` → different fetches → same
  behavior as before).

  ### #9 — pagination reference component

  `apps/web/src/components/pagination-nav.tsx` — small reference
  component. The framework intentionally doesn't ship a
  `<Pagination />` because visual treatment is theme territory;
  the data shape is already on `NpFindResult`
  (`hasPrevPage` / `hasNextPage` / `page` / `totalPages`). The
  component takes a `hrefForPage(p)` callback so the caller owns
  URL composition (preserving `?author=me` etc.). Migrated
  `/discussions/page.tsx` and `/u/[handle]/discussions/page.tsx`.

  ### Stability

  `NpFindOptions<T>` and `NpFindWhere<T>` join v0.1's stable
  surface. `findDocuments<T>` / `getDocumentById<T>` stable. The
  generated `documents.ts` is app-owned codegen output (not part
  of the framework's public surface), but the
  `generateDocumentsModule` function and the per-collection
  naming convention (`${Pascal}Document`, `find${Pascal}`,
  `get${Pascal}Document`) are stable — apps that vendored the
  generator will see the same shape as the official one.

- ddbb536: **F.3 follow-up — textarea support in the theme settings auto-form.**

  Closes the textarea gap recorded in F.9.1-A/portfolio:
  `z.string()` always rendered as a single-line `<input>`, even
  when the field semantically wanted multi-line input (operator
  bios, long descriptions, etc.).

  ### How theme authors opt in

  Use Zod v4's `.meta()` to tag the field:

  ```ts
  import { z } from "zod";

  export const myThemeSettingsSchema = z.object({
    bio: z
      .string()
      .meta({ widget: "textarea", rows: 6 })
      .describe("Studio bio (markdown not supported)."),
  });
  ```

  Required: `meta.widget === "textarea"`. Optional: `meta.rows`
  (positive integer; defaults to 4).

  ### What changed

  #### `@nexpress/core`
  - `NpThemeSettingsTextareaField` — new variant on the
    introspected metadata union with optional `rows` hint.
  - `introspectThemeSettingsSchema` reads `inner.meta()` on
    string nodes and emits `type: "textarea"` when the
    `widget` key matches. Falls back to existing
    text/url/color detection otherwise.
  - `readMeta(node)` helper — small structural narrower around
    Zod's instance method (the `.meta()` call returns the
    merged description + custom keys).

  #### `@nexpress/admin`
  - `ZodForm`'s field dispatcher routes `textarea` to a new
    `TextareaField` component using the existing
    `Textarea` UI primitive.
  - Honors the `rows` hint when present.

  #### `@nexpress/theme-portfolio`
  - `aboutCopy` setting now declares `meta({ widget:
"textarea", rows: 4 })` — operator gets a multi-line
    input in admin → footer bio renders correctly across
    paragraph breaks.

  ### Tests

  4 new unit tests in `settings-schema.test.ts`:
  - emits textarea field when `meta({ widget: "textarea" })`
    is set
  - carries optional `rows` hint
  - unwraps through `.default()` / `.optional()` (meta lives
    on the inner string, not the wrapper)
  - ignores `meta` when `widget` key isn't `textarea`

  Total core tests: 325 (was 321).

  ### Cross-axis coverage closure

  After F.9.1-C the v0.2 settings cheat-sheet had:

  > Magazine: enum/array-heavy
  > Docs: text-heavy (5 fields)
  > Portfolio: every supported widget except textarea (12 fields)

  This PR closes the "except textarea" gap. **Auto-form now
  covers every widget shape Zod can declare** through the
  combination of native types + `.meta()` extension. Future
  custom widgets (color-with-palette, file-picker, slider, etc.)
  will follow the same `.meta()` pattern.

- 3eeac73: Page (and any other slug-having collection) creation now works
  with non-Latin titles, and the slug becomes an editable input in
  the admin sidebar.

  Two bugs fixed together:
  - **`slugify` dropped non-Latin characters.** The old regex
    `[^a-z0-9]+` stripped Korean / Japanese / Chinese / Cyrillic /
    Greek / etc. titles down to an empty string, then the
    pipeline threw `NpValidationError("Slug generation failed")`.
    The regex now uses `[^\p{L}\p{N}]+/u` to keep any Unicode
    letter or number. Latin diacritic-stripping (Crème → creme)
    still works via an `NFKD → strip combining marks → NFC`
    dance — the recompose step puts Hangul jamo back into
    syllables since NFKD alone decomposes them.
  - **The admin had no slug input.** Most page-shaped collections
    configure `slugField: { useField: "title", unique: true }` and
    rely on auto-derive; they don't list `slug` in `fields` so
    the form had no way to override it. The edit view now
    injects an implicit `slug` text input in the sidebar
    whenever `slugField` is configured (and a `slug` field
    isn't already declared explicitly). Leave the input blank
    to keep the auto-derive behavior; type a custom value to
    override.

  Both changes are wire-compatible. Existing slugs (all ASCII
  today) continue to round-trip identically. Collections that
  already declare a `slug` field explicitly get their existing
  shape unchanged.

### Patch Changes

- bb55974: **Plugin load-time error isolation.**

  `loadPlugins()` no longer aborts the entire boot when a single
  plugin's `setup()` callback (or its `init()` for legacy plugins)
  throws. The throw is logged, the partially-registered plugin's
  hooks/routes are scrubbed from the registry via
  `pluginRegistry.delete(id)`, and the next plugin in the topo
  order continues to load.

  Behavioral contract change for the existing capability-violation
  errors: the throw used to be uncaught, so a plugin trying to
  register a `content:afterCreate` hook without declaring
  `hooks:content` would crash boot. With load-time isolation, that
  plugin is now logged + skipped; surviving plugins keep loading.

  Plugin authors still get loud feedback at boot — the `error`-level
  log message includes the plugin id and the underlying error
  message — but a single buggy plugin no longer takes down the
  host's other plugins.

  Three new tests in `host.test.ts` pin:
  - legacy `init()` throw → other legacy plugins still load
  - resolved `setup()` throw → registry is scrubbed; other resolved
    plugins still load
  - log-line shape (one `Plugin failed to load` per failure, with
    pluginId + error message in the structured context)

  Two existing tests for capability violations were updated to the
  new contract (no throw; plugin absent from `getAllPluginIds()`).

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

- 4d5aeba: `verifyStartupSafety`'s container-hint heuristic now recognizes
  Railway alongside Kubernetes / Fly / Render. The warning fires in
  production when `RAILWAY_ENVIRONMENT_NAME` is set and
  `NP_STORAGE_ADAPTER=local`, catching multi-replica Railway deploys
  that would otherwise silently desync `./uploads` between nodes.

  The warning message is updated to list the new env var so operators
  who hit it know which signal triggered it. `bootstrap.ts` in
  `@nexpress/next` wires `RAILWAY_ENVIRONMENT_NAME` into the
  `containerEnv` input automatically — apps using the standard
  bootstrap inherit the new behavior on next deploy.

- 006be38: **Boot warning: in-memory rate limiter in multi-node deploys.**

  `verifyStartupSafety` gains a new check `multi_node_in_memory_rate_limiter`
  that fires when:
  - `NP_MULTI_NODE=true` (or a container hint env var is set in
    production), AND
  - the operator hasn't called `setRateLimiter()` to opt into a
    shared-store adapter

  The default `InMemoryRateLimiter` keeps per-process buckets, so a
  multi-replica deploy effectively multiplies the configured limit
  by the replica count — a "5 login attempts / minute" rule
  becomes "5 × N pods / minute" without any visible signal.

  Operators get a one-line warning at boot pointing them at
  `@nexpress/rate-limiter-redis` (or any custom adapter). Single-
  node deploys silence the warning by setting `NP_MULTI_NODE=false`,
  matching the existing `multi_node_local_storage` shape.

  `NpStartupSafetyInput` gains an optional `rateLimiterCustom`
  boolean — `false` means the default will be lazy-installed,
  `true` means the operator opted in. `undefined` skips the check
  (back-compat with older callers).

  5 new tests pin: explicit-flag fire, container-hint fire,
  custom-adapter silences, undefined skips, single-node skips.

- 7357e44: feat(seo-audit, core): re-enable seo-audit `.refine()` cross-field validation, pin introspector regression tests

  Closes the second G-track follow-up tracked in `docs/design/plugin-config-auto-form.md` § 10. The earlier diagnosis was wrong: Zod 4 implements `.refine()` as a `checks` array on the same `z.object`, **not** as an effects/pipe wrapper, so `_def.type` stays `"object"` and the introspector walks the shape unchanged. Verified by direct probe — a refined schema introspects identically to its unrefined twin.

  **`@nexpress/plugin-seo-audit`**:
  - Re-added the cross-field refines that G.2.3's self-review had punted on: `titleMin <= titleMax` and `descriptionMin <= descriptionMax`. A misconfigured min/max pair where min > max is unrecoverable in the audit logic (the "short-X" branch always wins for any value < min, so "long-X" is unreachable). The refine rejects at save time, so the operator notices the misconfiguration immediately rather than wondering why long-title warnings never fire.
  - Inline comment in `configSchema` records the corrected diagnosis so the next person doesn't re-derive the wrong "wrapper breaks introspection" theory.

  **`@nexpress/core`**:
  - 2 new regression tests in `themes/settings-schema.test.ts` covering single `.refine()` and chained `.refine().refine()` schemas. Pin the no-op-for-introspection contract so future Zod upgrades don't regress quietly.

  `docs/design/plugin-config-auto-form.md` § 10 entry struck through with the corrected diagnosis pointing at this PR.

  Verified
  - `pnpm --filter @nexpress/core test` — 366 tests
  - `pnpm --filter @nexpress/plugin-seo-audit test` — 12 tests
  - `pnpm typecheck` (58/58) ✓
  - `pnpm build` (31/31) ✓

- 41ac5d2: fix(core, web): drop `.js` extension from generated `documents.ts` import — unbreaks Next 16 Turbopack build

  `packages/core/src/db/type-generator.ts` emitted `import { … } from "./collections.js"` into the generated `documents.ts`. That works under NodeNext module resolution (which `tsc --noEmit` uses) but breaks Next 16's Turbopack build, which respects `apps/web/tsconfig.json`'s `moduleResolution: "Bundler"` — Bundler resolution doesn't rewrite `.js` → `.ts` for relative imports the way NodeNext does.

  The two layers diverged silently: `pnpm typecheck` (58/58) kept passing because tsc handled the rewrite; `pnpm build` failed at `next build` with `Module not found: Can't resolve './collections.js'`.

  Fix: drop the `.js` extension in the generator's emit. Extension-less imports work under both resolution strategies — Bundler resolves directly to the `.ts` file, NodeNext does the same when the extension is omitted in TS source.

  Also updated the existing `apps/web/src/db/generated/documents.ts` to match (don't wait for the next `pnpm db:generate` to land it).

  361 core unit tests pass. `pnpm build` now succeeds (31/31 tasks). Plugged a real-world testing gap — typecheck and build had silently diverged on this rule for some time. Adding `pnpm build` to the per-track verification routine going forward.

## 0.1.0

### Minor Changes

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

- 4c01668: Phase 22.4 — readiness probe round-trip for the job queue.

  Adds an optional `isHealthy?(): Promise<boolean>` method to the
  `NpJobQueue` interface and implements it on `PgBossAdapter` via
  `PgBoss.isInstalled()` (a single SELECT against `pgboss.version`).
  Adapters that don't implement it are assumed healthy — the readiness
  probe never fails on a missing answer.

  Before: `/api/health/ready` only checked whether the queue object had
  been set on the singleton. A dead pool, a half-applied schema, or a
  silently-rejected `startProducer()` left readiness reporting `ok` while
  the queue was unusable.

  After: when the wired adapter exposes `isHealthy()`, the probe round-
  trips it and reports `ok: false` + `detail` on failure (and the
  endpoint returns 503, matching the existing degraded-mode contract).
  The pg-boss adapter swallows exceptions internally and returns
  `false`, so callers never see a thrown error.

- 75f65a2: Phase 22.6 — domain-bounded subpath exports for `@nexpress/core`.

  The single root `index.ts` had grown to ~91 export blocks across DB,
  auth, community, jobs, i18n, media, observability, and SEO surfaces.
  For a published package, that's a v1 commitment to the entire mixture.
  This carves the surface into subpath entries so consumers can reach a
  single domain without pulling in the others' types and so future
  deprecations are scoped per domain:
  - `@nexpress/core/auth` — capabilities, JWT, OAuth, sessions
  - `@nexpress/core/community` — comments, reactions, reports, bans, …
  - `@nexpress/core/db` — connection, runtime, schema codegen
  - `@nexpress/core/i18n` — locales, translations, formatting
  - `@nexpress/core/jobs` — pg-boss, handlers, heartbeat, pause
  - `@nexpress/core/media` — service, processor, refs
  - `@nexpress/core/observability` — logger, error reporter, safety check
  - `@nexpress/core/seo` — sitemap, page metadata, JSON-LD

  Additive only — the root `@nexpress/core` continues to re-export
  everything in those domains, so existing call sites do not need to
  migrate. New code should prefer the subpath that fits its call site.

  Two existing aggregator files (`auth/index.ts`, `db/index.ts`) were
  incomplete; they now mirror the root re-exports for their domain.
  Two new aggregators (`i18n/index.ts`, `seo/index.ts`) were added.

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
