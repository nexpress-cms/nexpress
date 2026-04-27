import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { highlightMatches } from "@/lib/search-highlight";

/**
 * Phase 10.7 — pin the highlightMatches edge cases. The
 * function returns React.ReactNode; we render to static
 * markup for assertion since the behavior we care about is
 * the resulting HTML string.
 */
describe("highlightMatches (Phase 10.7)", () => {
  function render(node: unknown): string {
    return renderToStaticMarkup(<>{node as ReactNode}</>);
  }

  it("wraps each occurrence of the query in <mark>", () => {
    const html = render(highlightMatches("Hello world hello", "hello"));
    expect(html).toContain('<mark class="nx-search-highlight">Hello</mark>');
    expect(html).toContain('<mark class="nx-search-highlight">hello</mark>');
  });

  it("is case-insensitive (uppercase query matches lowercase text)", () => {
    const html = render(highlightMatches("Tortoise", "TORTOISE"));
    expect(html).toContain('<mark class="nx-search-highlight">Tortoise</mark>');
  });

  it("returns the text unchanged when query is empty", () => {
    const html = render(highlightMatches("Hello world", ""));
    expect(html).toBe("Hello world");
    expect(html).not.toContain("<mark");
  });

  it("returns the text unchanged when query is whitespace-only", () => {
    const html = render(highlightMatches("Hello world", "   "));
    expect(html).toBe("Hello world");
  });

  it("filters single-char tokens (avoids matching every letter)", () => {
    const html = render(highlightMatches("a banana a", "a"));
    expect(html).not.toContain("<mark");
    expect(html).toBe("a banana a");
  });

  it("escapes regex-special characters in the query", () => {
    // `.` would normally match any char; with escaping, only
    // a literal `example.com` substring matches.
    const html = render(
      highlightMatches("Visit example.com or example_com", "example.com"),
    );
    expect(html).toContain(
      '<mark class="nx-search-highlight">example.com</mark>',
    );
    // The underscore variant should NOT be marked (proves
    // escaping worked — without escape, `.` would catch `_`).
    expect(html).not.toContain(
      '<mark class="nx-search-highlight">example_com</mark>',
    );
  });

  it("highlights every term in a multi-word query", () => {
    const html = render(
      highlightMatches("the quick brown fox", "quick brown"),
    );
    expect(html).toContain('<mark class="nx-search-highlight">quick</mark>');
    expect(html).toContain('<mark class="nx-search-highlight">brown</mark>');
  });

  it("does not produce empty marks when the query has no matches", () => {
    const html = render(highlightMatches("Hello world", "xyz"));
    expect(html).toBe("Hello world");
  });

  it("preserves the original casing of matched text", () => {
    const html = render(highlightMatches("Hello WORLD hello", "world"));
    expect(html).toContain('<mark class="nx-search-highlight">WORLD</mark>');
  });
});
