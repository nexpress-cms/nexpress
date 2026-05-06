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
 * In-page editor work (planned): a sibling `in-page-editor/`
 * directory will expose its own entry point that mounts the same
 * `useEditorState` hook + the same shared/ widgets but with a
 * different row-render surface.
 */

export { BlockPageEditor } from "./block-page-editor.js";
