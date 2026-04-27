import { sql, type SQL } from "drizzle-orm";

import { type NxCollectionConfig, type NxRichTextContent } from "../config/types.js";

/**
 * Plain-text concatenation of every searchable field. Used by
 * the moderation pipeline (spam/profanity adapters need the
 * full text, weights don't matter there).
 */
export function buildSearchVector(
  config: NxCollectionConfig,
  data: Record<string, unknown>,
): string {
  const parts: string[] = [];

  for (const field of config.fields) {
    if (field.type === "text" || field.type === "textarea") {
      const value = data[field.name];
      if (typeof value === "string") parts.push(value);
    }
    if (field.type === "richText") {
      const value = data[field.name];
      if (value) parts.push(extractPlainText(value as NxRichTextContent));
    }
  }

  return parts.join(" ");
}

/**
 * Phase 10.7 — split searchable fields into Postgres tsvector
 * weight buckets so title-like matches outrank body matches at
 * query time.
 *
 * Convention (no per-field opt-in to keep collections
 * declarations terse):
 *   - field.name === "title" or "name"            → weight A
 *   - other text / textarea / email                → weight B
 *   - richText                                     → weight C
 *
 * Sites that want different weights can name their primary
 * field "title" and the framework picks the right bucket
 * automatically. (A future revision can add `field.search.weight`
 * for explicit control.)
 *
 * Postgres ts_rank() applies the default weight scale
 * { D: 0.1, C: 0.2, B: 0.4, A: 1.0 }, so an A-weighted match
 * scores ~10× a D-weighted one — meaningful boost for titles.
 */
export interface NxSearchVectorParts {
  /** Title-like fields. Highest rank weight. */
  a: string;
  /** Body fields (text/textarea/email). */
  b: string;
  /** Rich-text body. */
  c: string;
  /** Reserved for future categorization (tags, slugs, etc.). */
  d: string;
}

const TITLE_LIKE_NAMES = new Set(["title", "name"]);

export function buildSearchVectorParts(
  config: NxCollectionConfig,
  data: Record<string, unknown>,
): NxSearchVectorParts {
  const parts: NxSearchVectorParts = { a: "", b: "", c: "", d: "" };
  const append = (bucket: keyof NxSearchVectorParts, value: string): void => {
    parts[bucket] = parts[bucket] ? `${parts[bucket]} ${value}` : value;
  };

  for (const field of config.fields) {
    if (
      field.type === "text" ||
      field.type === "textarea" ||
      field.type === "email"
    ) {
      const value = data[field.name];
      if (typeof value !== "string" || value.length === 0) continue;
      if (TITLE_LIKE_NAMES.has(field.name)) {
        append("a", value);
      } else {
        append("b", value);
      }
    }
    if (field.type === "richText") {
      const value = data[field.name];
      if (!value) continue;
      const text = extractPlainText(value as NxRichTextContent);
      if (text.length > 0) append("c", text);
    }
  }

  return parts;
}

/**
 * Build the weighted-tsvector SQL fragment that the pipeline
 * binds to `searchVector` on insert/update. Each non-empty
 * bucket becomes `setweight(to_tsvector('english', $bucket), '<W>')`;
 * the buckets are concatenated with `||`. Empty buckets are
 * skipped so the resulting expression is always non-trivial.
 *
 * If every bucket is empty (collection has no text fields, or
 * every text field is null on this row), returns an empty
 * tsvector cast — Postgres accepts this as a valid empty
 * vector value.
 */
export function buildWeightedSearchVectorSql(
  config: NxCollectionConfig,
  data: Record<string, unknown>,
): SQL {
  const parts = buildSearchVectorParts(config, data);
  const chunks: SQL[] = [];
  if (parts.a)
    chunks.push(sql`setweight(to_tsvector('english', ${parts.a}), 'A')`);
  if (parts.b)
    chunks.push(sql`setweight(to_tsvector('english', ${parts.b}), 'B')`);
  if (parts.c)
    chunks.push(sql`setweight(to_tsvector('english', ${parts.c}), 'C')`);
  if (parts.d)
    chunks.push(sql`setweight(to_tsvector('english', ${parts.d}), 'D')`);
  if (chunks.length === 0) {
    return sql`''::tsvector`;
  }
  if (chunks.length === 1) {
    return chunks[0];
  }
  // Drizzle's sql.join uses the second arg as the separator
  // SQL fragment. `||` is Postgres tsvector concatenation.
  return sql.join(chunks, sql` || `);
}

function extractPlainText(content: NxRichTextContent): string {
  if (!content || typeof content !== "object") return "";

  const root = content.root as { children?: unknown[] } | undefined;
  if (!root?.children) return "";

  const parts: string[] = [];
  walkNodes(root.children, parts);
  return parts.join(" ");
}

function walkNodes(nodes: unknown[], parts: string[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;

    if (typeof n.text === "string") {
      parts.push(n.text);
    }

    if (Array.isArray(n.children)) {
      walkNodes(n.children, parts);
    }
  }
}
