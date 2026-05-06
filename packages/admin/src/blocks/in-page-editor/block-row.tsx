"use client";

import { useRef, type Dispatch, type KeyboardEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/utils.js";

import { BlockActionsPopover } from "./block-actions-popover.js";
import { BlockBodyRenderer } from "./block-body-renderer.js";
import { BlockIcon } from "../shared/block-icon.js";
import { useContainerDropZone, useRowDrag, type DropSide } from "./dnd.js";

export interface BlockRowProps {
  block: NpBlockInstance;
  meta: NpBlockMetadata | undefined;
  availableBlocks: NpBlockMetadata[];
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  dispatch: Dispatch<EditorAction>;
  isFocused: boolean;
  selectedBlockId: string | null;
  onFocus: () => void;
  onSelectBlock: (id: string) => void;
  onAddBelow: () => void;
  /**
   * Reorder callback fired when a drop lands on this row. The
   * canvas owns the actual MOVE_WITHIN_PARENT dispatch so it can
   * compute the right `toId` from the side (above ↔ this row,
   * below ↔ this row's next sibling).
   */
  onReorder: (sourceId: string, side: DropSide) => void;
  /**
   * Parent block id. `null` for top-level rows in the canvas;
   * the container's id for nested children. Same-parent gating
   * for drag/drop reorder keys off this.
   */
  parentId: string | null;
  /** Nesting depth (0 for top-level). Used to bound recursion. */
  depth?: number;
}

/**
 * Single row in the Doc canvas. The hover-revealed left rail
 * surfaces a `+` (insert below), a grip (HTML5 drag handle), and
 * an actions popover trigger. The body comes from
 * `BlockBodyRenderer`, which switches over `meta.docBodyKind` to
 * render the right inline editor.
 *
 * Drag/drop is HTML5 native (see `dnd.ts`). The grip is the only
 * draggable element — dragging the row body would conflict with
 * text selection inside the auto-grow textarea. The whole row
 * acts as the drop target so the indicator anchors visually.
 */
export function BlockRow({
  block,
  meta,
  availableBlocks,
  definitions,
  dispatch,
  isFocused,
  selectedBlockId,
  onFocus,
  onSelectBlock,
  onAddBelow,
  onReorder,
  parentId,
  depth = 0,
}: BlockRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  const isContainer = Boolean(meta?.acceptsChildren);
  const children = isContainer ? (block.children ?? []) : null;

  const convertCandidates = availableBlocks.filter(
    (b) =>
      b.type !== block.type &&
      b.docBodyKind &&
      b.docBodyKind !== "complex" &&
      b.docBodyKind !== "image" &&
      b.docBodyKind !== "divider",
  );

  // Doc-friendly types ALSO honor the parent's `allowedChildTypes`
  // contract — the inline "Add into …" button shouldn't surface
  // types the reducer would reject. Empty / wildcard means accept
  // anything Doc-friendly.
  const childInsertCandidates = !isContainer
    ? []
    : availableBlocks.filter((b) => {
        if (!b.docBodyKind || b.docBodyKind === "complex") return false;
        const allowed = meta?.allowedChildTypes;
        if (!allowed || allowed.length === 0 || allowed.includes("*")) {
          return true;
        }
        return allowed.includes(b.type);
      });
  // Hide the inline insert button when the container is at its
  // maxChildren cap. The reducer would no-op silently otherwise —
  // the operator clicks "Add into …" and nothing happens. A
  // disabled button + tooltip is clearer than a hidden one for
  // wraparound cases (`undo` brings the cap back into reach).
  const atMaxChildren =
    typeof meta?.maxChildren === "number" && (children?.length ?? 0) >= meta.maxChildren;
  const childFallbackType = !atMaxChildren
    ? (childInsertCandidates.find((b) => b.type === "paragraph")?.type ??
      childInsertCandidates[0]?.type)
    : undefined;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Backspace on an empty body: delete the row (unless it's the
    // last surviving block). The reducer no-ops when the source
    // doesn't exist, so we don't need to guard the dispatch here.
    if (event.key === "Backspace" && isEffectivelyEmpty(block)) {
      const target = event.target as HTMLTextAreaElement;
      if (target.selectionStart === 0 && target.selectionEnd === 0) {
        event.preventDefault();
        dispatch({ type: "DELETE", id: block.id });
      }
    }
  };

  const drag = useRowDrag({
    blockId: block.id,
    parentId,
    onDrop: (sourceId, side) => onReorder(sourceId, side),
  });
  // Container drop-zone — only mounted when this row IS a
  // container. Accepts cross-parent drops by dispatching
  // MOVE_INTO; the reducer enforces cycle / contract guards.
  const containerDrop = useContainerDropZone({
    containerId: block.id,
    onDrop: (sourceId) =>
      dispatch({
        type: "MOVE_INTO",
        id: sourceId,
        targetParentId: block.id,
      }),
  });

  return (
    <div
      ref={rowRef}
      data-np-block-row={block.id}
      data-focused={isFocused ? "true" : undefined}
      data-dragover={drag.dropSide ?? undefined}
      tabIndex={-1}
      className={cn(
        "group/row relative flex items-start gap-1 rounded-md px-1 py-1 outline-none transition-colors",
        isFocused && "bg-neutral-100/50 dark:bg-neutral-900/40",
        drag.isDragging && "opacity-40",
      )}
      onFocusCapture={onFocus}
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
    >
      {/* Drop indicators — 2 px highlighted lines anchored above /
          below the row when a drag is hovering. The pseudo-element
          approach matches the design's BlockRow CSS. */}
      {drag.dropSide === "above" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-px left-7 right-1 h-0.5 rounded-full bg-primary"
        />
      ) : null}
      {drag.dropSide === "below" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-px left-7 right-1 h-0.5 rounded-full bg-primary"
        />
      ) : null}

      <div
        className={cn(
          "sticky top-16 flex h-6 w-7 shrink-0 items-center gap-0.5 pt-1.5 opacity-0 transition-opacity",
          "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          isFocused && "opacity-100",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground"
          aria-label="Add block below"
          onClick={onAddBelow}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <button
          type="button"
          aria-label="Drag to reorder"
          draggable={drag.draggable}
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <BlockActionsPopover
          blockId={block.id}
          blockType={block.type}
          dispatch={dispatch}
          convertCandidates={convertCandidates}
        />
      </div>
      <div className="min-w-0 flex-1 px-1 py-0.5">
        <BlockBodyRenderer
          block={block}
          meta={meta}
          dispatch={dispatch}
          onFocus={onFocus}
          onKeyDown={handleKeyDown}
        />
        {isContainer ? (
          <div
            className={cn(
              "mt-2 flex flex-col gap-1 rounded-lg border border-dashed p-2 transition-colors",
              containerDrop.isHovering
                ? "border-primary bg-primary/5"
                : "border-neutral-300 bg-neutral-50/40 dark:border-neutral-700 dark:bg-neutral-900/30",
            )}
            data-np-block-children={block.id}
            onDragOver={containerDrop.onDragOver}
            onDragLeave={containerDrop.onDragLeave}
            onDrop={containerDrop.onDrop}
          >
            {children && children.length > 0 ? (
              children.map((child) => (
                <BlockRow
                  key={child.id}
                  block={child}
                  meta={definitions.get(child.type)}
                  availableBlocks={availableBlocks}
                  definitions={definitions}
                  dispatch={dispatch}
                  isFocused={selectedBlockId === child.id}
                  selectedBlockId={selectedBlockId}
                  onFocus={() => onSelectBlock(child.id)}
                  onSelectBlock={onSelectBlock}
                  parentId={block.id}
                  onAddBelow={() => {
                    if (!childFallbackType) return;
                    dispatch({
                      type: "INSERT_AFTER",
                      targetId: child.id,
                      blockType: childFallbackType,
                    });
                  }}
                  onReorder={(sourceId, side) => {
                    // Same-parent reorder inside a container.
                    const targetIndex = (children ?? []).findIndex((c) => c.id === child.id);
                    if (targetIndex === -1) return;
                    const next = (children ?? [])[targetIndex + 1]?.id;
                    const toId = side === "above" ? child.id : (next ?? child.id);
                    dispatch({
                      type: "MOVE_WITHIN_PARENT",
                      parentId: block.id,
                      fromId: sourceId,
                      toId,
                    });
                  }}
                  depth={depth + 1}
                />
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Empty container.</p>
            )}
            {childFallbackType ? (
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: "ADD",
                    blockType: childFallbackType,
                    parentId: block.id,
                  })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 self-start rounded-md border border-dashed border-neutral-300 bg-transparent px-2 py-1 text-[11px] text-muted-foreground transition-colors",
                  "hover:border-neutral-400 hover:text-foreground dark:border-neutral-700",
                )}
              >
                <Plus className="h-3 w-3" />
                Add into {meta?.label ?? block.type}
              </button>
            ) : atMaxChildren ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {meta?.label ?? block.type} caps at{" "}
                <strong className="font-semibold text-foreground">{meta?.maxChildren}</strong>{" "}
                children.
              </p>
            ) : (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                <BlockIcon
                  icon={meta?.icon}
                  kind={meta?.iconKind}
                  sizeClassName="h-3 w-3"
                  className="mr-1 inline-flex"
                />
                No Doc-friendly child types — switch to Page builder to add nested blocks.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isEffectivelyEmpty(block: NpBlockInstance): boolean {
  const text = block.props.text;
  if (typeof text === "string") return text.length === 0;
  const items = block.props.items;
  if (Array.isArray(items)) {
    return items.length === 0 || (items.length === 1 && items[0] === "");
  }
  return false;
}
