import { describe, expect, it } from "vitest";

import { isGutenbergSource, parseGutenbergBlocks } from "./gutenberg.js";

describe("isGutenbergSource", () => {
  it("returns true on a standard Gutenberg paragraph", () => {
    expect(isGutenbergSource("<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->")).toBe(true);
  });
  it("returns true on a self-closing fence", () => {
    expect(isGutenbergSource("<!-- wp:separator /-->")).toBe(true);
  });
  it("returns false on a classic-editor source", () => {
    expect(isGutenbergSource("<p>just plain html</p>")).toBe(false);
  });
});

describe("parseGutenbergBlocks", () => {
  it("splits a sequence of paired blocks", () => {
    const out = parseGutenbergBlocks(
      '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph --><!-- wp:heading {"level":3} --><h3>T</h3><!-- /wp:heading -->',
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.name).toBe("paragraph");
    expect(out[0]?.innerHtml).toBe("<p>Hi</p>");
    expect(out[1]?.name).toBe("heading");
    expect(out[1]?.attrs.level).toBe(3);
    expect(out[1]?.innerHtml).toBe("<h3>T</h3>");
  });

  it("emits self-closing blocks with `selfClosing: true`", () => {
    const out = parseGutenbergBlocks("<!-- wp:separator /-->");
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("separator");
    expect(out[0]?.selfClosing).toBe(true);
    expect(out[0]?.innerHtml).toBe("");
  });

  it("captures attributes verbatim and parses JSON", () => {
    const out = parseGutenbergBlocks(
      '<!-- wp:list {"ordered":true} --><ol><li>a</li></ol><!-- /wp:list -->',
    );
    expect(out[0]?.rawAttrs).toBe('{"ordered":true}');
    expect(out[0]?.attrs.ordered).toBe(true);
  });

  it("treats malformed JSON attributes as empty without losing the raw text", () => {
    const out = parseGutenbergBlocks(
      `<!-- wp:image {bad json} --><figure></figure><!-- /wp:image -->`,
    );
    expect(out[0]?.attrs).toEqual({});
    expect(out[0]?.rawAttrs).toBe("{bad json}");
  });

  it("emits loose content between blocks as a synthetic gutenberg-loose record", () => {
    const out = parseGutenbergBlocks(
      "<!-- wp:paragraph --><p>a</p><!-- /wp:paragraph -->Loose text<!-- wp:paragraph --><p>b</p><!-- /wp:paragraph -->",
    );
    expect(out.map((b) => b.name)).toEqual(["paragraph", "gutenberg-loose", "paragraph"]);
    expect(out[1]?.innerHtml).toBe("Loose text");
  });

  it("is tolerant of nested blocks (treats inner fences as part of innerHtml)", () => {
    const out = parseGutenbergBlocks(
      "<!-- wp:columns --><!-- wp:column --><p>nested</p><!-- /wp:column --><!-- /wp:columns -->",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("columns");
    expect(out[0]?.innerHtml).toContain("<!-- wp:column -->");
  });

  it("recovers gracefully from a stray closer", () => {
    const out = parseGutenbergBlocks(
      "<!-- /wp:paragraph --><!-- wp:paragraph --><p>ok</p><!-- /wp:paragraph -->",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.innerHtml).toBe("<p>ok</p>");
  });

  it("recovers gracefully from a missing closer at EOF", () => {
    const out = parseGutenbergBlocks("<!-- wp:paragraph --><p>unterminated");
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("paragraph");
    expect(out[0]?.innerHtml).toContain("unterminated");
  });
});
