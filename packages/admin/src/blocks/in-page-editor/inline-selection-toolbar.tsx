"use client";

import { useEffect, useState, type RefObject } from "react";
import { Bold, Code, Italic, Link as LinkIcon, Strikethrough, Underline } from "lucide-react";

import { cn } from "../../ui/utils.js";

export interface InlineSelectionToolbarProps {
  /** Container ref the toolbar position is computed relative to. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Wrap the active textarea's selection in markdown delimiters.
   * Mirrors the sticky toolbar's wrapInlineMark — kept as a prop
   * so the orchestrator (DocCanvas) owns the dispatch flow and the
   * inline toolbar stays presentational.
   */
  onWrap: (delimiter: string) => void;
}

/**
 * Floating mini-toolbar that anchors above the active text
 * selection inside an atom-block textarea. Mirrors the design's
 * `be-inline` surface — dark background, compact button row,
 * appears only while selection is non-collapsed.
 *
 * Selection tracking listens to the document's `selectionchange`
 * event. When the active element is a textarea inside the canvas
 * AND the selection is non-empty, we compute a position above the
 * textarea (we don't get caret-level rects from a textarea, so the
 * toolbar anchors at the textarea's top-left + a small offset —
 * that's the same compromise the design's `InlineSelToolbar` made).
 *
 * The buttons use `onMouseDown.preventDefault` so the click
 * doesn't blur the textarea before `onWrap` reads its selection.
 */
export function InlineSelectionToolbar({
  containerRef,
  onWrap,
}: InlineSelectionToolbarProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const update = () => {
      if (typeof document === "undefined") return;
      const active = document.activeElement;
      if (!(active instanceof HTMLTextAreaElement)) {
        setPosition(null);
        return;
      }
      const container = containerRef.current;
      if (!container || !container.contains(active)) {
        setPosition(null);
        return;
      }
      // Only show when there's actually a selection range.
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      if (start === end) {
        setPosition(null);
        return;
      }
      const textareaRect = active.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // Anchor 36 px above the textarea's top — matches the design's
      // `be-inline` placement. The horizontal offset (24 px from
      // the textarea's left edge) gives the toolbar room without
      // overlapping the row's grip rail on the very-left.
      setPosition({
        x: textareaRect.left - containerRect.left + 24,
        y: textareaRect.top - containerRect.top - 36,
      });
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
    };
  }, [containerRef]);

  if (!position) return null;

  return (
    <div
      role="toolbar"
      aria-label="Inline formatting"
      className={cn(
        "absolute z-25 flex items-center gap-px rounded-md p-0.5 text-white shadow-lg",
        "bg-neutral-950 dark:bg-neutral-100 dark:text-neutral-900",
      )}
      style={{ left: position.x, top: position.y }}
      // Same focus-preservation pattern as the sticky toolbar — the
      // mousedown shouldn't blur the textarea, so the wrap helper
      // can read selectionStart / selectionEnd at click time.
      onMouseDown={(e) => e.preventDefault()}
    >
      <InlineButton label="Bold" onClick={() => onWrap("**")}>
        <Bold className="h-3.5 w-3.5" aria-hidden="true" />
      </InlineButton>
      <InlineButton label="Italic" onClick={() => onWrap("*")}>
        <Italic className="h-3.5 w-3.5" aria-hidden="true" />
      </InlineButton>
      <InlineButton label="Underline" onClick={() => onWrap("_")}>
        <Underline className="h-3.5 w-3.5" aria-hidden="true" />
      </InlineButton>
      <InlineButton label="Strikethrough" onClick={() => onWrap("~~")}>
        <Strikethrough className="h-3.5 w-3.5" aria-hidden="true" />
      </InlineButton>
      <span className="mx-0.5 h-3.5 w-px bg-white/20 dark:bg-neutral-900/20" />
      <InlineButton label="Inline code" onClick={() => onWrap("`")}>
        <Code className="h-3.5 w-3.5" aria-hidden="true" />
      </InlineButton>
      <InlineButton label="Link (rich-text only)" disabled>
        <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </InlineButton>
    </div>
  );
}

function InlineButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 w-7 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/15 hover:text-white",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-white/80",
        "dark:text-neutral-900/80 dark:hover:bg-neutral-900/15 dark:hover:text-neutral-900",
      )}
    >
      {children}
    </button>
  );
}
