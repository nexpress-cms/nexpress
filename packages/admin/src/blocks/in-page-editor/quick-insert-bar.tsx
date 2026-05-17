"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NpBlockMetadata } from "@nexpress/blocks";
import { CornerDownLeft } from "lucide-react";

import { Input } from "../../ui/input.js";
import { cn } from "../../ui/utils.js";

import { BlockIcon } from "../shared/block-icon.js";

interface QuickInsertBarProps {
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  availableBlocks?: readonly NpBlockMetadata[];
  onInsertBlock: (blockType: string) => void;
  onInsertText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  className?: string;
}

// Cap the slash menu at this many entries so a registry with
// dozens of plugin blocks doesn't render an unscrollable wall on
// open. Operators with a larger registry refine via the query;
// the corpus is searched, only the rendering is capped.
export const SLASH_MENU_LIMIT = 12;

/**
 * Pure filter for the slash-menu corpus. Exposed so the unit
 * suite can lock the contract (label / type / keyword match,
 * case-insensitive, capped) without booting React.
 *
 * @param definitions  Sorted list of every registered block.
 * @param query        Slash query (already lower-cased; pass `""`
 *                     for the no-query "show top N" case).
 */
export function filterSlashMenuDefinitions(
  definitions: readonly NpBlockMetadata[],
  query: string,
): NpBlockMetadata[] {
  if (!query) return definitions.slice(0, SLASH_MENU_LIMIT);
  const needle = query.toLowerCase();
  return definitions
    .filter((def) => {
      const label = (def.label ?? def.type).toLowerCase();
      const keywords = (def.keywords ?? []).join(" ").toLowerCase();
      return (
        label.includes(needle) ||
        def.type.toLowerCase().includes(needle) ||
        keywords.includes(needle)
      );
    })
    .slice(0, SLASH_MENU_LIMIT);
}

/**
 * Notion-ish insert bar used both at the bottom of the canvas and
 * inline under a hovered block. Two modes, picked by what the
 * operator types:
 *
 *   - Plain text + Enter → appends a rich-text block with the
 *     text wrapped as a Lexical paragraph. Routed through the
 *     parent `onInsertText` callback so the rich-text content
 *     hydration races stay in `DocCanvas`.
 *   - `/<query>` → opens an inline slash menu of registered
 *     block types whose label / type matches the query. Enter
 *     picks the highlighted entry; ↑ / ↓ navigates; Esc closes.
 *
 * The slash menu lists built-in blocks first (alphabetical by
 * label) and plugin blocks below — the design called for "built-
 * in only is fine if listing plugins is hard," but plugin blocks
 * already show up in the registry-context map and adding them
 * costs nothing.
 *
 * Placement is owned by the parent through `onInsertBlock` /
 * `onInsertText`, so this component stays focused on input,
 * filtering, keyboard navigation, and presentation.
 */
export function QuickInsertBar({
  definitions,
  availableBlocks,
  onInsertBlock,
  onInsertText,
  placeholder = "Write something, or type / to insert a block",
  autoFocus = false,
  onCancel,
  className,
}: QuickInsertBarProps) {
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);

  // Sorted list of every registered block — used as the slash-
  // menu corpus. Stable across renders (definitions identity
  // changes only when the registry does), so the filter below
  // can derive cheaply.
  const allDefinitions = useMemo(() => {
    const blocks = availableBlocks ?? Array.from(definitions.values());
    return [...blocks].sort((a, b) => (a.label ?? a.type).localeCompare(b.label ?? b.type));
  }, [availableBlocks, definitions]);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
  }, [autoFocus]);

  const isSlashMode = value.startsWith("/");
  const slashQuery = isSlashMode ? value.slice(1).toLowerCase() : "";
  const filtered = useMemo(() => {
    if (!isSlashMode) return [];
    return filterSlashMenuDefinitions(allDefinitions, slashQuery);
  }, [isSlashMode, slashQuery, allDefinitions]);

  // Reset active index when the filter changes — clamping it to
  // the new length keeps the highlight on a real entry.
  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered]);

  const commitSlash = (def: NpBlockMetadata | undefined) => {
    if (!def) return;
    onInsertBlock(def.type);
    setValue("");
    setActiveIndex(0);
    inputRef.current?.focus();
  };
  const commitText = (text: string) => {
    if (!text.trim()) return;
    onInsertText(text);
    setValue("");
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-dashed border-neutral-300",
          "bg-background px-3 py-2 shadow-sm transition-colors",
          "focus-within:border-primary/50 focus-within:bg-background",
          "dark:border-neutral-700",
        )}
      >
        <span className="text-sm text-neutral-400 dark:text-neutral-500">
          {isSlashMode ? "/" : "+"}
        </span>
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            if (isSlashMode) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                commitSlash(filtered[activeIndex]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setValue("");
                onCancel?.();
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setValue("");
              onCancel?.();
            }
          }}
          placeholder={placeholder}
          className={cn(
            "flex-1 border-0 bg-transparent px-0 text-sm shadow-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
        />
        {value && !isSlashMode ? (
          <kbd
            className={cn(
              "hidden items-center gap-1 rounded border border-neutral-200",
              "bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground",
              "sm:inline-flex dark:border-neutral-800",
            )}
          >
            <CornerDownLeft className="h-3 w-3" /> Enter
          </kbd>
        ) : null}
      </div>

      {isSlashMode && filtered.length > 0 ? (
        <div
          className={cn(
            // `left-0` anchors the popover to the input's leading
            // edge; `max-w-md` keeps it from stretching to the full
            // canvas width on wide layouts so it reads as a
            // popover, not a full-width list.
            "absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full max-w-md",
            "overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg",
            "dark:border-neutral-800 dark:bg-neutral-950",
          )}
          role="listbox"
        >
          {filtered.map((def, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={def.type}
                ref={isActive ? activeOptionRef : undefined}
                type="button"
                role="option"
                aria-selected={isActive}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                  isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commitSlash(def)}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md border",
                    "border-neutral-200/80 bg-background text-muted-foreground",
                    "dark:border-neutral-800/80",
                  )}
                >
                  <BlockIcon icon={def.icon} kind={def.iconKind} />
                </span>
                <span className="flex flex-col">
                  <span className="font-medium">{def.label ?? def.type}</span>
                  {def.category ? (
                    <span className="text-xs text-muted-foreground">{def.category}</span>
                  ) : null}
                </span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                  {def.source ?? "built-in"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {isSlashMode && filtered.length === 0 ? (
        <div
          className={cn(
            "absolute bottom-full left-0 z-20 mb-2 w-full max-w-md rounded-xl",
            "border border-neutral-200 bg-white px-3 py-2 text-sm text-muted-foreground shadow-lg",
            "dark:border-neutral-800 dark:bg-neutral-950",
          )}
        >
          No blocks match{slashQuery ? ` "${slashQuery}"` : ""}.
        </div>
      ) : null}
    </div>
  );
}
