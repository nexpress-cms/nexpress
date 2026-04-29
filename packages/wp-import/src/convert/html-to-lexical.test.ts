import { describe, expect, it } from "vitest";

import { htmlToLexical } from "./html-to-lexical.js";

function blockTypes(out: ReturnType<typeof htmlToLexical>): string[] {
  return out.root.children.map((c) => c.type);
}

describe("htmlToLexical", () => {
  it("returns an empty paragraph for empty input", () => {
    const out = htmlToLexical("");
    expect(out.root.children).toHaveLength(1);
    expect(out.root.children[0]?.type).toBe("paragraph");
    expect(out.root.children[0]?.children).toEqual([]);
  });

  it("wraps loose text in an implicit paragraph", () => {
    const out = htmlToLexical("hello world");
    expect(blockTypes(out)).toEqual(["paragraph"]);
    const para = out.root.children[0];
    expect(para?.children?.[0]).toMatchObject({ type: "text", text: "hello world", format: 0 });
  });

  it("converts <p> to a paragraph block", () => {
    const out = htmlToLexical("<p>Hello.</p>");
    expect(blockTypes(out)).toEqual(["paragraph"]);
    expect(out.root.children[0]?.children?.[0]).toMatchObject({ type: "text", text: "Hello." });
  });

  it("converts <h1>–<h6> to heading with the right tag", () => {
    const out = htmlToLexical("<h1>A</h1><h3>B</h3><h6>C</h6>");
    expect(blockTypes(out)).toEqual(["heading", "heading", "heading"]);
    expect(out.root.children[0]?.tag).toBe("h1");
    expect(out.root.children[1]?.tag).toBe("h3");
    expect(out.root.children[2]?.tag).toBe("h6");
  });

  it("applies bold/italic/code formats via bitmask", () => {
    const out = htmlToLexical("<p><strong>bold</strong> <em>italic</em> <code>code</code></p>");
    const children = out.root.children[0]?.children ?? [];
    expect(children[0]).toMatchObject({ text: "bold", format: 1 });
    expect(children[2]).toMatchObject({ text: "italic", format: 2 });
    expect(children[4]).toMatchObject({ text: "code", format: 16 });
  });

  it("composes nested inline formats (bold + italic)", () => {
    const out = htmlToLexical("<p><strong><em>both</em></strong></p>");
    const node = out.root.children[0]?.children?.[0];
    expect(node).toMatchObject({ text: "both", format: 1 | 2 });
  });

  it("emits a link node with the href + child text", () => {
    const out = htmlToLexical('<p>see <a href="https://example.com">site</a></p>');
    const link = out.root.children[0]?.children?.find((c) => c.type === "link");
    expect(link).toBeDefined();
    expect(link?.url).toBe("https://example.com");
    expect(link?.children?.[0]).toMatchObject({ type: "text", text: "site" });
  });

  it("converts <ul>/<ol> to list blocks with the right listType", () => {
    const out = htmlToLexical("<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol>");
    expect(blockTypes(out)).toEqual(["list", "list"]);
    expect(out.root.children[0]?.listType).toBe("bullet");
    expect(out.root.children[1]?.listType).toBe("number");
    expect(out.root.children[0]?.children).toHaveLength(2);
    expect(out.root.children[0]?.children?.[0]?.type).toBe("listitem");
  });

  it("converts <blockquote> to quote", () => {
    const out = htmlToLexical("<blockquote>quote me</blockquote>");
    expect(blockTypes(out)).toEqual(["quote"]);
  });

  it("converts <pre> to a code block holding the text content", () => {
    const out = htmlToLexical("<pre>line one\nline two</pre>");
    const block = out.root.children[0];
    expect(block?.type).toBe("code");
    expect(block?.children?.[0]).toMatchObject({ type: "text", text: "line one\nline two" });
  });

  it("converts <hr> to horizontalrule", () => {
    const out = htmlToLexical("<p>before</p><hr/><p>after</p>");
    expect(blockTypes(out)).toEqual(["paragraph", "horizontalrule", "paragraph"]);
  });

  it("emits a top-level <img> as an image block with src + alt", () => {
    const out = htmlToLexical('<img src="https://example.com/x.jpg" alt="x"/>');
    const block = out.root.children[0];
    expect(block?.type).toBe("image");
    expect(block?.src).toBe("https://example.com/x.jpg");
    expect(block?.altText).toBe("x");
  });

  it("preserves an inline <img> inside a paragraph", () => {
    const out = htmlToLexical('<p>before <img src="https://example.com/y.jpg" alt="y"/> after</p>');
    const para = out.root.children[0];
    expect(para?.type).toBe("paragraph");
    const img = para?.children?.find((c) => c.type === "image");
    expect(img?.src).toBe("https://example.com/y.jpg");
  });

  it("recurses through wrapping <div>/<section>/<article> containers", () => {
    const out = htmlToLexical("<div><p>one</p><p>two</p></div>");
    expect(blockTypes(out)).toEqual(["paragraph", "paragraph"]);
  });

  it("converts <br> inside a paragraph to a linebreak inline node", () => {
    const out = htmlToLexical("<p>line1<br/>line2</p>");
    const types = out.root.children[0]?.children?.map((c) => c.type);
    expect(types).toEqual(["text", "linebreak", "text"]);
  });

  it("strips <span> wrappers without losing the inner text formatting", () => {
    const out = htmlToLexical("<p><span><strong>bold</strong></span> plain</p>");
    const children = out.root.children[0]?.children ?? [];
    expect(children[0]).toMatchObject({ text: "bold", format: 1 });
    expect(children[1]).toMatchObject({ text: " plain", format: 0 });
  });
});
