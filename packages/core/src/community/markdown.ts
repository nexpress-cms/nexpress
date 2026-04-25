/**
 * Tiny safe markdown renderer for comment bodies. Deliberately minimal:
 * we escape every byte first, then pattern-match a small set of inline
 * + block constructs so the output HTML can only ever contain the
 * limited tag set listed below. No raw HTML pass-through, ever.
 *
 * Supported:
 *   - Bold        `**text**`     → `<strong>text</strong>`
 *   - Italic      `*text*`       → `<em>text</em>`
 *   - Inline code `` `code` ``   → `<code>code</code>`
 *   - Code block  ``` … ```     → `<pre><code>…</code></pre>`
 *   - Link        `[t](url)`    → `<a href="url" rel="…">t</a>`
 *                 (URL must start with http://, https://, or mailto:)
 *   - Paragraph break: blank line
 *   - Hard break  single \n     → `<br/>`
 *
 * NOT supported (deliberate, to keep the renderer tight + safe):
 *   raw HTML, headings, lists, blockquotes, images, tables. If users
 *   need richer formatting in 9.3+, plug `marked` + `dompurify` here
 *   without changing the public function shape.
 */

const URL_RE = /^(?:https?:\/\/|mailto:)[^\s)]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  // Escape the entire chunk first so any subsequent replacements only
  // produce HTML we explicitly emit. Order matters: code spans absorb
  // anything inside them so they have to win first.
  let html = escapeHtml(text);

  // Inline code: `code`. Greedy single-backtick pairs only.
  html = html.replace(/`([^`\n]+?)`/g, (_match, code) => `<code>${code}</code>`);

  // Bold: **text** — applied before italic so the `**` patterns aren't
  // greedily eaten by the italic regex.
  html = html.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<strong>$1</strong>");

  // Italic: *text* — must not be adjacent to whitespace on either side
  // (CommonMark behavior). We match `*` followed by a non-space group
  // ending in a non-space.
  html = html.replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "<em>$1</em>");

  // Links: [text](url) — URL must already match the allow-list.
  html = html.replace(/\[([^\]\n]+?)\]\(([^)\n]+?)\)/g, (_match, label, rawUrl) => {
    if (!URL_RE.test(rawUrl)) return `[${label}](${rawUrl})`;
    return `<a href="${rawUrl}" rel="nofollow ugc" target="_blank">${label}</a>`;
  });

  // Hard breaks within a paragraph.
  html = html.replace(/\n/g, "<br/>");

  return html;
}

/**
 * Render a comment body markdown source to safe HTML. Pure function;
 * idempotent; safe to call on the write path AND on display (we still
 * persist the rendered version to avoid re-rendering on every read).
 */
export function renderCommentMarkdown(source: string): string {
  if (!source) return "";

  const blocks: string[] = [];
  let cursor = 0;
  const fenceRe = /```([\s\S]*?)```/g;

  // Pull out fenced code blocks first so their contents don't get
  // mangled by inline rules. Render them as <pre><code> with the
  // contents HTML-escaped (no language highlighting in v1).
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(source)) !== null) {
    const before = source.slice(cursor, match.index);
    if (before) blocks.push(renderTextBlocks(before));
    blocks.push(`<pre><code>${escapeHtml(match[1] ?? "")}</code></pre>`);
    cursor = match.index + match[0].length;
  }
  const tail = source.slice(cursor);
  if (tail) blocks.push(renderTextBlocks(tail));

  return blocks.join("\n").trim();
}

/** Splits a chunk on blank lines and renders each as a `<p>`. */
function renderTextBlocks(chunk: string): string {
  return chunk
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${renderInline(para)}</p>`)
    .join("\n");
}
