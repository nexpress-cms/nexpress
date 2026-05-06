/**
 * Page-builder editor engine — UI-agnostic state machine shared
 * by the form-card editor (today) and the in-page editor
 * (planned). The contract between engine and UI is this module's
 * export surface plus the `EditorAction` union.
 *
 * No DOM, no React (except the `useEditorState` hook which is
 * deliberately limited to state composition), no dnd-kit. Drag
 * libraries live in the form-editor layer and dispatch the
 * actions defined here.
 */

export type {
  ContainerCandidate,
  EditorAction,
  FieldGroupSection,
  HistoryAction,
  HistoryState,
} from "./types.js";

export {
  cloneBlockDeep,
  createBlockId,
  detachBlock,
  filterTree,
  findBlockInTreeFlat,
  isDescendantOf,
  locateBlock,
  mapTree,
  updateContainerChildren,
} from "./tree.js";

export { canAcceptChild } from "./contracts.js";

export { createBlockInstance, createEditorReducer } from "./reducer.js";

export { createHistoryReducer } from "./history.js";

export {
  deleteNeedsConfirmation,
  getFieldValue,
  groupVisibleFields,
  isFieldHidden,
  isRecord,
  lintFieldValue,
  parseFieldInput,
} from "./validation.js";

export { getRowSummary } from "./summary.js";

export { collectContainerCandidates } from "./candidates.js";

export { useEditorState } from "./use-editor-state.js";
export type { EditorState, UseEditorStateOptions } from "./use-editor-state.js";
