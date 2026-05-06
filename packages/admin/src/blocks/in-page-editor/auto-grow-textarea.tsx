"use client";

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { cn } from "../../ui/utils.js";

export interface AutoGrowTextareaProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Optional id for label-for + slash-menu anchor. */
  id?: string;
  /** Optional aria-label when no visible label is rendered. */
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Auto-resize textarea — height tracks content. Used by every
 * Doc-mode block body that wants prose: paragraph, heading,
 * quote, callout, list item, code.
 *
 * Resets `style.height = "auto"` then sets to `scrollHeight` on
 * every input. Standard pattern; no third-party deps. Forward-
 * refs the textarea so the orchestrator's focus-on-newly-inserted
 * effect can land focus directly.
 */
export const AutoGrowTextarea = forwardRef<
  HTMLTextAreaElement,
  AutoGrowTextareaProps
>(function AutoGrowTextarea(
  {
    value,
    onChange,
    placeholder,
    className,
    onFocus,
    onKeyDown,
    id,
    ariaLabel,
    disabled,
  },
  ref,
) {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => internalRef.current as HTMLTextAreaElement);

  useLayoutEffect(() => {
    const el = internalRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={internalRef}
      id={id}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      disabled={disabled}
      rows={1}
      className={cn(
        "block w-full resize-none border-0 bg-transparent p-0 outline-none focus:ring-0",
        "placeholder:text-muted-foreground/60",
        className,
      )}
    />
  );
});
