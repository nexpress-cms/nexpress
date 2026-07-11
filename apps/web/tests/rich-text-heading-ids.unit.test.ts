import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderRichText } from "@nexpress/editor";
import type { NpRichTextContent } from "@nexpress/core";

/**
 * `renderRichText` auto-emits `id` attributes on `h2` / `h3` so
 * the docs theme's table of contents links resolve and "Copy link"
 * buttons work out of the box. The slug derivation has a few
 * properties worth pinning:
 *
 *   - lowercases + hyphenates so anchors are URL-safe
 *   - strips diacritics so "Résumé" → "resume" rather than "r-sum-"
 *   - keeps non-Latin letters so CJK headings still get usable ids
 *   - dedupes within a single render: "Heading" / "Heading" →
 *     `heading` / `heading-2`
 *   - empties (punctuation-only / emoji-only headings) fall back
 *     to `section` so the element still has an addressable id
 *   - h1 / h4–h6 are left without auto-ids (h1 is page title;
 *     deep levels are below typical TOC scope)
 *
 * The test renders to static HTML and pattern-matches on the
 * emitted attributes — keeps the assertion close to what an
 * operator's deep link actually targets.
 */

function html(content: NpRichTextContent): string {
  const tree = renderRichText(content);
  return tree === null ? "" : renderToStaticMarkup(tree);
}

function doc(...headings: Array<{ tag: string; text: string }>): NpRichTextContent {
  return {
    version: 1,
    document: {
      root: {
        type: "root",
        direction: null,
        format: "",
        indent: 0,
        version: 1,
        children: headings.map((h) => ({
          type: "heading",
          version: 1,
          tag: h.tag,
          children: [{ type: "text", version: 1, text: h.text }],
        })),
      },
    },
  };
}

describe("renderRichText heading id emission", () => {
  it("emits a slugified id on h2", () => {
    const out = html(doc({ tag: "h2", text: "Getting started" }));
    expect(out).toContain('<h2 id="getting-started">');
  });

  it("emits a slugified id on h3", () => {
    const out = html(doc({ tag: "h3", text: "Plugin authoring" }));
    expect(out).toContain('<h3 id="plugin-authoring">');
  });

  it("does NOT emit an id on h1, h4, h5, h6", () => {
    const out = html(
      doc(
        { tag: "h1", text: "Title" },
        { tag: "h4", text: "Subhead" },
        { tag: "h5", text: "Smaller" },
        { tag: "h6", text: "Smallest" },
      ),
    );
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<h4>Subhead</h4>");
    expect(out).toContain("<h5>Smaller</h5>");
    expect(out).toContain("<h6>Smallest</h6>");
  });

  it("strips diacritics", () => {
    const out = html(doc({ tag: "h2", text: "Résumé tips" }));
    expect(out).toContain('<h2 id="resume-tips">');
  });

  it("dedupes collisions within a single render", () => {
    const out = html(
      doc({ tag: "h2", text: "Notes" }, { tag: "h2", text: "Notes" }, { tag: "h3", text: "Notes" }),
    );
    expect(out).toContain('<h2 id="notes">');
    expect(out).toContain('<h2 id="notes-2">');
    expect(out).toContain('<h3 id="notes-3">');
  });

  it("keeps non-Latin letters", () => {
    const out = html(doc({ tag: "h2", text: "한글 제목" }));
    // hyphen replaces the space between the two CJK tokens.
    expect(out).toContain('<h2 id="한글-제목">');
  });

  it("falls back to `section` when the heading slugs to empty", () => {
    const out = html(doc({ tag: "h2", text: "👋" }));
    expect(out).toContain('<h2 id="section">');
  });

  it("trims leading/trailing whitespace before slugging", () => {
    const out = html(doc({ tag: "h2", text: "  Padded  " }));
    expect(out).toContain('<h2 id="padded">');
  });

  it("collapses runs of separators into a single hyphen", () => {
    const out = html(doc({ tag: "h2", text: "Heading -- with — many   separators" }));
    expect(out).toContain('<h2 id="heading-with-many-separators">');
  });

  it("resets numbering across separate renderRichText calls", () => {
    const first = html(doc({ tag: "h2", text: "Intro" }));
    const second = html(doc({ tag: "h2", text: "Intro" }));
    expect(first).toContain('<h2 id="intro">');
    expect(second).toContain('<h2 id="intro">');
    expect(second).not.toContain("intro-2");
  });
});
