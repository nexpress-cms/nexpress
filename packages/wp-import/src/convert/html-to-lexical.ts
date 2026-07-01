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
 * Gutenberg block-comment fences (`<!-- wp:paragraph -->`) are
 * handled in a narrow, content-preserving pass before the classic
 * HTML converter runs. Core blocks with structural attributes
 * (heading level, ordered-list flag, image figure, embeds, and
 * separators) get explicit handling; unknown blocks fall back to
 * their inner HTML and emit a warning through `onWarning`.
 *
 * NOT in this PR:
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

export interface LexicalConversionWarning {
  code: "unknown-gutenberg-block" | "malformed-gutenberg-attrs";
  blockName: string;
  message: string;
  rawAttrs?: string;
}

export interface HtmlToLexicalOptions {
  onWarning?: (warning: LexicalConversionWarning) => void;
}

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_STRIKETHROUGH = 4;
const FORMAT_UNDERLINE = 8;
const FORMAT_CODE = 16;

const QUOTE_CITATION_TAGS = new Set(["cite"]);

const GUTENBERG_PASSTHROUGH_BLOCKS = new Set([
  "paragraph",
  "freeform",
  "html",
  "classic",
  "gallery",
  "group",
  "columns",
  "column",
  "media-text",
  "cover",
  "buttons",
  "button",
  "table",
  "details",
]);

/**
 * Convert raw WP content HTML into a Lexical root document.
 * Always returns a valid Lexical structure — empty input becomes a
 * single empty paragraph, matching what the editor would produce
 * for a freshly-created field.
 */
export function htmlToLexical(html: string, options: HtmlToLexicalOptions = {}): LexicalRoot {
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
      convertGutenbergBlock(block, blocks, options);
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
function convertGutenbergBlock(
  block: GutenbergBlock,
  out: LexicalBlock[],
  options: HtmlToLexicalOptions,
): void {
  const name = normalizeGutenbergName(block.name);
  if (hasMalformedAttrs(block.rawAttrs, block.attrs)) {
    options.onWarning?.({
      code: "malformed-gutenberg-attrs",
      blockName: block.name,
      rawAttrs: block.rawAttrs,
      message: `Gutenberg block "${block.name}" had malformed JSON attributes; inner content was preserved without those attributes.`,
    });
  }

  // Self-closing structural blocks land directly. Today only
  // a few core blocks have a clear Lexical analog. Empty unknown
  // self-closing blocks are reported because there is no inner
  // content to preserve.
  if (block.selfClosing) {
    if (name === "separator" || name === "more" || name === "nextpage" || name === "page-break") {
      out.push({
        type: "horizontalrule",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
      });
    } else if (name === "spacer") {
      out.push(paragraph([]));
    } else {
      warnUnknownBlock(block, options);
    }
    return;
  }

  // Loose content (the synthetic name parseGutenbergBlocks emits
  // for text between fences) — fall through to the classic path.
  if (name === "gutenberg-loose") {
    runClassicPath(block.innerHtml, out);
    return;
  }

  switch (name) {
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
    case "image":
      convertImageBlock(block.innerHtml, out);
      return;
    case "embed":
      convertEmbedBlock(block.innerHtml, out);
      return;
    case "video":
    case "audio":
    case "file":
      convertMediaLinkBlock(block.innerHtml, out);
      return;
    case "quote":
    case "pullquote":
      convertQuoteBlock(block.innerHtml, out);
      return;
    case "code":
    case "preformatted":
    case "verse":
      runClassicPath(block.innerHtml, out);
      return;
    case "separator":
    case "more":
    case "nextpage":
    case "page-break":
      out.push({
        type: "horizontalrule",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
      });
      return;
    case "spacer":
      out.push(paragraph([]));
      return;
    default:
      // Most known layout blocks (paragraph, group, columns,
      // buttons, table, ...) carry markup that the classic
      // converter already maps cleanly. For truly unknown blocks
      // we still preserve inner content but surface a warning so
      // operators know which imported records deserve a manual
      // spot-check.
      if (!GUTENBERG_PASSTHROUGH_BLOCKS.has(name)) {
        warnUnknownBlock(block, options);
      }
      runGutenbergOrClassicPath(block.innerHtml, out, options);
  }
}

function normalizeGutenbergName(name: string): string {
  return name.startsWith("core/") ? name.slice("core/".length) : name;
}

function hasMalformedAttrs(rawAttrs: string, attrs: Record<string, unknown>): boolean {
  const raw = rawAttrs.trim();
  if (!raw || Object.keys(attrs).length > 0) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return !(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return true;
  }
}

function warnUnknownBlock(block: GutenbergBlock, options: HtmlToLexicalOptions): void {
  options.onWarning?.({
    code: "unknown-gutenberg-block",
    blockName: block.name,
    rawAttrs: block.rawAttrs || undefined,
    message: `Unsupported Gutenberg block "${block.name}" was imported by preserving its inner HTML only.`,
  });
}

function runGutenbergOrClassicPath(
  html: string,
  out: LexicalBlock[],
  options: HtmlToLexicalOptions,
): void {
  if (isGutenbergSource(html)) {
    for (const block of parseGutenbergBlocks(html)) {
      convertGutenbergBlock(block, out, options);
    }
    return;
  }
  runClassicPath(html, out);
}

function runClassicPath(html: string, out: LexicalBlock[]): void {
  const parsed = parse(html, { lowerCaseTagName: true });
  for (const child of parsed.childNodes) {
    convertTopLevel(child, out);
  }
}

function convertImageBlock(html: string, out: LexicalBlock[]): void {
  const parsed = parse(html, { lowerCaseTagName: true });
  const img = findFirstElement(parsed, "img");
  if (!img) {
    runClassicPath(html, out);
    return;
  }

  out.push(imageBlock(img));
  const caption = findFirstElement(parsed, "figcaption");
  const captionChildren = caption ? convertInline(caption) : [];
  if (captionChildren.length > 0) {
    out.push(paragraph(captionChildren));
  }
}

function convertEmbedBlock(html: string, out: LexicalBlock[]): void {
  const parsed = parse(html, { lowerCaseTagName: true });
  const caption = findFirstElement(parsed, "figcaption");
  const url = findFirstUrl(parsed, ["src", "href"]);

  if (url) {
    out.push(
      paragraph([
        {
          type: "link",
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          url,
          children: [textNode(url, 0)],
        },
      ]),
    );
    const captionChildren = caption ? convertInline(caption) : [];
    if (captionChildren.length > 0) out.push(paragraph(captionChildren));
    return;
  }

  runClassicPath(html, out);
}

function convertMediaLinkBlock(html: string, out: LexicalBlock[]): void {
  const parsed = parse(html, { lowerCaseTagName: true });
  const url = findFirstUrl(parsed);
  if (!url) {
    runClassicPath(html, out);
    return;
  }
  out.push(
    paragraph([
      {
        type: "link",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        url,
        children: [textNode(url, 0)],
      },
    ]),
  );
}

function convertQuoteBlock(html: string, out: LexicalBlock[]): void {
  const parsed = parse(html, { lowerCaseTagName: true });
  const quote = findFirstElement(parsed, "blockquote");
  if (!quote) {
    runClassicPath(html, out);
    return;
  }

  const children: LexicalNode[] = [];
  const cite = findFirstElement(quote, "cite");
  for (const child of quote.childNodes) {
    walkInline(child, 0, children, QUOTE_CITATION_TAGS);
  }
  if (cite && cite.text.trim().length > 0) {
    children.push({
      type: "linebreak",
      version: 1,
      format: "",
      indent: 0,
      direction: null,
    });
    children.push(...convertInline(cite));
  }
  out.push({
    type: "quote",
    version: 1,
    format: "",
    indent: 0,
    direction: null,
    children,
  });
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
    case "figure":
      convertFigure(el, out);
      return;
    case "iframe": {
      const src = el.getAttribute("src");
      if (src) {
        out.push(
          paragraph([
            {
              type: "link",
              version: 1,
              format: "",
              indent: 0,
              direction: null,
              url: src,
              children: [textNode(src, 0)],
            },
          ]),
        );
      }
      return;
    }
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

function convertFigure(el: HTMLElement, out: LexicalBlock[]): void {
  const img = findFirstElement(el, "img");
  if (img) {
    out.push(imageBlock(img));
    const caption = findFirstElement(el, "figcaption");
    const captionChildren = caption ? convertInline(caption) : [];
    if (captionChildren.length > 0) out.push(paragraph(captionChildren));
    return;
  }

  const iframe = findFirstElement(el, "iframe");
  const iframeSrc = iframe?.getAttribute("src");
  if (iframeSrc) {
    out.push(
      paragraph([
        {
          type: "link",
          version: 1,
          format: "",
          indent: 0,
          direction: null,
          url: iframeSrc,
          children: [textNode(iframeSrc, 0)],
        },
      ]),
    );
    return;
  }

  for (const child of el.childNodes) convertTopLevel(child, out);
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
  "figure",
  "figcaption",
  "iframe",
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

function findFirstElement(root: HTMLElement, tagName: string): HTMLElement | null {
  if ((root.tagName ?? "").toLowerCase() === tagName) return root;
  for (const child of root.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const found = findFirstElement(child as HTMLElement, tagName);
    if (found) return found;
  }
  return null;
}

function findFirstUrl(
  root: HTMLElement,
  priority: Array<"href" | "src"> = ["href", "src"],
): string | null {
  for (const attr of priority) {
    const found = findFirstElementWithAttribute(root, attr);
    const url = found?.getAttribute(attr);
    if (url) return url;
  }

  const match = root.text.match(/https?:\/\/[^\s<>"']+/);
  return match?.[0] ?? null;
}

function findFirstElementWithAttribute(root: HTMLElement, attr: string): HTMLElement | null {
  if (root.getAttribute(attr)) return root;
  for (const child of root.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const found = findFirstElementWithAttribute(child as HTMLElement, attr);
    if (found) return found;
  }
  return null;
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

function walkInline(
  node: Node,
  format: number,
  out: LexicalNode[],
  skipTags?: ReadonlySet<string>,
): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.text;
    if (!text) return;
    out.push(textNode(text, format));
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = (el.tagName ?? "").toLowerCase();
  if (skipTags?.has(tag)) return;

  switch (tag) {
    case "strong":
    case "b":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_BOLD, out, skipTags);
      return;
    case "em":
    case "i":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_ITALIC, out, skipTags);
      return;
    case "u":
      for (const child of el.childNodes)
        walkInline(child, format | FORMAT_UNDERLINE, out, skipTags);
      return;
    case "s":
    case "del":
    case "strike":
      for (const child of el.childNodes) {
        walkInline(child, format | FORMAT_STRIKETHROUGH, out, skipTags);
      }
      return;
    case "code":
      for (const child of el.childNodes) walkInline(child, format | FORMAT_CODE, out, skipTags);
      return;
    case "a": {
      const url = el.getAttribute("href") ?? "";
      const inner: LexicalNode[] = [];
      for (const child of el.childNodes) walkInline(child, format, inner, skipTags);
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
      for (const child of el.childNodes) walkInline(child, format, out, skipTags);
      return;
    default: {
      // Unknown inline element — fall through with whatever
      // text it contains.
      for (const child of el.childNodes) walkInline(child, format, out, skipTags);
    }
  }
}
