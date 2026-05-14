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

  return (
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
          <button type="button" disabled>
            Yes
          </button>
          <button type="button" disabled>
            Could be better
          </button>
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
