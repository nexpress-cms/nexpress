"use client";

import { AlertCircle } from "lucide-react";
import type { ContainerWarning } from "../editor-engine/index.js";

import { cn } from "../../ui/utils.js";

export interface ContainerWarningsPanelProps {
  warnings: ContainerWarning[];
  onPick: (id: string) => void;
}

/**
 * Side card listing every container contract violation in the
 * current tree. Click a row to scroll the offending block into
 * view (the orchestrator owns the scroll behavior). Hidden when
 * the warnings list is empty.
 */
export function ContainerWarningsPanel({ warnings, onPick }: ContainerWarningsPanelProps) {
  if (warnings.length === 0) return null;
  return (
    <section
      className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/95 shadow-sm backdrop-blur-sm dark:border-neutral-800/80 dark:bg-neutral-950/95"
      aria-label="Container warnings"
    >
      <header className="border-b border-neutral-200/80 px-4 py-2.5 dark:border-neutral-800/80">
        <h3 className="text-sm font-semibold tracking-tight">Container warnings</h3>
      </header>
      <ul className="flex flex-col gap-1 p-2">
        {warnings.map((w, i) => (
          <li key={`${w.id}-${i}`}>
            <button
              type="button"
              onClick={() => onPick(w.id)}
              className={cn(
                "grid min-w-0 w-full grid-cols-[14px_minmax(0,1fr)] items-center gap-2 rounded-md border border-amber-200/80 bg-amber-50/70 px-2.5 py-1.5 text-left text-xs text-amber-900 min-[420px]:grid-cols-[14px_minmax(0,1fr)_auto]",
                "hover:bg-amber-100/70 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
              )}
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              <span className="min-w-0 break-words leading-snug">{w.message}</span>
              <code className="col-start-2 w-fit rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider min-[420px]:col-start-auto">
                {w.kind}
              </code>
            </button>
          </li>
        ))}
      </ul>
      <footer className="break-all border-t border-neutral-200/80 bg-neutral-50/60 px-4 py-1.5 font-mono text-[10px] text-muted-foreground dark:border-neutral-800/80 dark:bg-neutral-900/40">
        min · max · allowedChildTypes
      </footer>
    </section>
  );
}
