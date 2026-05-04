"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Search } from "lucide-react";
import type { NxBlockMetadata } from "@nexpress/blocks";

import { Input } from "../ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { cn } from "../ui/utils.js";

interface BlockPaletteProps {
  availableBlocks: NxBlockMetadata[];
  onAdd: (type: string) => void;
  trigger: ReactElement;
}

// Tiny popover-anchored block picker. The trigger is provided by
// the editor (so the host controls placement / styling — the
// "Add block" button between rows or a sticky end-of-list CTA).
// Selecting a block adds it via `onAdd` and closes the popover.
export function BlockPalette({ availableBlocks, onAdd, trigger }: BlockPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Reset the search filter on close so reopening shows the full
  // list again — operators rarely want to resume a stale filter.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableBlocks;
    return availableBlocks.filter(
      (block) =>
        block.label.toLowerCase().includes(q) ||
        block.type.toLowerCase().includes(q) ||
        (block.description ?? "").toLowerCase().includes(q),
    );
  }, [availableBlocks, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[28rem] p-0" align="center">
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search blocks…"
              autoFocus
              className="h-8 pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              No blocks match.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((block) => (
                <button
                  key={block.type}
                  type="button"
                  onClick={() => {
                    onAdd(block.type);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border border-border/60 bg-background p-3 text-left transition-colors",
                    "hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {block.icon ? (
                      <span aria-hidden="true" className="text-base leading-none">
                        {block.icon}
                      </span>
                    ) : null}
                    <span className="text-sm font-semibold">{block.label}</span>
                  </div>
                  {block.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {block.description}
                    </p>
                  ) : null}
                  <span className="mt-auto font-mono text-[10px] text-muted-foreground/70">
                    {block.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
