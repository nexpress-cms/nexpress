"use client";

import { useState, type DragEvent } from "react";

/**
 * HTML5 native drag/drop helpers for the in-page Doc canvas. Doc
 * rows reorder same-parent only in v1 — top-level rows reorder
 * within the doc, container children reorder within their
 * container. Cross-parent drops are filtered visually so the
 * operator never gets a "drop accepted but tree didn't change"
 * silent failure.
 *
 * The hook returns a position string (`"above"` / `"below"` /
 * `null`) the row's render uses to draw the 2-px highlighted line.
 * `dataTransfer` carries the dragged block id; a module-scoped
 * ref carries the source's parent id so drop targets can gate on
 * same-parent (the dataTransfer payload is read-restricted during
 * dragover by the spec, so we can't compare ids that way).
 */

export type DropSide = "above" | "below" | null;

/** dataTransfer mime so other drop targets ignore our payload. */
const MIME = "application/x-np-block-row";

/**
 * Module-scoped pointer to the row currently being dragged. HTML5
 * drag is single-pointer so a module-level slot is safe — only one
 * useRowDrag instance can be the source at a time. Drop targets
 * read this in onDragOver to filter cross-parent drops.
 *
 * Cleared on dragEnd so a subsequent drag starts clean. Null when
 * no drag is in flight.
 */
let activeDragSource: { sourceId: string; parentId: string | null } | null =
  null;

export interface RowDragHandlers {
  /** Spread on the row element to make it `draggable`. */
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  /** Computed by `onDragOver` — `null` outside a drag, otherwise the side. */
  dropSide: DropSide;
  /** True while THIS row is the source of the active drag. */
  isDragging: boolean;
}

interface UseRowDragOptions {
  blockId: string;
  /**
   * Parent block id. `null` for top-level rows. Used to gate
   * cross-parent drops — a row whose parent doesn't match the
   * active drag source's parent doesn't show an indicator.
   */
  parentId: string | null;
  /** Called when a drop lands on this row. */
  onDrop: (sourceId: string, side: DropSide) => void;
}

/**
 * Wires the drag-source + drop-target events for a single row.
 * Both ends live on the same element — the drag handle (the rail's
 * grip) calls `event.dataTransfer.setData()` via the row's
 * `onDragStart`; any other row's `onDragOver` reads the same data.
 */
export function useRowDrag({
  blockId,
  parentId,
  onDrop,
}: UseRowDragOptions): RowDragHandlers {
  const [dropSide, setDropSide] = useState<DropSide>(null);
  const [isDragging, setIsDragging] = useState(false);

  return {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(MIME, blockId);
      // Also set a text/plain payload so a drop into a non-aware
      // target degrades gracefully (the drop is rejected because
      // the source id isn't a row id, but the drag itself shows a
      // valid cursor instead of "no entry").
      event.dataTransfer.setData("text/plain", blockId);
      activeDragSource = { sourceId: blockId, parentId };
      setIsDragging(true);
    },
    onDragEnd: () => {
      activeDragSource = null;
      setIsDragging(false);
      setDropSide(null);
    },
    onDragOver: (event) => {
      // Only respond to drags carrying our row mime — protects
      // against arbitrary file / text drops landing on the canvas.
      const types = Array.from(event.dataTransfer.types);
      if (!types.includes(MIME)) return;
      // Suppress the indicator on the row that's currently being
      // dragged (would visually claim "drop here" on the source).
      // dataTransfer.getData() is restricted during dragover, so
      // we can't compare ids — the source's local `isDragging`
      // flag is the right signal.
      if (isDragging) return;
      // Cross-parent drops aren't supported in v1. Filter visually
      // so the operator never sees an indicator that the reducer
      // would silently reject. activeDragSource is set by the
      // source row's `onDragStart` and cleared on `onDragEnd`.
      if (activeDragSource && activeDragSource.parentId !== parentId) {
        return;
      }
      // Stop the event from bubbling to a parent row's handler
      // (relevant when a sibling drags over a child row inside a
      // container — without this both rows would set `dropSide`).
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const side: DropSide =
        event.clientY - rect.top < rect.height / 2 ? "above" : "below";
      setDropSide(side);
    },
    onDragLeave: (event) => {
      // Skip dragleave events fired when the cursor moves between
      // child elements of the same row — `relatedTarget` is the
      // node the pointer entered next, so if it's still inside the
      // row we treat the leave as spurious. Without this guard
      // the indicator flickers off → on every time the cursor
      // crosses an internal element boundary.
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) {
        return;
      }
      setDropSide(null);
    },
    onDrop: (event) => {
      const sourceId = event.dataTransfer.getData(MIME);
      const side = dropSide;
      setDropSide(null);
      setIsDragging(false);
      if (!sourceId || sourceId === blockId || side === null) return;
      event.stopPropagation();
      event.preventDefault();
      onDrop(sourceId, side);
    },
    dropSide,
    isDragging,
  };
}
