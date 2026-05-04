---
"@nexpress/admin": minor
"@nexpress/blocks": minor
---

Page builder editor — phase 1 (UI polish).

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
