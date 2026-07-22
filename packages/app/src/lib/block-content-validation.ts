import { NpValidationError, getCollectionConfig, type NpFieldConfig } from "@nexpress/core";
import {
  getRegisteredBlockMetadataForActiveSources,
  npAnalyzeBlockContent,
  type NpBlockMetadata,
} from "@nexpress/blocks";
import { createSiteScopedBlockRenderContext } from "@nexpress/next";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFields(
  fields: readonly NpFieldConfig[],
  values: Record<string, unknown>,
  prefix: string,
  definitions: readonly NpBlockMetadata[],
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      validateFields(field.fields, values, prefix, definitions);
      continue;
    }

    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const value = values[field.name];
    if (field.type === "blocks" && value !== undefined) {
      const contentIssue = npAnalyzeBlockContent(value, definitions).find(
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
      validateFields(field.fields, value, path, definitions);
      continue;
    }

    if (field.type === "array" && Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (isRecord(item)) {
          validateFields(field.fields, item, `${path}.${index.toString()}`, definitions);
        }
      }
    }
  }
}

/** Enforces registered block definitions at the app's document-write boundary. */
export async function validateDocumentBlockContent(
  collectionSlug: string,
  data: Record<string, unknown>,
): Promise<void> {
  const ctx = await createSiteScopedBlockRenderContext();
  const definitions = getRegisteredBlockMetadataForActiveSources(ctx.activeSources!);
  validateFields(getCollectionConfig(collectionSlug).fields, data, "", definitions);
}
