import { eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { findDocuments, getCollectionRegistration, getDb } from "@nexpress/core";

export interface DefaultThemeTagItem {
  id: string;
  label: string;
  slug: string;
  count?: number;
}

function postsTagsTable(): PgTable | null {
  const registration = getCollectionRegistration("posts");
  const table = registration.joinTables?.tags;
  return table ? (table as PgTable) : null;
}

function column(table: PgTable, key: string): PgColumn {
  const selected = getTableColumns(table)[key];
  if (!selected) {
    throw new Error(`Column '${key}' not found on table.`);
  }
  return selected;
}

function parentColumn(table: PgTable): PgColumn {
  const columns = getTableColumns(table);
  const key = Object.keys(columns).find(
    (candidate) =>
      candidate !== "id" &&
      candidate !== "targetId" &&
      candidate !== "order" &&
      candidate.endsWith("Id"),
  );
  if (!key) {
    throw new Error("Parent column not found on posts tags table.");
  }
  return columns[key];
}

export async function loadTagIdsForPost(postId: string): Promise<string[]> {
  const table = postsTagsTable();
  if (!table) return [];

  const rows = await getDb()
    .select({ targetId: column(table, "targetId") })
    .from(table)
    .where(eq(parentColumn(table), postId));

  return rows.map((row) => String(row.targetId));
}

export async function loadPostIdsForTag(tagId: string): Promise<string[]> {
  const table = postsTagsTable();
  if (!table) return [];

  const rows = await getDb()
    .select({ postId: parentColumn(table) })
    .from(table)
    .where(eq(column(table, "targetId"), tagId));

  return rows.map((row) => String(row.postId));
}

export async function loadTagsByIds(ids: string[]): Promise<DefaultThemeTagItem[]> {
  if (ids.length === 0) return [];

  const result = await findDocuments<Record<string, unknown>>("tags", {
    where: { id: ids },
    limit: ids.length,
  });
  const byId = new Map(result.docs.map((tag) => [String(tag.id), tag]));

  return ids
    .map((id) => {
      const tag = byId.get(id);
      const label = typeof tag?.name === "string" && tag.name.length > 0 ? tag.name : id;
      const slug = typeof tag?.slug === "string" && tag.slug.length > 0 ? tag.slug : "";
      return slug ? { id, label, slug } : null;
    })
    .filter((tag): tag is DefaultThemeTagItem => tag !== null);
}

export async function findPublishedPostsForTag(
  tagId: string,
  options: { limit: number },
): Promise<{ docs: Record<string, unknown>[]; totalDocs: number }> {
  const postIds = await loadPostIdsForTag(tagId);
  if (postIds.length === 0) {
    return { docs: [], totalDocs: 0 };
  }

  const result = await findDocuments<Record<string, unknown>>("posts", {
    where: { id: postIds, status: "published" },
    sort: "-publishedAt",
    limit: options.limit,
  });

  return {
    docs: result.docs,
    totalDocs: result.totalDocs,
  };
}
