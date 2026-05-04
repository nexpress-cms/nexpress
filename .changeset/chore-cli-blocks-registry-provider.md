---
"create-nexpress": minor
---

Sites scaffolded by `create-nexpress` get the same plugin-block
wiring the reference app (`apps/web`) ships with — without it,
plugin blocks would render correctly on the public site but
silently disappear from the admin's Add-block popover.

Two changes in the scaffold's protected admin layout:

- `ensureFor("read")` → `ensureFor("plugins")` so plugins (and
  their blocks) load before the metadata snapshot.
- `<BlocksRegistryProvider metadata={...}>` mounted around the
  admin children, fed by `getRegisteredBlockMetadata()` called
  server-side. The provider hands the block list down to the
  client-side editor through React context — necessary because
  the shared block registry is module-scoped and the browser
  module-instance only ever has the built-in defaults.
