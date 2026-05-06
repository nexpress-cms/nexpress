import { Fragment, type ReactNode } from "react";

/**
 * Tiny markdown-style inline-mark parser shared by every atom
 * block's `render()` (paragraph, heading, quote, list-item, code,
 * callout). Operators type marks inline using a small subset of
 * markdown syntax:
 *
 *   **bold**       → <strong>bold</strong>
 *   *italic*       → <em>italic</em>
 *   _underline_    → <u>underline</u>
 *   ~~strike~~     → <s>strike</s>
 *   `code`         → <code>code</code>
 *
 * Why markdown over a structured marks array: marks indices have
 * to track every keystroke (insert / delete / paste shifts every
 * downstream index). Markdown sidesteps the entire problem — the
 * text IS the source of truth, the parser just produces spans at
 * render time. The trade-off is operators see the syntax while
 * editing; for full WYSIWYG, the rich-text block (Lexical) is
 * the right surface.
 *
 * Parsing is single-pass and conservative: unmatched delimiters
 * fall through as plain text (so a line ending mid-`**foo` doesn't
 * break the page). Nesting works for the common case (`**bold
 * with _underline_ inside**`) but is not full markdown — we don't
 * try to compete with full markdown spec coverage. Callers that
 * need richer formatting use the rich-text block.
 */

type Token =
  | { kind: "text"; value: string }
  | { kind: "bold"; children: Token[] }
  | { kind: "italic"; children: Token[] }
  | { kind: "underline"; children: Token[] }
  | { kind: "strike"; children: Token[] }
  | { kind: "code"; value: string };

const PATTERNS: Array<{
  open: string;
  close: string;
  kind: Exclude<Token["kind"], "text" | "code">;
}> = [
  // Order matters: longer delimiters first so `**` doesn't match
  // as two `*`.
  { open: "**", close: "**", kind: "bold" },
  { open: "~~", close: "~~", kind: "strike" },
  { open: "*", close: "*", kind: "italic" },
  { open: "_", close: "_", kind: "underline" },
];

function parseInline(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf.length > 0) {
      out.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  while (i < input.length) {
    const ch = input[i];

    // Backtick code is single-line, opaque (no nested marks). The
    // common `` `inline code` `` pattern.
    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ kind: "code", value: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Other delimited marks — recurse for nested content.
    let matched = false;
    for (const pattern of PATTERNS) {
      if (!input.startsWith(pattern.open, i)) continue;
      const close = input.indexOf(pattern.close, i + pattern.open.length);
      if (close === -1) continue;
      // Reject empty content (`**`, `**a*` mid-stream).
      if (close === i + pattern.open.length) continue;
      flush();
      const inner = input.slice(i + pattern.open.length, close);
      out.push({ kind: pattern.kind, children: parseInline(inner) });
      i = close + pattern.close.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function renderTokens(tokens: Token[], keyPrefix = ""): ReactNode {
  return tokens.map((token, i) => {
    const key = `${keyPrefix}${i}`;
    switch (token.kind) {
      case "text":
        return <Fragment key={key}>{token.value}</Fragment>;
      case "code":
        return <code key={key}>{token.value}</code>;
      case "bold":
        return <strong key={key}>{renderTokens(token.children, `${key}-`)}</strong>;
      case "italic":
        return <em key={key}>{renderTokens(token.children, `${key}-`)}</em>;
      case "underline":
        return <u key={key}>{renderTokens(token.children, `${key}-`)}</u>;
      case "strike":
        return <s key={key}>{renderTokens(token.children, `${key}-`)}</s>;
    }
  });
}

/**
 * Parse a plain-string atom-block body into React nodes with
 * inline marks resolved. Use in every atom block's `render()` for
 * the text-shaped prop (paragraph `text`, heading `text`, etc.).
 */
export function renderInlineMarks(text: string): ReactNode {
  if (!text) return null;
  return renderTokens(parseInline(text));
}
