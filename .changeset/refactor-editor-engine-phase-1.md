---
"@nexpress/admin": patch
---

Page builder — extract UI-agnostic editor engine (refactor phase 1).

Pulls the page-builder's pure logic out of the
`block-page-editor.tsx` monolith into a new
`packages/admin/src/blocks/editor-engine/` directory. Lays the
foundation for adding (or eventually replacing the form-card
editor with) an in-page editor that shares the same state
machine.

What moved (zero semantic change):

- `editor-engine/types.ts` — `EditorAction`, `HistoryState`,
  `HistoryAction`, `ContainerCandidate`, `FieldGroupSection`.
- `editor-engine/tree.ts` — `mapTree` / `filterTree` /
  `locateBlock` / `updateContainerChildren` / `cloneBlockDeep` /
  `findBlockInTreeFlat` / `isDescendantOf` / `detachBlock` /
  `createBlockId`.
- `editor-engine/contracts.ts` — `canAcceptChild`.
- `editor-engine/reducer.ts` — `createEditorReducer` +
  `createBlockInstance`.
- `editor-engine/history.ts` — `createHistoryReducer` (50-step
  cap, 600 ms typing coalesce contract).
- `editor-engine/validation.ts` — `lintFieldValue` /
  `isFieldHidden` / `groupVisibleFields` /
  `deleteNeedsConfirmation` / `parseFieldInput` /
  `getFieldValue` / `isRecord`.
- `editor-engine/summary.ts` — `getRowSummary`.
- `editor-engine/candidates.ts` — `collectContainerCandidates`.
- `editor-engine/use-editor-state.ts` — composes reducer +
  history + dispatch coalescing + `onChange` effect into one
  React hook (`useEditorState`).

What stayed in `block-page-editor.tsx` (form-card UI layer):
all `SortableBlockItem` / `ChildrenArea` / `HierarchyMenu` /
`InsertSlot` / `BlockJsonDialog` / `PageJsonDialog` / etc.
components, plus the dnd-kit wiring. Phases 2 and 3 of the
refactor will continue extraction (shared dialogs / pickers /
etc., and finally the form-card UI itself).

The engine is **dnd-kit-free** by design — drag libraries live
in the form-editor layer and dispatch the actions in
`EditorAction`. An in-page editor can pick its own drag
mechanism (or none) and reuse the same hook.

External API unchanged: `BlockPageEditor` still exports from
the same path and `field-renderer.tsx`'s `LazyBlockPageEditor`
keeps loading via the same dynamic import.
