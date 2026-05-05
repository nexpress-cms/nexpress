import { sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { npMembers } from "../db/schema/community.js";
import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "./registry.js";
import { getDb } from "../db/runtime.js";

/**
 * Cross-collection pending queue (Phase 9.7e). Lists every
 * member-authored row that landed `status = "pending"` — the ones
 * waiting on a staff promote (9.7d) or staff delete. Only collections
 * that opt into `community.memberWrite.create` are scanned; the rest
 * either have no member-author column at all or aren't part of the
 * member-write surface.
 *
 * Phase 12.11 — replaced the v1 fan-out (one round trip per
 * collection, no SQL `LIMIT`, JS-side merge + page) with a single
 * `UNION ALL` query whose outer `LIMIT/OFFSET` runs at the database.
 * The per-collection `(status, member_author_id)` is still
 * status-indexed (`nx_c_<slug>_status_idx`), so each branch of the
 * union narrows fast; the database does the cross-collection
 * `ORDER BY created_at DESC` + paging. A site with dozens of
 * member-writable surfaces no longer fans out N+2 round trips, and
 * an unattended collection accumulating thousands of pendings can't
 * blow heap by being read fully into memory.
 */
export interface NpPendingDocSummary {
  id: string;
  collectionSlug: string;
  /** From the doc's `title` field, when it has one. Never empty. */
  title: string;
  slug: string | null;
  status: "pending";
  createdAt: Date;
  /**
   * Resolved from `nx_members` via `member_author_id`. Null when the
   * member was deleted after authoring (FK is `ON DELETE SET NULL`)
   * — mods see the audit trail for the original actor in that case.
   */
  memberAuthor: {
    id: string;
    handle: string;
    displayName: string;
  } | null;
}

export interface NpListPendingDocsOptions {
  /** Restrict to one collection. Useful for per-collection queue
   *  pages; omit for the global queue. */
  collectionSlug?: string;
  limit?: number;
  offset?: number;
}

export interface NpListPendingDocsResult {
  docs: NpPendingDocSummary[];
  totalDocs: number;
}

function getTableColumn(table: PgTable, name: string): unknown {
  return (table as unknown as Record<string, unknown>)[name];
}

/**
 * Build one branch of the pending-queue UNION ALL: a SELECT against
 * one member-write collection's table that projects the columns the
 * outer query needs (`collection_slug`, `id`, `title`, `doc_slug`,
 * `created_at`, `member_author_id`). Collections without a `title`
 * column are skipped by the caller — there's nothing to display in
 * the queue without it. Collections without a `slug` column emit
 * `NULL::text` so the UNION ALL row shapes match.
 */
function buildPendingBranch(slug: string): SQL | null {
  let config;
  try {
    config = getCollectionConfig(slug);
  } catch {
    return null;
  }
  if (!config.community?.memberWrite?.create) return null;

  const table = getCollectionTable(slug) as PgTable;
  const titleCol = getTableColumn(table, "title");
  if (!titleCol) return null;
  const slugCol = getTableColumn(table, "slug");
  // The literal collection slug is bound as a parameter (no
  // injection risk) so the same prepared statement shape can be
  // reused across calls. `NULL::text` keeps the column type stable
  // for collections without a `slug` field — UNION ALL requires
  // type-aligned columns at each position.
  return sql`
    SELECT
      ${slug}::text AS collection_slug,
      id,
      title,
      ${slugCol ? sql`slug` : sql`NULL::text`} AS doc_slug,
      created_at,
      member_author_id
    FROM ${table}
    WHERE status = 'pending' AND member_author_id IS NOT NULL
  `;
}

export async function listPendingMemberDocs(
  options: NpListPendingDocsOptions = {},
): Promise<NpListPendingDocsResult> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const slugs = options.collectionSlug
    ? [options.collectionSlug]
    : getAllCollectionSlugs();

  const db = getDb();

  const branches: SQL[] = [];
  for (const slug of slugs) {
    const branch = buildPendingBranch(slug);
    if (branch) branches.push(branch);
  }

  // Empty pool: caller asked for a slug that isn't member-writable
  // (or the registry is empty). UNION ALL of zero subqueries is
  // invalid SQL; bail with the empty envelope rather than crash.
  if (branches.length === 0) {
    return { docs: [], totalDocs: 0 };
  }

  const union = sql.join(branches, sql` UNION ALL `);

  const [countRow] = (
    (await db.execute(
      sql`SELECT count(*)::int AS total FROM (${union}) p`,
    )) as unknown as { rows: Array<{ total: number | string }> }
  ).rows;
  const totalDocs = Number(countRow?.total ?? 0);

  const result = (await db.execute(sql`
    SELECT
      p.collection_slug AS collection_slug,
      p.id AS id,
      p.title AS title,
      p.doc_slug AS doc_slug,
      p.created_at AS created_at,
      m.id AS member_id,
      m.handle AS member_handle,
      m.display_name AS member_display_name
    FROM (${union}) p
    LEFT JOIN ${npMembers} m ON m.id = p.member_author_id
    ORDER BY p.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as {
    rows: Array<{
      collection_slug: string;
      id: string;
      title: string | null;
      doc_slug: string | null;
      created_at: Date | string;
      member_id: string | null;
      member_handle: string | null;
      member_display_name: string | null;
    }>;
  };

  const docs: NpPendingDocSummary[] = result.rows.map((row) => ({
    id: row.id,
    collectionSlug: row.collection_slug,
    title:
      typeof row.title === "string" && row.title.length > 0
        ? row.title
        : "(untitled)",
    slug: row.doc_slug,
    status: "pending",
    createdAt:
      row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    memberAuthor:
      row.member_id && row.member_handle && row.member_display_name
        ? {
            id: row.member_id,
            handle: row.member_handle,
            displayName: row.member_display_name,
          }
        : null,
  }));

  return { docs, totalDocs };
}
