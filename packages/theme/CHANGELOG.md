# @nexpress/theme

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

- 6672371: feat(theme, web): M.1 — `impl.members.shell` slot + `(member)` route group restructure

  First phase of the F-track member-surface skinning (`docs/design/member-surface-skinning.md`). Themes can now wrap the framework-owned `(member)/members/*` routes (login / register / forgot-password / reset-password / verify / me/notifications) in their own chrome — same masthead + footer the theme uses for the public site — without rewriting the form-submit / email-verification / OAuth flows.

  **Theme contract addition** (`@nexpress/theme`, `NpThemeImpl`):

  ```ts
  members?: {
    shell?: ComponentType<{ children: ReactNode }> | null;
    pageTitle?: {
      login?: string;
      register?: string;
      forgotPassword?: string;
      resetPassword?: string;
      verify?: string;
      notifications?: string;
    };
  };
  ```

  Fallback chain at the `(member)/layout.tsx` level:
  1. `impl.members.shell` truthy → use it
  2. `impl.members.shell === null` → opt out explicitly (member pages render bare, useful when the public-site shell would clash with narrow auth forms)
  3. `impl.members.shell === undefined` → fall back to `impl.shell` (the public-site shell)
  4. `impl.shell === undefined` → transparent fragment

  **Route restructure** (locked decision E in the design doc § 2): six page files moved out of `(site)/members/*` into a new sibling `(member)/members/*` route group. URL surface unchanged (Next.js route groups don't add path segments — `/members/login` resolves to `(member)/members/login/page.tsx` post-restructure, same as `(site)/members/login/page.tsx` did pre-restructure). Header-based i18n (proxy sets `x-np-locale` without rewriting URL) is unaffected — static `/members/*` URLs are locale-agnostic in URL form.

  The new `(member)/layout.tsx` duplicates the infrastructure pieces of `(site)/layout.tsx` — `ensureFor("read")`, `<NpThemeStyle theme={tokens}>`, the theme-owned CSS `<style>` tag, the `data-np-theme` attribute — because route groups are siblings (Next.js runs ONE root layout per request based on which group matches). Differences: wraps content in the member shell (or fallback chain) instead of `impl.shell`; skips the feed-discovery `<link rel="alternate" type="application/atom+xml">` line — member pages don't carry feed metadata.

  Reference theme migration (magazine + portfolio + docs) lands in M.ref; this PR ships only the framework wiring + the empty contract slot. Existing themes with no `impl.members` declared inherit the public-site `impl.shell`, so behavior is unchanged for sites that haven't migrated.

  Manifest changes: `NpThemeImpl` gains optional `members` field (additive — all existing themes continue to compile against the new type without changes).

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

- 45020fd: Thread the block render ctx from the site renderer into theme templates (#476).

  PR #469 added server-rendered / data-bound blocks (`latest-posts`,
  `stats.counter`, plugin-contributed dynamic blocks) that need an
  `NpBlockRenderContext` to query content. Shipped theme templates
  called `renderBlocks(blocks)` without passing the ctx, so those
  blocks rendered the "ctx unavailable" placeholder instead of the
  real query result.

  `NpTemplateRenderProps` now carries an optional
  `blockCtx?: NpBlockRenderContext`. The reference site renderer
  builds one per page render via `createDefaultBlockRenderContext()`
  and passes it into both the active theme template and the
  historical fallback `renderBlocks` call. Each shipped template
  forwards it as `renderBlocks(blocks, { ctx: blockCtx })`.

  Theme packages no longer have to import `@nexpress/next` directly
  to opt into the ctx — the type is exposed via `@nexpress/theme`'s
  new `@nexpress/blocks` dependency. Templates that don't use
  data-bound blocks can ignore the prop entirely; static themes
  keep their pre-#476 call shape unchanged because `blockCtx` is
  optional and `renderBlocks(blocks)` with `undefined` ctx still
  works.

### Patch Changes

- 9942779: **F.7.1 — theme error delegation pattern (working through the
  Next.js client-only constraint).**

  The v0.2 contract reserved `NpThemeImpl.error` for theme-shipped
  error UI, but Next requires `error.tsx` to be a client component
  — and a server-side reference declared on a theme's `impl`
  can't cross the React server→client boundary. F.7 kept the slot
  as a forward-compat type marker and shipped a framework default;
  F.7.1 closes the loop with a working pattern.

  ### How it works

  | Layer            | Responsibility                                                                                                                                                                                                                                          |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Theme package    | Ships a CLIENT error component at `./components/error` subpath (`"use client"` banner, separate tsup entry, exports map declares the path)                                                                                                              |
  | Site layout      | Already emits `<style data-np-theme="<id>">` for the theme's CSS — the id is in the DOM by the time error.tsx mounts                                                                                                                                    |
  | Site `error.tsx` | Maintains a `THEME_ERRORS` registry of theme-id → `lazy(() => import("@nexpress/theme-X/components/error"))`. Reads active theme via `useActiveThemeId` (queries the style tag), lazy-loads the matching theme's chunk, falls back to framework default |

  ### Bundle impact

  Only the active theme's error chunk downloads — `lazy()` defers
  the import until `<ThemeError>` renders, which only happens after
  the boundary fires + the active theme matches the registry.
  Themes not in the active theme don't reach the client bundle.

  ### Reference implementation
  - `packages/themes/magazine/src/components/error.tsx` — pilot
    theme error: editorial "Stop the press" treatment with the
    magazine's serif heading + CTA button. Uses theme CSS
    custom properties (`--np-color-foreground`, `--np-font-heading`)
    so it matches the masthead even before the rest of the page
    rehydrates.
  - `apps/web/src/app/(site)/error.tsx` — site-level delegator
    with the registry + lazy imports + framework default.

  ### Adding a new theme to the pattern
  1. Add `src/components/error.tsx` with `"use client"` at the top.
  2. Register the entry in `tsup.config.ts` under the second build
     (the one with `banner: { js: '"use client";' }`).
  3. Add the path to `package.json`'s `exports`:
     ```json
     "./components/error": {
       "types": "./dist/components/error.d.ts",
       "import": "./dist/components/error.js"
     }
     ```
  4. In the site's `error.tsx`, add a row to `THEME_ERRORS`:
     ```ts
     yourTheme: lazy(() => import("@nexpress/theme-yours/components/error")),
     ```

  Themes that don't opt in keep falling through to the framework
  default — no breaking change for portfolio / docs / minimal /
  default.

  ### Why the slot stays on `NpThemeImpl`

  `impl.error?: ComponentType` remains as a forward-compat type
  marker. If Next eventually adds a server-rendered error
  fallback API, the framework can wire it transparently from the
  server-side reference and remove the operator-maintained
  registry. The JSDoc points operators at the F.7.1 pattern in
  the meantime.

- 6fd0332: **Theme-system cleanup cluster — closes #600, #601, #602, #607, #610.**

  Five small fixes against the theme system, batched. None of
  them are user-facing breakage; they're correctness regressions
  that piled up across the v0.2 / theme-system work and would
  have surfaced as confusing behavior over time.

  **#610 — theme-minimal stale references.** The `theme-minimal`
  package was retired in #590 but three integration tests still
  imported it (`theme-switcher`, `theme-render`,
  `theme-layout-swap`) and `packages/theme/README.md` still
  listed it. Tests migrated to `theme-magazine` (matching the
  "magazine modifier" / `np-magazine-header` assertions);
  README's "Reference themes" list now reflects the actual four
  shipped themes.

  **#601 — theme error delegation depended on `impl.css`.** The
  (site) / (member) layouts only emitted `<style
data-np-theme="...">` when `impl.css` was truthy. A theme that
  shipped a client error subpath but no theme-owned CSS would
  silently fall back to the framework default error page because
  the boundary's `useActiveThemeId()` reads that data attribute.
  Now both layouts emit an empty `<style data-np-theme="...">`
  marker when a theme is active even if its CSS string is empty.

  **#600 — block cleanup tool treated inactive-theme blocks as
  known.** `/api/admin/blocks/unknown` built its known-types set
  with the unfiltered `getRegisteredBlocks()`, which includes
  every installed theme's blocks regardless of active state.
  After switching themes, `magazine.*` blocks remained "known"
  on a `portfolio`-active site, so the cleanup tool reported
  nothing for the exact theme-switch flow it advertises. Now
  the scan uses `getRegisteredBlocksForActiveSources({ themeId
})`, aligning with how the public renderer treats those
  instances (placeholder rendering).

  **#607 — page-builder preview used wrong render context.** The
  preview API (`/api/admin/preview-blocks`) called
  `createDefaultBlockRenderContext()` — no active-source filter —
  so the iframe rendered inactive-theme blocks normally while
  the public site showed placeholders. Preview disagreed with
  production output. Now uses
  `createSiteScopedBlockRenderContext()`, matching the catch-all.

  **#602 — scaffold admin layout skipped active-theme filter.**
  The reference `apps/web` admin layout filters block metadata
  - patterns through the active-source context (#590, F.5), but
    the `create-nexpress` template still emitted unfiltered
    `getRegisteredBlockMetadata()` / `getRegisteredPatterns()`.
    Freshly scaffolded apps would surface every installed theme's
    blocks in the editor regardless of which was active. Template
    now mirrors the reference app's filter.

  No new tests — each fix is verified by the existing integration
  suites (which were broken by #610's stale refs anyway, now
  restored). Repo typecheck + lint + unit tests all green.

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
