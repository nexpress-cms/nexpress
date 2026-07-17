/**
 * Phase 10.7 — query-term highlighting for search results.
 *
 * Wraps query terms in `<mark>` so users can see why a result
 * matched. Splits the query on whitespace, builds a single
 * case-insensitive regex from the escaped terms, and emits
 * alternating text + mark segments.
 *
 * Edge cases:
 *   - Empty / whitespace-only query → returns the input
 *     text unchanged (no marks)
 *   - Tokens shorter than 2 chars filtered (avoids matching
 *     every single letter)
 *   - Regex-special chars in the query escaped before compile
 *   - Output is React-safe — pure JSX fragments, no
 *     dangerouslySetInnerHTML
 */
import type { ReactNode } from "react";

const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function toPlainSearchText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z]+);/gi, (match, entity: string) => {
      return HTML_ENTITY_REPLACEMENTS[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function highlightMatches(text: string, query: string): ReactNode {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return text;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="np-search-highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
