import * as React from "react";
import type { NpTemplateRenderProps } from "@nexpress/theme";
import { findDocuments, type NpRichTextContent } from "@nexpress/core";
import { renderRichText } from "@nexpress/editor/server";

import { resolveDocsSettings } from "../settings-helpers.js";

interface DocDoc {
  id: string;
  slug: string;
  title: string;
  lede?: string;
  body?: NpRichTextContent;
  parent?: string | null;
  order?: number;
  updatedAt?: string | Date;
  publishedAt?: string | Date;
  stableSince?: string;
  readingTime?: number | string;
}

interface TocEntry {
  id: string;
  text: string;
  /** `2` or `3` — h2 is top-level, h3 nests under preceding h2. */
  level: 2 | 3;
}

/**
 * Walks a Lexical doc looking for `heading` nodes. Returns
 * `{ id, text, level }` for h2 / h3 — h1 is the page title
 * itself, deeper levels (h4+) don't fit the TOC's two-tier
 * visual.
 *
 * The renderer (`renderRichText` from `@nexpress/editor/server`)
 * does NOT currently emit `id="..."` on the heading elements,
 * so the anchor links the TOC produces only work once the
 * renderer learns to do that (or sites override the body
 * render with their own slug-emitting walker). Tracked as a
 * follow-up — for v0.1 the TOC reads as a structural overview
 * even if clicks fall through.
 */
function extractToc(body: NpRichTextContent | undefined): TocEntry[] {
  if (!body) return [];
  const root = (body as { root?: { children?: unknown[] } }).root;
  if (!root || !Array.isArray(root.children)) return [];
  const out: TocEntry[] = [];
  walk(root.children, out);
  return out;
}

function walk(nodes: unknown[], out: TocEntry[]): void {
  for (const raw of nodes) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as { type?: unknown; tag?: unknown; children?: unknown };
    if (node.type === "heading" && (node.tag === "h2" || node.tag === "h3")) {
      const text = collectText(Array.isArray(node.children) ? node.children : []);
      if (text) {
        out.push({
          id: slugify(text),
          text,
          level: node.tag === "h2" ? 2 : 3,
        });
      }
      continue;
    }
    if (Array.isArray(node.children)) walk(node.children, out);
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Doc page template — three-zone article: header strap
 * (breadcrumbs + h1 + lede + meta pills), Lexical-rendered body,
 * footer (feedback widget + prev/next pair).
 *
 * Breadcrumbs walk the parent chain so a nested doc shows
 * `Docs / Plugins / Author quickstart` without the operator
 * configuring it explicitly. Falls back to a single "Docs" entry
 * for root-level pages.
 *
 * Meta pills render only when their data is present:
 *
 *   - `stableSince` (e.g. `"0.1"`) → green pill `"Stable since 0.1"`.
 *   - `readingTime` (number or string) → `"X min read"` pill.
 *   - `updatedAt` → date string after a · separator.
 *   - `settings.githubRepo` set → `"Edit this page →"` link to GH.
 *
 * Feedback row is static HTML (Yes / Could be better buttons)
 * without a wired endpoint — operators that want a real
 * feedback API drop in their own client island.
 *
 * Prev/next walks the same ordered list the sidebar uses; the
 * doc immediately before / after `current` in render-order wins.
 */
export async function DocPageTemplate({
  doc: rawDoc,
}: NpTemplateRenderProps): Promise<React.ReactElement> {
  const doc = rawDoc as unknown as DocDoc;
  const settings = await resolveDocsSettings();
  const breadcrumbs = await loadBreadcrumbs(doc);
  const navInfo = await loadPrevNext(doc);
  const updatedLabel = formatUpdated(doc.updatedAt ?? doc.publishedAt);
  const readingLabel = readingMinutesLabel(doc.readingTime);
  const editHref = settings.githubRepo
    ? `${settings.githubRepo}/edit/main/docs/${doc.slug}.md`
    : null;
  const toc = extractToc(doc.body);
  const reportIssueHref = settings.githubRepo
    ? `${settings.githubRepo}/issues/new`
    : null;

  return (
    <>
    <article className="np-docs-page">
      <nav className="np-docs-breadcrumbs" aria-label="Breadcrumb">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <React.Fragment key={`crumb-${index.toString()}-${crumb.slug ?? "root"}`}>
              {index > 0 ? (
                <span className="np-docs-breadcrumbs-sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              {isLast || !crumb.slug ? (
                <span>{crumb.title}</span>
              ) : (
                <a href={`/docs/${crumb.slug}`}>{crumb.title}</a>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <h1>{doc.title}</h1>
      {doc.lede ? <p className="np-docs-page-lede">{doc.lede}</p> : null}

      {(doc.stableSince || readingLabel || updatedLabel || editHref) ? (
        <div className="np-docs-page-meta">
          {doc.stableSince ? (
            <span className="np-docs-page-meta-pill status">
              Stable since {doc.stableSince}
            </span>
          ) : null}
          {readingLabel ? (
            <span className="np-docs-page-meta-pill">{readingLabel}</span>
          ) : null}
          {updatedLabel ? (
            <>
              <span className="np-docs-page-meta-sep" aria-hidden="true">
                ·
              </span>
              <span>Updated {updatedLabel}</span>
            </>
          ) : null}
          {editHref ? (
            <a href={editHref} target="_blank" rel="noreferrer">
              Edit this page →
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="np-docs-page-body">
        {doc.body ? (
          // Core types `NpRichTextContent` as the opaque
          // `Record<string, unknown>`; the editor's renderer
          // refines it to `{ root: ... }`. Structural cast at
          // the boundary — both sides go through the same
          // Lexical serializer.
          renderRichText(doc.body as unknown as Parameters<typeof renderRichText>[0])
        ) : (
          <p style={{ color: "var(--np-color-muted-foreground)" }}>
            No body content yet.
          </p>
        )}
      </div>

      <div className="np-docs-feedback">
        <div>
          <div className="np-docs-feedback-title">Was this page helpful?</div>
          <div className="np-docs-feedback-helper">
            Operators wire the feedback endpoint via a plugin or a custom
            client island — the form is intentionally inert in v0.1.
          </div>
        </div>
        <div className="np-docs-feedback-buttons">
          <button type="button">Yes</button>
          <button type="button">Could be better</button>
        </div>
      </div>

      <nav className="np-docs-prev-next" aria-label="Pagination">
        {navInfo.prev ? (
          <a
            href={`/docs/${navInfo.prev.slug}`}
            className="np-docs-prev-next-prev"
          >
            <div className="np-docs-prev-next-dir">← Previous</div>
            <div className="np-docs-prev-next-title">{navInfo.prev.title}</div>
          </a>
        ) : (
          <span />
        )}
        {navInfo.next ? (
          <a
            href={`/docs/${navInfo.next.slug}`}
            className="np-docs-prev-next-next"
          >
            <div className="np-docs-prev-next-dir">Next →</div>
            <div className="np-docs-prev-next-title">{navInfo.next.title}</div>
          </a>
        ) : (
          <span />
        )}
      </nav>
    </article>

    {toc.length > 0 ? (
      <aside className="np-docs-toc" aria-label="On this page">
        <p className="np-docs-toc-eyebrow">On this page</p>
        <ul>
          {toc.map((entry) => (
            <li
              key={`toc-${entry.id}`}
              style={entry.level === 3 ? { marginLeft: "0.85rem" } : undefined}
            >
              <a href={`#${entry.id}`}>{entry.text}</a>
            </li>
          ))}
        </ul>

        {(editHref || reportIssueHref) ? (
          <div className="np-docs-toc-secondary">
            {editHref ? (
              <a href={editHref} target="_blank" rel="noreferrer">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit on GitHub
              </a>
            ) : null}
            {reportIssueHref ? (
              <a href={reportIssueHref} target="_blank" rel="noreferrer">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Report an issue
              </a>
            ) : null}
          </div>
        ) : null}
      </aside>
    ) : null}
    </>
  );
}

interface Crumb {
  slug: string | null;
  title: string;
}

async function loadBreadcrumbs(current: DocDoc): Promise<Crumb[]> {
  const root: Crumb = { slug: null, title: "Docs" };
  if (!current.parent) {
    return [root, { slug: null, title: current.title }];
  }
  // Walk parents in a single bounded query — sidebar already
  // pulls the same list so the row count is small.
  const result = await findDocuments<Record<string, unknown>>("docs", {
    where: { status: "published" },
    sort: "order",
    limit: 500,
  });
  const byId = new Map<string, DocDoc>();
  for (const r of result.docs as unknown as DocDoc[]) {
    if (r.id) byId.set(r.id, r);
  }
  const chain: Crumb[] = [];
  let cursor: string | null = current.parent;
  let safety = 6;
  while (cursor && safety-- > 0) {
    const node = byId.get(cursor);
    if (!node) break;
    chain.unshift({ slug: node.slug, title: node.title });
    cursor = node.parent ?? null;
  }
  return [root, ...chain, { slug: null, title: current.title }];
}

async function loadPrevNext(
  current: DocDoc,
): Promise<{ prev: DocDoc | null; next: DocDoc | null }> {
  const result = await findDocuments<Record<string, unknown>>("docs", {
    where: { status: "published" },
    sort: "order",
    limit: 500,
  });
  const docs = result.docs as unknown as DocDoc[];
  const idx = docs.findIndex((d) => d.id === current.id);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? docs[idx - 1] ?? null : null,
    next: idx < docs.length - 1 ? docs[idx + 1] ?? null : null,
  };
}

function formatUpdated(value: DocDoc["updatedAt"]): string | null {
  if (!value) return null;
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function readingMinutesLabel(value: DocDoc["readingTime"]): string | null {
  if (!value && value !== 0) return null;
  if (typeof value === "number") return `${value.toString()} min read`;
  return value;
}
