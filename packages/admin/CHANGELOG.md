# @nexpress/admin

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

- 71045bd: Three small nav follow-ups grouped into one cleanup:
  - **Lock down `/api/navigation/locations`.** The endpoint now
    requires staff auth + the `admin.manage` capability instead of
    allowing anonymous reads. The data is technically inferable
    from rendered nav menus, but enumerating every custom slot
    via one HTTP call shouldn't be free.
  - **CLI page template opts into `navMembership`.** Sites
    scaffolded with `create-nexpress` get the "In navigation"
    side-panel on the page edit view out of the box, matching the
    reference app's behavior. Comment explains the flag for
    operators who add a `landing-pages` or `static-pages`
    collection later.
  - **Arrow-key navigation in the page picker.** ArrowDown / ArrowUp
    move the highlighted row; Enter commits. Radix Popover already
    handles Esc → close. The previously-selected page is shown
    with a subtle ring when it isn't the active row, so the
    operator can see both "where I am" and "what I had".

- 92baa44: **v0.3 (C + E) — bulk "cleanup unknown blocks" admin action +
  cross-theme migration hint.**

  Closes two v0.3-deferred items from
  `docs/design/theme-v0.2-extension.md` §10 in one bundled PR
  since both deal with cleanup workflows after theme/plugin
  changes:

  > Bulk "cleanup unknown blocks" admin action — placeholder
  > rendering covers correctness; bulk action is convenience.

  > Cross-theme migration — switching themes A → B is idempotent
  > at install time but doesn't remove A's leftover fields.
  > Cleanup workflow tracked here.

  ### What changed

  **New admin route**: `/admin/themes/cleanup` — scans every
  collection's `type: "blocks"` field for instances whose `type`
  string isn't in the active block registry (typical after
  `theme:uninstall`, theme switch, or plugin removal). Lists
  unknown types with instance + doc counts; operator can:
  - "Remove all" — strip every unknown instance across the site
  - Per-row "Remove" — strip just one type at a time

  Each cleanup run goes through `saveDocument` so revisions
  track the change and media-ref / search-vector hooks fire
  correctly. Operators can revert via the per-doc revision
  history if a removal was a mistake.

  **New API endpoints** under `/api/admin/blocks/unknown`:
  - `GET` — scan-only, returns `{ unknownTypes, affected,
totalInstances, totalDocs }`
  - `POST` — apply cleanup, optional `{ types: string[] }` body
    filters which types to strip (default: all). Returns
    `{ removedInstances, updatedDocs }`

  Both are gated by `admin.manage` capability and CSRF-protected
  by the standard proxy.

  **Cross-theme migration hint** (E): the existing theme switcher
  (`/admin/settings/theme`) now shows a yellow callout after a
  successful theme switch (skipped on first-boot when there was
  no previous active theme), pointing operators at the cleanup
  tool. The hint surfaces specifically because the operator just
  took an action (switching themes) that commonly produces stale
  references — discoverability without permanent visual noise.

  ### Why bundled

  Both items address the same workflow: "I changed something
  about my site's theme/plugins; now my pages have orphan
  references to blocks that no longer render." C is the tool;
  E is the discovery surface that points operators at the tool
  right when they're most likely to need it.

  ### Scan scope (today)
  - Walks every registered collection
  - Inspects `type: "blocks"` fields (incl. those nested inside
    `row` / `collapsible` containers)
  - Recurses into block `children` arrays — even known parent
    blocks can hold unknown descendants
  - Caps at 1000 docs per collection (a future iteration paginates
    when sites cross the threshold; today's reference sites are
    far below)

- b66581e: Admin UI — refined visual register ("clean / sophisticated" pass).

  Adopts the redesigned NexPress design-system kit
  (`ui_kits/admin/index.html`). The shape of the public API is unchanged
  (`AdminShell`, `AdminTopbar`, `Card`, `Button`, `Input`, `Select`,
  `Tabs`, `Switch`, `Badge` — same exports, same props), but the
  rendered surface changes:
  - **Brand accent.** `--np-color-brand` (`#0066FF`, sourced from the
    wordmark's blue notch) is wired through `apps/web/src/app/globals.css`
    with `--np-color-brand-soft` and `--np-color-brand-ring`. Used as a
    quiet indicator (active sidebar rail, focus rings, links, progress
    bars) — never as a fill. Adds a `brand` button variant for the rare
    case a CTA wants the wordmark blue.
  - **Sidebar (`AdminShell`)** redesigned: smaller width (`w-60`), warm-
    paper background (`#fbfbfa`), hairline border, group eyebrows
    (Workspace / Content / {collection groups} / Multi-site / Community /
    System), brand-blue 2px left rail on the active item, and the new
    `NpMark` SVG wordmark replaces the "NexPress / Editorial control
    center" eyebrow header.
  - **Topbar (`AdminTopbar`)** swaps the "Admin / Welcome back, {name}"
    eyebrow + h1 for breadcrumbs derived from `usePathname()` (e.g.
    `Workspace / Dashboard`, `Content / Posts / Edit`). Shorter (52px)
    and the userpill is rounded-full + inline-only.
  - **Primitives tightened to a 32px-control register:** `Button` default
    is `h-8` (was `h-10`), `Input` / `Select` are `h-8`, `Tabs` list is
    `h-9`, `Switch` is 32×18. All focus rings switched to a 3px halo at
    `--np-color-brand-ring`. `Card` is `rounded-xl` (12px, was 24px) on
    a hairline border with no backdrop blur; `CardHeader` and `CardFooter`
    add their own divider.
  - **Dashboard** drops the "Admin overview" tracked eyebrow for a single
    date headline (`Today, May 3`), tightens stat-card density, runs
    `tabular-nums` on the value, and switches the Collection-pulse
    progress bar to brand-blue with a 4px track.
  - **Auth pages** (`/admin/login`, `/admin/forgot-password`,
    `/admin/set-password`, `/admin/setup`) move from raw-Tailwind cards
    to the new exports `AuthLayout` + `AuthCard` (soft brand-blue
    radial-vignette background, hairline-bordered card with the
    `NpMark` wordmark, version + Argon2/JWT footer pill). Login lists
    registered OAuth providers (`listOAuthProviders()`) above the
    email/password form with provider-icon SVGs (GitHub, Google, fall-
    back globe).
  - **PageHeader.** New shared component (`PageHeader` from
    `@nexpress/admin/client`) replaces the eyebrow + tracked + 30px h1
    pattern across every admin view (Settings, Plugins, Sites, Site
    members, Members, Reports, Audit log, Pending review, Community
    settings, Background jobs, Collection list, Plugin admin) with a
    consistent `text-[22px]` heading + `text-[13.5px]` description +
    optional actions slot. Page-level surfaces import it directly; ad-
    hoc inline headers (collection edit, media library, user / member
    detail, system health) drop to the same type scale without the
    helper.

  Themes that opt into the admin surface inherit these tokens
  automatically — there is no opt-in flag. Sites that override
  `@theme` color tokens via `generateThemeCss` continue to override
  the same names; the brand tokens are additive and don't conflict.
  - **Floating panels** (`Dialog`, `Popover`, `Select` content,
    `DropdownMenu` content) drop `rounded-3xl` / `rounded-2xl` and
    `shadow-2xl` for `rounded-xl`/`rounded-lg` with a paired
    `0_20px_50px_-12px` / `0_12px_24px_-12px` shadow stack — the
    refined "ledge of paper" the design calls for. Menu / select item
    rows pick up the new neutral-950/[0.045] hover token used by the
    sidebar so all interactive states share one ramp.
  - **DataTable** uses the same hairline border + 36px header height
    as the redesigned activity table on the dashboard. Header cells
    switch to the 11px uppercase tracked-eyebrow style; body rows use
    `text-[13px]` with the lighter divide treatment.
  - **SitePicker / ThemeToggle** shrink to fit the 52px topbar.
    SitePicker is now an `h-7` rounded-md trigger with the new brand
    focus ring; ThemeToggle uses `size="icon-sm"` rounded-full.
  - **Textarea / Label** match Input's new register (13px text, 12.5px
    label, hairline border, brand focus ring).
  - **Body** picks up `font-feature-settings: "ss01", "cv11", "cv02"`
    for the geometric numerals/glyphs the design system commits to.
  - **`StatusBadge` + `StatusDot`.** New shared exports — the canonical
    pill+dot pattern from the design (`Published`/`Draft`/`Scheduled`/
    `In review`/`Pending`/`Open`/`Resolved`/`Banned`/`Active`/etc.).
    `collection-list-view`, `collection-edit-view`, `members-list-view`,
    and `reports-queue-view` swap their hand-rolled status pills for it,
    collapsing four nearly-identical color-mapping tables to one source
    of truth.
  - **Browser favicon.** New `apps/web/src/app/icon.svg` — Next.js
    picks it up automatically and serves the geometric-N mark as the
    tab icon (matches the sidebar `NpMark`).
  - **CardTitle defaults.** `text-lg` overrides removed across every
    admin view that used them; the new `CardTitle` default
    (`text-[13px] font-semibold`) reads correctly without override.

  New public exports on `@nexpress/admin/client`:
  `NpMark`, `PageHeader`, `AuthLayout`, `AuthCard`,
  `AuthCardDefaultFooter`, `AuthDivider`,
  `StatusBadge`, `StatusDot`, `StatusTone`.

- c40cded: Page builder editor — phase 1 (composition ergonomics).

  First slice of the upgrades scoped in #467: precise insertion,
  undo/redo, collapsed-row summaries, and confirm-before-destruct on
  deletes.
  - **Insert above / below** — every block row gets a thin "+" slot
    above and below it (and the same inside container `children`
    lists). Picking a block from the popover fires the new
    `INSERT_BEFORE` / `INSERT_AFTER` reducer actions, so the new
    block lands exactly next to the target instead of always at the
    end of the list. Empty pages keep the existing bottom-of-page
    Add-block button.
  - **Undo / redo** — the editor reducer is now wrapped in a
    past/present/future stack with toolbar buttons and Cmd+Z /
    Cmd-Shift-Z / Ctrl-Y shortcuts. Consecutive `UPDATE_PROPS` to
    the same block within 600 ms collapse into a single undo step
    so a sentence-long text edit doesn't bury earlier history. The
    shortcut handler skips when focus sits on an input / textarea /
    contenteditable surface, so native input undo still works while
    typing into prop fields. History resets when the backing
    document or page-level JSON edit replaces the tree.
  - **Collapsed-row summaries** — `NpBlockMetadata` gains an optional
    `summaryFields?: readonly string[]` hint. The page-builder reads
    the first non-empty string-shaped value from those props and
    shows it inline next to the block label (e.g. `Hero — Build pages
block by block`). Wired up on the seven built-in display blocks
    (hero, cta, faq, feature-grid, pricing, contact-form,
    image-gallery). Pure presentational hint — runtime renders ignore
    the field.
  - **Confirm destructive deletes** — the trash button now opens a
    Dialog when the block has nested children OR any prop that
    diverges from the registered defaults. Plain rows still delete
    in one click, so the confirmation only shows up when there's
    actual work to lose.

  Backward compatible: existing page block JSON keeps loading
  unchanged; `summaryFields` is optional; undo state is internal and
  doesn't change wire format.

- ab9c759: Page builder editor — phase 1 (UI polish).

  The blocks page editor used to ship with inline `style={...}`
  CSS-in-JS that looked completely unrelated to the rest of the
  admin (rounded white panels, pill buttons, a literal ⠿ Unicode
  drag handle). This PR moves the editor into `@nexpress/admin`
  itself so it can use the admin's Radix + Tailwind primitives
  directly, then rebuilds it on top of those.

  What changed:
  - `BlockPageEditor` and `BlockPalette` moved from
    `@nexpress/blocks/client` to
    `packages/admin/src/blocks/`. The `./client` subpath export is
    removed — `@nexpress/blocks` is now server-safe end-to-end
    (types, registry, renderBlocks, block definitions).
  - Each block becomes a `<Card>` with a Collapsible body so
    operators can fold the props form once they're done editing.
    Drag handle is `GripVertical`, actions are icon buttons
    (chevron up / chevron down / `Copy` / `Trash2`).
  - Field controls now use the admin's `<Input>`, `<Textarea>`,
    `<Select>`, `<Switch>` primitives. The `richtext` field stays
    a JSON textarea but with `font-mono` for legibility (a real
    Lexical-based richtext field is in a later phase).
  - Block palette becomes a `<Popover>` triggered by an "Add
    block" button placed below the list. The popover has a
    search input that filters by label / type / description, and
    a 2-column card grid of results. The standalone "select a
    block above" landing strip is gone — empty state is now a
    dashed placeholder that points operators at the same Add
    button.
  - `dnd-kit` deps move from `@nexpress/blocks` (where they were
    unused after the editor moved) to `@nexpress/admin` (which
    already had them for the nav editor anyway). Net dep diff:
    zero.

  Subsequent phases will add: grid layout (tree-shaped blocks via
  container blocks), plugin-registered block types, and a raw
  JSON edit dialog. This phase is purely cosmetic — the data
  shape is unchanged.

- 2eb505d: Page builder editor — phase 2 (grid layout + tree-shaped blocks).

  `NpBlockInstance` gains an optional `children: NpBlockInstance[]`,
  `NpBlockDefinition` gains `acceptsChildren: boolean`, and the
  `render` signature picks up an optional second arg
  `(props, children?: ReactNode) => ReactElement`. Existing leaf
  blocks (hero, cta, faq, …) keep working unchanged because they
  ignore the new arg; their instances on disk continue to have no
  `children` field. Pure-additive on the wire format.

  A new built-in `gridBlock` (`type: "grid"`) ships as the first
  container — 12-column CSS grid with configurable column count and
  gap. Each grid child carries an optional `_layout: { colSpan }`
  on its props (1–12, defaults to 12 = full row). The renderer
  wraps each child in a span div automatically so leaf blocks don't
  need to know they sit inside a grid.

  `renderBlocks` recurses through `instance.children` and feeds the
  rendered subtree to the parent's `render(props, children)`. The
  top-level renderer is unchanged for leaf-only pages — output is
  byte-equivalent.

  The admin block page editor recurses too: container blocks show
  a "Children (N)" area with their own SortableContext, an inline
  "Add child" popover (same `BlockPalette`), and per-child
  collapsibles. Grid children get a dedicated "Grid column span"
  1–12 select control inside their props form. Cross-container
  drag is intentionally not supported in v1 — operators move blocks
  across containers via duplicate-then-delete; nested-DnD shipped
  without a clear-collision UX is worse than not shipping it.

- e93a46d: Page builder editor — phase 4 (raw JSON editing).

  Two new escape hatches for power users:
  - **Per-block "Edit as JSON"** — a `Braces` icon button in each
    block header opens a Dialog with the block's `props` as
    pretty-printed JSON. Apply replaces the entire props object
    (REPLACE_PROPS, not the merge that the field form uses) so
    removing a key in JSON actually drops it. Validates JSON
    parse + object shape; richer schema validation is left to the
    server-side save path.
  - **Page-level "Edit JSON"** — a button next to "Add block" at
    the editor footer opens a Dialog with the entire blocks tree.
    Apply RESETs the editor state. Validates each block has a
    string `id` + string `type` (recursively through `children`).
    Unknown types soft-warn but don't block saves — operators can
    paste in plugin-block JSON before the plugin is enabled.

  The reducer gains `REPLACE_PROPS` for the per-block path. The
  existing `RESET` action was reused for the page-level path.

- 0e54051: Page builder editor — phase 5 (rich field types).

  Two block-prop field types upgrade from raw text inputs to the
  proper interactive editors the rest of the admin already ships.
  - **`richtext` → Lexical editor.** The block-prop form now uses
    the same `NpRichTextEditor` (lazy-loaded from
    `@nexpress/editor/client`) that the collection field-renderer
    uses for `richText` fields. Replaces the legacy "monospace JSON
    in a textarea" fallback. Block render functions still receive
    the same parsed Lexical content object — wire format unchanged.
  - **`image` → URL input + library picker.** The field shows a
    URL input (escape hatch for external CDNs and remote assets)
    side-by-side with a "Library" button that opens a media-picker
    Dialog. Selecting a media doc fills the URL input with the
    doc's `url`. Block props still store a URL string — keeps the
    wire format simple, no relationship resolution at render time.
    Live image preview below the input confirms the URL resolves.

  The `textarea` field type stays a plain Textarea (no Lexical) —
  it's intended for short freeform copy, not formatted content.

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

- 3bf7539: Page builder JSON dialogs — safer tools (#467, "Safer advanced JSON tools").

  Both the per-block and page-level JSON editors gain a small toolbar
  - stronger guards before Apply. Pulled from the #467 phase-1.5
    queue — JSON apply is the most destructive operator action, so the
    safety net here matters more than anywhere else in the editor.

  Per-block JSON dialog:
  - **Format** button — pretty-prints the current textarea via
    `JSON.parse` + `JSON.stringify(_, null, 2)`. Surfaces parse
    errors inline.
  - **Copy** button — writes the current text to the clipboard with
    a transient "Copied!" label. Silent on Clipboard-API failure;
    operators can fall back to select-all + Cmd-C.
  - **Schema lint** — when the block's `propsSchema` is registered,
    Apply runs a soft lint pass that warns on missing `required`
    keys and unknown keys (the row UI already flagged "unknown
    block type" — this catches bad keys _inside_ a known block).
    Warnings don't block Apply; they surface as an amber banner
    the operator can act on.

  Page-level JSON dialog:
  - **Format / Copy** — same shape as the per-block dialog.
  - **Import as new blocks** toggle — when on, Apply appends the
    validated input to the current tree with fresh ids (recursive,
    including nested children) instead of replacing the tree. Lets
    operators paste a section from another page without nuking the
    current one.
  - **Apply preview** — Apply now goes through a two-stage flow:
    click Preview to see "{before} → {after} blocks (+added /
    −removed / ~modified)" plus the active mode (Replace vs.
    Import-as-new), then click Confirm apply to commit. Stage 2
    is intentionally a separate click — the diff makes it cheap
    to spot a paste that's about to overwrite work.

  Backward compatible: dialog wire format unchanged, Apply still
  dispatches the same RESET / REPLACE_PROPS reducer actions.

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

- 6da32de: Page builder — five new built-in patterns + parallel media uploads (#467 follow-ups).
  - **Built-in patterns**: CTA section, Feature grid section, Image
    gallery section, Contact section. Combined with the original
    three (Landing hero, FAQ, Pricing) the operator now has eight
    ready-to-drop section templates covering the common landing-page
    beats.
  - **Parallel media uploads**: `BlockImagePicker.handleUploadFiles`
    switches from a sequential `for…of` loop to `Promise.allSettled`.
    A 5-image batch now finishes in ~1× the slowest upload instead
    of the sum. Per-file failures don't block the rest; the URL
    field gets the last successful upload's URL and a banner
    reports `N of M failed` when applicable.

  Backward compatible. The pattern list is additive (existing custom
  patterns / saved-as-pattern flow unchanged); the upload handler's
  external surface (`onChange(url)` + listing refresh) is identical.

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

- dccf7d0: Nav editor's drag interaction now shows live intent during the
  drag, not just after release. The over row picks up:
  - A subtle primary ring while you're dropping at sibling depth
    ("will-reorder").
  - A primary-tinted left border + ring once `delta.x` crosses the
    nest threshold ("will-nest"), matching the indent the new child
    would take so the cue is anchored to where the row will land.

  The intent calculation lives in `handleDragOver` and mirrors
  `handleDragEnd`'s rules exactly — same `wantsNest` check, same
  1-level guards — so the preview can never disagree with the apply
  path.

- d8f8496: Nav editor's drag interaction grows past sibling-only reorder.
  The grip handle still reorders, but dragging an item right by ~24px
  while dropping nests it as a sub-menu of the target — the macOS
  Reminders / WordPress Block Editor pattern. The drop also respects
  the existing 1-level depth limit: items with their own children
  fall through to plain sibling reorder rather than create
  grandchildren.

  Side benefits from going to a single flat SortableContext (was two
  nested ones):
  - Cross-scope drags now work. Dragging a child onto another
    top-level item re-parents it; dragging a child without drag-right
    onto a top-level item promotes it to top-level.
  - The Parent select is still there for keyboard-driven changes.

- 532aefe: Nav editor and the page edit "In navigation" panel now load the
  location list from `GET /api/navigation/locations` instead of a
  hardcoded `header / footer / main` triplet. The endpoint always
  returns those three plus any custom locations the operator has
  created.

  The editor's location switcher gains a `+ New location…` entry
  that opens a dialog: enter a slug (lowercase, hyphens), the
  editor PUTs an empty nav at that location, refreshes the list,
  and switches to the new entry.

  Themes consume custom locations by calling
  `getCachedNavigation("your-slug")` — same as the built-in three.
  This unlocks per-section sidebars, announcement bars, and other
  theme slots without forking the editor.

  Backwards compatible: the fallback constant inside both surfaces
  keeps the editor / panel functional during the loading flicker
  or if `/api/navigation/locations` is unreachable.

- ac3f8bc: **F.6.1 follow-up — nav editor "Location assignments" panel.**

  The v0.2 theme contract lets themes declare nav slots with
  `navLocations: { primary: { label, description, maxItems } }`,
  and `getActiveThemeNavLocations()` already exposed those to the
  admin. The locations endpoint returned label + description +
  maxItems + source (default / theme / custom), but the editor
  silently dropped everything except value/label and rendered
  locations as a flat select.

  Operators couldn't tell:
  - Which slots their theme actually consumes (vs the framework
    defaults `header` / `footer` / `main`)
  - What each slot is for (the description never surfaced)
  - Whether a slot is empty before publish (theme expects 6
    footer-social links; you have 0)
  - Whether they've gone past the slot's `maxItems` (theme says
    max 6, operator added 8 — items 7-8 will silently render
    past the layout and look broken)

  This PR adds a "Location assignments" panel above the items
  list. It renders only when ≥1 theme-declared location exists,
  showing each as a clickable card with:
  - Label + slug
  - Description (italic, small)
  - Live item count (current location pulls from the in-editor
    state for unsaved-edit awareness; other cards show the
    last-saved count returned by the API)
  - Status badge: `Empty` (amber) / `N / max` (green) /
    `N / max over` (red, when over-limit)
  - "Editing" indicator on the active card

  Click → switches to that location (with the existing dirty-edit
  guard).

  The classic `<Select>` switcher in the header still works for
  keyboard-driven full-list switching incl. defaults + custom
  locations.

  ### API change (back-compat)

  `/api/navigation/locations` now returns `itemCount: number` on
  each entry. The editor's parser narrows defensively, so older
  deploys where the field is absent still render correctly (count
  treated as 0 → "Empty" badge).

- 2f36e2e: Settings → Navigation gains a "Manage locations…" surface so
  operators can rename or delete custom slots without dropping into
  SQL. The dropdown picks up a new sentinel item that opens a dialog
  listing every non-default location with inline rename and a delete
  button.

  Backed by two new endpoints on `/api/navigation`:
  - `PATCH ?location=<old>` body `{ newLocation }` — renames the row.
    Validates the slug shape, blocks renames into or against the
    built-in `header` / `footer` / `main`, and 409s instead of
    surfacing the unique-key violation when the target already
    exists. Busts the nav cache for both old and new slugs so theme
    reads land on the current name.
  - `DELETE ?location=<slug>` — removes the row. Same protection
    against deleting the three theme-baked defaults; 404s when the
    slug doesn't exist. Defaults reappear in the locations list on
    the next read because the locations endpoint always re-injects
    them — that's intentional, "deleting" a default would be a
    no-op.

  The dialog mirrors the rename / delete result client-side: if you
  renamed the location you're currently editing, the editor follows
  the new slug; if you deleted it, the editor falls back to the
  first remaining option.

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

- 0dc95b9: Nav editor + themes now support a single level of sub-menu nesting.

  **Editor**: each row gets a `Parent` select alongside `Type`. Picking a
  parent nests the item under another top-level item; on save the
  flat list with `parentId` collapses into the canonical
  `children: NpNavItem[]` shape. The select is disabled on items that
  themselves have children (1-level limit). Promoting a parent to be
  someone else's child orphans its existing children back to top-level
  so the saved tree never grows deeper.

  **Themes**: `default`, `magazine`, `portfolio` now render
  `item.children` as a nested `<ul>` in their header. Default's
  mobile drawer + footer-columns and magazine's mobile drawer + footer
  expand children inline. Desktop sub-menus get a hover/focus
  dropdown via per-theme CSS (`.np-site-subnav`,
  `.np-magazine-subnav`, `.np-portfolio-subnav`).

  Server-side resolution (`getNavigation` in `@nexpress/core`) already
  walks `children` recursively — added in #429 / #430 and unchanged
  here.

- 53db1b8: `PUT /api/navigation` honors an optional `expectedUpdatedAt`
  token. The settings editor and the page-edit "In navigation"
  panel both stash the `updatedAt` they got from the GET and echo
  it back on the next PUT. If the row's `updatedAt` doesn't match
  what the client expected, the route returns a 409 instead of
  silently overwriting another writer's save.

  The token is opt-in: requests that don't include
  `expectedUpdatedAt` keep the previous last-write-wins semantics
  for back-compat (server-side scripts, older admin builds, the
  "first save of a fresh location" path where there's no row to
  compare against yet).

  When a 409 lands, both UIs surface a clear "someone else
  changed this" message instead of a generic save error.

- c829160: Page edit view gains an "In navigation" side panel that shows which
  nav locations currently link to this page and lets the editor add
  or remove the page without leaving the page form. Backed by a new
  `GET /api/navigation/membership?pageId=<id>` endpoint that scans
  every `np_navigation` row for the current site (recursing into
  `children`), so the API stays correct as nav locations grow beyond
  the current `header` / `footer` / `main` triplet — no fixed
  location list baked into the server.

  The "Add to" dropdown still surfaces the three default locations
  in v1; when nav locations become user-defined, switch the panel's
  location source to a `/api/navigation/locations` fetch and the
  membership endpoint already speaks the right shape.

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

- 77495e7: The nav editor's page picker becomes a search-as-you-type
  combobox so sites with more than 100 pages stop silently dropping
  the rest. The previous picker fetched the first 100 pages at
  collection limit and rendered them as a flat `<Select>` —
  anything past row 100 was unreachable.

  The new picker:
  - Opens a Popover containing a search input and a debounced
    result list (200ms keystroke debounce, `?search=<term>&limit=20`
    against the existing collection list endpoint, sorted by title).
  - Resets its query on close so reopening shows the latest
    default results, not the previous search state.
  - Updates a shared title cache as the operator interacts, so
    every picker on the page benefits from titles already resolved.
  - Shows `(unknown page)` only when a nav item references an id
    the cache hasn't seen yet — and on editor mount the editor
    proactively fetches titles for every `pageId` in the loaded
    nav items via `GET /api/collections/pages/<id>` so that label
    resolves before first paint even on a >100-page site.

- 60e5dc6: Page builder a11y / keyboard workflow (#467, "A11y / keyboard workflow").

  Three additions from the #467 phase 1 leftovers, all bundled
  because they share the same DOM-attribute contract (`[data-np-
block-row]`).
  - **Roving keyboard navigation** — every block row Card is now a
    single keyboard tab stop with `tabIndex={0}` and a
    `data-np-block-row="<id>"` data attribute. The editor section
    intercepts ArrowUp / ArrowDown / Home / End and walks the
    `[data-np-block-row]` set in DOM order, so nested-container
    children flow naturally between their parent and the next
    top-level row. Arrow keys are skipped while focus sits on a
    text-entry surface (input / textarea / contenteditable) so
    caret movement still works inside prop fields.
  - **Command menu (Cmd-K / Ctrl-K)** — opens a `Dialog`-based
    command palette filtered by substring. Context-sensitive: when
    a row is focused at the moment the menu opens, block-scoped
    actions (move up / move down / duplicate / delete, all
    targeting the focused row) appear under a "Block" group; the
    full Add-block list and "Edit page JSON" appear under "Add"
    and "Page". Built on the existing `Dialog` + `Input` primitives
    — no `cmdk` dependency, since the action set is small enough
    that a custom matcher keeps the bundle lean.
  - **Container focus-within ring** — container blocks
    (`acceptsChildren: true`) get a `focus-within:ring-2
focus-within:ring-primary/30` so operators can tell which
    subtree is focused while keyboard-navigating into a nested
    child. Leaf blocks just get the normal `focus-visible` ring on
    the row itself.

  No wire-format changes. All a11y additions are additive — mouse
  operators see no change beyond the focus-within ring on
  containers (which only activates while a child is focused).

- cf5db32: Page builder container contracts (#467, "Layout and container contracts").

  Eighth PR off the #467 phase 2-4 queue. Container blocks
  (`acceptsChildren: true`) can now describe what kind of children
  they accept and how many.

  `@nexpress/blocks` — three new optional fields on
  `NpBlockMetadata`:
  - `allowedChildTypes?: readonly string[]` — restricts which
    block types may be added or moved into the container. Empty /
    omitted accepts every type (historical behavior). Wildcard
    `"*"` is shorthand for "anything".
  - `minChildren?: number` — soft lower bound. The admin shows an
    amber banner beneath the container when fewer children are
    present (intentionally not enforced at save — in-progress
    pages naturally violate lower bounds).
  - `maxChildren?: number` — upper cap. The Add-child UI hides
    when at the cap; `MOVE_INTO` rejects when adding would exceed.

  `@nexpress/admin`:
  - `canAcceptChild(parentDef, childType, count)` central helper
    used by the reducer (`ADD`, `MOVE_INTO`) and the
    `ChildrenArea` UI.
  - The container's children-count header now shows
    `Children (3 / 5)` when `maxChildren` is set; "Max reached"
    badge replaces the Add-child button at the cap.
  - Add-child popover only lists `allowedChildTypes`.
  - `MOVE_INTO` rejects target containers that would violate the
    contract (early-return in the reducer).

  Backward compatible. All metadata fields are optional; pre-PR
  container definitions accept anything (including the built-in
  `grid`, which keeps its open contract since its purpose is
  arbitrary layout composition).

- 8894f34: Page builder hierarchy moves — into / out / wrap-in (#467, "Move blocks across hierarchy").

  Seventh PR off the #467 phase 2-4 queue. The reducer gains three
  new command-driven actions that let operators restructure the
  block tree without using JSON edit:
  - `MOVE_INTO { id, targetParentId }` — detach the block and
    append it as the last child of `targetParentId` (a container
    block). Rejects self-into-self and into-descendant moves so
    the tree can never form a cycle.
  - `MOVE_OUT { id }` — promote one level: drop into grandparent
    immediately after the current parent. No-op for top-level
    blocks (no grandparent).
  - `WRAP_IN { id, containerType }` — replace the block in place
    with a new container that has the block as its sole child.
    Useful for converting a leaf into "Hero inside a Grid" without
    re-pasting JSON.

  The command menu (Cmd-K) surfaces these as context-sensitive
  actions on the focused row:
  - "Move <label> out of parent" appears only when there's a
    grandparent.
  - "Move <label> into <containerLabel>" appears once per valid
    container in the tree (skipping descendants of the source).
  - "Wrap <label> in <containerLabel>" appears for every available
    container block except the source's own type.

  Backward compatible. Wire format unchanged. The drag-handle in
  SortableBlockItem still only does same-parent reorder (cross-
  container drag is a separate UX problem worth its own PR).

- 684530d: Page builder live preview surface (#467, "Server-rendered live preview").

  Third PR off the #467 phase 2-4 queue. The editor now ships an
  optional iframe preview that re-renders on every blocks change,
  so operators can see what their unsaved tree looks like without
  saving + reloading the public page.
  - New `POST /api/admin/preview-blocks` route (in the reference
    app). Accepts an unsaved blocks payload, runs `renderBlocks`
    - `renderToStaticMarkup` server-side, returns a standalone
      HTML document. `admin.manage` capability required. Render
      errors come back as a wrapped HTML doc with a banner — the
      iframe still mounts something, the operator never falls into
      a "blank preview" state and editor state is preserved.
  - New `PreviewPanel` client component in `@nexpress/admin`.
    Posts the editor's blocks (debounced 500 ms), drops the
    response into an `iframe srcDoc`, renders inside a sandbox
    (`allow-same-origin` only). Three viewport widths (Desktop /
    Tablet / Mobile) so operators can spot mobile-only layout
    issues without resizing the browser.
  - New "Show preview" / "Hide preview" toggle in the block-page
    editor toolbar. State persists in `localStorage` so an
    operator who keeps it open across sessions doesn't need to
    flip it on every page load. Defaults to off — preview costs
    an extra server round trip per edit and not every session
    needs it.

  Caveats (tracked as follow-ups):
  - `renderToStaticMarkup` is sync, so data-bound blocks that
    return `Promise<ReactElement>` (latest-posts, stats.counter,
    plugin async blocks) won't await — they fall back to whatever
    their sync placeholder is. Streaming support via
    `renderToReadableStream` is the obvious upgrade.
  - The preview document uses a generic system-font shell, not
    the active theme's CSS. Threading the active theme into the
    preview shell is a separate item on the #467 roadmap.

  No wire-format changes. The editor's existing save path and the
  public render path are untouched.

- 7399d8c: Page builder media picker — search / pagination / upload / broken state (#467, "Richer image/media authoring").

  Sixth PR off the #467 phase 2-4 queue. The block-image picker
  (`BlockImagePicker`) gets four upgrades.
  - **Search** — filter the loaded library by filename / alt text
    (300 ms debounce). Currently a client-side filter over the
    loaded pages; once `/api/media` accepts a `q` parameter this
    will switch to server-side. Tracked as a follow-up.
  - **Pagination** — page-based "Load more" so libraries with
    thousands of assets stay reachable. The picker reads
    `totalPages` from the media response to decide when to hide the
    button.
  - **Upload from the picker** — file input inside the dialog
    POSTs to `/api/media` with multipart form data, refreshes the
    listing, and immediately fills the URL field with the new
    asset's URL. Handles multiple files (sequentially) and surfaces
    upload errors as a banner.
  - **Broken-image state** — the inline preview now shows an
    amber-bannered "Image preview failed to load. Check the URL or
    pick from the library." instead of silently collapsing when the
    URL 404s. Combined with a new **Remove** button next to the URL
    input, operators can recover from a stale URL without retyping.

  Backward compatible. Wire format unchanged (`image` field still
  stores a URL string). The picker keeps working with the existing
  media route.

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

- 4edfa42: Page builder section patterns (#467, "Section patterns / reusable block groups").

  Ninth and final PR off the #467 phase 2-4 queue. The editor
  gains a "patterns" surface — pre-shaped block subtrees the
  operator can drop into a page in one click — plus a save-as-
  pattern flow so custom compositions persist across sessions.

  `@nexpress/admin/src/blocks/patterns.ts` — new module:
  - `NpPattern` type: `{ id, label, description?, source:
"built-in" | "custom", blocks: NpBlockInstance[] }`.
  - `getBuiltInPatterns()` ships three defaults: **Landing
    hero**, **FAQ section**, **Pricing section**.
  - `getCustomPatterns()` / `saveCustomPattern()` /
    `deleteCustomPattern()` persist user-saved patterns in
    `localStorage` (`np-page-builder.custom-patterns`).

  Block reducer:
  - New `INSERT_PATTERN { pattern, parentId? }` action.
    Re-ids every block in the pattern via `cloneBlockDeep` so
    each insertion is independent. Filters unknown types
    defensively (a saved pattern might outlive a plugin that
    contributed one of its blocks).

  Cmd-K command menu:
  - "Insert pattern: <label>" actions for built-ins + custom
    patterns under a new **Pattern** group (between Block
    actions and Add block).
  - "Save <focused block> as pattern" — prompts for a label,
    serializes the focused row's subtree, persists to
    localStorage, and surfaces immediately in the same session.

  Backward compatible. No wire-format changes for saved pages.
  Patterns are an admin-only authoring affordance; the wire is
  the same `NpBlockInstance[]` the rest of the editor speaks.

- 225d6a1: **F.5.2 — pattern library side panel + broken-image fallback +
  preview URL convention.**

  Three follow-ups bundled, building on F.5.1's Cmd-K
  enhancement:

  ### 1. Pattern library dialog (`PatternLibraryDialog`)

  A richer browse-and-pick UI for patterns: full-width
  thumbnail tiles in a 1/2/3-column grid, a search box, and
  source-filter chips (All / Built-in / Theme / Plugin /
  Saved). Complements the Cmd-K menu's text-line shortcut for
  operators who want to _see_ their options before inserting.

  Opens via:
  - New "Patterns" button next to Undo/Redo in the page-builder
    header
  - Cmd-Shift-P keyboard shortcut (Shift-P is unbound in
    Chrome / Safari / Firefox; Cmd-P / Cmd-L are reserved by
    the browser)

  Selecting a tile fires `INSERT_PATTERN` and closes the
  dialog — single-action by design so the operator goes back
  to the editor immediately to position the inserted block.

  ### 2. Broken-image fallback (`PatternPreview`)

  Reusable component for rendering pattern thumbnails. Two
  sizes: `thumb` (24×36px, used inline by Cmd-K menu) and
  `card` (16:10 aspect, used in the library grid).

  Behavior:
  - Renders `<img loading="lazy">` when `src` is set
  - Catches `onError` and falls back to a labeled icon tile
    (lucide `LayoutGrid`) so the picker stays usable when a
    theme ships a 404 preview path
  - When `src` is omitted (built-in / saved patterns without
    thumbnails), renders the same fallback for visual
    consistency with theme-shipped patterns

  The Cmd-K menu's existing inline thumbnail also routes
  through this component now, picking up the fallback for
  free.

  ### 3. Preview URL convention (documented on `NpPattern.preview`)

  Theme authors who ship preview images should:
  - Place files under the theme package's
    `public/themes/<theme-id>/patterns/` directory
  - Reference them as `/themes/<theme-id>/patterns/<pattern-id>.png`
  - Use PNG or WebP (transparent backgrounds OK)
  - Source size 800×500px (admin renders 16:10 cards)
  - Keep individual thumbnails under ~100 KB

  The convention is documented; the field still accepts any
  URL string, and the picker tolerates 404s via the fallback.

  ### What's NOT in this PR
  - No changes to existing patterns. None of the built-in
    patterns / theme patterns currently set `preview`, so the
    library dialog opens with the icon-tile fallback for now.
    Theme authors can add previews incrementally.
  - No server-side preview validation. The framework doesn't
    HEAD the URL at registration time — that'd be a bootstrap
    cost for every theme cold-start.

- a74a776: **F.5.1 — pattern picker UI: category bands + preview thumbnails.**

  The Cmd-K command menu's "Pattern" group used to render a flat
  list of `Insert pattern: <label>` actions. Theme + plugin
  contributors set `category` ("homepage" / "page" / "section"
  / ...) and `preview` (image URL) on `NpPattern` since F.5,
  but the picker ignored both.

  This PR enhances the picker:
  - **Category bands** — within the Pattern group, actions
    group by `pattern.category`. Each non-null category renders
    as a sub-header (Title-cased). Patterns without a category
    fall into the un-headered band first.
  - **Preview thumbnails** — when `pattern.preview` is set, a
    24px × 36px thumbnail renders at the left of the action
    label. Built-in / custom patterns without preview render
    text-only.

  ### Surface change

  `CommandAction` gained two optional fields:
  - `subgroup?: string` — generic sub-header within a group.
    Patterns use it for their category; other groups ignore.
  - `preview?: string` — thumbnail URL. Tiny `<img>` rendered
    inline in the action button.

  `groupCommandActions` now returns nested `CommandSubgroup[]`
  inside each `CommandGroup`. Items without a subgroup go into
  the first un-headered band so existing groups keep their flat
  look. `bucketBySubgroup` preserves declaration order (no
  alphabetical sort) — operators see patterns in the order
  their themes / plugins specified.

  ### What this enables

  Theme authors can now ship visual patterns with proper
  discovery:

  ```ts
  // in @nexpress/theme-magazine's patterns.ts
  {
    id: "magazine.homepage-feature-grid",
    label: "Homepage: feature + grid",
    description: "...",
    category: "homepage",
    preview: "/themes/magazine/preview.png",
    source: "theme:magazine",
    blocks: [...],
  }
  ```

  The Cmd-K picker shows it under a "Homepage" sub-header with
  the preview image. Operators glance once and pick.

  ### What's not in this PR — F.5.2 follow-up
  - **Dedicated side panel** — the design doc envisioned a
    separate "Insert pattern" side panel rather than the Cmd-K
    menu. The category-banded picker hits 80% of the value;
    side panel is bigger UI work (state-mgmt, animation, mobile
    layout) for the remaining polish.
  - **Search within Pattern** — current filter applies across
    all groups. A pattern-only search mode (or a dedicated
    search box inside the side panel) is part of F.5.2.

  ### Test plan
  - [x] @nexpress/admin build + typecheck clean
  - [x] @nexpress/web typecheck clean
  - [ ] Manual: install a theme with patterns that set
        `category` + `preview`, hit Cmd-K, confirm:
    - Pattern group shows category sub-headers
    - Preview thumbnails render inline
    - Pattern click still inserts the block subtree
    - Built-in / custom patterns without category fall into the
      first un-headered band

- 2084b7c: Page-builder patterns — auto-migrate localStorage to server, expose Delete pattern in Cmd-K (#467 follow-up).

  Two follow-ups to #493 flagged in the self-review. Closes the
  loop between local-only and server-stored patterns and gives
  operators a way to remove saved patterns without going through
  JSON.
  - **Auto-migration**: the first successful server fetch in a
    given browser pushes any local-only patterns up via
    `saveServerPattern`. Idempotent (server upserts by id) and
    guarded by a `np-page-builder.patterns-migrated` flag in
    localStorage so we don't re-run on every command-menu open.
    When the migration succeeds the migrated patterns are removed
    from the local list, ending the duplicate-listing surface in
    the merged view. Total failures (no migrations succeeded with
    a non-empty local list) leave the flag unset so the next
    session retries.
  - **Delete pattern in Cmd-K**: every custom pattern (server-
    stored or local-only) now appears under the **Pattern** group
    with a "Delete pattern: <label>" action marked `destructive`.
    Built-ins stay immutable. Selection prompts via
    `window.confirm`; on confirm the editor calls
    `deleteServerPattern` (no-op success when the id isn't on the
    server) and `deleteCustomPattern` so a stale localStorage
    entry can't survive.

  Backward compatible. The new helpers (`migrateLocalPatternsToServer`)
  just live next to the existing `get / save / delete` ones and
  are opt-in for callers — the editor wires them, anything else
  that imports `patterns.ts` keeps working unchanged.

- 1f4c718: Page-builder patterns — server-side storage (#467 follow-up).

  Patterns now persist in `np_settings` per site, shared across
  operator accounts and devices, instead of being trapped in one
  browser's `localStorage`. localStorage stays as a fallback for
  offline use, lower-role accounts, and unreachable APIs.

  `@nexpress/web`:
  - New `GET /api/admin/patterns` — returns site-shared patterns.
  - New `POST /api/admin/patterns` — upsert a pattern by id;
    generates an id when the body omits one; preserves
    `createdAt` on overwrite.
  - New `DELETE /api/admin/patterns/:id` — removes a pattern;
    treats missing-id as a no-op success so optimistic UI
    doesn't have to special-case races.

  All three are `admin.manage`-gated. CSRF auto-applied via the
  existing `apps/web/src/proxy.ts` pipeline. Storage shape: a
  single JSON-array value under `np_settings.key =
"page-builder.patterns"`, scoped by `siteId` so multi-tenant
  deployments don't leak compositions across tenants.

  `@nexpress/admin`:
  - New `fetchServerPatterns()`, `saveServerPattern()`,
    `deleteServerPattern()` helpers in
    `packages/admin/src/blocks/patterns.ts`. Each falls back to
    `null` / `false` on network or auth failure so callers can
    drop into local-only mode without crashing.
  - Block page editor merges server + local patterns when the
    command menu opens. Server patterns take precedence on id
    collision; local-only patterns surface alongside them so a
    pattern saved while offline is still reachable.
  - "Save as pattern" tries the server first; on failure it falls
    back to localStorage so the operator's intent isn't lost.

  Backward compatible. Existing localStorage patterns keep working
  unchanged — nothing migrates them to the server automatically
  (operators can re-save locally-stored patterns to push them up).

- ca1722e: Block prop schema — placeholder / min / max / pattern / rows / group / hiddenWhen (#467, "Stronger prop schema and validation").

  Fifth PR off the #467 phase 2-4 queue. The block-prop schema
  gains optional constraint metadata so block authors can describe
  better UI affordances and lighter validation without writing a
  custom field-renderer.

  `@nexpress/blocks` — new optional fields on `NpBlockPropField`:
  - `placeholder?: string` — native `<input>` / `<textarea>`
    placeholder. Applies to `text` / `textarea` / `url` / `number`.
  - `min?: number`, `max?: number`, `step?: number` — for
    `type: "number"`. Wired to the HTML number input attributes
    AND to the new client validator (`lintFieldValue`), so
    out-of-bounds values surface as soft warnings.
  - `pattern?: string`, `patternMessage?: string` — regex (string
    source) for `type: "text"` / `type: "url"`. Invalid patterns
    silently drop so a schema typo doesn't crash the editor.
  - `rows?: number` — visible rows for `type: "textarea"`.
    Defaults to 4 when omitted (matches the legacy renderer).
  - `group?: string` — collapsible-section label. Fields with the
    same `group` render under one bordered card; ungrouped fields
    stay flat.
  - `hiddenWhen?: ReadonlyArray<readonly [string, unknown]>` —
    conditional visibility. Hidden when _all_ `[propName, value]`
    predicates match the block's current `props`. Lets a schema
    express "show ctaUrl only when showCta is true" without the
    block author writing UI logic.

  `@nexpress/admin` props form:
  - `FieldControl` reads `placeholder` / `min` / `max` / `step` /
    `pattern` / `rows` from the schema and forwards them to the
    underlying `<Input>` / `<Textarea>`.
  - New `lintFieldValue(field, value)` helper runs alongside the
    existing required-missing check. Out-of-bounds numbers and
    pattern-mismatched text surface as amber warnings under the
    field. Soft warnings only — Apply still saves so server-side
    validation has the final say.
  - `groupVisibleFields(schema, props)` filters `hiddenWhen` and
    partitions visible fields into groups in declaration order.
    Groups render as bordered cards with a label header; ungrouped
    fields stay flat (no wrapper).

  Backward compatible. All metadata fields are optional; pre-PR
  schemas render unchanged. Wire format unchanged.

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

- 7c0eb2e: Block editor refresh — design alignment + new Document view.

  ## Page builder refresh (every operator gets this)
  - **Modal block palette** — popover replaced by a centered Dialog
    with categorized sections (Layout / Content / Media / Commerce
    / Community / Plugin / Other), search + favorites + recent,
    source (built-in / plugin / theme) + container badges on every
    card. Same data-flow as before; deeper UI.
  - **Hairline + rounded-2xl row cards** with refined source /
    container badges in the row header.
  - **Outline panel + Container warnings panel** mounted via portal
    in the host's sticky right sidebar, so the editor canvas keeps
    full width. Outline = recursive block tree (click → scroll +
    focus); warnings surface `minChildren` / `maxChildren` /
    `allowedChildTypes` violations with click-to-scroll.
  - **Status bar** in the editor footer — registry size, total
    block count, warnings count, active-block chip, autosave pulse
    with a custom box-shadow ripple keyframe matching the design's
    `.be-pulse`.

  ## Document view (new)

  A second view alongside Page builder, picked by a header toggle
  (Document / Page builder). Doc view renders the page **as a
  server-side preview** — the same `/api/admin/preview-blocks`
  pipeline the existing PreviewPanel uses, but now the operator's
  primary editing surface. Theme CSS, plugin blocks, async data
  all resolve correctly so what the operator sees matches what
  visitors will see.

  Hovering any block in the canvas surfaces a small action rail:
  - **Settings (gear)** — opens a `BlockSettingsDialog` modal that
    walks the block's `propsSchema` and renders one `FieldControl`
    per field. Honors `hiddenWhen` / `visibleWhen` predicates the
    same way the form-card editor does. Save dispatches
    `REPLACE_PROPS`; Cancel discards.
  - **Delete (trash)** — dispatches `DELETE` for the hovered block.

  Block insertion routes through the same `<PaletteModal>` Page
  builder uses — Doc and Page modes share one picker.

  The view choice persists per `<collection>.<field>` in
  localStorage. Default lands on Page builder; opting into Doc is
  one click.

  ## Engine extension — `REPLACE_TYPE`

  `EditorAction` gains one new variant — `REPLACE_TYPE` — used by
  the form-card editor's bulk "Convert to" flow. Adding to a
  discriminated union is non-breaking. Reducer behavior:
  - Locate by id; no-op if missing.
  - Honor parent's `allowedChildTypes` contract.
  - Optional `preserveText` (default true) carries the source's
    primary text-shaped prop into the new block's matching slot.
  - Container children carry over when both old and new types
    accept children.

  ## Lucide icon migration

  The 14 built-in blocks switched from emoji `icon` strings to
  Lucide icon names (`"Sunrise"`, `"LayoutGrid"`, `"FileText"`,
  etc.) and added `iconKind: "lucide"`. New `BlockIcon` resolver
  maps Lucide names to `lucide-react` SVG components; an
  `EMOJI_TO_LUCIDE` alias map keeps un-migrated plugin blocks
  rendering as proper SVGs without API churn.

  ## CSRF + autosave
  - All admin mutations now route through `npFetch` so the proxy's
    auto-CSRF check (#281) succeeds: PreviewPanel
    (`/api/admin/preview-blocks`), patterns service
    (`/api/admin/patterns`), and the block image picker upload
    (`/api/media`). Raw `fetch(POST, ...)` was returning 403
    CSRF_INVALID and silently breaking those flows.
  - New `SaveEventsProvider` mounted in `CollectionEditView` emits
    `"saving"` / `"saved"` / `"error"` around the form's submit
    flow. The block-editor orchestrator subscribes via
    `useSaveEvents` and forwards to its autosave indicator —
    status-bar pulse cycles dirty → saving → saved → idle as
    expected.

  ## Type extensions on `NpBlockMetadata`
  - `iconKind?: "lucide" | "emoji"` — advisory hint for the icon
    resolver. Optional and additive.

  (`docBodyKind` was added during the design pass and removed
  before merge — Doc view uses server-side preview now, no
  per-block kind hint required.)

### Patch Changes

- 53416e9: PagePicker (the search-as-you-type page combobox in the nav
  editor) gains two accessibility / UX polish bits:
  - **Scroll-into-view on arrow-key navigation.** The result list
    is height-capped to ~5–7 rows; ArrowDown past the visible
    window now calls `scrollIntoView({ block: "nearest" })` on the
    active row so the highlight stays visible. `nearest` is the
    important detail — it only scrolls when the row is actually
    clipped, so already-visible rows don't trigger a jolt.
  - **WAI-ARIA combobox pattern.** Input gets
    `role="combobox"` + `aria-expanded` + `aria-controls` +
    `aria-activedescendant` + `aria-autocomplete="list"`. Result
    container becomes `role="listbox"`. Each row becomes
    `role="option"` with `aria-selected={index === activeIndex}`.
    Screen readers now announce "1 of N" + the focused option's
    text on arrow-key navigation, even though DOM focus stays on
    the input. No visual change.

- 03bc2b7: **A11y: PagePicker trigger declares `aria-haspopup="listbox"`.**

  The navigation editor's PagePicker uses Radix Popover, whose trigger
  auto-applies `aria-expanded` but NOT `aria-haspopup`. Without it,
  the closed trigger reads as a plain button to screen readers — no
  hint that activating it surfaces a list of pages. Declaring
  `aria-haspopup="listbox"` matches the WAI-ARIA combobox pattern
  already in place inside the popover (`role="listbox"` on the
  results, `role="option"` per row).

  One-line polish item carried over from the post-#433 nav editor
  follow-up backlog.

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

- 7632009: **Dashboard onboarding: welcome card on fresh installs.**

  When the dashboard loads with no content AND no recent activity
  (brand-new install signal), the dashboard now shows a "Welcome
  to NexPress" card listing four concrete next-step actions:
  1. Create your first post
  2. Tune site settings
  3. Browse plugins
  4. View your site (opens public site in a new tab)

  The card disappears as soon as any content lands or any activity
  gets recorded, so it doesn't stick around as visual noise once
  the operator is rolling.

  Also adds an empty-state message to the "Collection pulse" card
  when no collections are registered (rare but possible during
  plugin development / collection-config refactor).

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

- e8cc136: `AdminShell` now types `collections` as `AdminShellCollection[]` — slug,
  labels, and admin sidebar flags only — instead of full `NpCollectionConfig`.
  Passing complete configs from a Server Component embedded `access` callbacks
  and triggered Next.js “Functions cannot be passed to Client Components”
  errors; consumers should map config to this shape in their layout.
- 51a7c75: **Auto-form (zod) — closes #599 + #603.**

  Two correctness bugs in the settings / plugin-config auto-form
  renderer (`packages/admin/src/zod-form/form-renderer.tsx`).
  Both surfaced in the G-track but were trigger-driven enough
  to ride the post-v0.1 follow-up queue. Easy to batch.

  **#599 — string-array editor lost newlines while typing.**
  `StringArrayField` parsed the textarea on every `onChange`
  (split → trim → drop-empty) and immediately re-controlled the
  textarea via `items.join("\n")`. Pressing Enter created a
  transient blank line that the controlled re-render erased
  before the next character could land — multi-line entries were
  effectively impossible.

  Fix: keep a local `draft: string | null` state. While the
  operator is mid-edit, the textarea owns its content verbatim
  (including trailing blanks); on `onBlur` we parse and emit
  the array, then reset `draft` to null so external resets take
  effect. Display value falls back to the parsed-from-value
  joined string when `draft === null`, so a parent re-render
  with a different value still updates the textarea when no
  edit is pending.

  Affected fields: OAuth scopes (`@nexpress/plugin-oauth-*`),
  any plugin / theme schema using `z.array(z.string())`.

  **#603 — optional text-like fields submitted `""` instead of
  `undefined` on clear.** Text / textarea / password / url /
  color fields all passed `onChange(e.target.value)` directly,
  sending an empty string when the operator cleared the input.
  Optional zod schemas (`z.string().url().optional()`,
  `z.string().regex(...).optional()`) generally treat `""` as
  present-but-invalid rather than absent — so clearing an
  optional URL hit "Invalid URL" instead of being accepted.

  Fix: extract a `commitText(raw, required)` helper that mirrors
  `NumberField`'s empty-→-undefined treatment. When the field is
  NOT required, clearing sends `undefined`; required fields keep
  the empty-string behavior so `min(1)` / `required_error`
  surfaces correctly. Color's twin-input (picker + text input)
  gets the same treatment — operators clear via the text box.

  No new tests — the `zod-form/` directory has no test suite
  today; behavior is exercised by the admin's settings flow
  end-to-end and the existing G-track integration tests.
  Manual smoke: type multi-line OAuth scopes (newlines persist
  while typing, normalize on blur); clear an optional URL field
  (no "Invalid URL" error).

- 961f456: **Page-builder hardening — #498-#516 review fallout (#520, #523, #524, #525, #529).**

  Five related fixes to the page-builder editor, bundled because
  they all sit on the same hydration / contract / UI-filtering
  spine:
  - **#520 — Preserve nested children on hydration.** The
    `field-renderer` block-field's `toBlockInstances` rebuilt every
    block as `{ id, type, props }`, dropping `children`. Opening a
    saved page with a populated grid mounted the editor with empty
    children; the next save persisted the truncated tree, silently
    deleting operator content. Hydration is now recursive.
  - **#523 — Container contracts on DUPLICATE / MOVE_OUT /
    REPLACE_TYPE / DUPLICATE_MANY.** Several reducer actions could
    push past `maxChildren` or violate `allowedChildTypes`:
    - `DUPLICATE` rejects when the parent is at max
    - `MOVE_OUT` checks the grandparent's contract before promoting
    - `REPLACE_TYPE` re-validates carried children against the new
      container's contract (drops invalid children rather than
      failing the whole replace)
    - `DUPLICATE_MANY` walks per-parent and skips duplicates that
      would push past the cap
  - **#524 — Doc settings dialog accessibility.** `BlockSettingsDialog`
    rendered every non-boolean field without a programmatic label.
    The dialog now wraps each `FieldControl` with a `<Label
htmlFor>` + required marker + description, except for boolean
    switches which already embed their own inline label.
  - **#525 — Doc canvas hover-rail palette filtering.** Clicking
    `+` on a hovered nested block opened the palette with the full
    field-allowed list. The reducer's `INSERT_AFTER` gate (#523)
    then silently rejected types the parent container excludes.
    The palette now filters by `allowedChildTypes` and respects
    `maxChildren` when an insertion target lives inside a container.
  - **#529 — Form-card insert-slot filtering.** The before/after
    `InsertSlot`s inside `ChildrenArea` received the unfiltered
    `availableBlocks` while the sibling Add-child popover used the
    contract-filtered `allowedChildBlocks`. Slots now share the
    filtered list and hide when the parent is at `maxChildren`.

- 2c05fab: Self-review follow-ups for #502–#506.

  `@nexpress/cli` template `protected-layout.tsx` now passes
  `getRegisteredPatterns()` to `BlocksRegistryProvider`, mirroring
  `apps/web`. Without this, sites scaffolded after #503 silently
  missed plugin / theme contributed patterns in the page-builder's
  command-menu picker.
  - `DUPLICATE_MANY` no longer double-clones a descendant when both
    it and an ancestor are in the selection. The recursive walk
    emits a clone for every selected id, so the descendant was
    cloned once inside the ancestor's clone AND once on its own —
    4× the descendant, 2× the ancestor. Pre-filtering the selection
    to drop ids whose ancestor is also selected fixes the count.
  - Preview-iframe selection highlight survives `srcDoc` swaps. The
    iframe replaces its document on every preview refetch (every
    500ms-debounced edit), which discarded the injected `<style
data-np-preview-selection>`. Re-applying on `onLoad` keeps the
    highlight stable across debounced renders. Block-id is now
    `CSS.escape`-d before going into the attribute selector so an
    id with a quote / backslash can't break the selector.
  - Paste-pattern shape check recurses into `children`. A malformed
    deep node (e.g. `children` not an array, or a child missing
    `id`) used to pass the top-level guard and crash the reducer's
    `cloneBlockDeep` later. The dialog rejects the paste up front
    with a readable error instead.
  - Wrap-picker dismisses on outside-click and auto-closes when the
    selection stops being wrap-eligible. The render guard
    `{wrapPickerOpen && wrapEligible}` was hiding the popup
    visually but leaving `wrapPickerOpen` true — re-eligibility
    would then re-open the popup without the operator clicking.

- 6c9c480: Page builder — post-review fixes for #487–#491.

  Bundle of seven small fixes flagged in the deep review of the
  phase 2-4 PRs.

  Reducer contract gates (closes the bypass paths #490 added):
  - `INSERT_BEFORE` / `INSERT_AFTER` now check the parent
    container's `allowedChildTypes` and `maxChildren` before
    inserting. Previously the slot affordances bypassed the same
    gate the Add-block popover already respected.
  - `INSERT_PATTERN` checks the parent contract for every block
    in the pattern, with cumulative `maxChildren` enforcement —
    a pattern that would push the count past the cap truncates
    rather than overflowing. Empty result returns the unchanged
    state.
  - `WRAP_IN` validates the wrapper's `allowedChildTypes` against
    the source block's type — wrapping a `hero` in a strict
    `["pricing-tier"]`-only container now fails closed instead
    of producing an instantly-invalid tree.

  Prop schema validation (#487):
  - `lintFieldValue` regex is now anchored (`^(?:…)$`) to match
    HTML5 `<input pattern>` semantics, so the soft warning and
    the native browser validation agree on whether a value passes.
  - Required-missing check on the props form now reads
    `block.props[field.name]` directly (pre-default), so a
    required number with no `defaultValue` is correctly flagged
    when the operator hasn't supplied a value. The previous
    check used the post-`getFieldValue` value, which always
    resolved to `0` for numbers — required + number was
    effectively un-flaggable.

  Media picker robustness (#488):
  - `loadMedia` now uses `AbortController` so a slow earlier
    request can't overwrite the response from a newer query
    search. Aborted requests skip the error banner.
  - `handleUploadFiles` caps concurrency at 3 simultaneous
    uploads. A 100-file drop runs in cohorts instead of opening
    100 parallel POSTs and saturating the rate limit.

  No wire-format changes. All gates fail closed (return unchanged
  state) so the editor's existing reducer-output invariants hold.

- 886ea26: Page builder — refactor self-review fixes (#467).

  Two issues found during the self-review of the
  phase 1-3 refactor.
  - **Engine no longer imports `@dnd-kit/sortable`.** The phase 1
    changeset claimed the engine was "dnd-kit-free by design,"
    but `editor-engine/reducer.ts` imported `arrayMove` from
    `@dnd-kit/sortable` for its `MOVE_WITHIN_PARENT` /
    `MOVE_UP` / `MOVE_DOWN` handlers. Replaces that with a tiny
    4-line `arrayMove` helper inside `editor-engine/tree.ts` so
    the dependency claim holds. An in-page editor that swaps
    drag libraries (or skips drag entirely) can now mount the
    engine without pulling dnd-kit through.
  - **Consolidate duplicate import lines** in
    `form-editor/block-page-editor.tsx`. `findBlockInTreeFlat`
    was imported from `../editor-engine/index.js` on a separate
    line right after another `editor-engine` import block —
    artifact of the phase 3 extraction that didn't merge cleanly.
    Now a single combined import.

  No semantic change. Bundle size unchanged (the engine wasn't
  shipping its own copy of `arrayMove` either way; the in-engine
  helper is the same 4 lines).

- 4fa8e89: **Fix WRAP_IN reducer infinite recursion** (caught by new editor-engine test suite).

  The page-builder's `WRAP_IN` action used `mapTree` to swap a block in
  place with a wrapper containing the original. Because `mapTree`
  walks every block in the tree — including the wrapper's child,
  which is the SAME block with the SAME id — the match condition
  fired again on every recursion, wrapping endlessly until the call
  stack blew up.

  The bug had been silent because admin had no unit test coverage
  for the editor engine until #595 — every WRAP_IN-triggering UI
  action would have crashed with `RangeError: Maximum call stack
size exceeded`. The contract-rejection paths (wrong type / not a
  container / parent excludes the wrapper) all return early before
  the buggy `mapTree` call, so the rejected paths "worked".

  Fix: replace the `mapTree` walk with `locateBlock` +
  `updateContainerChildren`, which performs the substitution exactly
  once at the source's depth without recursing into the wrapper's
  children. New `reducer — WRAP_IN > wraps a top-level block in a
container` test pins the success path.

- 2c05fab: `WRAP_IN` and `WRAP_MANY` now check the parent container's
  contract before wrapping. Previously, only the wrapper-accepts-
  source side was checked — wrapping a `text` block inside a
  `column` whose `allowedChildTypes: ["text"]` into a `grid` would
  make the column hold a `grid` child, which the column's contract
  forbids. The reducer rejects the wrap closed instead of building
  an instantly-invalid tree.

  Preview-iframe `scrollIntoView` now targets the marker's first
  element child instead of the marker itself. The marker uses
  `display: contents` to stay layout-neutral, but a box-less
  element is historically unreliable as a `scrollIntoView` target
  (descendant fallback works in modern Chrome / Firefox; Safari has
  had bugs around this). The new target is the same node the
  outline CSS hits via `> *`, so highlight and scroll stay aligned.

- f590247: Page-builder medium tier (#467): plugin / theme contributed patterns flow through the bootstrap into the editor's command-menu pattern picker (`definePlugin({ patterns })` plus a shared pattern registry in `@nexpress/blocks`); favorites in the block palette pin a per-operator "Favorites" section above Recent (localStorage-persisted); a paste-import dialog in the command menu accepts a single block, an array of blocks, or a pattern object, validates, and inserts via `INSERT_PATTERN` so id-regeneration goes through the existing reducer.
- fcbb9f3: Page-builder multi-select (#467 #3): rows have a checkbox in the header and a sticky bulk-action toolbar appears when one or more blocks are selected. Click toggles a single id; shift-click extends across contiguous siblings; cmd/ctrl-click adds to the selection. Bulk actions cover Wrap-in-container (gated to contiguous siblings of one parent — `WRAP_MANY` reducer action), Duplicate (`DUPLICATE_MANY`), and Delete with confirmation (`DELETE_MANY`). The orchestrator's selection set is auto-pruned when a referenced id leaves the tree (post-delete / post-undo).
- 15aa1d4: Page-builder quick wins (#467): conditional `visibleWhen` on prop fields (inverse of `hiddenWhen`), validation status badges on collapsed rows (`required` / `warning`), per-row collapsed state lifted to the orchestrator and persisted in `localStorage`, focus moves to a newly inserted block, and an empty-page state with one-click recommended starter blocks.
- 71427c8: Plugins page — design refresh.

  The `PluginsManager` swaps the per-plugin Card stack for a single
  "Installed" Card with compact rows. Mirrors the design handoff's
  `PluginsScreen` (`ui_kits/admin/OtherScreens.jsx`):
  - Card header surfaces the live state count
    (`X active · Y pending restart · Z disabled`) so operators see
    the plugin landscape at a glance.
  - Each row carries the plugin name + slug
    (`@nexpress/<id>@<version>`, monospace + muted) on the same line,
    with the description underneath. Status pills (Active /
    Pending restart / Inactive) sit between the name and the
    Configure / Open admin / Switch controls.
  - Capabilities, Hooks, and Routes details collapse into a
    `Show details` disclosure under each row. Operators who just
    want to toggle a plugin keep a tight overview; the metadata
    is one click away.

  No public API change — `PluginsManager`'s prop surface, the API
  endpoints, the toggle / config flow, and the dialog itself are
  unchanged. Visual / interaction only.

  ## Pagehead actions

  The page header now matches the design's `PluginsScreen` action
  rail with three buttons:
  - **Reload all** (existing) — re-runs every plugin's `setup()`.
  - **Browse registry** (new) — opens a large modal listing every
    npm package tagged `keywords:nexpress-plugin`. Replaces the
    inline `DiscoverPanel` card that previously sat below the
    Installed list. Same `/api/admin/plugins/discover` endpoint
    feeds it; copy-install button is preserved per row.
  - **Install plugin** (new) — opens a guide modal that walks the
    operator through the actual install flow (`pnpm add` → register
    in `nexpress.config.ts` → restart). NexPress doesn't ship a
    runtime installer, so this is the honest UI for the CTA. Both
    the install command and the config snippet have copy buttons.

- 89c7180: Page-builder selected-block preview (#467 #1): focusing a row in the editor now highlights the matching block in the live preview iframe and scrolls it into view. `renderBlocks` gains an opt-in `previewMarkers` flag that wraps each block with a layout-neutral `<div data-np-block-id="…" style="display: contents">`; production renders never enable it. The admin's preview API route flips it on, and `PreviewPanel` reaches into the iframe (which is already `allow-same-origin`) to apply an outline + `scrollIntoView`.
- 03db59e: Page builder — extract UI-agnostic editor engine (refactor phase 1).

  Pulls the page-builder's pure logic out of the
  `block-page-editor.tsx` monolith into a new
  `packages/admin/src/blocks/editor-engine/` directory. Lays the
  foundation for adding (or eventually replacing the form-card
  editor with) an in-page editor that shares the same state
  machine.

  What moved (zero semantic change):
  - `editor-engine/types.ts` — `EditorAction`, `HistoryState`,
    `HistoryAction`, `ContainerCandidate`, `FieldGroupSection`.
  - `editor-engine/tree.ts` — `mapTree` / `filterTree` /
    `locateBlock` / `updateContainerChildren` / `cloneBlockDeep` /
    `findBlockInTreeFlat` / `isDescendantOf` / `detachBlock` /
    `createBlockId`.
  - `editor-engine/contracts.ts` — `canAcceptChild`.
  - `editor-engine/reducer.ts` — `createEditorReducer` +
    `createBlockInstance`.
  - `editor-engine/history.ts` — `createHistoryReducer` (50-step
    cap, 600 ms typing coalesce contract).
  - `editor-engine/validation.ts` — `lintFieldValue` /
    `isFieldHidden` / `groupVisibleFields` /
    `deleteNeedsConfirmation` / `parseFieldInput` /
    `getFieldValue` / `isRecord`.
  - `editor-engine/summary.ts` — `getRowSummary`.
  - `editor-engine/candidates.ts` — `collectContainerCandidates`.
  - `editor-engine/use-editor-state.ts` — composes reducer +
    history + dispatch coalescing + `onChange` effect into one
    React hook (`useEditorState`).

  What stayed in `block-page-editor.tsx` (form-card UI layer):
  all `SortableBlockItem` / `ChildrenArea` / `HierarchyMenu` /
  `InsertSlot` / `BlockJsonDialog` / `PageJsonDialog` / etc.
  components, plus the dnd-kit wiring. Phases 2 and 3 of the
  refactor will continue extraction (shared dialogs / pickers /
  etc., and finally the form-card UI itself).

  The engine is **dnd-kit-free** by design — drag libraries live
  in the form-editor layer and dispatch the actions in
  `EditorAction`. An in-page editor can pick its own drag
  mechanism (or none) and reuse the same hook.

  External API unchanged: `BlockPageEditor` still exports from
  the same path and `field-renderer.tsx`'s `LazyBlockPageEditor`
  keeps loading via the same dynamic import.

- e460cc3: Page builder — extract form-card UI (refactor phase 3, final).

  Final phase of the `block-page-editor.tsx` decomposition started
  in phases 1 (engine) and 2 (shared UI). Moves the form-card
  specific layout components into a new
  `packages/admin/src/blocks/form-editor/` directory and reduces
  the entry file to a thin re-export.

  What moved (zero semantic change):
  - `form-editor/block-page-editor.tsx` — orchestrator: mounts
    `useEditorState`, wires top-level shortcuts, manages pattern /
    preview / command-menu state.
  - `form-editor/sortable-block-item.tsx` — `SortableBlockItem` +
    `ChildrenArea` (kept together because the two recurse into
    each other through container blocks).
  - `form-editor/hierarchy-menu.tsx` — row-header dropdown for
    cross-hierarchy moves.
  - `form-editor/insert-slot.tsx` — between-rows hover affordance.
  - `form-editor/grid-child-layout.tsx` — `GridChildLayoutControl`
    - `getLayout` helper for grid `_layout.colSpan` meta.
  - `form-editor/drag-preview.tsx` — dnd-kit drag overlay card.

  `packages/admin/src/blocks/block-page-editor.tsx` is now a
  10-line `export { BlockPageEditor } from "./form-editor/…"` so
  existing dynamic imports (`field-renderer.tsx`'s
  `LazyBlockPageEditor`) keep working unchanged.

  What lands next (separate work): a sibling `in-page-editor/`
  directory will mount the same `useEditorState` hook + the same
  shared widgets but with its own row-render surface (page-as-
  canvas instead of card list). The engine + shared bundle is
  already designed to be reused — phase 3 just makes the form-
  card layout's separation explicit.

  External API unchanged. No wire-format changes.

  ## Final stats
  - Phase 0 (pre-refactor): `block-page-editor.tsx` ≈ 3700 lines.
  - Phase 1 (engine): -694 lines.
  - Phase 2 (shared UI): -1587 lines.
  - Phase 3 (form-card UI): -1408 lines, replaced by 10-line
    re-export.
  - Total reduction in the entry file: ~3690 → 11 lines (-99.7%).
  - New layout: `editor-engine/` (11 files), `shared/` (8 files),
    `form-editor/` (7 files).

- 1a60fdc: Page builder — extract shared UI (refactor phase 2).

  Continues the `block-page-editor.tsx` cleanup started in phase 1.
  Pulls UI components that aren't tied to the form-card layout
  into a new `packages/admin/src/blocks/shared/` directory, so an
  in-page editor (or any other surface) can mount them without
  dragging in the row-card layout primitives.

  What moved (zero semantic change):
  - `shared/field-control.tsx` — `FieldControl` (switch on
    `field.type` over Input / Textarea / Select / Switch /
    ColorInput / RichTextEditor / ArrayFieldControl / etc.) plus
    the lazy-loaded Lexical wrapper.
  - `shared/array-field-control.tsx` — `ArrayFieldControl` +
    `normalizeArrayValue`. Takes `FieldControl` as a prop to
    avoid the field-control ↔ array-field-control import cycle.
  - `shared/block-image-picker.tsx` — `BlockImagePicker` with
    search / pagination / upload / broken-image affordances.
  - `shared/block-json-dialog.tsx` — per-block JSON editor +
    schema lint helper.
  - `shared/page-json-dialog.tsx` — page-level JSON editor with
    Preview → Confirm staging, import-as-new, +/-/~ diff
    preview.
  - `shared/delete-block-dialog.tsx` — destructive-confirm
    dialog only mounted when delete would lose work.
  - `shared/command-menu.tsx` — Cmd-K palette with substring
    filter and context-sensitive Block / Pattern / Add / Page
    groups.

  What stays in the form-editor layer (`block-page-editor.tsx`,
  phase 3 target): `SortableBlockItem` / `ChildrenArea` /
  `HierarchyMenu` / `InsertSlot` / `GridChildLayoutControl` /
  `DragPreview` plus the dnd-kit wiring.

  External API unchanged: `BlockPageEditor` still exports from
  the same path; internal imports re-resolve through the new
  shared bundle.

  Stats: `block-page-editor.tsx` 3006 → 1419 lines (-1587).
  Shared bundle: 8 files, ~1860 lines.

- 6483de7: Page-builder responsive grid spans (#467 #9): grid children carry `_layout: { colSpan, mdColSpan?, lgColSpan? }`. The base `colSpan` applies to mobile; `mdColSpan` overrides at ≥ 768 px, `lgColSpan` at ≥ 1024 px, and unset breakpoints fall back through the cascade (lg → md → base) via CSS custom properties + a scoped media query block. The form-editor's grid-child control swaps to a three-up Mobile / Tablet / Desktop picker with an "Auto" option for the larger breakpoints. Existing pages with only `colSpan` keep rendering identically.
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
- Updated dependencies [6772bf2]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [15aa1d4]
- Updated dependencies [89c7180]
- Updated dependencies [6483de7]
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0
  - @nexpress/editor@1.0.0

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
  - @nexpress/blocks@0.1.0
  - @nexpress/editor@0.1.0
