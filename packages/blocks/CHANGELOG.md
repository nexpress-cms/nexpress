# @nexpress/blocks

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

- c40cded: Built-in blocks — replace JSON-textarea props with structured array fields.

  The five default blocks that previously asked operators to hand-edit a
  JSON blob (FAQ, Feature Grid, Pricing, Contact Form, Image Gallery) now
  expose their list-shaped props as `type: "array"` with a real
  `itemSchema`. The page-builder admin renders an Add / Remove UI per
  entry instead of a monospace textarea.
  - `faq.items` — Question / Answer per row.
  - `feature-grid.features` — Icon / Title / Description per row.
  - `pricing.plans` — Plan name / Price / Period / Features (one per
    line) / CTA text / CTA URL / Highlight per row.
  - `contact-form.fields` — Field label per row (was `string[]`).
  - `image-gallery.images` — Image (URL / library picker) + Alt text
    per row.

  Wire format change: `defaultProps` for these props are now real
  arrays / objects instead of JSON strings. Each block's render-time
  parser still accepts the legacy JSON-string shape, so pages saved
  with the old admin keep rendering. New entries written through the
  admin go out as plain arrays.

  `pricing.plans[].features` is a special case: the new admin-editor
  format is a single newline-separated `string` (per-line one
  feature, edited via a textarea inside each plan row), while the
  legacy default exported a `string[]`. The parser accepts both
  shapes — new pages persist a `string`, older pages keep their
  `string[]` until the operator next edits and saves the plan.

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

- 8bed938: Five new built-in blocks so a real landing page can be composed
  without falling back to a single rich-text dump:
  - `section-header` — eyebrow + heading + subtitle. Drop above any
    content section that needs a labeled intro.
  - `testimonials` — quote-card grid (avatar / name / role / rating).
    Auto-collapses to one column on mobile and caps at three on
    desktop.
  - `stats-grid` — number + label cells in a horizontal strip. The
    value is a string field, so suffixes like `"99.9%"` / `"10k+"` /
    `"$2.4M"` work without a parse step.
  - `logos-cloud` — grayscale logo strip for trust signals. Each
    logo can be a link or an inert mark.
  - `tabs` — exclusive-accordion via HTML5's `<details name="...">`
    group. Browsers that honor the spec render it as native tabs
    (one panel open at a time); browsers that don't fall back to
    plain accordion. SSR-pure, no client JS.

  All five register through the shared block registry alongside the
  existing built-ins, so plugin / theme / admin consumers pick them
  up automatically without explicit wiring.

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

- b78dbbc: **F.4 follow-up — registry collision warnings.**

  Per design doc §5.8 namespace decision:

  > Same id from two sources = silent overwrite (last-loaded
  > wins) with dev warning.

  F.2's `collectThemeRoutes` already had this for routes. F.4 +
  F.5 stamped `source: "theme:<id>"` / `"plugin:<id>"` on
  blocks + patterns but the registries silently overwrote on
  collision without surfacing the conflict.

  This PR adds the dev-mode `console.warn` for both `registerBlock`
  and `registerPattern`, with the same once-per-process dedup
  pattern used elsewhere.

  ### Rules

  | Scenario                                                          | Warns?                    |
  | ----------------------------------------------------------------- | ------------------------- |
  | First registration                                                | No                        |
  | Same source re-registers (HMR / cold-start re-boot)               | No                        |
  | Built-in default getting overridden by theme/plugin               | No (intentional override) |
  | Two different non-default sources register the same `type` / `id` | **Yes**, once per process |

  The "intentional override" exemption matches the v0.2 contract:
  themes can replace built-ins (e.g., a magazine theme shipping
  its own `gridBlock` to add editorial defaults). Plugin →
  plugin or theme → theme collisions, however, are author errors
  worth surfacing.

  ### Why warn instead of throw

  `registerBlock` runs on every cold boot AND on plugin reload.
  A strict throw would make HMR + dev iteration painful when a
  plugin author renames a type. Warn keeps the dev loop moving
  while making the silent overwrite visible. Last-loaded still
  wins (existing contract).

  ### Tests

  11 new unit tests in `packages/blocks/src/registry.test.ts`:
  - 6 for blocks (first registration, same-source idempotent,
    built-in override allowed, cross-source warn, warn-once,
    plugin↔theme cross)
  - 5 for patterns (same coverage minus plugin↔theme since
    patterns share the test path)

  Total `@nexpress/blocks` tests: 29 (was 18).

  ### Test-only fix

  `render: () => null` in test stubs was technically incorrect —
  `NpBlockDefinition.render` returns `ReactElement` (or
  Promise), not `null`. Replaced with a typed stub that the
  type system accepts. Existing source tests fixed at the same
  seam.

- f590247: Page-builder medium tier (#467): plugin / theme contributed patterns flow through the bootstrap into the editor's command-menu pattern picker (`definePlugin({ patterns })` plus a shared pattern registry in `@nexpress/blocks`); favorites in the block palette pin a per-operator "Favorites" section above Recent (localStorage-persisted); a paste-import dialog in the command menu accepts a single block, an array of blocks, or a pattern object, validates, and inserts via `INSERT_PATTERN` so id-regeneration goes through the existing reducer.
- 15aa1d4: Page-builder quick wins (#467): conditional `visibleWhen` on prop fields (inverse of `hiddenWhen`), validation status badges on collapsed rows (`required` / `warning`), per-row collapsed state lifted to the orchestrator and persisted in `localStorage`, focus moves to a newly inserted block, and an empty-page state with one-click recommended starter blocks.
- 89c7180: Page-builder selected-block preview (#467 #1): focusing a row in the editor now highlights the matching block in the live preview iframe and scrolls it into view. `renderBlocks` gains an opt-in `previewMarkers` flag that wraps each block with a layout-neutral `<div data-np-block-id="…" style="display: contents">`; production renders never enable it. The admin's preview API route flips it on, and `PreviewPanel` reaches into the iframe (which is already `allow-same-origin`) to apply an outline + `scrollIntoView`.
- 6483de7: Page-builder responsive grid spans (#467 #9): grid children carry `_layout: { colSpan, mdColSpan?, lgColSpan? }`. The base `colSpan` applies to mobile; `mdColSpan` overrides at ≥ 768 px, `lgColSpan` at ≥ 1024 px, and unset breakpoints fall back through the cascade (lg → md → base) via CSS custom properties + a scoped media query block. The form-editor's grid-child control swaps to a three-up Mobile / Tablet / Desktop picker with an "Auto" option for the larger breakpoints. Existing pages with only `colSpan` keep rendering identically.
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
- Updated dependencies [6772bf2]
- Updated dependencies [3eeac73]
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
  - @nexpress/editor@0.1.0
