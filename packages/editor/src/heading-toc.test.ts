import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { NpRichTextContent } from "@nexpress/core/fields";
import { extractHeadingToc, type NpHeadingTocEntry } from "./heading-toc.js";
import { renderRichText } from "./render-rich-text.js";

type Node = NpRichTextContent["document"]["root"]["children"][number];

function text(value: string, format = 0): Node {
  return { type: "text", version: 1, text: value, format };
}

function heading(tag: string, value: string | Node[]): Node {
  return {
    type: "heading",
    version: 1,
    tag,
    children: typeof value === "string" ? [text(value)] : value,
  };
}

function doc(...children: Node[]): NpRichTextContent {
  return {
    version: 1,
    document: {
      root: { type: "root", version: 1, direction: null, format: "", indent: 0, children },
    },
  };
}

function expectMatchingAnchors(content: NpRichTextContent, expected: NpHeadingTocEntry[]): string {
  const markup = renderToStaticMarkup(renderRichText(content, { headingAnchors: true }));
  expect(extractHeadingToc(content)).toEqual(expected);
  expect(
    [...markup.matchAll(/<h([23]) id="([^"]+)"/gu)].map((match) => ({
      level: Number(match[1]),
      id: match[2],
    })),
  ).toEqual(expected.map(({ id, level }) => ({ id, level })));
  expect([...markup.matchAll(/class="np-docs-anchor" href="#([^"]+)"/gu)].map((m) => m[1])).toEqual(
    expected.map(({ id }) => id),
  );
  return markup;
}

describe("rich-text heading anchors and table of contents", () => {
  it("preserves public heading IDs, scope, and numbering across renders", () => {
    const content = doc(
      heading("h1", "Notes"),
      heading("h2", "Notes"),
      heading("h2", "Notes"),
      heading("h3", "Notes"),
      ...["h4", "h5", "h6"].map((tag) => heading(tag, "Notes")),
      heading("h2", " \n "),
      heading("h2", "Résumé tips"),
      heading("h3", "한글 제목"),
      heading("h2", "👋"),
      heading("h3", "?!"),
      heading("h2", "  Padded  "),
      heading("h2", "Heading -- with — many   separators"),
    );
    const markup = expectMatchingAnchors(content, [
      { id: "notes", text: "Notes", level: 2 },
      { id: "notes-2", text: "Notes", level: 2 },
      { id: "notes-3", text: "Notes", level: 3 },
      { id: "resume-tips", text: "Résumé tips", level: 2 },
      { id: "한글-제목", text: "한글 제목", level: 3 },
      { id: "section", text: "👋", level: 2 },
      { id: "section-2", text: "?!", level: 3 },
      { id: "padded", text: "Padded", level: 2 },
      {
        id: "heading-with-many-separators",
        text: "Heading -- with — many   separators",
        level: 2,
      },
    ]);
    for (const tag of ["h1", "h4", "h5", "h6"]) {
      expect(markup).toContain(`<${tag}>Notes</${tag}>`);
    }
    const repeated = renderToStaticMarkup(renderRichText(content));
    expect(repeated.match(/<h[23] id="[^"]+"/gu)).toEqual(markup.match(/<h[23] id="[^"]+"/gu));
    expect(repeated).not.toContain("np-docs-anchor");
  });

  it("uses the rendered text for line breaks and nested inline formatting", () => {
    const markup = expectMatchingAnchors(
      doc(
        heading("h2", [text("Hello", 1), { type: "linebreak", version: 1 }, text("world")]),
        heading("h3", [
          { type: "link", version: 1, url: "/hello", children: [text("Hello ", 2)] },
          text("world"),
        ]),
        heading("h2", [text("Hello "), text("world", 16)]),
      ),
      [
        { id: "hello-world", text: "Hello\nworld", level: 2 },
        { id: "hello-world-2", text: "Hello world", level: 3 },
        { id: "hello-world-3", text: "Hello world", level: 2 },
      ],
    );
    expect(markup).toContain("<strong>Hello</strong><br/>world");
    expect(markup).toContain('<a href="/hello"><em>Hello </em></a>world');
    expect(markup).toContain("Hello <code>world</code>");
  });

  it("includes only headings rendered through container children", () => {
    expectMatchingAnchors(
      doc(
        ...["text", "code", "image", "horizontalrule", "linebreak"].map((type) => ({
          type,
          version: 1,
          text: "Leaf",
          src: "/image.png",
          children: [heading("h2", "Visible")],
        })),
        { type: "custom-container", version: 1, children: [heading("h2", "Visible")] },
        { type: "quote", version: 1, children: [heading("h3", "Visible")] },
      ),
      [
        { id: "visible", text: "Visible", level: 2 },
        { id: "visible-2", text: "Visible", level: 3 },
      ],
    );
  });
});
