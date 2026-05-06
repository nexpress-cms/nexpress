/**
 * Shared editor UI — components both the form-card editor and
 * the (future) in-page editor mount. Each component is layout-
 * agnostic and reads from / writes to the engine via the
 * `EditorAction` contract.
 *
 * What lives here:
 * - Field controls (`FieldControl`, `ArrayFieldControl`) — the
 *   props form widgets, switched by `field.type`.
 * - Media picker (`BlockImagePicker`) — library + upload + URL
 *   paste with broken-image fallback.
 * - JSON dialogs (`BlockJsonDialog`, `PageJsonDialog`) — hand-
 *   editing escape hatches with diff preview + import-as-new.
 * - Destructive confirm (`DeleteBlockDialog`) — only mounted
 *   when the row's delete would lose work.
 * - Command palette (`CommandMenu`) — Cmd-K substring picker for
 *   block / pattern / page actions.
 *
 * What stays in the form-editor layer (block-page-editor.tsx
 * for now): SortableBlockItem / ChildrenArea / HierarchyMenu /
 * InsertSlot / GridChildLayoutControl / DragPreview — all the
 * row-card UI that's specific to the form-card layout.
 */

export {
  ArrayFieldControl,
  normalizeArrayValue,
} from "./array-field-control.js";
export {
  BlockImagePicker,
  type BlockImagePickerProps,
} from "./block-image-picker.js";
export {
  BlockJsonDialog,
  type BlockJsonDialogProps,
} from "./block-json-dialog.js";
export {
  CommandMenu,
  type CommandMenuProps,
} from "./command-menu.js";
export {
  DeleteBlockDialog,
  type DeleteBlockDialogProps,
} from "./delete-block-dialog.js";
export { FieldControl, type FieldControlProps } from "./field-control.js";
export {
  PageJsonDialog,
  type PageJsonDialogProps,
} from "./page-json-dialog.js";
