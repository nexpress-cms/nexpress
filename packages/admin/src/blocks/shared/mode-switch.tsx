"use client";

import { useEffect, useState } from "react";
import { AlignLeft, Layers } from "lucide-react";

import { cn } from "../../ui/utils.js";

export type EditorView = "doc" | "page";

const STORAGE_PREFIX = "np-page-builder.editor-view";

function storageKey(scope?: string): string | null {
  if (!scope) return null;
  return `${STORAGE_PREFIX}.${scope}`;
}

/**
 * Reads the persisted view choice for a given `<collection>.<field>`
 * scope. Returns `null` when storage is unavailable, the key is
 * empty, or the scope is not provided. SSR-safe — guards on `window`.
 */
export function readPersistedView(scope?: string): EditorView | null {
  const key = storageKey(scope);
  if (!key) return null;
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "doc" || value === "page") return value;
    return null;
  } catch {
    return null;
  }
}

function writePersistedView(scope: string | undefined, view: EditorView): void {
  const key = storageKey(scope);
  if (!key) return;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, view);
  } catch {
    // Private browsing / quota — drop the persistence, keep the
    // in-memory choice.
  }
}

export interface ModeSwitchProps {
  view: EditorView;
  onViewChange: (next: EditorView) => void;
  /** Optional scope for localStorage persistence (e.g. `pages.blocks`). */
  scope?: string;
  /** Disables the toggle entirely. */
  disabled?: boolean;
}

/**
 * Document / Page builder segmented toggle. Used in the
 * orchestrator header. The orchestrator owns the actual view
 * state; this component just renders the chrome and persists
 * the choice when `scope` is provided.
 */
export function ModeSwitch({
  view,
  onViewChange,
  scope,
  disabled,
}: ModeSwitchProps) {
  const handlePick = (next: EditorView) => {
    if (disabled || next === view) return;
    onViewChange(next);
    writePersistedView(scope, next);
  };

  return (
    <div
      role="tablist"
      aria-label="Editor view"
      className="inline-flex h-7 items-center gap-0 overflow-hidden rounded-md border border-neutral-200/80 bg-background dark:border-neutral-800/80"
    >
      <ToggleButton
        active={view === "doc"}
        disabled={disabled}
        onClick={() => handlePick("doc")}
        ariaLabel="Document view"
      >
        <AlignLeft className="h-3 w-3" aria-hidden="true" />
        Document
      </ToggleButton>
      <ToggleButton
        active={view === "page"}
        disabled={disabled}
        onClick={() => handlePick("page")}
        ariaLabel="Page builder view"
      >
        <Layers className="h-3 w-3" aria-hidden="true" />
        Page builder
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  disabled,
  onClick,
  ariaLabel,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 px-2.5 text-xs transition-colors",
        active
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-muted-foreground hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Hook that mounts a persisted view state. Returns the current
 * value + a setter that writes through to localStorage.
 */
export function usePersistedView(
  scope?: string,
  defaultView: EditorView = "page",
): [EditorView, (next: EditorView) => void] {
  const [view, setView] = useState<EditorView>(defaultView);
  // Hydrate from storage post-mount so SSR doesn't choke on
  // `window`. The default render is whichever view the orchestrator
  // passes — operators see one frame of "page" before the toggle
  // hydrates if their saved choice is "doc".
  useEffect(() => {
    const persisted = readPersistedView(scope);
    if (persisted) setView(persisted);
  }, [scope]);
  const set = (next: EditorView) => {
    setView(next);
    writePersistedView(scope, next);
  };
  return [view, set];
}
