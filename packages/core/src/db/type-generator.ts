import { type NpCollectionConfig, type NpFieldConfig } from "../config/types.js";

export function generateTypeScript(collections: NpCollectionConfig[]): string {
  const interfaces = collections.map((collection) => renderCollectionInterface(collection));
  return interfaces.join("\n\n");
}

/**
 * Renders a complete `documents.ts` module: imports from
 * `@nexpress/core`, per-collection `${Pascal}Document` interfaces,
 * and typed read-helper wrappers (`find${Pascal}` /
 * `get${Pascal}Document`) that bind the type generic so call sites
 * don't have to.
 *
 * The output is meant for `apps/<app>/src/db/generated/documents.ts`
 * and is a direct counterpart to `generateDrizzleSchema`'s
 * `collections.ts` (Drizzle schema). Both files come from the same
 * `nexpressConfig.collections` source so they stay in sync.
 */
export function generateDocumentsModule(collections: NpCollectionConfig[]): string {
  const imports = [
    `import {`,
    `  findDocuments,`,
    `  getDocumentById,`,
    `  type NpAuthUser,`,
    `  type NpFindOptions,`,
    `  type NpFindResult,`,
    `} from "@nexpress/core";`,
    ``,
  ].join("\n");

  const interfaces = collections.map((c) => renderCollectionInterface(c)).join("\n\n");
  const helpers = collections.map((c) => renderReadHelpers(c)).join("\n\n");

  return [imports, interfaces, "", helpers, ""].join("\n");
}

function renderReadHelpers(collection: NpCollectionConfig): string {
  const docType = `${toPascalCase(collection.slug)}Document`;
  const findFnName = `find${toPascalCase(collection.slug)}`;
  const getFnName = `get${toPascalCase(collection.slug)}Document`;
  const slug = JSON.stringify(collection.slug);
  return [
    `/** Typed listing query for the \`${collection.slug}\` collection. */`,
    `export function ${findFnName}(`,
    `  options: NpFindOptions<${docType}> = {},`,
    `  user?: NpAuthUser,`,
    `): Promise<NpFindResult<${docType}>> {`,
    `  return findDocuments<${docType}>(${slug}, options, user);`,
    `}`,
    ``,
    `/** Typed by-id fetch for the \`${collection.slug}\` collection. */`,
    `export function ${getFnName}(`,
    `  id: string,`,
    `  user?: NpAuthUser,`,
    `): Promise<${docType} | null> {`,
    `  return getDocumentById<${docType}>(${slug}, id, user);`,
    `}`,
  ].join("\n");
}

function renderCollectionInterface(collection: NpCollectionConfig): string {
  const interfaceName = `${toPascalCase(collection.slug)}Document`;
  const fields = [
    'id: string;',
    'status: "draft" | "published" | "archived" | "pending";',
    'createdAt: Date;',
    'updatedAt: Date;',
    'createdBy: string | null;',
    'updatedBy: string | null;',
  ];

  if (collection.community?.memberWrite?.create) {
    fields.push('memberAuthorId: string | null;');
  }

  if (collection.slugField) {
    fields.push("slug: string;");
  }

  if (collection.versions?.drafts) {
    fields.push('_status: "draft" | "published";');
  }

  fields.push(...renderFields(collection.fields));

  return [`export interface ${interfaceName} {`, ...fields.map((field) => `  ${field}`), "}"].join("\n");
}

function renderFields(fields: NpFieldConfig[], prefix: string[] = []): string[] {
  const lines: string[] = [];

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      lines.push(...renderFields(field.fields, prefix));
      continue;
    }

    const fieldName = field.type === "group" ? getPropertyName(prefix, field.name) : "";

    if (field.type === "group") {
      const groupType = renderObjectType(field.fields);
      lines.push(`${fieldName}: ${applyNullability(groupType, field.required)};`);
      continue;
    }

    const propertyName = getPropertyName(prefix, field.name);
    const typeSource = getTypeSource(field);
    lines.push(`${propertyName}: ${applyNullability(typeSource, field.required)};`);
  }

  return lines;
}

function renderObjectType(fields: NpFieldConfig[]): string {
  const members = renderFields(fields).map((field) => `  ${field}`);
  return [`{`, ...members, `}`].join("\n");
}

function getTypeSource(field: Exclude<NpFieldConfig, { type: "row" | "collapsible" | "group" }>): string {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "select":
    case "radio":
      return "string";
    case "number":
      return "number";
    case "checkbox":
      return "boolean";
    case "date":
      return "Date";
    case "upload":
      return "string";
    case "relationship":
      return field.hasMany ? "string[]" : "string";
    case "array":
      return `Array<${renderObjectType(field.fields)}>`;
    case "richText":
    case "blocks":
    case "json":
      return "unknown";
    default:
      return "unknown";
  }
}

function applyNullability(typeSource: string, required?: boolean): string {
  return required ? typeSource : `${typeSource} | null`;
}

function getPropertyName(prefix: string[], name: string): string {
  if (prefix.length === 0) {
    return toCamelCase(name);
  }

  return `${prefix[0]}${prefix.slice(1).map(toPascalCase).join("")}${toPascalCase(name)}`;
}

function toCamelCase(value: string): string {
  const parts = splitName(value);
  const [first = "", ...rest] = parts;
  return `${first}${rest.map(toPascalCase).join("")}`;
}

function toPascalCase(value: string): string {
  return splitName(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function splitName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}
