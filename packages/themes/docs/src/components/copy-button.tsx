"use client";

import * as React from "react";

const COPIED_RESET_MS = 1500;

/**
 * Tiny client island the docs `codePanel` / `shellCommand` blocks
 * surface as the "Copy" affordance in the code-panel header. Reads
 * `text` once at render time (props are stable per block-instance);
 * `navigator.clipboard.writeText` is the only DOM API touched.
 *
 * Renders a label that swaps `"Copy" → "Copied"` for 1.5s and back.
 * Falls back to a no-op when `navigator.clipboard` is absent (older
 * browsers, sandboxed contexts) — the button still toggles its label
 * so the operator sees feedback even if the write silently fails.
 */
export function CopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleClick = React.useCallback(() => {
    const writer = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (writer && typeof writer.writeText === "function") {
      writer.writeText(text).catch(() => {
        // Swallowed by design — clipboard write can reject in
        // permission-locked contexts; the label flip is still
        // useful as visual ack of the click.
      });
    }
    setCopied(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className ?? "np-docs-code-copy"}
      aria-label={copied ? "Copied" : "Copy"}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
