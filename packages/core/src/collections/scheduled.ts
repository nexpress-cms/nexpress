import { and, eq, lt } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import type { NpFieldConfig } from "../config/types.js";
import { enqueueJob } from "../jobs/queue.js";
import { runHook } from "../plugins/host.js";
import { getAllCollectionSlugs, getCollectionConfig, getCollectionTable } from "./registry.js";
import { getDb } from "../db/runtime.js";

function hasPublishedAtField(fields: NpFieldConfig[]): boolean {
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
    if (!config.versions?.drafts && !hasPublishedAtField(config.fields)) continue;

    const table = getCollectionTable(slug) as PgTable;
    const statusCol = getTableColumn(table, "status");
    const publishedAtCol = getTableColumn(table, "publishedAt");

    const db = getDb();
    // `.returning()` without args gives every column so plugin hooks get the
    // full doc they'd see from a normal update, not just { id }.
    const rows = (await db
      .update(table)
      .set({ status: "published", updatedAt: atTime })
      .where(and(eq(statusCol, "scheduled"), lt(publishedAtCol, atTime)))
      .returning()) as Array<Record<string, unknown>>;

    const ids = rows.map((row) => row.id as string);
    byCollection[slug] = ids;
    published += ids.length;

    for (const row of rows) {
      const docId = row.id as string;
      // Fire every hook a plugin would have seen if the user had clicked
      // Publish directly: afterUpdate (content changed), afterPublish
      // (status transitioned), and the afterSave job so revalidation +
      // collection-level afterUpdate hooks run too.
      await runHook("content:afterUpdate", {
        collection: slug,
        documentId: docId,
        document: row,
        originalDocument: null,
        operation: "update",
        source: "scheduler",
        principal: null,
      });
      await runHook("content:afterPublish", {
        collection: slug,
        documentId: docId,
        document: row,
        originalDocument: null,
        operation: "update",
        source: "scheduler",
        principal: null,
      });
      await enqueueJob("content:afterSave", {
        collection: slug,
        documentId: docId,
        operation: "update",
        userId: "scheduler",
      });
    }
  }

  return { published, byCollection };
}
