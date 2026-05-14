/**
 * Slugify a heading's plain text into a URL-safe id. Shared by
 * `renderRichText` (which writes the id onto h2/h3) and
 * `extractHeadingToc` (which walks the document to produce the
 * matching anchor list). Same function, same input → both sides
 * agree on the slug, so a theme's "On this page" links resolve.
 *
 *   - NFKD splits "é" → "e" + combining accent so the `\p{M}`
 *     pass can drop diacritics. It also decomposes Hangul
 *     syllables into conjoining jamo letters; the final NFC
 *     re-composes them so a Korean heading like "한글" round-
 *     trips intact instead of surfacing in the URL as decomposed
 *     jamo.
 *   - Lowercases, replaces runs of non-letter/digit/underscore
 *     with a single hyphen, trims edge hyphens.
 *   - Empty result (punctuation- or emoji-only heading) → falls
 *     back to `"section"` so the element still has an addressable
 *     id and the TOC link still resolves.
 */
export function slugifyHeading(text: string): string {
  const stripped = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = stripped.normalize("NFC");
  return slug.length > 0 ? slug : "section";
}

/**
 * One entry per heading. `id` already accounts for in-document
 * collisions (`"Notes"` twice → `notes` and `notes-2`), so
 * consumers can render `<a href={\`#${entry.id}\`}>` directly.
 */
export interface NpHeadingTocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Walk a Lexical document and emit one TOC entry per h2/h3.
 *
 * Matches `renderRichText`'s id-emission scope (h2/h3 only — h1
 * is the page title, h4+ is below typical TOC scope) and reuses
 * the same slug + collision counter so anchor hrefs line up with
 * heading ids 1:1. Themes call this for their on-page TOC; the
 * docs theme is the reference consumer.
 */
export function extractHeadingToc(content: unknown): NpHeadingTocEntry[] {
  if (!content || typeof content !== "object") return [];
  const root = (content as { root?: { children?: unknown[] } }).root;
  if (!root || !Array.isArray(root.children)) return [];
  const out: NpHeadingTocEntry[] = [];
  const seen = new Map<string, number>();
  walk(root.children, out, seen);
  return out;
}

function walk(
  nodes: unknown[],
  out: NpHeadingTocEntry[],
  seen: Map<string, number>,
): void {
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as { type?: unknown; tag?: unknown; children?: unknown };
    if (node.type === "heading" && (node.tag === "h2" || node.tag === "h3")) {
      const text = collectText(Array.isArray(node.children) ? node.children : []);
      if (text.length > 0) {
        const slug = slugifyHeading(text);
        const prior = seen.get(slug) ?? 0;
        seen.set(slug, prior + 1);
        const id = prior === 0 ? slug : `${slug}-${(prior + 1).toString()}`;
        out.push({ id, text, level: node.tag === "h2" ? 2 : 3 });
      }
      continue;
    }
    if (Array.isArray(node.children)) walk(node.children, out, seen);
  }
}

function collectText(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as { text?: unknown; children?: unknown };
    if (typeof node.text === "string") parts.push(node.text);
    else if (Array.isArray(node.children)) parts.push(collectText(node.children));
  }
  return parts.join("").trim();
}
