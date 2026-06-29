import { getCollectionTable, getDb } from "@nexpress/core";
import { eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { revalidateCollection } from "./revalidate";

export interface ScheduledPublishRevalidationOptions {
  readDocument?: (collection: string, id: string) => Promise<Record<string, unknown> | null>;
  revalidate?: (collection: string, doc?: Record<string, unknown> | null) => void;
}

export async function revalidatePublishedDocuments(
  byCollection: Record<string, string[]>,
  options: ScheduledPublishRevalidationOptions = {},
): Promise<void> {
  const readDocument = options.readDocument ?? readPublishedDocument;
  const revalidate = options.revalidate ?? revalidateCollection;

  for (const [collection, ids] of Object.entries(byCollection)) {
    for (const id of ids) {
      const doc = await readDocument(collection, id);
      if (doc) {
        revalidate(collection, doc);
      } else {
        revalidate(collection);
      }
    }
  }
}

async function readPublishedDocument(
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const table = getCollectionTable(collection) as PgTable;
  const idCol = getTableColumn(table, "id");
  const [doc] = (await getDb().select().from(table).where(eq(idCol, id)).limit(1)) as Array<
    Record<string, unknown>
  >;
  return doc ?? null;
}

function getTableColumn(table: PgTable, key: string): AnyPgColumn {
  const column = (table as unknown as Record<string, unknown>)[key];
  if (!column) {
    throw new Error(`Column '${key}' not found on scheduled-publish table.`);
  }
  return column as AnyPgColumn;
}
