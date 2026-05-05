"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Search } from "lucide-react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { Input } from "../ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { cn } from "../ui/utils.js";

interface BlockPaletteProps {
  availableBlocks: NpBlockMetadata[];
  onAdd: (type: string) => void;
  trigger: ReactElement;
}

const RECENT_KEY = "np-page-builder.recent-blocks";
const RECENT_LIMIT = 5;

// Section order for the grouped palette. Built-in categories
// render first; "Plugin" + "Other" sit at the bottom so the
// operator-defined surface is closer to the top of the list.
const CATEGORY_ORDER = [
  "Recent",
  "Layout",
  "Content",
  "Media",
  "Commerce",
  "Community",
  "Plugin",
  "Other",
] as const;

interface PaletteSection {
  category: string;
  items: NpBlockMetadata[];
}

function categoryOf(block: NpBlockMetadata): string {
  if (block.category && block.category.trim().length > 0) return block.category;
  // Plugin contributions without an explicit category land in
  // "Plugin" (the bootstrap auto-tags `source: "plugin"` so this
  // is reliable). Anything else falls into "Other".
  if (block.source === "plugin") return "Plugin";
  return "Other";
}

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function writeRecent(types: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(types));
  } catch {
    // localStorage unavailable / quota exceeded — recent list is a
    // nice-to-have, not load-bearing.
  }
}

function buildSections(
  availableBlocks: NpBlockMetadata[],
  recent: string[],
): PaletteSection[] {
  const byType = new Map(availableBlocks.map((b) => [b.type, b]));

  // Recent section pulls from localStorage and filters out types
  // that are no longer registered (plugin disabled, theme swap).
  const recentItems: NpBlockMetadata[] = [];
  for (const type of recent) {
    const block = byType.get(type);
    if (block) recentItems.push(block);
    if (recentItems.length >= RECENT_LIMIT) break;
  }

  const buckets = new Map<string, NpBlockMetadata[]>();
  for (const block of availableBlocks) {
    const cat = categoryOf(block);
    const list = buckets.get(cat) ?? [];
    list.push(block);
    buckets.set(cat, list);
  }

  const sections: PaletteSection[] = [];
  if (recentItems.length > 0) {
    sections.push({ category: "Recent", items: recentItems });
  }
  for (const cat of CATEGORY_ORDER) {
    if (cat === "Recent") continue;
    const items = buckets.get(cat);
    if (items && items.length > 0) {
      sections.push({ category: cat, items });
      buckets.delete(cat);
    }
  }
  // Anything in a custom category not in CATEGORY_ORDER renders
  // alphabetically after the canonical buckets. Lets themes /
  // plugins introduce their own sections without lobbying for a
  // hard-coded slot.
  const remaining = [...buckets.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [cat, items] of remaining) {
    sections.push({ category: cat, items });
  }
  return sections;
}

function matchesQuery(block: NpBlockMetadata, query: string): boolean {
  if (!query) return true;
  const haystacks = [
    block.label,
    block.type,
    block.description ?? "",
    block.category ?? "",
    ...(block.keywords ?? []),
  ];
  for (const h of haystacks) {
    if (h.toLowerCase().includes(query)) return true;
  }
  return false;
}

// Tiny popover-anchored block picker. The trigger is provided by
// the editor (so the host controls placement / styling — the
// "Add block" button between rows or a sticky end-of-list CTA).
// Selecting a block adds it via `onAdd` and closes the popover.
//
// Phase 2 of #467 — blocks are grouped by `category`, the
// operator's recent picks float to the top, and the search filter
// also reads `keywords`.
export function BlockPalette({ availableBlocks, onAdd, trigger }: BlockPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  // Reset the search filter on close so reopening shows the full
  // list again — operators rarely want to resume a stale filter.
  // Refresh the recent list on open so a Recent picked in another
  // tab / dialog flows through.
  useEffect(() => {
    if (open) {
      setRecent(readRecent());
    } else {
      setQuery("");
    }
  }, [open]);

  const sections = useMemo(
    () => buildSections(availableBlocks, recent),
    [availableBlocks, recent],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return sections;
    // While filtering, drop the Recent section (it's redundant
    // with the search results) and only keep matches per category.
    return sections
      .filter((s) => s.category !== "Recent")
      .map((s) => ({
        category: s.category,
        items: s.items.filter((b) => matchesQuery(b, normalizedQuery)),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, normalizedQuery]);

  const handlePick = (block: NpBlockMetadata) => {
    onAdd(block.type);
    setOpen(false);
    // Push to the front of the recent list, dedupe, cap.
    const next = [block.type, ...recent.filter((t) => t !== block.type)].slice(
      0,
      RECENT_LIMIT,
    );
    setRecent(next);
    writeRecent(next);
  };

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
          {filteredSections.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              No blocks match.
            </div>
          ) : (
            filteredSections.map((section, sectionIndex) => (
              <div
                key={section.category}
                className={cn(sectionIndex > 0 && "mt-3")}
              >
                <div className="px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {section.category}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {section.items.map((block) => (
                    <button
                      key={`${section.category}-${block.type}`}
                      type="button"
                      onClick={() => handlePick(block)}
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
                        <span className="flex-1 truncate text-sm font-semibold">
                          {block.label}
                        </span>
                        {block.source === "plugin" ? (
                          <span
                            className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary"
                            aria-label="Plugin block"
                          >
                            plugin
                          </span>
                        ) : null}
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
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
