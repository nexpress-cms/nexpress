---
"@nexpress/admin": patch
---

Page builder — refactor self-review fixes (#467).

Two issues found during the self-review of the
phase 1-3 refactor.

- **Engine no longer imports `@dnd-kit/sortable`.** The phase 1
  changeset claimed the engine was "dnd-kit-free by design,"
  but `editor-engine/reducer.ts` imported `arrayMove` from
  `@dnd-kit/sortable` for its `MOVE_WITHIN_PARENT` /
  `MOVE_UP` / `MOVE_DOWN` handlers. Replaces that with a tiny
  4-line `arrayMove` helper inside `editor-engine/tree.ts` so
  the dependency claim holds. An in-page editor that swaps
  drag libraries (or skips drag entirely) can now mount the
  engine without pulling dnd-kit through.
- **Consolidate duplicate import lines** in
  `form-editor/block-page-editor.tsx`. `findBlockInTreeFlat`
  was imported from `../editor-engine/index.js` on a separate
  line right after another `editor-engine` import block —
  artifact of the phase 3 extraction that didn't merge cleanly.
  Now a single combined import.

No semantic change. Bundle size unchanged (the engine wasn't
shipping its own copy of `arrayMove` either way; the in-engine
helper is the same 4 lines).
