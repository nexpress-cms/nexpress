import type { NpFieldConfig } from "../config/types.js";
import { isNpRichTextContent } from "../fields/rich-text.js";
import type {
  NpContentTransferMediaReference,
  NpContentTransferRelationshipReference,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null;
}

function mediaId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function collectRichTextMedia(
  value: unknown,
  path: string,
  references: NpContentTransferMediaReference[],
): void {
  if (!isNpRichTextContent(value)) return;
  const walk = (node: unknown, nodePath: string): void => {
    const current = record(node);
    if (!current) return;
    if (current.type === "image" || current.type === "upload") {
      const key = current.mediaId !== undefined ? "mediaId" : "value";
      const id = mediaId(current[key]);
      if (id) references.push({ mediaId: id, path: `${nodePath}.${key}` });
    }
    if (Array.isArray(current.children)) {
      for (const [index, child] of current.children.entries()) {
        walk(child, `${nodePath}.children[${index.toString()}]`);
      }
    }
  };
  walk(value.document.root, `${path}.document.root`);
}

function collectMediaFromFields(
  fields: readonly NpFieldConfig[],
  data: Record<string, unknown>,
  path: string,
  references: NpContentTransferMediaReference[],
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      collectMediaFromFields(field.fields, data, path, references);
      continue;
    }
    const fieldPath = `${path}.${field.name}`;
    const value = data[field.name];
    if (field.type === "upload") {
      const id = mediaId(value);
      if (id) references.push({ mediaId: id, path: fieldPath });
      continue;
    }
    if (field.type === "richText") {
      collectRichTextMedia(value, fieldPath, references);
      continue;
    }
    if (field.type === "group") {
      const nested = record(value);
      if (nested) collectMediaFromFields(field.fields, nested, fieldPath, references);
      continue;
    }
    if (field.type === "array" && Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const nested = record(item);
        if (nested) {
          collectMediaFromFields(
            field.fields,
            nested,
            `${fieldPath}[${index.toString()}]`,
            references,
          );
        }
      }
    }
  }
}

export function npCollectContentTransferMediaReferences(
  fields: readonly NpFieldConfig[],
  document: Record<string, unknown>,
  path = "document",
): NpContentTransferMediaReference[] {
  const references: NpContentTransferMediaReference[] = [];
  collectMediaFromFields(fields, document, path, references);
  return references;
}

function remapRichText(value: unknown, replacements: ReadonlyMap<string, string | null>): unknown {
  if (!isNpRichTextContent(value)) return value;
  const walk = (node: unknown): unknown => {
    const current = record(node);
    if (!current) return node;
    const next: Record<string, unknown> = { ...current };
    if (current.type === "image" || current.type === "upload") {
      const key = current.mediaId !== undefined ? "mediaId" : "value";
      const id = mediaId(current[key]);
      if (id && replacements.has(id)) next[key] = replacements.get(id) ?? null;
    }
    if (Array.isArray(current.children)) next.children = current.children.map(walk);
    return next;
  };
  return {
    version: value.version,
    document: { root: walk(value.document.root) },
  };
}

function remapFields(
  fields: readonly NpFieldConfig[],
  data: Record<string, unknown>,
  replacements: ReadonlyMap<string, string | null>,
): Record<string, unknown> {
  const result = { ...data };
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(result, remapFields(field.fields, result, replacements));
      continue;
    }
    const value = result[field.name];
    if (field.type === "upload") {
      const id = mediaId(value);
      if (id && replacements.has(id)) result[field.name] = replacements.get(id) ?? null;
      continue;
    }
    if (field.type === "richText") {
      result[field.name] = remapRichText(value, replacements);
      continue;
    }
    if (field.type === "group") {
      const nested = record(value);
      if (nested) result[field.name] = remapFields(field.fields, nested, replacements);
      continue;
    }
    if (field.type === "array" && Array.isArray(value)) {
      result[field.name] = value.map((item) => {
        const nested = record(item);
        return nested ? remapFields(field.fields, nested, replacements) : item;
      });
    }
  }
  return result;
}

/**
 * Rewrites only collection upload fields and legacy rich-text mediaId/value
 * nodes. Relationship ids, JSON fields, ordinary text, and block props are
 * deliberately untouched. Block image/media controls currently store URLs.
 */
export function npRemapContentTransferMediaReferences(
  fields: readonly NpFieldConfig[],
  document: Record<string, unknown>,
  replacements: ReadonlyMap<string, string | null>,
): Record<string, unknown> {
  return remapFields(fields, document, replacements);
}

function collectRelationshipsFromFields(
  fields: readonly NpFieldConfig[],
  data: Record<string, unknown>,
  path: string,
  references: NpContentTransferRelationshipReference[],
): void {
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      collectRelationshipsFromFields(field.fields, data, path, references);
      continue;
    }
    const fieldPath = `${path}.${field.name}`;
    const value = data[field.name];
    if (field.type === "relationship" && typeof field.relationTo === "string") {
      const values = field.hasMany ? (Array.isArray(value) ? value : []) : [value];
      for (const [index, candidate] of values.entries()) {
        const id = mediaId(candidate);
        if (id) {
          references.push({
            collection: field.relationTo,
            documentId: id,
            path: field.hasMany ? `${fieldPath}[${index.toString()}]` : fieldPath,
          });
        }
      }
      continue;
    }
    if (field.type === "group") {
      const nested = record(value);
      if (nested) collectRelationshipsFromFields(field.fields, nested, fieldPath, references);
      continue;
    }
    if (field.type === "array" && Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const nested = record(item);
        if (nested) {
          collectRelationshipsFromFields(
            field.fields,
            nested,
            `${fieldPath}[${index.toString()}]`,
            references,
          );
        }
      }
    }
  }
}

export function npCollectContentTransferRelationshipReferences(
  fields: readonly NpFieldConfig[],
  document: Record<string, unknown>,
  path = "document",
): NpContentTransferRelationshipReference[] {
  const references: NpContentTransferRelationshipReference[] = [];
  collectRelationshipsFromFields(fields, document, path, references);
  return references;
}
