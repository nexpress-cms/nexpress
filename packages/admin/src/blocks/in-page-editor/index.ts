/**
 * In-page editor — the Doc view of the page-builder. Sits beside
 * the form-card row layout (`form-editor/`) under one orchestrator:
 * same `useEditorState`, same `availableBlocks`, same
 * `NpBlockInstance[]` tree.
 *
 * Doc view renders blocks via the server-side preview pipeline
 * (`/api/admin/preview-blocks`) inside an iframe — operators see
 * the page exactly as it would appear on the public site (theme
 * CSS + plugin blocks resolved). Hovering a block surfaces a
 * settings / delete control overlay; clicking settings opens a
 * props-schema-driven dialog. Block insertion routes through the
 * shared `<PaletteModal>` Page builder uses — same picker, same
 * dispatch flow.
 */

export { DocCanvas, type DocCanvasProps } from "./doc-canvas.js";
export {
  BlockSettingsDialog,
  type BlockSettingsDialogProps,
} from "./block-settings-dialog.js";
