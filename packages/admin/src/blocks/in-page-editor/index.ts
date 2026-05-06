/**
 * In-page editor — the Notion-style canvas (Doc view) of the
 * page-builder. Sits beside the form-card row layout
 * (`form-editor/`) under one orchestrator: same `useEditorState`,
 * same `availableBlocks`, same `NpBlockInstance[]` tree.
 *
 * The orchestrator routes between Doc and Page views via the
 * shared `<ModeSwitch>`. Doc view dispatches engine actions for
 * structural changes; the view is essentially an alternate
 * row-render surface for the same data.
 */

export { DocCanvas, type DocCanvasProps } from "./doc-canvas.js";
export { BlockRow, type BlockRowProps } from "./block-row.js";
export { BlockBodyRenderer, type BlockBodyRendererProps } from "./block-body-renderer.js";
export { BlockActionsPopover } from "./block-actions-popover.js";
export { EditorToolbar, type EditorToolbarProps } from "./editor-toolbar.js";
export { SlashMenu, type SlashMenuProps, type SlashMenuPosition } from "./slash-menu.js";
export { AutoGrowTextarea, type AutoGrowTextareaProps } from "./auto-grow-textarea.js";
export {
  useContainerDropZone,
  useRowDrag,
  type ContainerDropZoneHandlers,
  type DropSide,
  type RowDragHandlers,
} from "./dnd.js";
