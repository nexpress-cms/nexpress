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
    <div className="group/slot relative -my-1.5 flex h-4 items-center justify-center">
      {/* Hairline that fades in alongside the button so the slot
          reads as a real insertion point (not just a floating "+").
          Stays invisible until hover/focus/open so resting rows
          aren't crowded by separator lines between every card. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover/slot:opacity-100 group-focus-within/slot:opacity-100"
      />
      <BlockPalette
        availableBlocks={availableBlocks}
        onAdd={onInsert}
        trigger={
          <button
            type="button"
            aria-label={ariaLabel ?? "Insert block here"}
            className="relative inline-flex h-6 items-center gap-1 rounded-full border border-border/60 bg-background px-2 text-[11px] font-medium text-muted-foreground opacity-0 shadow-sm transition hover:border-primary/60 hover:text-primary focus-visible:opacity-100 group-hover/slot:opacity-100 data-[state=open]:opacity-100"
          >
            <Plus className="h-3 w-3" />
            Insert
          </button>
        }
      />
    </div>
  );
}
