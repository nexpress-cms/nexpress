"use client";

import { useRef, type Dispatch, type KeyboardEvent } from "react";
import { Plus } from "lucide-react";
import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import type { EditorAction } from "../editor-engine/index.js";
import { Button } from "../../ui/button.js";
import { cn } from "../../ui/utils.js";

import { BlockActionsPopover } from "./block-actions-popover.js";
import { BlockBodyRenderer } from "./block-body-renderer.js";

export interface BlockRowProps {
  block: NpBlockInstance;
  meta: NpBlockMetadata | undefined;
  availableBlocks: NpBlockMetadata[];
  dispatch: Dispatch<EditorAction>;
  isFocused: boolean;
  onFocus: () => void;
  onAddBelow: () => void;
}

/**
 * Single row in the Doc canvas. The hover-revealed left rail
 * surfaces a `+` (insert below) and a grip (drag-handle + actions
 * popover trigger). The body comes from `BlockBodyRenderer`,
 * which switches over `meta.docBodyKind` to render the right
 * inline editor.
 *
 * Drag-and-drop reorder lands in a follow-up phase — for v1 the
 * grip just triggers the actions popover, with Move up / Move
 * down available there. The same row data attribute
 * (`data-np-block-row`) the form-card editor uses keeps the
 * orchestrator's keyboard nav + outline scroll-into-view working
 * across both views.
 */
export function BlockRow({
  block,
  meta,
  availableBlocks,
  dispatch,
  isFocused,
  onFocus,
  onAddBelow,
}: BlockRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  const convertCandidates = availableBlocks.filter(
    (b) =>
      b.type !== block.type &&
      b.docBodyKind &&
      b.docBodyKind !== "complex" &&
      b.docBodyKind !== "image" &&
      b.docBodyKind !== "divider",
  );

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

  return (
    <div
      ref={rowRef}
      data-np-block-row={block.id}
      data-focused={isFocused ? "true" : undefined}
      tabIndex={-1}
      className={cn(
        "group/row relative flex items-start gap-1 rounded-md px-1 py-1 outline-none transition-colors",
        isFocused && "bg-neutral-100/50 dark:bg-neutral-900/40",
      )}
      onFocusCapture={onFocus}
    >
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
