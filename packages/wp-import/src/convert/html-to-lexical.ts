import { type HTMLElement, type Node, NodeType, parse } from "node-html-parser";

import { isGutenbergSource, parseGutenbergBlocks, type GutenbergBlock } from "./gutenberg.js";

/**
 * Phase 21.4 — HTML → Lexical AST.
 *
 * Resolves design doc §11.1: roll our own minimal converter rather
 * than wrap a heavier ecosystem library. Rationale:
 *
 *   - The set of WP HTML constructs we care about is small —
 *     paragraphs, headings, lists, blockquote, basic inline
 *     formatting, links, images, line breaks, hr, code.
 *   - `node-html-parser` gives us a lenient HTML5 parse with no
 *     DOM dependency (works in Node and edge runtimes).
 *   - The Lexical node shape is well-documented in the framework's
 *     own renderer (`packages/editor/src/render-rich-text.tsx`),
 *     so we emit exactly what the renderer expects.
 *
 * NOT in this PR:
 *   - Gutenberg block-comment syntax (`<!-- wp:paragraph -->`).
 *     Treat the comments as text noise; Phase 21.4b can layer
 *     block awareness on top once we have a real WP fixture to
 *     validate against.
 *   - Image media-id resolution. <img> nodes are emitted with
 *     the source URL as `src`; Phase 21.5 swaps these to
 *     NexPress media ids after the upload pipeline runs.
 *   - Custom shortcodes (`[gallery]`, etc.). Out of scope per
 *     design doc §2 — handled by the long-tail conversion pass.
 */

export interface LexicalRoot {
  root: {
    type: "root";
    direction: null;
    format: "";
    indent: 0;
    version: 1;
    children: LexicalBlock[];
  };
}

interface LexicalBlock {
  type: string;
  version: 1;
  format: "" | number;
  indent: number;
  direction: null;
  children?: LexicalNode[];
  // Discriminated extras handled per node type:
  tag?: string;
  listType?: "bullet" | "number";
  url?: string;
  src?: string;
  altText?: string;
  text?: string;
}

type LexicalNode = LexicalBlock;

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_STRIKETHROUGH = 4;
const FORMAT_UNDERLINE = 8;
const FORMAT_CODE = 16;

/**
 * Convert raw WP content HTML into a Lexical root document.
 * Always returns a valid Lexical structure — empty input becomes a
 * single empty paragraph, matching what the editor would produce
 * for a freshly-created field.
 */
export function htmlToLexical(html: string): LexicalRoot {
  const trimmed = html.trim();
  if (!trimmed) {
    return emptyDocument();
  }

  // Phase 21.15 — when the source carries Gutenberg block fences,
  // route through the block-aware converter so we honor the JSON
  // attribute payload (heading levels, ordered-list flag, etc.).
  // Sources without a `<!-- wp:` fence keep going through the
  // legacy classic-editor path — same shape, same behavior.
  const blocks: LexicalBlock[] = [];
  if (isGutenbergSource(trimmed)) {
    for (const block of parseGutenbergBlocks(trimmed)) {
      convertGutenbergBlock(block, blocks);
    }
  } else {
    // `parse()` wraps the input in a synthetic root element. Walk
    // its children as top-level blocks.
    const parsed = parse(trimmed, { lowerCaseTagName: true });
    for (const child of parsed.childNodes) {
      convertTopLevel(child, blocks);
    }
  }

  if (blocks.length === 0) {
    return emptyDocument();
  }

  return {
    root: {
      type: "root",
      direction: null,
      format: "",
      indent: 0,
      version: 1,
      children: blocks,
    },
  };
}

/**
 * Phase 21.15 — turn a single Gutenberg block into one or more
 * Lexical blocks. Most blocks bottom out in the existing per-tag
 * converters (`convertTopLevel`), so this function's job is just
 * to reach in for the block-attribute hints (heading level, list
 * ordering) and override what `convertTopLevel` would have
 * inferred from the markup alone.
 */
function convertGutenbergBlock(block: GutenbergBlock, out: LexicalBlock[]): void {
  // Self-closing structural blocks land directly. Today only
  // `wp:separator` has a clear Lexical analog; others (spacer,
  // page-break) fall through to plain paragraphs so the document
  // shape survives.
  if (block.selfClosing) {
    if (block.name === "separator") {
      out.push({
        type: "horizontalrule",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
      });
    }
    return;
  }

  // Loose content (the synthetic name parseGutenbergBlocks emits
  // for text between fences) — fall through to the classic path.
  if (block.name === "gutenberg-loose") {
    runClassicPath(block.innerHtml, out);
    return;
  }

  switch (block.name) {
    case "heading": {
      // The fence may pin a level (1–6); if absent we fall back to
      // whatever <h*> tag the inner markup carries.
      const innerBlocks: LexicalBlock[] = [];
      runClassicPath(block.innerHtml, innerBlocks);
      const heading = innerBlocks.find((b) => b.type === "heading");
      if (heading) {
        const lvl = block.attrs.level;
        if (typeof lvl === "number" && lvl >= 1 && lvl <= 6) {
          heading.tag = `h${lvl}`;
        }
        out.push(heading);
        // Anything else (rare — should be empty) tags along.
        for (const b of innerBlocks) if (b !== heading) out.push(b);
      } else {
        // Fence said heading but inner has none — synthesise one
        // at the requested level using the inner text.
        const lvl = typeof block.attrs.level === "number" ? block.attrs.level : 2;
        out.push({
          type: "heading",
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          tag: `h${Math.min(6, Math.max(1, lvl))}`,
          children: [textNode(stripTags(block.innerHtml), 0)],
        });
      }
      return;
    }
    case "list": {
      // The fence's `ordered: true` flag wins over the markup
      // when they disagree — markup edits sometimes lose the
      // <ol>/<ul> swap and trust the attribute instead.
      const innerBlocks: LexicalBlock[] = [];
      runClassicPath(block.innerHtml, innerBlocks);
      const list = innerBlocks.find((b) => b.type === "list");
      if (list) {
        if (block.attrs.ordered === true) list.listType = "number";
        else if (block.attrs.ordered === false) list.listType = "bullet";
        out.push(list);
      } else {
        runClassicPath(block.innerHtml, out);
      }
      return;
    }
    default:
      // Most blocks (paragraph, quote, code, image, gallery,
      // group, columns, ...) carry markup that the classic
      // converter already maps cleanly. Recurse and let the
      // existing path handle them.
      runClassicPath(block.innerHtml, out);
  }
}

function runClassicPath(html: string, out: LexicalBlock[]): void {
  const parsed = parse(html, { lowerCaseTagName: true });
  for (const child of parsed.childNodes) {
    convertTopLevel(child, out);
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function emptyDocument(): LexicalRoot {
  return {
    root: {
      type: "root",
      direction: null,
      format: "",
      indent: 0,
      version: 1,
      children: [paragraph([])],
    },
  };
}

/**
 * A "top-level" node becomes one block in the document — either a
 * direct mapping (`<p>` → paragraph, `<h2>` → heading) or a wrap
 * (loose text gets bundled into an implicit paragraph).
 */
function convertTopLevel(node: Node, out: LexicalBlock[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.text;
    if (text.trim().length === 0) return;
    out.push(paragraph([textNode(text, 0)]));
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();

  switch (tag) {
    case "p":
      out.push(paragraph(convertInline(el)));
      return;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      out.push({
        type: "heading",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        tag,
        children: convertInline(el),
      });
      return;
    case "blockquote":
      out.push({
        type: "quote",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        children: convertInline(el),
      });
      return;
    case "ul":
    case "ol":
      out.push(convertList(el, tag === "ol" ? "number" : "bullet"));
      return;
    case "pre":
      out.push({
        type: "code",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        children: [textNode(el.text, 0)],
      });
      return;
    case "hr":
      out.push({
        type: "horizontalrule",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
      });
      return;
    case "img":
      out.push(imageBlock(el));
      return;
    case "br":
      // A <br> at top level is rare but appears in WP content
      // around editor switches. Emit as an empty paragraph so the
      // visual gap survives.
      out.push(paragraph([]));
      return;
    case "div":
    case "section":
    case "article":
      // Containers — recurse without an extra wrapping paragraph.
      for (const child of el.childNodes) convertTopLevel(child, out);
      return;
    default: {
      // Unknown block-ish element: bundle its inline content into
      // a paragraph so the text isn't lost. If it has block
      // children of its own (e.g. a stray <table>) we recurse.
      const hasBlockChild = el.childNodes.some(
        (c) => c.nodeType === NodeType.ELEMENT_NODE && isBlockTag(c as HTMLElement),
      );
      if (hasBlockChild) {
        for (const child of el.childNodes) convertTopLevel(child, out);
      } else {
        const inline = convertInline(el);
        if (inline.length > 0) out.push(paragraph(inline));
      }
    }
  }
}

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "hr",
  "div",
  "section",
  "article",
  "table",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
]);

function isBlockTag(el: HTMLElement): boolean {
  return BLOCK_TAGS.has((el.tagName ?? "").toLowerCase());
}

function paragraph(children: LexicalNode[]): LexicalBlock {
  return {
    type: "paragraph",
    version: 1,
    format: "",
    indent: 0,
    direction: null,
    children,
  };
}

function textNode(text: string, format: number): LexicalNode {
  return {
    type: "text",
    version: 1,
    format,
    indent: 0,
    direction: null,
    text,
  };
}

function imageBlock(el: HTMLElement): LexicalBlock {
  return {
    type: "image",
    version: 1,
    format: "",
    indent: 0,
    direction: null,
    src: el.getAttribute("src") ?? "",
    altText: el.getAttribute("alt") ?? "",
  };
}

function convertList(el: HTMLElement, listType: "bullet" | "number"): LexicalBlock {
  const items: LexicalBlock[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const inner = child as HTMLElement;
    if ((inner.tagName ?? "").toLowerCase() !== "li") continue;
    items.push({
      type: "listitem",
      version: 1,
      format: "",
      indent: 0,
      direction: null,
      children: convertInline(inner),
    });
  }
  return {
    type: "list",
    version: 1,
    format: "",
    indent: 0,
    direction: null,
    listType,
    children: items,
  };
}

/**
 * Walk an element's children and emit Lexical inline nodes —
 * text spans with bitmask `format`, or `link` / `linebreak`
 * structural inlines.
 */
function convertInline(el: HTMLElement): LexicalNode[] {
  const out: LexicalNode[] = [];
  walkInline(el, 0, out);
  return out;
}

function walkInline(node: Node, format: number, out: LexicalNode[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.text;
    if (!text) return;
    out.push(textNode(text, format));
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = (el.tagName ?? "").toLowerCase();

  switch (tag) {
    case "strong":
    case "b":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_BOLD, out);
      return;
    case "em":
    case "i":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_ITALIC, out);
      return;
    case "u":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_UNDERLINE, out);
      return;
    case "s":
    case "del":
    case "strike":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_STRIKETHROUGH, out);
      return;
    case "code":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_CODE, out);
      return;
    case "a": {
      const url = el.getAttribute("href") ?? "";
      const inner: LexicalNode[] = [];
      for (const child of el.childNodes) walkInline(child, format, inner);
      out.push({
        type: "link",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        url,
        children: inner,
      });
      return;
    }
    case "br":
      out.push({
        type: "linebreak",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
      });
      return;
    case "img":
      // Inline <img> inside a paragraph — Lexical doesn't have a
      // proper inline-image node, so we emit a block image. The
      // surrounding paragraph still renders cleanly because the
      // Lexical renderer falls back to fragment for unknown
      // children. Phase 21.5 may want to revisit this.
      out.push(imageBlock(el));
      return;
    case "span":
      // Strip span wrappers — they almost always carry styling
      // we don't want. Walk their children with the inherited
      // format mask.
      for (const child of el.childNodes) walkInline(child, format, out);
      return;
    default: {
      // Unknown inline element — fall through with whatever
      // text it contains.
      for (const child of el.childNodes) walkInline(child, format, out);
    }
  }
}
