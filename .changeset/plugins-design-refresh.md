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
