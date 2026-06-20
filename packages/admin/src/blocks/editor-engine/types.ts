import type { NpBlockInstance } from "@nexpress/blocks";

import type { NpPattern } from "../patterns.js";

/**
 * Editor reducer action union. The full set of mutations the
 * page-builder reducer accepts. Drag-and-drop, command menu,
 * Cmd-K, and the row dropdown all funnel into this set — no
 * UI layer dispatches anything else.
 *
 * The engine is intentionally UI-agnostic. Any surface that adds
 * or edits blocks (form-card Page builder, Doc view, third-party
 * extension) just needs to dispatch one of these actions. dnd-kit
 * lives in the form-editor layer, not in the engine.
 */
export type EditorAction =
  | { type: "RESET"; blocks: NpBlockInstance[] }
  // Append a new block (top-level when `parentId` is omitted, into
  // the named container otherwise). Initial props default to the
  // definition's `defaultProps`; the optional `props` override
  // shallow-merges on top, used by surfaces that need to seed
  // content at insertion time (e.g. DocCanvas's plain-text → rich-
  // text shortcut, where the new block lands with its Lexical
  // body already populated).
  | {
      type: "ADD";
      blockType: string;
      parentId?: string;
      props?: Record<string, unknown>;
    }
  | {
      type: "INSERT_BEFORE";
      targetId: string;
      blockType: string;
      props?: Record<string, unknown>;
    }
  | {
      type: "INSERT_AFTER";
      targetId: string;
      blockType: string;
      props?: Record<string, unknown>;
    }
  | { type: "DELETE"; id: string }
  | { type: "DUPLICATE"; id: string }
  // Reorder a sibling pair within their shared parent.
  //
  // Without `side`, the reducer falls through to plain `arrayMove`
  // semantics (dnd-kit-style) — that's how the form-editor's drag
  // path has always wired it. The asymmetry is deliberate there:
  // dnd-kit's sortable already computes the adjusted target index.
  //
  // With `side`, the reducer interprets the drop as "land source
  // BEFORE target" or "land source AFTER target" regardless of
  // drag direction. The DocCanvas drag-shield uses this so its
  // top-edge / bottom-edge drop indicator matches the actual
  // outcome both forward and backward.
  | {
      type: "MOVE_WITHIN_PARENT";
      parentId: string | null;
      fromId: string;
      toId: string;
      side?: "before" | "after";
    }
  | { type: "MOVE_UP"; id: string }
  | { type: "MOVE_DOWN"; id: string }
  // Cross-hierarchy moves (#467 phase 4). All three preserve
  // children + props of the moved subtree; only its position
  // changes.
  // - MOVE_INTO: detach the block and append it as the last
  //   child of `targetParentId` (a container block). No-op when
  //   targetParentId == id (would orphan the block) or when
  //   the target is a descendant of `id` (would create a cycle).
  // - MOVE_OUT: detach the block from its current parent and
  //   place it immediately AFTER its parent in the grandparent's
  //   sibling list. No-op for top-level blocks (no grandparent).
  // - WRAP_IN: replace the block in place with a new container
  //   of `containerType` that has the block as its sole child.
  //   Container's `defaultProps` apply.
  | { type: "MOVE_INTO"; id: string; targetParentId: string }
  | { type: "MOVE_OUT"; id: string }
  | { type: "WRAP_IN"; id: string; containerType: string }
  // Append a pattern's pre-shaped subtree to the top-level (or
  // into a container when `parentId` is supplied). All ids in
  // the pattern's blocks get regenerated so reuse never collides
  // with an existing row.
  | { type: "INSERT_PATTERN"; pattern: NpPattern; parentId?: string }
  // Bulk actions (#467 #3 — multi-select). All three accept a list
  // of ids; missing ids are skipped silently. WRAP_MANY additionally
  // requires every id to be a contiguous sibling under one parent —
  // wrapping a non-contiguous set or cross-container set would
  // either reorder the page or split the selection, so we reject
  // both up front.
  | { type: "DELETE_MANY"; ids: string[] }
  | { type: "DUPLICATE_MANY"; ids: string[] }
  | { type: "WRAP_MANY"; ids: string[]; containerType: string }
  | { type: "UPDATE_PROPS"; id: string; props: Record<string, unknown> }
  | { type: "REPLACE_PROPS"; id: string; props: Record<string, unknown> }
  // Replace a block's type in place. Retained for convert-type
  // affordances; the id stays the same so undo/redo lands the
  // operator on the same row.
  //
  // `preserveText` (default true): when both blocks expose a string-
  // shaped primary text prop (paragraph `text`, heading `text`, quote
  // `text`, code `code`, list `items[0]`), the value carries over so
  // an operator typing `/h1` mid-paragraph doesn't lose their prose.
  // No-op when the new type isn't registered, the id isn't found, or
  // when the parent's container contract rejects the new type.
  | {
      type: "REPLACE_TYPE";
      id: string;
      newType: string;
      preserveText?: boolean;
    };

/**
 * Snapshot stack for undo/redo. The history reducer holds the
 * current `present` plus walks of past + future snapshots, each
 * of which is a fully-formed `NpBlockInstance[]` (deep enough
 * to roll back to).
 */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  lastUpdate: { time: number; id: string } | null;
}

/**
 * Wrapper actions consumed by `createHistoryReducer`. The DO
 * action carries the inner editor action plus a `coalesce` flag
 * that lets the form layer collapse a typing burst into a single
 * undo step.
 */
export type HistoryAction =
  | { type: "DO"; action: EditorAction; now: number; coalesceWindowMs: number }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET_HISTORY"; blocks: NpBlockInstance[] };

/**
 * Container block surfaced as a `MOVE_INTO` candidate. Built by
 * `collectContainerCandidates` and consumed by the form-editor's
 * row-header dropdown + Cmd-K.
 */
export interface ContainerCandidate {
  id: string;
  label: string;
}

/**
 * Bucket used by `groupVisibleFields` — partitioning a block's
 * `propsSchema` by `group` while filtering `hiddenWhen`. The form
 * editor renders one section per bucket; Doc view's settings
 * dialog reads the same field model directly.
 */
export interface FieldGroupSection<TField> {
  group: string | null;
  fields: TField[];
}
