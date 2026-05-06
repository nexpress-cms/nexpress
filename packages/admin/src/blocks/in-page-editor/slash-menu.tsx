"use client";

import { useEffect, useMemo, useState } from "react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { BlockIcon } from "../shared/block-icon.js";
import { matchesQuery } from "../shared/use-block-palette-sections.js";
import { cn } from "../../ui/utils.js";

export interface SlashMenuPosition {
  /** Pixel position, relative to the editor section. */
  x: number;
  y: number;
}

export interface SlashMenuProps {
  /** Doc-friendly blocks (excluding `complex` / containers). */
  blocks: NpBlockMetadata[];
  query: string;
  position: SlashMenuPosition;
  onPick: (type: string) => void;
  onClose: () => void;
}

/**
 * Caret-anchored block-type picker. Opens when an operator types
 * `/` at the start of an empty atom body, OR when they click the
 * row rail's `+` button. Filters across `label / type / category /
 * keywords` via the same `matchesQuery` helper the palette uses.
 *
 * Keyboard navigation: ↑/↓ to move, ⏎ to insert, Esc to close.
 * The orchestrator owns the trigger DOM (intercepting `/` from a
 * textarea) and the dispatch — this component is presentation +
 * keyboard nav only.
 */
export function SlashMenu({ blocks, query, position, onPick, onClose }: SlashMenuProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter((b) => matchesQuery(b, q));
  }, [blocks, query]);

  const [active, setActive] = useState(0);
  // Reset highlight whenever the filter list shrinks/grows.
  useEffect(() => {
    setActive(0);
  }, [query, filtered.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((a) => (a + 1) % Math.max(1, filtered.length));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((a) => (a - 1 + filtered.length) % Math.max(1, filtered.length));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const pick = filtered[active];
        if (pick) onPick(pick.type);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, active, onPick, onClose]);

  if (filtered.length === 0) {
    return (
      <div
        role="dialog"
        aria-label="Insert block"
        style={{ left: position.x, top: position.y }}
        className="absolute z-30 w-60 rounded-lg border border-neutral-200/80 bg-white p-3 text-xs text-muted-foreground shadow-lg dark:border-neutral-800/80 dark:bg-neutral-950"
        onMouseDown={(e) => e.preventDefault()}
      >
        No block matches “{query}”.
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Insert block"
      style={{ left: position.x, top: position.y }}
      className="absolute z-30 max-h-72 w-60 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white p-1 shadow-lg dark:border-neutral-800/80 dark:bg-neutral-950"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Insert block
      </div>
      {filtered.map((block, i) => (
        <button
          key={block.type}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(block.type)}
          className={cn(
            "grid w-full grid-cols-[20px_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
            i === active ? "bg-accent" : "hover:bg-accent/60",
          )}
        >
          <BlockIcon
            icon={block.icon}
            kind={block.iconKind}
            sizeClassName="h-3.5 w-3.5"
            className="text-muted-foreground"
          />
          <span className="truncate font-medium text-foreground">{block.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{block.type}</span>
        </button>
      ))}
    </div>
  );
}
