---
"@nexpress/admin": minor
---

Page builder hierarchy moves — into / out / wrap-in (#467, "Move blocks across hierarchy").

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
