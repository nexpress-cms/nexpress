---
"@nexpress/blocks": minor
"@nexpress/admin": minor
---

Page builder container contracts (#467, "Layout and container contracts").

Eighth PR off the #467 phase 2-4 queue. Container blocks
(`acceptsChildren: true`) can now describe what kind of children
they accept and how many.

`@nexpress/blocks` — three new optional fields on
`NpBlockMetadata`:

- `allowedChildTypes?: readonly string[]` — restricts which
  block types may be added or moved into the container. Empty /
  omitted accepts every type (historical behavior).  Wildcard
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
