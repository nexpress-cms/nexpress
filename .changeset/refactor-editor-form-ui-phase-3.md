---
"@nexpress/admin": patch
---

Page builder — extract form-card UI (refactor phase 3, final).

Final phase of the `block-page-editor.tsx` decomposition started
in phases 1 (engine) and 2 (shared UI). Moves the form-card
specific layout components into a new
`packages/admin/src/blocks/form-editor/` directory and reduces
the entry file to a thin re-export.

What moved (zero semantic change):

- `form-editor/block-page-editor.tsx` — orchestrator: mounts
  `useEditorState`, wires top-level shortcuts, manages pattern /
  preview / command-menu state.
- `form-editor/sortable-block-item.tsx` — `SortableBlockItem` +
  `ChildrenArea` (kept together because the two recurse into
  each other through container blocks).
- `form-editor/hierarchy-menu.tsx` — row-header dropdown for
  cross-hierarchy moves.
- `form-editor/insert-slot.tsx` — between-rows hover affordance.
- `form-editor/grid-child-layout.tsx` — `GridChildLayoutControl`
  + `getLayout` helper for grid `_layout.colSpan` meta.
- `form-editor/drag-preview.tsx` — dnd-kit drag overlay card.

`packages/admin/src/blocks/block-page-editor.tsx` is now a
10-line `export { BlockPageEditor } from "./form-editor/…"` so
existing dynamic imports (`field-renderer.tsx`'s
`LazyBlockPageEditor`) keep working unchanged.

What lands next (separate work): a sibling `in-page-editor/`
directory will mount the same `useEditorState` hook + the same
shared widgets but with its own row-render surface (page-as-
canvas instead of card list). The engine + shared bundle is
already designed to be reused — phase 3 just makes the form-
card layout's separation explicit.

External API unchanged. No wire-format changes.

## Final stats

- Phase 0 (pre-refactor): `block-page-editor.tsx` ≈ 3700 lines.
- Phase 1 (engine): -694 lines.
- Phase 2 (shared UI): -1587 lines.
- Phase 3 (form-card UI): -1408 lines, replaced by 10-line
  re-export.
- Total reduction in the entry file: ~3690 → 11 lines (-99.7%).
- New layout: `editor-engine/` (11 files), `shared/` (8 files),
  `form-editor/` (7 files).
