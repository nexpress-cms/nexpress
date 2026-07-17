import { useCallback, useRef, useState, type Dispatch } from "react";

import type { EditorAction } from "../editor-engine/index.js";

import type { OverlayPosition, ResolvedBlockHit } from "./iframe-coords.js";

export type DragSide = "before" | "after";

export interface DocCanvasDragState {
  /** Id of the block currently being dragged, null when idle. */
  draggingId: string | null;
  /** Id of the block under cursor as a drop target, null when none. */
  dragOverId: string | null;
  /** Drop target rect projected into the canvas container. */
  dragOverRect: OverlayPosition | null;
  /** Which side of the target the drop will land — see reducer. */
  dragSide: DragSide;
}

export interface UseDocCanvasDragOptions {
  /** Engine dispatch — receives a MOVE_WITHIN_PARENT on mouseup. */
  dispatch: Dispatch<EditorAction>;
  /** Set of ids that may participate (top-level only in v1). */
  topLevelIds: ReadonlySet<string>;
  /** Resolve a parent-doc point to a block hit inside the iframe. */
  resolveHit: (clientX: number, clientY: number) => ResolvedBlockHit | null;
  /** Project a block's iframe rect into the container's coord space. */
  projectIntoContainer: (blockRect: DOMRect, iframeRect: DOMRect) => OverlayPosition | null;
  /**
   * Optional hook fired right when drag starts — typical use is
   * to release the hover pin so the rail unmounts cleanly behind
   * the drag shield.
   */
  onDragStart?: () => void;
}

export interface UseDocCanvasDragResult extends DocCanvasDragState {
  /** Spread onto the grip button's `onMouseDown`. Reads block id
   *  from the element's `data-block-id` attribute. */
  onGripMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** True while a drag is in flight — render the shield. */
  isDragging: boolean;
}

/**
 * Drag-reorder state machine for the Doc canvas. Lifted out of
 * `doc-canvas.tsx` so the canvas body owns React state + JSX
 * only; this hook owns the cross-frame mouse handling.
 *
 * Mechanics:
 *
 *   1. Mousedown on a grip button captures `data-block-id`,
 *      stores it as the source, sets `draggingId`. The canvas
 *      mounts a transparent shield over the iframe; that shield
 *      is the only reason mousemove + mouseup events fire in the
 *      parent doc (the iframe wouldn't bubble them out).
 *   2. Window mousemove (captured) resolves the cursor to a
 *      block hit, picks `side` from cursor vs target midpoint,
 *      and updates the drop-target state for the indicator.
 *   3. Window mouseup commits — dispatches `MOVE_WITHIN_PARENT`
 *      with `side` so the reducer adjusts the toIndex. Esc
 *      cancels mid-drag without dispatching.
 *
 * Top-level only in v1: cross-container moves still live in
 * Page builder.
 */
export function useDocCanvasDrag({
  dispatch,
  topLevelIds,
  resolveHit,
  projectIntoContainer,
  onDragStart,
}: UseDocCanvasDragOptions): UseDocCanvasDragResult {
  const dragSourceRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const dragSideRef = useRef<DragSide>("before");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverRect, setDragOverRect] = useState<OverlayPosition | null>(null);
  const [dragSide, setDragSide] = useState<DragSide>("before");

  const onGripMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = event.currentTarget.dataset.blockId;
      if (!id || !topLevelIds.has(id)) return;
      event.preventDefault();
      event.stopPropagation();
      dragSourceRef.current = id;
      setDraggingId(id);
      onDragStart?.();

      const onShieldMove = (e: MouseEvent) => {
        const hit = resolveHit(e.clientX, e.clientY);
        if (!hit || !topLevelIds.has(hit.id)) {
          dragOverIdRef.current = null;
          setDragOverId(null);
          setDragOverRect(null);
          return;
        }
        // Pick the drop side from the cursor's vertical position
        // relative to the target's midpoint. Top half → "before",
        // bottom half → "after". The reducer adjusts the toIndex
        // accordingly so the visual indicator matches the outcome
        // regardless of drag direction.
        const midpointY = hit.iframeRect.top + hit.rect.top + hit.rect.height / 2;
        const side: DragSide = e.clientY < midpointY ? "before" : "after";
        dragOverIdRef.current = hit.id;
        dragSideRef.current = side;
        setDragOverId(hit.id);
        setDragSide(side);
        const projected = projectIntoContainer(hit.rect, hit.iframeRect);
        if (projected) setDragOverRect(projected);
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onShieldMove, true);
        window.removeEventListener("mouseup", onShieldUp, true);
        window.removeEventListener("keydown", onEscape, true);
        dragSourceRef.current = null;
        dragOverIdRef.current = null;
        setDraggingId(null);
        setDragOverId(null);
        setDragOverRect(null);
      };
      const onShieldUp = () => {
        const source = dragSourceRef.current;
        const target = dragOverIdRef.current;
        const side = dragSideRef.current;
        cleanup();
        if (source && target && source !== target) {
          dispatch({
            type: "MOVE_WITHIN_PARENT",
            parentId: null,
            fromId: source,
            toId: target,
            side,
          });
        }
      };
      const onEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") cleanup();
      };

      window.addEventListener("mousemove", onShieldMove, true);
      window.addEventListener("mouseup", onShieldUp, true);
      window.addEventListener("keydown", onEscape, true);
    },
    [dispatch, topLevelIds, resolveHit, projectIntoContainer, onDragStart],
  );

  return {
    draggingId,
    dragOverId,
    dragOverRect,
    dragSide,
    onGripMouseDown,
    isDragging: draggingId !== null,
  };
}
