import { and, eq, lt } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import type { NxFieldConfig } from "../config/types.js";
import { runHook } from "../plugins/host.js";
import {
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "./registry.js";
import { getDb } from "./pipeline.js";

function hasPublishedAtField(fields: NxFieldConfig[]): boolean {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      if (hasPublishedAtField(field.fields)) return true;
      continue;
    }
    if (field.type === "group" || field.type === "array") {
      if (hasPublishedAtField(field.fields)) return true;
      continue;
    }
    if (field.type === "date" && field.name === "publishedAt") {
      return true;
    }
  }
  return false;
}

function getTableColumn(table: PgTable, key: string): AnyPgColumn {
  const column = (table as unknown as Record<string, unknown>)[key];
  if (!column) {
    throw new Error(`Column '${key}' not found on scheduled-publish table.`);
  }
  return column as AnyPgColumn;
}

export interface PublishScheduledResult {
  published: number;
  byCollection: Record<string, string[]>;
}

/**
 * Scans every registered collection that has a `publishedAt` date field,
 * flips rows with `status="scheduled"` whose `publishedAt <= now` to
 * `status="published"`, and fires `content:afterPublish` for each.
 *
 * Safe to call repeatedly (idempotent once a doc is published) and cheap —
 * each UPDATE runs against an indexed status column and no-ops when empty.
 */
export async function publishScheduledDocuments(
  atTime: Date = new Date(),
): Promise<PublishScheduledResult> {
  const byCollection: Record<string, string[]> = {};
  let published = 0;

  for (const slug of getAllCollectionSlugs()) {
    const config = getCollectionConfig(slug);
    if (!hasPublishedAtField(config.fields)) continue;

    const table = getCollectionTable(slug) as PgTable;
    const statusCol = getTableColumn(table, "status");
    const publishedAtCol = getTableColumn(table, "publishedAt");
    const idCol = getTableColumn(table, "id");

    const db = getDb();
    const rows = (await db
      .update(table)
      .set({ status: "published", updatedAt: atTime })
      .where(and(eq(statusCol, "scheduled"), lt(publishedAtCol, atTime)))
      .returning({ id: idCol })) as Array<{ id: string }>;

    const ids = rows.map((row) => row.id);
    byCollection[slug] = ids;
    published += ids.length;

    for (const id of ids) {
      await runHook("content:afterPublish", {
        collection: slug,
        doc: { id },
        operation: "update",
        scheduled: true,
      });
    }
  }

  return { published, byCollection };
}
