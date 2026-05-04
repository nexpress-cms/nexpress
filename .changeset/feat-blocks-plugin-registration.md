---
"@nexpress/blocks": minor
"@nexpress/plugin-sdk": minor
"@nexpress/next": minor
"@nexpress/admin": patch
---

Page builder editor — phase 3 (plugin block registration).

Plugins can now contribute block types to the page builder.
`definePlugin({ blocks: NxBlockDefinition[] })` accepts the same
real `NxBlockDefinition` shape as the built-ins (icon, label,
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
  `NxBlockRegistration` type (component-string, never wired) for
  the real `NxBlockDefinition` from `@nexpress/blocks` on
  `NxPluginDefinition.blocks`. The legacy interface stays
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
`NxBlockMetadata` type (`Omit<NxBlockDefinition, "render">`) and
a `getRegisteredBlockMetadata()` helper. The admin's protected
layout calls it server-side after `ensureFor("plugins")` and
mounts a `<BlocksRegistryProvider>` (new export from
`@nexpress/admin/client`) that delivers the snapshot to the
browser editor through React props. The page-builder reads from
the provider via `useBlocksRegistry()`; `getRegisteredBlocks()`
calls in browser-side code would only see the module-instance's
defaults, never the plugin blocks the Node-side bootstrap pushed
into the server instance.

