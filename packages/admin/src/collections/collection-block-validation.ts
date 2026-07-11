import {
  npAnalyzeBlockContent,
  type NpBlockContentIssue,
  type NpBlockMetadata,
} from "@nexpress/blocks";
import type { NpFieldConfig } from "@nexpress/core";

export interface CollectionBlockContentError {
  readonly fieldPath: string;
  readonly issue: NpBlockContentIssue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findInFields(
  fields: readonly NpFieldConfig[],
  values: Record<string, unknown>,
  definitions: readonly NpBlockMetadata[],
  prefix: string,
): CollectionBlockContentError | null {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      const nested = findInFields(field.fields, values, definitions, prefix);
      if (nested) return nested;
      continue;
    }

    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    const value = values[field.name];
    if (field.type === "blocks") {
      const issue = npAnalyzeBlockContent(value, definitions).find(
        (entry) => entry.severity === "error",
      );
      if (issue) return { fieldPath, issue };
      continue;
    }

    if (field.type === "group" && isRecord(value)) {
      const nested = findInFields(field.fields, value, definitions, fieldPath);
      if (nested) return nested;
      continue;
    }

    if (field.type === "array" && Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (!isRecord(item)) continue;
        const nested = findInFields(
          field.fields,
          item,
          definitions,
          `${fieldPath}.${index.toString()}`,
        );
        if (nested) return nested;
      }
    }
  }
  return null;
}

/** Finds the first definition-level block error before an Admin document save. */
export function findCollectionBlockContentError(
  fields: readonly NpFieldConfig[],
  values: Record<string, unknown>,
  definitions: readonly NpBlockMetadata[],
): CollectionBlockContentError | null {
  return findInFields(fields, values, definitions, "");
}
