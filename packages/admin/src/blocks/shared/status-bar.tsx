"use client";

import type { ReactNode } from "react";
import type { NpBlockMetadata } from "@nexpress/blocks";

import { cn } from "../../ui/utils.js";

import { BlockIcon } from "./block-icon.js";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved";

export interface StatusBarProps {
  /** Total blocks in the tree (recursive). */
  totalBlocks: number;
  /** Number of blocks the registry knows about. */
  registrySize: number;
  /** Container warnings from `evaluateContainerWarnings`. */
  warningsCount: number;
  /** Currently focused block's metadata, if any. */
  activeMeta?: NpBlockMetadata | null;
  /** Currently focused block's type slug — shown in the chip. */
  activeType?: string | null;

  /** Optional Doc-mode word count. When omitted the segment hides. */
  wordCount?: number;
  /** Optional Doc-mode reading time minutes. */
  readingMinutes?: number;

  /** Autosave label: "Just now", "2m ago", etc. */
  savedLabel?: string;
  /** Autosave indicator state (drives the pulse + accessible status). */
  status?: AutosaveStatus;

  /** Optional left-side extra content (e.g. mode-specific stats). */
  startSlot?: ReactNode;
}

/**
 * Editor footer surfaced under both Doc and Page canvases. Renders
 * a sentence of inline stats on the left, the active-block chip
 * + autosave indicator on the right.
 */
export function StatusBar({
  totalBlocks,
  registrySize,
  warningsCount,
  activeMeta,
  activeType,
  wordCount,
  readingMinutes,
  savedLabel,
  status = "idle",
  startSlot,
}: StatusBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-neutral-200/80 bg-neutral-50/70 px-3.5 py-2 text-xs text-muted-foreground dark:border-neutral-800/80 dark:bg-neutral-900/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {startSlot}
        {typeof wordCount === "number" ? (
          <>
            <span>
              <strong className="font-semibold tabular-nums text-foreground">{wordCount}</strong>{" "}
              words
            </span>
            <span className="text-muted-foreground/40">·</span>
          </>
        ) : null}
        <span>
          <strong className="font-semibold tabular-nums text-foreground">{totalBlocks}</strong>{" "}
          blocks
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span>
          <strong className="font-semibold tabular-nums text-foreground">{registrySize}</strong> in
          registry
        </span>
        {warningsCount > 0 ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-amber-600 dark:text-amber-400">
              <strong className="font-semibold tabular-nums">{warningsCount}</strong> warning
              {warningsCount === 1 ? "" : "s"}
            </span>
          </>
        ) : null}
        {typeof readingMinutes === "number" ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span>
              Reading time ≈{" "}
              <strong className="font-semibold tabular-nums text-foreground">
                {Math.max(1, readingMinutes)} min
              </strong>
            </span>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {activeMeta && activeType ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200/80 bg-background px-2 py-0.5 text-[11px] dark:border-neutral-800/80">
            <BlockIcon
              icon={activeMeta.icon}
              kind={activeMeta.iconKind}
              sizeClassName="h-3 w-3"
              className="text-muted-foreground"
            />
            <span className="font-medium text-foreground">{activeMeta.label ?? activeType}</span>
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground/80">
              {activeType}
            </code>
          </span>
        ) : null}
        {savedLabel ? (
          <span>
            Saved <strong className="font-semibold text-foreground">{savedLabel}</strong>
          </span>
        ) : null}
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            status === "saving" && "animate-pulse bg-amber-500",
            status === "saved" && "np-autosave-pulse bg-emerald-500",
            status === "dirty" && "bg-amber-500",
            // Idle = autosave on, no pending changes — ripple to
            // signal the indicator is alive (matches the design's
            // `be-pulse` ambient state).
            status === "idle" && "np-autosave-pulse bg-emerald-500",
          )}
          aria-label={`Autosave ${status}`}
        />
      </div>
    </div>
  );
}
