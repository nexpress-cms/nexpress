import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { nxMembers } from "../db/schema/community.js";
import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "./registry.js";
import { getDb } from "./pipeline.js";

/**
 * Cross-collection pending queue (Phase 9.7e). Lists every
 * member-authored row that landed `status = "pending"` — the ones
 * waiting on a staff promote (9.7d) or staff delete. Only collections
 * that opt into `community.memberWrite.create` are scanned; the rest
 * either have no member-author column at all or aren't part of the
 * member-write surface.
 *
 * v1 collates results client-side after running one query per
 * collection. That's fine for a handful of forum/news collections;
 * sites with dozens of member-writable surfaces should switch to a
 * dedicated `nx_pending_queue` view (a future PR — out of scope
 * here).
 */
export interface NxPendingDocSummary {
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

export interface NxListPendingDocsOptions {
  /** Restrict to one collection. Useful for per-collection queue
   *  pages; omit for the global queue. */
  collectionSlug?: string;
  limit?: number;
  offset?: number;
}

export interface NxListPendingDocsResult {
  docs: NxPendingDocSummary[];
  totalDocs: number;
}

function getTableColumn(table: PgTable, name: string): unknown {
  return (table as unknown as Record<string, unknown>)[name];
}

export async function listPendingMemberDocs(
  options: NxListPendingDocsOptions = {},
): Promise<NxListPendingDocsResult> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const slugs = options.collectionSlug
    ? [options.collectionSlug]
    : getAllCollectionSlugs();

  const db = getDb();

  // Fan out across collections. We collect per-collection rows then
  // sort + paginate in JS — the per-collection queries are
  // status-indexed (`nx_c_<slug>_status_idx`) so each is cheap, and
  // the pending queue is small by definition (mods drain it). Note
  // that the per-collection query has no SQL `LIMIT`: if a single
  // collection accumulates an unreasonable number of pendings (a
  // misbehaving spam adapter, no mod attention for weeks), this
  // function would fetch every row into memory. Sites that hit
  // that ceiling should switch to a dedicated `nx_pending_queue`
  // materialized view — out of scope for v1.
  const allRows: NxPendingDocSummary[] = [];
  let totalDocs = 0;

  for (const slug of slugs) {
    let config;
    try {
      config = getCollectionConfig(slug);
    } catch {
      continue;
    }
    if (!config.community?.memberWrite?.create) continue;

    const table = getCollectionTable(slug) as PgTable;
    const statusCol = getTableColumn(table, "status") as never;
    const memberAuthorCol = getTableColumn(table, "memberAuthorId") as never;
    const idCol = getTableColumn(table, "id") as never;
    const createdAtCol = getTableColumn(table, "createdAt") as never;
    const titleCol = getTableColumn(table, "title") as never;
    const slugCol = getTableColumn(table, "slug") as never;

    // Skip collections that don't have a `title` field — there's
    // nothing to display in the queue without it.
    if (!titleCol) continue;

    const where = and(eq(statusCol, "pending"), isNotNull(memberAuthorCol));

    // Total count for this collection — paginate after fanning out.
    const [count] = (await (db as unknown as {
      select: (s: Record<string, unknown>) => {
        from: (t: PgTable) => { where: (c: unknown) => Promise<Array<{ total: number | string }>> };
      };
    })
      .select({ total: sql<number>`count(*)::int` })
      .from(table)
      .where(where)) as Array<{ total: number | string }>;
    totalDocs += Number(count?.total ?? 0);

    const rows = (await (db as unknown as {
      select: (s: Record<string, unknown>) => {
        from: (t: PgTable) => {
          leftJoin: (j: PgTable, c: unknown) => {
            where: (c: unknown) => {
              orderBy: (o: unknown) => Promise<Array<Record<string, unknown>>>;
            };
          };
        };
      };
    })
      .select({
        id: idCol,
        title: titleCol,
        slug: slugCol,
        createdAt: createdAtCol,
        memberId: nxMembers.id,
        memberHandle: nxMembers.handle,
        memberDisplayName: nxMembers.displayName,
      })
      .from(table)
      .leftJoin(nxMembers, eq(memberAuthorCol, nxMembers.id))
      .where(where)
      .orderBy(desc(createdAtCol))) as Array<{
      id: string;
      title: string | null;
      slug: string | null;
      createdAt: Date;
      memberId: string | null;
      memberHandle: string | null;
      memberDisplayName: string | null;
    }>;

    for (const row of rows) {
      allRows.push({
        id: row.id,
        collectionSlug: slug,
        title: typeof row.title === "string" && row.title.length > 0 ? row.title : "(untitled)",
        slug: row.slug,
        status: "pending",
        createdAt: row.createdAt,
        memberAuthor:
          row.memberId && row.memberHandle && row.memberDisplayName
            ? {
                id: row.memberId,
                handle: row.memberHandle,
                displayName: row.memberDisplayName,
              }
            : null,
      });
    }
  }

  // Cross-collection sort by createdAt desc, then page.
  allRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const docs = allRows.slice(offset, offset + limit);
  return { docs, totalDocs };
}
