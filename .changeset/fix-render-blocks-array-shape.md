---
"@nexpress/blocks": patch
---

Fix `renderBlocks` crashing on every page that has blocks.

`NxPageBlocks` was typed as `{ blocks: NxBlockInstance[] }`, but
the actual data flow on every other surface uses a flat
`NxBlockInstance[]` array — the JSONB column on `nx_c_*` tables,
the admin `BlockPageEditor` prop, the `toBlockInstances` adapter,
the seed scripts, and every theme template / catch-all caller all
pass an array. Only `renderBlocks` interpreted its argument as the
wrapper, so `pageBlocks.blocks.length` threw
`TypeError: Cannot read properties of undefined (reading 'length')`
the first time a page with seeded blocks tried to render.

`NxPageBlocks` is now a type alias for `NxBlockInstance[]`, and
`renderBlocks` indexes into the array directly. All call sites
were already passing arrays, so no theme or app code needs
to change.
