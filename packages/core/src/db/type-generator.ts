import { type NpCollectionConfig, type NpFieldConfig } from "../config/types.js";

export function generateTypeScript(collections: NpCollectionConfig[]): string {
  const interfaces = collections.map((collection) => renderCollectionInterface(collection));
  const imports = renderFieldTypeImport(collections);
  return `import type { NpCollectionDocumentWire } from "@nexpress/core/collection-contract";\n${imports}${interfaces.join("\n\n")}`;
}

function renderFieldTypeImport(collections: NpCollectionConfig[]): string {
  const types: string[] = [];
  if (collections.some((collection) => hasFieldType(collection.fields, "blocks"))) {
    types.push("NpBlockContent");
  }
  if (collections.some((collection) => hasFieldType(collection.fields, "richText"))) {
    types.push("NpRichTextContent");
  }
  return types.length > 0
    ? `import type { ${types.join(", ")} } from "@nexpress/core/fields";\n\n`
    : "";
}

function hasFieldType(fields: NpFieldConfig[], target: "blocks" | "richText"): boolean {
  return fields.some((field) => {
    if (field.type === target) return true;
    if (
      field.type === "array" ||
      field.type === "group" ||
      field.type === "row" ||
      field.type === "collapsible"
    ) {
      return hasFieldType(field.fields, target);
    }
    return false;
  });
}

/**
 * Renders a complete `documents.ts` module: imports from
 * `@nexpress/core`, per-collection `${Pascal}Document` interfaces,
 * and typed read-helper wrappers (`find${Pascal}` /
 * `get${Pascal}Document`) that bind the type generic so call sites
 * don't have to.
 *
 * Every wrapper delegates directly to the canonical Core query
 * boundary. Core validates options and resolves hasMany join-table
 * filters, so generated helpers cannot bypass access, pagination,
 * hydration, or result-contract checks on an empty match.
 *
 * The output is meant for `apps/<app>/src/db/generated/documents.ts`
 * and is a direct counterpart to `generateDrizzleSchema`'s
 * `collections.ts` (Drizzle schema). Both files come from the same
 * `nexpressConfig.collections` source so they stay in sync.
 */
export function generateDocumentsModule(collections: NpCollectionConfig[]): string {
  const coreImports = [
    `import {`,
    `  findDocuments,`,
    `  getDocumentById,`,
    `  type NpAuthUser,`,
    `  type NpFindOptions,`,
    `  type NpFindResult,`,
    `} from "@nexpress/core";`,
  ].join("\n");
  const collectionContractImport = `import type { NpCollectionDocumentWire } from "@nexpress/core/collection-contract";`;
  const fieldImports = renderFieldTypeImport(collections).trim();

  const imports = [coreImports, collectionContractImport, fieldImports].filter(Boolean).join("\n");

  const interfaces = collections.map((c) => renderCollectionInterface(c)).join("\n\n");
  const helpers = collections.map((collection) => renderReadHelpers(collection)).join("\n\n");

  return [imports, "", interfaces, "", helpers, ""].join("\n");
}

function renderReadHelpers(collection: NpCollectionConfig): string {
  const docType = `${toPascalCase(collection.slug)}Document`;
  const findFnName = `find${toPascalCase(collection.slug)}`;
  const getFnName = `get${toPascalCase(collection.slug)}Document`;
  const slug = JSON.stringify(collection.slug);

  const findFn = renderSimpleFindFn(findFnName, slug, docType, collection.slug);

  return [
    findFn,
    "",
    `/** Typed by-id fetch for the \`${collection.slug}\` collection. */`,
    `export function ${getFnName}(`,
    `  id: string,`,
    `  user?: NpAuthUser,`,
    `): Promise<${docType} | null> {`,
    `  return getDocumentById<${docType}>(${slug}, id, user);`,
    `}`,
  ].join("\n");
}

function renderSimpleFindFn(
  findFnName: string,
  slug: string,
  docType: string,
  slugLabel: string,
): string {
  return [
    `/** Typed listing query for the \`${slugLabel}\` collection. */`,
    `export function ${findFnName}(`,
    `  options: NpFindOptions<${docType}> = {},`,
    `  user?: NpAuthUser,`,
    `): Promise<NpFindResult<${docType}>> {`,
    `  return findDocuments<${docType}>(${slug}, options, user);`,
    `}`,
  ].join("\n");
}

function renderCollectionInterface(collection: NpCollectionConfig): string {
  const interfaceName = `${toPascalCase(collection.slug)}Document`;
  const fields = [
    "id: string;",
    'status: "draft" | "scheduled" | "published" | "archived" | "pending";',
    "createdBy: string | null;",
    "updatedBy: string | null;",
  ];

  if (collection.timestamps !== false) {
    fields.splice(2, 0, "createdAt: Date;", "updatedAt: Date;");
  }

  if (collection.community?.memberWrite?.create) {
    fields.push("memberAuthorId: string | null;");
  }

  if (collection.slugField) {
    fields.push("slug: string;");
  }

  if (collection.versions?.drafts) {
    if (!hasTopLevelField(collection, "publishedAt")) {
      fields.push("publishedAt: Date | null;");
    }
  }

  fields.push('visibility: "public" | "private";');
  fields.push("siteId: string;");
  if (collection.i18n) {
    fields.push("locale: string;");
    fields.push("translationGroupId: string;");
  }

  fields.push(...renderFields(collection.fields));

  return [
    `export interface ${interfaceName} {`,
    ...fields.map((field) => `  ${field}`),
    "}",
    `export type ${interfaceName}Wire = NpCollectionDocumentWire<${interfaceName}>;`,
  ].join("\n");
}

function hasTopLevelField(collection: NpCollectionConfig, name: string): boolean {
  return collection.fields.some((field) => {
    if (field.type === "row" || field.type === "collapsible") {
      return hasTopLevelField({ ...collection, fields: field.fields }, name);
    }
    return field.name === name;
  });
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

function getTypeSource(
  field: Exclude<NpFieldConfig, { type: "row" | "collapsible" | "group" }>,
): string {
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
      return "NpRichTextContent";
    case "blocks":
      return "NpBlockContent";
    case "json":
      return "unknown";
    default:
      return "unknown";
  }
}

function applyNullability(typeSource: string, required?: boolean): string {
  if (typeSource === "string[]" || typeSource.startsWith("Array<")) return typeSource;
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
