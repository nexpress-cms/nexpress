---
"@nexpress/admin": patch
---

Plugins page — design refresh.

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
