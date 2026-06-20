/**
 * Form-card page-builder editor — the row-card layout that ships
 * today. Mounts the engine state (`useEditorState`) and renders
 * each block as a draggable card.
 *
 * The orchestrator (`BlockPageEditor`) is the entry point host
 * apps mount via `field-renderer.tsx`'s `LazyBlockPageEditor`.
 * Other components in this directory are internal to the form
 * layout — they hard-assume row-card UI (sortable card, header
 * action bar, inline children area).
 *
 * Document view lives in the sibling `in-page-editor/` directory.
 * The orchestrator here owns the shared engine state and chooses
 * between the form-card layout and the server-rendered preview
 * canvas.
 */

export { BlockPageEditor } from "./block-page-editor.js";
