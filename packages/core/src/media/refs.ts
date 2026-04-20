import { and, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { NxFieldConfig } from "../config/types.js";
import { nxMediaRefs } from "../db/schema/media.js";

interface InsertValuesQuery extends Promise<unknown> {
  returning(): Promise<unknown[]>;
}

interface SelectQuery extends Promise<unknown[]> {
  where(condition: ReturnType<typeof and>): SelectQuery;
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
  fields: NxFieldConfig[],
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
  await tx.delete(nxMediaRefs).where(
    and(eq(nxMediaRefs.collection, collection), eq(nxMediaRefs.documentId, documentId)),
  );

  const uniqueRefs = dedupeRefs(refs);

  if (uniqueRefs.length === 0) {
    return;
  }

  await tx.insert(nxMediaRefs).values(
    uniqueRefs.map((ref) => ({
      mediaId: ref.mediaId,
      collection,
      documentId,
      field: ref.field,
    })),
  );
}

function collectMediaIds(
  fields: NxFieldConfig[],
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
  walkRichTextValue(value, (node) => {
    if (node.type !== "image") {
      return;
    }

    const mediaId = getMediaId(node.mediaId) ?? getMediaId(node.value);

    if (mediaId) {
      refs.push({ mediaId, field });
    }
  });
}

function walkRichTextValue(
  value: unknown,
  visit: (node: Record<string, unknown>) => void,
): void {
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
