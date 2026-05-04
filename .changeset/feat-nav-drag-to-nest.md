---
"@nexpress/admin": minor
---

Nav editor's drag interaction grows past sibling-only reorder.
The grip handle still reorders, but dragging an item right by ~24px
while dropping nests it as a sub-menu of the target — the macOS
Reminders / WordPress Block Editor pattern. The drop also respects
the existing 1-level depth limit: items with their own children
fall through to plain sibling reorder rather than create
grandchildren.

Side benefits from going to a single flat SortableContext (was two
nested ones):

  - Cross-scope drags now work. Dragging a child onto another
    top-level item re-parents it; dragging a child without drag-right
    onto a top-level item promotes it to top-level.
  - The Parent select is still there for keyboard-driven changes.
