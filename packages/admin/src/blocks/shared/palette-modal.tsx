"use client";

import { useState, type ReactNode } from "react";
import { Search, Star, X } from "lucide-react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { Button } from "../../ui/button.js";
import { Dialog, DialogContent, DialogTrigger } from "../../ui/dialog.js";
import { Input } from "../../ui/input.js";
import { cn } from "../../ui/utils.js";

import { BlockIcon } from "./block-icon.js";
import { useBlockPaletteSections } from "./use-block-palette-sections.js";

export interface PaletteModalProps {
  availableBlocks: NpBlockMetadata[];
  onAdd: (type: string) => void;
  /**
   * Optional. When provided, renders the modal as a controlled
   * surface (no built-in trigger). Used by the orchestrator's
   * sticky toolbar / slash-menu for keyboard-driven opening.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional. When provided, the modal renders this trigger
   * inside `<DialogTrigger asChild>` and mounts as an
   * uncontrolled surface. Mutually exclusive with `open`.
   */
  trigger?: ReactNode;
  /** Optional aria-label for the modal panel. */
  ariaLabel?: string;
}

/**
 * Categorized full-modal block picker. Replaces the legacy popover
 * (`BlockPalette`) with the design's centered Dialog layout: a
 * larger search input, two-column card grid per section, source +
 * container badges in each card, and ESC / outside-click close.
 *
 * Both views (form-card + in-page Doc) mount this; the legacy
 * `BlockPalette` shell is now a thin wrapper around it preserved
 * for plugin authors who imported it directly.
 */
export function PaletteModal({
  availableBlocks,
  onAdd,
  open: controlledOpen,
  onOpenChange,
  trigger,
  ariaLabel = "Add block",
}: PaletteModalProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const [query, setQuery] = useState("");

  // Reset the query whenever the modal opens — operators rarely
  // want to resume a stale filter from a prior session.
  const handleOpenChange = (next: boolean) => {
    if (next && !open) setQuery("");
    setOpen(next);
  };

  const { filteredSections, favorites, toggleFavorite, pushRecent } = useBlockPaletteSections({
    availableBlocks,
    query,
    open,
  });

  const handlePick = (block: NpBlockMetadata) => {
    onAdd(block.type);
    pushRecent(block.type);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        aria-label={ariaLabel}
        className="grid min-w-0 max-h-[calc(100dvh-2rem)] max-w-[46rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
      >
        <div className="flex min-w-0 items-center gap-2 border-b border-neutral-200/80 px-3.5 py-2.5 dark:border-neutral-800/80">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search blocks · type, category, keyword…"
            autoFocus
            className="h-10 min-w-0 border-0 px-0 shadow-none focus-visible:ring-0 sm:h-8"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close palette"
            className="shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto px-3 py-2.5">
          {filteredSections.length === 0 ? (
            <div className="px-2 py-12 text-center text-sm text-muted-foreground">
              No blocks match.
            </div>
          ) : (
            filteredSections.map((section, sectionIndex) => (
              <div key={section.category} className={cn("min-w-0", sectionIndex > 0 && "mt-4")}>
                <div className="break-all px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {section.category}
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {section.items.map((block) => (
                    <PaletteCard
                      key={`${section.category}-${block.type}`}
                      block={block}
                      isFavorite={favorites.has(block.type)}
                      onPick={() => handlePick(block)}
                      onToggleFavorite={() => toggleFavorite(block.type)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-200/80 px-3.5 py-2 text-[11px] text-muted-foreground dark:border-neutral-800/80">
          <span className="min-w-0 break-words">
            <strong className="font-semibold text-foreground">{availableBlocks.length}</strong>{" "}
            blocks · shared registry
          </span>
          <span className="hidden sm:inline">↑↓ navigate · ↵ insert · esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PaletteCardProps {
  block: NpBlockMetadata;
  isFavorite: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
}

function PaletteCard({ block, isFavorite, onPick, onToggleFavorite }: PaletteCardProps) {
  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-1 rounded-lg border border-neutral-200/80 bg-background p-2.5 transition-colors",
        "hover:border-primary/40 hover:bg-accent focus-within:border-primary/40 dark:border-neutral-800/80",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={isFavorite ? `Unpin ${block.label}` : `Pin ${block.label}`}
        aria-pressed={isFavorite}
        className={cn(
          "absolute right-1.5 top-1.5 z-10 inline-flex size-10 items-center justify-center rounded text-muted-foreground transition sm:size-6",
          "hover:bg-accent hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          isFavorite
            ? "text-amber-500"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current")} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onPick}
        className="flex min-w-0 flex-col gap-1 text-left focus-visible:outline-none"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 pr-7">
          <BlockIcon icon={block.icon} kind={block.iconKind} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 break-words text-sm font-semibold">{block.label}</span>
          {block.source && block.source !== "built-in" ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                block.source === "plugin"
                  ? "bg-primary/10 text-primary"
                  : block.source === "theme"
                    ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                    : "bg-muted text-muted-foreground",
              )}
              aria-label={`${block.source} block`}
            >
              {block.source}
            </span>
          ) : null}
          {block.acceptsChildren ? (
            <span
              className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300"
              aria-label="Container block"
            >
              container
            </span>
          ) : null}
        </div>
        {block.description ? (
          <p className="line-clamp-2 break-words text-xs text-muted-foreground">
            {block.description}
          </p>
        ) : null}
        <span className="mt-auto break-all pt-0.5 font-mono text-[10px] text-muted-foreground/70">
          {block.type}
        </span>
      </button>
    </div>
  );
}
