"use client";

import { useState, type DragEvent } from "react";

/**
 * HTML5 native drag/drop helpers for the in-page Doc canvas. Doc
 * rows are top-level only in v1, so the simple top/bottom drop
 * indicator + same-parent reorder semantics dnd-kit gives us is
 * overkill — `draggable` + `dragover` clientY positioning is
 * enough.
 *
 * The hook returns a position string (`"above"` / `"below"` /
 * `null`) the row's render uses to draw the 2-px highlighted line.
 * `dataTransfer` carries the dragged block id so dropping decides
 * which row moves.
 */

export type DropSide = "above" | "below" | null;

/** dataTransfer mime so other drop targets ignore our payload. */
const MIME = "application/x-np-block-row";

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
  /** Called when a drop lands on this row. */
  onDrop: (sourceId: string, side: DropSide) => void;
}

/**
 * Wires the drag-source + drop-target events for a single row.
 * Both ends live on the same element — the drag handle (the rail's
 * grip) calls `event.dataTransfer.setData()` via the row's
 * `onDragStart`; any other row's `onDragOver` reads the same data.
 */
export function useRowDrag({ blockId, onDrop }: UseRowDragOptions): RowDragHandlers {
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
      setIsDragging(true);
    },
    onDragEnd: () => {
      setIsDragging(false);
      setDropSide(null);
    },
    onDragOver: (event) => {
      // Only respond to drags carrying our row mime — protects
      // against arbitrary file / text drops landing on the canvas.
      const types = Array.from(event.dataTransfer.types);
      if (!types.includes(MIME)) return;
      // Reject self-on-self drops up front so the indicator doesn't
      // flicker on the source row during a hover-over-self drag.
      // dataTransfer.getData() returns "" during dragover (security
      // restriction), so we can't compare ids — the indicator just
      // doesn't anchor on a row that's already mid-drag.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const side: DropSide =
        event.clientY - rect.top < rect.height / 2 ? "above" : "below";
      setDropSide(side);
    },
    onDragLeave: () => {
      setDropSide(null);
    },
    onDrop: (event) => {
      const sourceId = event.dataTransfer.getData(MIME);
      const side = dropSide;
      setDropSide(null);
      setIsDragging(false);
      if (!sourceId || sourceId === blockId || side === null) return;
      event.preventDefault();
      onDrop(sourceId, side);
    },
    dropSide,
    isDragging,
  };
}
