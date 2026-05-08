---
"@nexpress/blocks": minor
"@nexpress/theme": minor
"@nexpress/next": minor
"@nexpress/web": patch
---

**Phase F.4 — `impl.blocks`: theme-shipped block types + source identity contract.**

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

| Contributor | Auto-stamped `source` |
|-------------|------------------------|
| Built-in (registry seed) | undefined → parsed as `core` |
| Plugin (via bootstrap) | `plugin:<plugin.id>` |
| Theme (via bootstrap) | `theme:<theme.manifest.id>` |

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
  + theme routes both use the site-scoped ctx variant so this
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
