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

  describe("Phase 21.15 — Gutenberg block fences", () => {
    it("converts wp:paragraph into a paragraph block", () => {
      const out = htmlToLexical("<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->");
      expect(out.root.children).toHaveLength(1);
      expect(out.root.children[0]?.type).toBe("paragraph");
    });

    it("honors wp:heading {level} when the fence and markup disagree", () => {
      // Markup says h2, fence says h4 — fence wins.
      const out = htmlToLexical(
        '<!-- wp:heading {"level":4} --><h2>Title</h2><!-- /wp:heading -->',
      );
      expect(out.root.children[0]?.type).toBe("heading");
      expect(out.root.children[0]?.tag).toBe("h4");
    });

    it("synthesises a heading when the fence inner is plain text", () => {
      const out = htmlToLexical('<!-- wp:heading {"level":3} -->Just text<!-- /wp:heading -->');
      const block = out.root.children[0];
      expect(block?.type).toBe("heading");
      expect(block?.tag).toBe("h3");
      expect(block?.children?.[0]).toMatchObject({ text: "Just text" });
    });

    it("flips list type when the fence's `ordered` flag overrides the markup", () => {
      const out = htmlToLexical(
        '<!-- wp:list {"ordered":true} --><ul><li>a</li></ul><!-- /wp:list -->',
      );
      expect(out.root.children[0]?.type).toBe("list");
      expect(out.root.children[0]?.listType).toBe("number");
    });

    it("maps wp:separator (self-closing) to horizontalrule", () => {
      const out = htmlToLexical(
        "<!-- wp:paragraph --><p>before</p><!-- /wp:paragraph --><!-- wp:separator /--><!-- wp:paragraph --><p>after</p><!-- /wp:paragraph -->",
      );
      expect(out.root.children.map((c) => c.type)).toEqual([
        "paragraph",
        "horizontalrule",
        "paragraph",
      ]);
    });

    it("maps wp:image figure markup to an image block plus caption paragraph", () => {
      const out = htmlToLexical(
        '<!-- wp:image {"id":7} --><figure class="wp-block-image"><img src="https://example.com/hero.jpg" alt="Hero"/><figcaption>Hero caption</figcaption></figure><!-- /wp:image -->',
      );
      expect(out.root.children.map((c) => c.type)).toEqual(["image", "paragraph"]);
      expect(out.root.children[0]).toMatchObject({
        type: "image",
        src: "https://example.com/hero.jpg",
        altText: "Hero",
      });
      expect(out.root.children[1]?.children?.[0]).toMatchObject({ text: "Hero caption" });
    });

    it("maps wp:embed iframe markup to a link paragraph and keeps the caption", () => {
      const out = htmlToLexical(
        '<!-- wp:embed {"providerNameSlug":"youtube"} --><figure><div><iframe src="https://www.youtube.com/embed/abc"></iframe></div><figcaption>Watch this</figcaption></figure><!-- /wp:embed -->',
      );
      expect(out.root.children.map((c) => c.type)).toEqual(["paragraph", "paragraph"]);
      const link = out.root.children[0]?.children?.[0];
      expect(link).toMatchObject({
        type: "link",
        url: "https://www.youtube.com/embed/abc",
      });
      expect(out.root.children[1]?.children?.[0]).toMatchObject({ text: "Watch this" });
    });

    it("prefers the embedded media URL over caption links", () => {
      const out = htmlToLexical(
        '<!-- wp:embed --><figure><iframe src="https://video.example.com/embed/1"></iframe><figcaption><a href="https://caption.example.com">caption</a></figcaption></figure><!-- /wp:embed -->',
      );
      const link = out.root.children[0]?.children?.[0];
      expect(link).toMatchObject({
        type: "link",
        url: "https://video.example.com/embed/1",
      });
    });

    it("preserves wp:gallery content without unsupported-block warnings", () => {
      const warnings: string[] = [];
      const out = htmlToLexical(
        '<!-- wp:gallery --><figure><img src="https://example.com/one.jpg" alt="One"/></figure><!-- /wp:gallery -->',
        {
          onWarning: (warning) => warnings.push(warning.code),
        },
      );
      expect(out.root.children[0]).toMatchObject({
        type: "image",
        src: "https://example.com/one.jpg",
      });
      expect(warnings).toEqual([]);
    });

    it("recurses through nested Gutenberg layout blocks so child attrs still apply", () => {
      const out = htmlToLexical(
        '<!-- wp:group --><!-- wp:heading {"level":5} --><h2>Nested</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph --><!-- /wp:group -->',
      );
      expect(out.root.children.map((c) => c.type)).toEqual(["heading", "paragraph"]);
      expect(out.root.children[0]?.tag).toBe("h5");
    });

    it("maps wp:more and wp:spacer structural blocks without dropping document shape", () => {
      const out = htmlToLexical(
        "<!-- wp:paragraph --><p>before</p><!-- /wp:paragraph --><!-- wp:more /--><!-- wp:spacer /--><!-- wp:paragraph --><p>after</p><!-- /wp:paragraph -->",
      );
      expect(out.root.children.map((c) => c.type)).toEqual([
        "paragraph",
        "horizontalrule",
        "paragraph",
        "paragraph",
      ]);
    });

    it("falls through to the classic converter for unknown blocks", () => {
      const warnings: string[] = [];
      const out = htmlToLexical(
        "<!-- wp:custom-foo --><blockquote>cite</blockquote><!-- /wp:custom-foo -->",
        {
          onWarning: (warning) => warnings.push(`${warning.code}:${warning.blockName}`),
        },
      );
      expect(out.root.children[0]?.type).toBe("quote");
      expect(warnings).toEqual(["unknown-gutenberg-block:custom-foo"]);
    });

    it("warns on malformed Gutenberg attributes while preserving content", () => {
      const warnings: string[] = [];
      const out = htmlToLexical(
        "<!-- wp:paragraph {bad json} --><p>Safe</p><!-- /wp:paragraph -->",
        {
          onWarning: (warning) => warnings.push(`${warning.code}:${warning.rawAttrs}`),
        },
      );
      expect(out.root.children[0]?.children?.[0]).toMatchObject({ text: "Safe" });
      expect(warnings).toEqual(["malformed-gutenberg-attrs:{bad json}"]);
    });

    it("does not warn for a valid empty Gutenberg attributes object", () => {
      const warnings: string[] = [];
      htmlToLexical("<!-- wp:paragraph {} --><p>Safe</p><!-- /wp:paragraph -->", {
        onWarning: (warning) => warnings.push(warning.code),
      });
      expect(warnings).toEqual([]);
    });

    it("keeps quote citations once with a line break", () => {
      const out = htmlToLexical(
        "<!-- wp:quote --><blockquote><p>Quoted</p><cite>Alice</cite></blockquote><!-- /wp:quote -->",
      );
      const children = out.root.children[0]?.children ?? [];
      expect(children.map((node) => node.type)).toEqual(["text", "linebreak", "text"]);
      expect(children[0]).toMatchObject({ text: "Quoted" });
      expect(children[2]).toMatchObject({ text: "Alice" });
    });

    it("keeps nested quote citations once", () => {
      const out = htmlToLexical(
        "<!-- wp:quote --><blockquote><p>Quoted <cite>Alice</cite></p></blockquote><!-- /wp:quote -->",
      );
      const children = out.root.children[0]?.children ?? [];
      expect(children.map((node) => node.type)).toEqual(["text", "linebreak", "text"]);
      expect(children[0]).toMatchObject({ text: "Quoted " });
      expect(children[2]).toMatchObject({ text: "Alice" });
    });
  });
});
