import * as React from "react";
import type { NpTemplateRenderProps } from "@nexpress/theme";
import { findDocuments } from "@nexpress/core";

import { resolveDocsSettings } from "../settings-helpers.js";

interface DocDoc {
  id: string;
  slug: string;
  title: string;
  body?: unknown;
  parent?: string | null;
  order?: number;
}

/**
 * Phase F.9-B — doc page template.
 *
 * Renders the doc's title + body, plus a prev/next bar at the
 * bottom that walks the same parent-ordered hierarchy the
 * sidebar uses. Optional "Edit on GitHub" link is added when
 * the operator set `settings.githubRepo`.
 *
 * Body rendering: this template assumes `doc.body` is a
 * Lexical / blocks payload. For a real F.9-B we'd thread
 * through `renderBlocks(doc.body, { ctx: blockCtx })` for the
 * actual content; the placeholder JSON keeps the contract
 * shape-correct without binding to a specific body shape that
 * may differ across operator setups.
 */
export async function DocPageTemplate({
  doc: rawDoc,
}: NpTemplateRenderProps): Promise<React.ReactElement> {
  const doc = rawDoc as unknown as DocDoc;
  const settings = await resolveDocsSettings();

  const navInfo = await loadPrevNext(doc);

  return (
    <article className="np-docs-page">
      <header>
        <h1>{doc.title}</h1>
      </header>
      <div className="np-docs-body">
        {/* Operators that customize body rendering swap this
            placeholder for `renderBlocks(doc.body, { ctx })`
            or their own renderer. */}
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
          {typeof doc.body === "string" ? doc.body : "Doc body unavailable."}
        </pre>
      </div>

      {settings.githubRepo ? (
        <p style={{ marginTop: "2rem" }}>
          <a
            href={`${settings.githubRepo}/edit/main/docs/${doc.slug}.md`}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "0.875rem",
              color: "var(--np-color-muted-foreground)",
            }}
          >
            ✏️ Edit on GitHub
          </a>
        </p>
      ) : null}

      <nav className="np-docs-prev-next" aria-label="Pagination">
        {navInfo.prev ? (
          <a href={`/docs/${navInfo.prev.slug}`}>
            <span className="np-docs-prev-next-label">← Previous</span>
            {navInfo.prev.title}
          </a>
        ) : (
          <span />
        )}
        {navInfo.next ? (
          <a
            href={`/docs/${navInfo.next.slug}`}
            style={{ textAlign: "right" }}
          >
            <span className="np-docs-prev-next-label">Next →</span>
            {navInfo.next.title}
          </a>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

async function loadPrevNext(
  current: DocDoc,
): Promise<{ prev: DocDoc | null; next: DocDoc | null }> {
  // For F.9-B we walk the same ordered list the sidebar uses
  // and pick the doc immediately before/after `current`. Cap
  // matches the sidebar (500); same query is cached at the
  // docs read path.
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
