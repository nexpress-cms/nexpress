/**
 * Phase 21.15 — Gutenberg block-comment fence parser.
 *
 * WP's block editor stores content as HTML with `<!-- wp:foo -->`
 * fence comments wrapping each block. The fences carry a JSON
 * attributes payload that the framework loses if we treat the
 * source as raw HTML — heading levels, ordered-list flags, custom
 * block attributes all live in the comment, not the inner markup.
 *
 * This module's only job is **structural**: it segments the source
 * string into a flat stream of `GutenbergBlock` records. Each
 * record carries the block name (`paragraph`, `heading`, ...), the
 * parsed JSON attributes (or empty object when absent), and the
 * inner HTML between the open + close fence. The block-aware
 * converter (`html-to-lexical.ts`) consumes the stream and decides
 * how to map each block onto Lexical nodes.
 *
 * What this module does NOT do:
 *
 *   - It doesn't recurse into nested blocks (`wp:columns` →
 *     `wp:column`). Nested blocks land as a single block whose
 *     inner HTML still contains the child fences; the converter
 *     decides whether to recurse into that inner HTML or treat it
 *     as classic content.
 *   - It doesn't validate the JSON attributes against any schema.
 *     Malformed JSON is treated as no attributes, with the raw
 *     attribute text preserved in `rawAttrs` so a downstream
 *     debugger can spot what was discarded.
 *
 * Sources without any `<!-- wp:` fence are detected by the caller
 * via `isGutenbergSource()` and routed through the legacy classic-
 * editor converter (untouched by this module).
 */

export interface GutenbergBlock {
  /** Block name without the `wp:` prefix, e.g. `paragraph`, `heading`, `list/item`. */
  name: string;
  /** Parsed JSON attributes from the fence. Empty when none / malformed. */
  attrs: Record<string, unknown>;
  /** Original attributes JSON string, useful for debugging. */
  rawAttrs: string;
  /** Inner HTML between the open + close fence. Empty for self-closing blocks. */
  innerHtml: string;
  /** True when the source used the `<!-- wp:foo /-->` self-closing form. */
  selfClosing: boolean;
}

const FENCE_RE = /<!--\s*(\/?)wp:([\w/-]+)(\s+(\{[\s\S]*?\}))?\s*(\/)?\s*-->/g;

/**
 * Quick check the caller uses to decide whether to route content
 * through the Gutenberg-aware path. Conservative — a single
 * `<!-- wp:` substring flips the switch.
 */
export function isGutenbergSource(html: string): boolean {
  return /<!--\s*wp:[\w/-]+/i.test(html);
}

/**
 * Walk the source linearly. State machine:
 *
 *   - At depth 0: we accumulate "loose" text/HTML between blocks.
 *     Loose chunks land as a synthetic `gutenberg-loose` block so
 *     the converter can still process them — the alternative is
 *     dropping content silently which is worse.
 *   - On an opener: push a stack frame, mark the start of inner.
 *   - On a closer matching the top frame: pop, slice the inner,
 *     emit a record. Mismatched closers are tolerated by ignoring
 *     them (we surface a malformed-source warning via the caller's
 *     log path eventually; for now they're best-effort skipped).
 *   - On a self-closing opener at depth 0: emit immediately.
 */
export function parseGutenbergBlocks(source: string): GutenbergBlock[] {
  const blocks: GutenbergBlock[] = [];
  const stack: Array<{
    name: string;
    attrs: Record<string, unknown>;
    rawAttrs: string;
    innerStart: number;
  }> = [];
  let cursor = 0;
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(source))) {
    const [full, slash, rawName, , attrsJson, selfSlash] = match;
    const isCloser = slash === "/";
    const isSelfClosing = !isCloser && selfSlash === "/";
    const name = (rawName ?? "").trim();
    const attrsRaw = (attrsJson ?? "").trim();
    const attrs = parseAttrsJson(attrsRaw);
    const matchStart = match.index;
    const matchEnd = matchStart + full.length;

    if (isCloser) {
      // Loose content between this closer and the prior cursor:
      // belongs to the closing block's inner. Pop the matching
      // frame off the stack — if the stack is empty or the top
      // frame is a different block we're looking at a corrupt
      // source. Emit nothing for the bogus closer; the cursor
      // advances past it so the rest of the source still parses.
      if (stack.length === 0) {
        cursor = matchEnd;
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top || top.name !== name) {
        // Mismatched closer — best-effort recovery: drop the closer.
        cursor = matchEnd;
        continue;
      }
      stack.pop();
      // Only emit when the popped frame is at depth 0 — nested
      // fences ride along inside their parent's innerHtml because
      // this v1 cut doesn't recurse.
      if (stack.length === 0) {
        const innerHtml = source.slice(top.innerStart, matchStart);
        blocks.push({
          name: top.name,
          attrs: top.attrs,
          rawAttrs: top.rawAttrs,
          innerHtml,
          selfClosing: false,
        });
      }
      cursor = matchEnd;
      continue;
    }

    if (isSelfClosing) {
      // Loose content before a self-closing fence at depth 0
      // becomes its own loose block.
      if (stack.length === 0 && matchStart > cursor) {
        const looseHtml = source.slice(cursor, matchStart);
        if (looseHtml.trim().length > 0) {
          blocks.push({
            name: "gutenberg-loose",
            attrs: {},
            rawAttrs: "",
            innerHtml: looseHtml,
            selfClosing: false,
          });
        }
      }
      if (stack.length === 0) {
        blocks.push({ name, attrs, rawAttrs: attrsRaw, innerHtml: "", selfClosing: true });
      }
      cursor = matchEnd;
      continue;
    }

    // Opener.
    if (stack.length === 0 && matchStart > cursor) {
      const looseHtml = source.slice(cursor, matchStart);
      if (looseHtml.trim().length > 0) {
        blocks.push({
          name: "gutenberg-loose",
          attrs: {},
          rawAttrs: "",
          innerHtml: looseHtml,
          selfClosing: false,
        });
      }
    }
    stack.push({ name, attrs, rawAttrs: attrsRaw, innerStart: matchEnd });
    cursor = matchEnd;
  }

  // Trailing loose content after the last closer.
  if (stack.length === 0 && cursor < source.length) {
    const tail = source.slice(cursor);
    if (tail.trim().length > 0) {
      blocks.push({
        name: "gutenberg-loose",
        attrs: {},
        rawAttrs: "",
        innerHtml: tail,
        selfClosing: false,
      });
    }
  }
  // Stack non-empty → unterminated block. Treat the tail (from
  // the outermost frame's innerStart to EOF) as that block's
  // body so the content survives.
  const root = stack[0];
  if (root) {
    blocks.push({
      name: root.name,
      attrs: root.attrs,
      rawAttrs: root.rawAttrs,
      innerHtml: source.slice(root.innerStart),
      selfClosing: false,
    });
  }

  return blocks;
}

function parseAttrsJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through — caller keeps `rawAttrs`
  }
  return {};
}
