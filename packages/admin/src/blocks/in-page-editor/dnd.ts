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
let activeDragSource: { sourceId: string; parentId: string | null } | null = null;

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
/**
 * Container drop-zone handlers — wires `MOVE_INTO` for the
 * cross-parent case. Mounted on a container's children area;
 * accepts drops from blocks whose parent ISN'T this container,
 * dispatches `MOVE_INTO` to append the source as the container's
 * last child. Same-parent drops fall through to the per-row
 * handlers (which dispatch `MOVE_WITHIN_PARENT`).
 *
 * Combined with `useRowDrag`'s same-parent gate, this covers both
 * v1 reorder paths without overlap: `useRowDrag` shows the
 * above/below indicator on rows whose parent matches the source's
 * parent; `useContainerDropZone` shows a "drop into" highlight on
 * containers whose id isn't the source's parent.
 */
export interface ContainerDropZoneHandlers {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  /** True when a cross-parent drag is currently hovering this zone. */
  isHovering: boolean;
}

interface UseContainerDropZoneOptions {
  /** The container block id this zone belongs to. */
  containerId: string;
  /** Called on drop with the source row id. */
  onDrop: (sourceId: string) => void;
}

export function useContainerDropZone({
  containerId,
  onDrop,
}: UseContainerDropZoneOptions): ContainerDropZoneHandlers {
  const [isHovering, setIsHovering] = useState(false);
  return {
    onDragOver: (event) => {
      const types = Array.from(event.dataTransfer.types);
      if (!types.includes(MIME)) return;
      // Only highlight when the drag source comes from a DIFFERENT
      // parent — otherwise the row-level handlers cover the
      // reorder path and we'd double-handle the drop.
      if (!activeDragSource || activeDragSource.parentId === containerId) {
        return;
      }
      // Reject self-into-self (dragging the container onto its
      // own children area would orphan the container's tree
      // inside itself — the reducer rejects this anyway, but we
      // shouldn't show an indicator for it either).
      if (activeDragSource.sourceId === containerId) return;
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setIsHovering(true);
    },
    onDragLeave: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) {
        return;
      }
      setIsHovering(false);
    },
    onDrop: (event) => {
      const sourceId = event.dataTransfer.getData(MIME);
      setIsHovering(false);
      if (!sourceId || sourceId === containerId) return;
      // The reducer's `MOVE_INTO` handles cycle prevention
      // (descendant target) + parent contract (allowedChildTypes /
      // maxChildren) — we just dispatch and trust those gates.
      event.stopPropagation();
      event.preventDefault();
      onDrop(sourceId);
    },
    isHovering,
  };
}

export function useRowDrag({ blockId, parentId, onDrop }: UseRowDragOptions): RowDragHandlers {
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
      const side: DropSide = event.clientY - rect.top < rect.height / 2 ? "above" : "below";
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
