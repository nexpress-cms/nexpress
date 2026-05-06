---
"@nexpress/admin": patch
---

Page builder — extract shared UI (refactor phase 2).

Continues the `block-page-editor.tsx` cleanup started in phase 1.
Pulls UI components that aren't tied to the form-card layout
into a new `packages/admin/src/blocks/shared/` directory, so an
in-page editor (or any other surface) can mount them without
dragging in the row-card layout primitives.

What moved (zero semantic change):

- `shared/field-control.tsx` — `FieldControl` (switch on
  `field.type` over Input / Textarea / Select / Switch /
  ColorInput / RichTextEditor / ArrayFieldControl / etc.) plus
  the lazy-loaded Lexical wrapper.
- `shared/array-field-control.tsx` — `ArrayFieldControl` +
  `normalizeArrayValue`. Takes `FieldControl` as a prop to
  avoid the field-control ↔ array-field-control import cycle.
- `shared/block-image-picker.tsx` — `BlockImagePicker` with
  search / pagination / upload / broken-image affordances.
- `shared/block-json-dialog.tsx` — per-block JSON editor +
  schema lint helper.
- `shared/page-json-dialog.tsx` — page-level JSON editor with
  Preview → Confirm staging, import-as-new, +/-/~ diff
  preview.
- `shared/delete-block-dialog.tsx` — destructive-confirm
  dialog only mounted when delete would lose work.
- `shared/command-menu.tsx` — Cmd-K palette with substring
  filter and context-sensitive Block / Pattern / Add / Page
  groups.

What stays in the form-editor layer (`block-page-editor.tsx`,
phase 3 target): `SortableBlockItem` / `ChildrenArea` /
`HierarchyMenu` / `InsertSlot` / `GridChildLayoutControl` /
`DragPreview` plus the dnd-kit wiring.

External API unchanged: `BlockPageEditor` still exports from
the same path; internal imports re-resolve through the new
shared bundle.

Stats: `block-page-editor.tsx` 3006 → 1419 lines (-1587).
Shared bundle: 8 files, ~1860 lines.
