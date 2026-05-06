"use client";

import type { NpBlockInstance, NpBlockMetadata } from "@nexpress/blocks";

import { ScrollArea } from "../../ui/scroll-area.js";
import { cn } from "../../ui/utils.js";

import { BlockIcon } from "./block-icon.js";

interface OutlineRowProps {
  node: NpBlockInstance;
  depth: number;
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  activeId: string | null;
  onPick: (id: string) => void;
}

function OutlineRow({ node, depth, definitions, activeId, onPick }: OutlineRowProps) {
  const meta = definitions.get(node.type);
  const summary = readSummary(node, meta);
  const isActive = activeId === node.id;
  return (
    <>
      <button
        type="button"
        onClick={() => onPick(node.id)}
        className={cn(
          "grid w-full grid-cols-[14px_1fr_auto_auto] items-center gap-2 rounded-md py-1 text-left text-xs transition-colors",
          "hover:bg-accent/60",
          isActive && "bg-primary/10 text-primary",
        )}
        style={{ paddingLeft: 8 + depth * 14, paddingRight: 6 }}
        aria-current={isActive ? "true" : undefined}
        data-np-outline-row={node.id}
      >
        <BlockIcon
          icon={meta?.icon}
          kind={meta?.iconKind}
          sizeClassName="h-3 w-3"
          className={cn("text-muted-foreground", isActive && "text-primary")}
        />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-foreground/90">
            {meta?.label ?? node.type}
          </span>
          {summary ? <span className="truncate text-muted-foreground">{summary}</span> : null}
        </span>
        {meta?.source && meta.source !== "built-in" ? (
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider",
              meta.source === "plugin"
                ? "bg-primary/10 text-primary"
                : meta.source === "theme"
                  ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {meta.source}
          </span>
        ) : null}
        <span className="font-mono text-[10px] text-muted-foreground/70">{node.type}</span>
      </button>
      {Array.isArray(node.children) &&
        node.children.map((child) => (
          <OutlineRow
            key={child.id}
            node={child}
            depth={depth + 1}
            definitions={definitions}
            activeId={activeId}
            onPick={onPick}
          />
        ))}
    </>
  );
}

function readSummary(node: NpBlockInstance, meta?: NpBlockMetadata): string {
  if (!meta) return "";
  const fields = meta.summaryFields ?? [];
  for (const f of fields) {
    const v = node.props[f];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 48);
    if (typeof v === "number") return String(v);
  }
  return "";
}

export interface OutlinePanelProps {
  blocks: NpBlockInstance[];
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  activeId: string | null;
  onPick: (id: string) => void;
  /** Optional title shown at the top of the panel. */
  title?: string;
  /** Optional footer caption (e.g. "page.blocks · live"). */
  footer?: string;
  /** Optional max-height for the scroll area. Defaults to 320 px. */
  maxHeight?: number;
}

/**
 * Recursive block-tree outline. Used by both views — Page renders
 * the full tree (containers expand inline), Doc renders the same
 * shape but always-flat at the top level.
 *
 * Click a row to focus the matching block in the canvas. The
 * orchestrator owns the scroll-into-view side effect via the
 * `onPick` callback (it knows whether the row lives in Doc or
 * Page mode).
 */
export function OutlinePanel({
  blocks,
  definitions,
  activeId,
  onPick,
  title = "Blocks in document",
  footer,
  maxHeight = 320,
}: OutlinePanelProps) {
  return (
    <section
      className="rounded-2xl border border-neutral-200/80 bg-white/95 shadow-sm backdrop-blur-sm dark:border-neutral-800/80 dark:bg-neutral-950/95"
      aria-label={title}
    >
      <header className="border-b border-neutral-200/80 px-4 py-2.5 dark:border-neutral-800/80">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </header>
      <ScrollArea className="px-1.5 py-1.5" style={{ maxHeight: `${maxHeight}px` }}>
        {blocks.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No blocks yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {blocks.map((b) => (
              <OutlineRow
                key={b.id}
                node={b}
                depth={0}
                definitions={definitions}
                activeId={activeId}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      {footer ? (
        <footer className="border-t border-neutral-200/80 bg-neutral-50/60 px-4 py-1.5 font-mono text-[10px] text-muted-foreground dark:border-neutral-800/80 dark:bg-neutral-900/40">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
