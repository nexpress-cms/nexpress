"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { Input } from "../../ui/input.js";
import { cn } from "../../ui/utils.js";

import type { NpPattern } from "../patterns.js";
import { PatternPreview } from "./pattern-preview.js";

/**
 * Phase F.5.2 — pattern library side panel (rendered as a wide
 * centered dialog rather than a literal off-canvas sheet, since
 * admin doesn't have a Sheet primitive and Dialog is plenty for
 * a browse-and-pick interaction).
 *
 * Complements the Cmd-K command menu's quick "Insert pattern:
 * <name>" lines with a richer browse experience: full-width
 * thumbnail tiles, source filter chips (built-in / theme /
 * plugin / saved), and a search box.
 *
 * Selecting a tile fires `onInsert(pattern)` and closes — the
 * dialog is single-action by design (operator goes back to the
 * editor immediately so they can position the inserted block).
 */

interface SourceFilter {
  /** "all" matches anything; named keys match exact source kind. */
  key: "all" | "built-in" | "theme" | "plugin" | "custom";
  label: string;
}

const SOURCE_FILTERS: SourceFilter[] = [
  { key: "all", label: "All" },
  { key: "built-in", label: "Built-in" },
  { key: "theme", label: "Theme" },
  { key: "plugin", label: "Plugin" },
  { key: "custom", label: "Saved" },
];

function matchesSourceFilter(pattern: NpPattern, key: SourceFilter["key"]): boolean {
  if (key === "all") return true;
  // Concrete identities (`theme:magazine` / `plugin:foo`) match
  // their broad bucket so the filter "Theme" surfaces every
  // theme-contributed pattern regardless of which theme.
  if (key === "theme") {
    return pattern.source === "theme" || pattern.source.startsWith("theme:");
  }
  if (key === "plugin") {
    return pattern.source === "plugin" || pattern.source.startsWith("plugin:");
  }
  return pattern.source === key;
}

export interface PatternLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patterns: NpPattern[];
  onInsert: (pattern: NpPattern) => void;
}

export function PatternLibraryDialog({
  open,
  onOpenChange,
  patterns,
  onInsert,
}: PatternLibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter["key"]>("all");

  // Reset query/filter on open so the operator always lands on
  // the unfiltered library — re-using state across opens led to
  // confusing "where are my patterns?" moments when a previous
  // search left only one card visible.
  useEffect(() => {
    if (open) {
      setQuery("");
      setFilter("all");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return patterns.filter((p) => {
      if (!matchesSourceFilter(p, filter)) return false;
      if (!q) return true;
      const haystack = `${p.label} ${p.description ?? ""} ${p.category ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [patterns, query, filter]);

  function pick(pattern: NpPattern) {
    onInsert(pattern);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] max-w-4xl grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle>Pattern library</DialogTitle>
          <DialogDescription>
            Browse patterns shipped by your theme, plugins, and your saved snippets. Pick one to
            insert at the current position.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-4 pt-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search patterns…"
            aria-label="Search patterns"
            autoFocus
          />
          <div role="tablist" aria-label="Filter by source" className="flex flex-wrap gap-1">
            {SOURCE_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 pb-4">
          {filtered.length === 0 ? (
            <p className="px-2 py-12 text-center text-sm text-muted-foreground">
              No patterns match.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((pattern) => (
                <li key={pattern.id}>
                  <button
                    type="button"
                    onClick={() => pick(pattern)}
                    className={cn(
                      "group flex w-full flex-col gap-2 rounded-lg border border-border/60 bg-background/70 p-2 text-left transition",
                      "hover:border-primary/60 hover:bg-background hover:shadow-sm",
                      "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    )}
                  >
                    <PatternPreview
                      src={pattern.preview}
                      alt={`${pattern.label} preview`}
                      size="card"
                    />
                    <div className="space-y-0.5 px-1 pb-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{pattern.label}</span>
                        <SourceBadge source={pattern.source} />
                      </div>
                      {pattern.description ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {pattern.description}
                        </p>
                      ) : null}
                      {pattern.category ? (
                        <code className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {pattern.category}
                        </code>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceBadge({ source }: { source: NpPattern["source"] }) {
  const label =
    source === "custom"
      ? "Saved"
      : source === "built-in"
        ? "Built-in"
        : source.startsWith("theme:") || source === "theme"
          ? "Theme"
          : source.startsWith("plugin:") || source === "plugin"
            ? "Plugin"
            : source;
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
  );
}
