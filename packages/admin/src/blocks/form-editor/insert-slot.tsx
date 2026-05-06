"use client";

import { Plus } from "lucide-react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { BlockPalette } from "../block-palette.js";

/**
 * Thin gap between rows that surfaces a "+" button on hover/focus.
 * The button opens the standard `BlockPalette` popover; picking a
 * block type fires `onInsert(type)` so the parent can dispatch the
 * right INSERT_BEFORE / INSERT_AFTER action with the right target.
 *
 * Form-editor specific: the slot's vertical spacing assumes the
 * row-card layout. An in-page editor would surface "insert" via a
 * different affordance (drop zones, hover toolbar, etc.) and not
 * reuse this component.
 */

export interface InsertSlotProps {
  availableBlocks: NpBlockMetadata[];
  onInsert: (blockType: string) => void;
  ariaLabel?: string;
}

export function InsertSlot({
  availableBlocks,
  onInsert,
  ariaLabel,
}: InsertSlotProps) {
  return (
    <div className="group/slot relative -my-1 flex h-3 items-center justify-center">
      <BlockPalette
        availableBlocks={availableBlocks}
        onAdd={onInsert}
        trigger={
          <button
            type="button"
            aria-label={ariaLabel ?? "Insert block here"}
            className="invisible inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground shadow-sm transition hover:border-primary/60 hover:text-primary group-hover/slot:visible focus-visible:visible data-[state=open]:visible"
          >
            <Plus className="h-3 w-3" />
          </button>
        }
      />
    </div>
  );
}
