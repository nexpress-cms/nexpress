import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { NpFieldConfig } from "../config/types.js";
import { npMedia, npMediaRefs } from "../db/schema/media.js";
import { isNpRichTextContent } from "../fields/rich-text.js";

interface InsertValuesQuery extends Promise<unknown> {
  returning(): Promise<unknown[]>;
}

interface SelectQuery extends Promise<unknown[]> {
  where(condition: SQL): SelectQuery;
  orderBy(order: SQL): SelectQuery;
  limit(limit: number): SelectQuery;
  for(strength: "key share"): SelectQuery;
}

export interface NpMediaReference {
  mediaId: string;
  collection: string;
  documentId: string;
  field: string;
}

export interface NpListMediaReferencesOptions {
  field?: string;
  limit?: number;
}

export interface DrizzleTransactionLike {
  insert(table: PgTable): {
    values(values: Record<string, unknown> | Record<string, unknown>[]): InsertValuesQuery;
  };
  delete(table: PgTable): {
    where(condition: ReturnType<typeof and>): Promise<unknown>;
  };
  select(selection?: Record<string, unknown>): {
    from(table: PgTable): SelectQuery;
  };
}

export function extractMediaIds(
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
): Array<{ mediaId: string; field: string }> {
  const refs: Array<{ mediaId: string; field: string }> = [];

  collectMediaIds(fields, data, refs, []);

  return refs;
}

export async function syncMediaRefs(
  tx: DrizzleTransactionLike,
  collection: string,
  documentId: string,
  refs: Array<{ mediaId: string; field: string }>,
): Promise<void> {
  const uniqueRefs = dedupeRefs(refs);

  if (uniqueRefs.length === 0) {
    await tx
      .delete(npMediaRefs)
      .where(and(eq(npMediaRefs.collection, collection), eq(npMediaRefs.documentId, documentId)));
    return;
  }

  const mediaIds = [...new Set(uniqueRefs.map((ref) => ref.mediaId))].sort();
  const activeRows = (await tx
    .select({ id: npMedia.id })
    .from(npMedia)
    .where(sql`${inArray(npMedia.id, mediaIds)} and ${isNull(npMedia.deletedAt)}`)
    .orderBy(asc(npMedia.id))
    .for("key share")) as Array<{ id: string }>;
  if (activeRows.length !== mediaIds.length) {
    throw new Error("Every media reference must target an active media row.");
  }

  await tx
    .delete(npMediaRefs)
    .where(and(eq(npMediaRefs.collection, collection), eq(npMediaRefs.documentId, documentId)));

  await tx.insert(npMediaRefs).values(
    uniqueRefs.map((ref) => ({
      mediaId: ref.mediaId,
      collection,
      documentId,
      field: ref.field,
    })),
  );
}

export async function listMediaReferences(
  mediaId: string,
  options: NpListMediaReferencesOptions = {},
): Promise<NpMediaReference[]> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Media reference limit must be an integer from 1 to 200.");
  }
  if (
    options.field !== undefined &&
    (options.field.length === 0 ||
      options.field.length > 255 ||
      options.field !== options.field.trim())
  ) {
    throw new Error("Media reference field must be non-empty trimmed text.");
  }
  const { getDb } = await import("../db/runtime.js");
  const db = getDb();
  const condition = options.field
    ? and(eq(npMediaRefs.mediaId, mediaId), eq(npMediaRefs.field, options.field))
    : eq(npMediaRefs.mediaId, mediaId);
  const rows = await db
    .select({
      mediaId: npMediaRefs.mediaId,
      collection: npMediaRefs.collection,
      documentId: npMediaRefs.documentId,
      field: npMediaRefs.field,
    })
    .from(npMediaRefs)
    .where(condition)
    .limit(limit);

  return rows.map((row) => ({
    mediaId: row.mediaId,
    collection: row.collection,
    documentId: row.documentId,
    field: row.field,
  }));
}

function collectMediaIds(
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
  refs: Array<{ mediaId: string; field: string }>,
  prefix: string[],
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      collectMediaIds(field.fields, data, refs, prefix);
      continue;
    }

    const fieldPath = [...prefix, field.name];
    const fieldKey = fieldPath.join(".");
    const value = data[field.name];

    if (field.type === "upload") {
      const mediaId = getMediaId(value);

      if (mediaId) {
        refs.push({ mediaId, field: fieldKey });
      }

      continue;
    }

    if (field.type === "richText") {
      collectRichTextMediaIds(value, fieldKey, refs);
      continue;
    }

    if (field.type === "array") {
      if (!Array.isArray(value)) {
        continue;
      }

      for (const item of value) {
        const itemRecord = toOptionalRecord(item);

        if (itemRecord) {
          collectMediaIds(field.fields, itemRecord, refs, fieldPath);
        }
      }

      continue;
    }

    if (field.type === "group") {
      const groupRecord = toOptionalRecord(value);

      if (groupRecord) {
        collectMediaIds(field.fields, groupRecord, refs, fieldPath);
      }
    }
  }
}

function collectRichTextMediaIds(
  value: unknown,
  field: string,
  refs: Array<{ mediaId: string; field: string }>,
): void {
  if (!isNpRichTextContent(value)) return;
  walkRichTextValue(value.document.root, (node) => {
    if (node.type !== "image") {
      return;
    }

    const mediaId = getMediaId(node.mediaId) ?? getMediaId(node.value);

    if (mediaId) {
      refs.push({ mediaId, field });
    }
  });
}

function walkRichTextValue(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkRichTextValue(item, visit);
    }

    return;
  }

  const record = toOptionalRecord(value);

  if (!record) {
    return;
  }

  visit(record);

  for (const child of Object.values(record)) {
    walkRichTextValue(child, visit);
  }
}

function getMediaId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const record = toOptionalRecord(value);

  if (!record) {
    return null;
  }

  if (typeof record.mediaId === "string" && record.mediaId.length > 0) {
    return record.mediaId;
  }

  if (typeof record.id === "string" && record.id.length > 0) {
    return record.id;
  }

  return null;
}

function dedupeRefs(
  refs: Array<{ mediaId: string; field: string }>,
): Array<{ mediaId: string; field: string }> {
  const seen = new Set<string>();

  return refs.filter((ref) => {
    const key = `${ref.mediaId}:${ref.field}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function toOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
