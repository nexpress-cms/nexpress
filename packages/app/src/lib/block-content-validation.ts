import { NpValidationError, getCollectionConfig, type NpFieldConfig } from "@nexpress/core";
import { getRegisteredBlockMetadata, npAnalyzeBlockContent } from "@nexpress/blocks";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFields(
  fields: readonly NpFieldConfig[],
  values: Record<string, unknown>,
  prefix: string,
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      validateFields(field.fields, values, prefix);
      continue;
    }

    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const value = values[field.name];
    if (field.type === "blocks" && value !== undefined) {
      const contentIssue = npAnalyzeBlockContent(value, getRegisteredBlockMetadata()).find(
        (issue) => issue.severity === "error",
      );
      if (contentIssue) {
        throw new NpValidationError("Invalid block content", [
          { field: path, message: contentIssue.message },
        ]);
      }
      continue;
    }

    if (field.type === "group" && isRecord(value)) {
      validateFields(field.fields, value, path);
      continue;
    }

    if (field.type === "array" && Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (isRecord(item)) {
          validateFields(field.fields, item, `${path}.${index.toString()}`);
        }
      }
    }
  }
}

/** Enforces registered block definitions at the app's document-write boundary. */
export function validateDocumentBlockContent(
  collectionSlug: string,
  data: Record<string, unknown>,
): void {
  validateFields(getCollectionConfig(collectionSlug).fields, data, "");
}
