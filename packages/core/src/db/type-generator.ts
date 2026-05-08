import { type NpCollectionConfig, type NpFieldConfig } from "../config/types.js";

export function generateTypeScript(collections: NpCollectionConfig[]): string {
  const interfaces = collections.map((collection) => renderCollectionInterface(collection));
  return interfaces.join("\n\n");
}

interface HasManyDescriptor {
  /** Field name on the collection (the where clause key). */
  fieldName: string;
  /** Generated join-table import name (e.g., `postsCategoriesTable`). */
  joinTable: string;
  /** Parent FK column on the join table (e.g., `postsId`). */
  parentColumn: string;
}

function collectHasManyFields(collection: NpCollectionConfig): HasManyDescriptor[] {
  const collCamel = toCamelCase(collection.slug);
  const parentColumn = `${collCamel}Id`;
  const out: HasManyDescriptor[] = [];
  // Only top-level fields participate. Nested hasMany (inside row /
  // collapsible / group / array) is rare in practice and the join-
  // table naming convention doesn't carry through nesting cleanly.
  for (const field of collection.fields) {
    if (field.type === "relationship" && field.hasMany === true) {
      const joinTable = `${collCamel}${toPascalCase(field.name)}Table`;
      out.push({ fieldName: field.name, joinTable, parentColumn });
    }
  }
  return out;
}

/**
 * Renders a complete `documents.ts` module: imports from
 * `@nexpress/core`, per-collection `${Pascal}Document` interfaces,
 * and typed read-helper wrappers (`find${Pascal}` /
 * `get${Pascal}Document`) that bind the type generic so call sites
 * don't have to.
 *
 * Collections with hasMany relationship fields get a smarter
 * wrapper: when the caller's `where` clause names a hasMany
 * field, the wrapper queries the join table for matching parent
 * ids first, intersects across multiple hasMany filters, and
 * delegates to `findDocuments` with `id: idList`. That covers
 * the friction surfaced in #540's category-page dogfood — a
 * `where: { categories: id }` filter looked typed but failed at
 * runtime because `categories` isn't a column on the parent
 * table; this wrapper makes it work.
 *
 * The output is meant for `apps/<app>/src/db/generated/documents.ts`
 * and is a direct counterpart to `generateDrizzleSchema`'s
 * `collections.ts` (Drizzle schema). Both files come from the same
 * `nexpressConfig.collections` source so they stay in sync.
 */
export function generateDocumentsModule(collections: NpCollectionConfig[]): string {
  const hasManyByCollection = new Map(
    collections.map((c) => [c.slug, collectHasManyFields(c)]),
  );
  const anyHasMany = Array.from(hasManyByCollection.values()).some(
    (list) => list.length > 0,
  );

  const coreImports = [
    `import {`,
    `  findDocuments,`,
    ...(anyHasMany ? [`  getDb,`] : []),
    `  getDocumentById,`,
    `  type NpAuthUser,`,
    `  type NpFindOptions,`,
    `  type NpFindResult,`,
    `} from "@nexpress/core";`,
  ].join("\n");

  // Drizzle + join-table imports only when at least one collection
  // has a hasMany relationship — keeps the file lean for sites
  // that don't use them.
  const drizzleImports = anyHasMany
    ? [
        `import { inArray } from "drizzle-orm";`,
        `import type { NodePgDatabase } from "drizzle-orm/node-postgres";`,
      ].join("\n")
    : "";
  const joinTables = Array.from(
    new Set(
      Array.from(hasManyByCollection.values())
        .flat()
        .map((d) => d.joinTable),
    ),
  ).sort();
  const joinTableImports =
    joinTables.length > 0
      ? `import { ${joinTables.join(", ")} } from "./collections.js";`
      : "";

  const imports = [coreImports, drizzleImports, joinTableImports]
    .filter(Boolean)
    .join("\n");

  const interfaces = collections.map((c) => renderCollectionInterface(c)).join("\n\n");
  const helpers = collections
    .map((c) => renderReadHelpers(c, hasManyByCollection.get(c.slug) ?? []))
    .join("\n\n");

  return [imports, "", interfaces, "", helpers, ""].join("\n");
}

function renderReadHelpers(
  collection: NpCollectionConfig,
  hasMany: HasManyDescriptor[],
): string {
  const docType = `${toPascalCase(collection.slug)}Document`;
  const findFnName = `find${toPascalCase(collection.slug)}`;
  const getFnName = `get${toPascalCase(collection.slug)}Document`;
  const slug = JSON.stringify(collection.slug);

  const findFn =
    hasMany.length === 0
      ? renderSimpleFindFn(findFnName, slug, docType, collection.slug)
      : renderHasManyFindFn(findFnName, slug, docType, collection.slug, hasMany);

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

function renderHasManyFindFn(
  findFnName: string,
  slug: string,
  docType: string,
  slugLabel: string,
  hasMany: HasManyDescriptor[],
): string {
  // Build a literal array of `{ field, table, column }` for
  // runtime iteration. Keep it inline (instead of a loose const)
  // so the wrapper is one self-contained function — no helpers
  // bleed into consumer code completion.
  const descriptors = hasMany
    .map(
      (d) =>
        `    { field: ${JSON.stringify(d.fieldName)}, table: ${d.joinTable}, parent: ${d.joinTable}.${d.parentColumn} },`,
    )
    .join("\n");

  return [
    `/**`,
    ` * Typed listing query for the \`${slugLabel}\` collection.`,
    ` *`,
    ` * Pre-resolves hasMany relationship filters in the where`,
    ` * clause (${hasMany.map((d) => `\`${d.fieldName}\``).join(", ")}) by`,
    ` * subquerying the join table for matching parent ids. Each`,
    ` * field accepts a single target id (most common) or an array`,
    ` * of target ids (OR semantics). Multiple hasMany filters`,
    ` * intersect — \`where: { categories: catId, tags: tagId }\``,
    ` * matches rows that have BOTH.`,
    ` */`,
    `export async function ${findFnName}(`,
    `  options: NpFindOptions<${docType}> = {},`,
    `  user?: NpAuthUser,`,
    `): Promise<NpFindResult<${docType}>> {`,
    `  const where = options.where ? { ...options.where } : {};`,
    `  const hasManyDescriptors = [`,
    descriptors,
    `  ];`,
    ``,
    `  const matched: string[][] = [];`,
    `  let touchedHasMany = false;`,
    `  for (const { field, table, parent } of hasManyDescriptors) {`,
    `    const value = (where as Record<string, unknown>)[field];`,
    `    if (value === undefined) continue;`,
    `    touchedHasMany = true;`,
    `    delete (where as Record<string, unknown>)[field];`,
    `    const targets = (Array.isArray(value) ? value : [value]).filter(`,
    `      (v): v is string => typeof v === "string" && v.length > 0,`,
    `    );`,
    `    if (targets.length === 0) {`,
    `      // Empty array short-circuits to no rows — match the`,
    `      // pipeline's array-where semantics.`,
    `      matched.push([]);`,
    `      continue;`,
    `    }`,
    `    // Cast getDb() to NodePgDatabase so the drizzle builder`,
    `    // chain (.select.from.where) carries proper return types.`,
    `    // The empty-schema generic narrows the return shape away`,
    `    // from any specific tables; the explicit \`{ id: string }[]\` `,
    `    // cast at the end matches the projection.`,
    `    const db = getDb() as unknown as NodePgDatabase<Record<string, never>>;`,
    `    const rows = (await db`,
    `      .select({ id: parent })`,
    `      .from(table)`,
    `      .where(inArray(table.targetId, targets))) as Array<{ id: string }>;`,
    `    matched.push(rows.map((r) => r.id));`,
    `  }`,
    ``,
    `  if (touchedHasMany) {`,
    `    // Intersect across all hasMany filters. Empty intersection`,
    `    // → return immediately; findDocuments would short-circuit`,
    `    // on the empty-array where clause anyway, but the early`,
    `    // exit saves a round-trip.`,
    `    let ids = matched[0] ?? [];`,
    `    for (let i = 1; i < matched.length; i++) {`,
    `      const set = new Set(matched[i]);`,
    `      ids = ids.filter((id) => set.has(id));`,
    `    }`,
    `    if (ids.length === 0) {`,
    `      return {`,
    `        docs: [],`,
    `        totalDocs: 0,`,
    `        totalPages: 0,`,
    `        page: options.page ?? 1,`,
    `        limit: options.limit ?? 20,`,
    `        hasNextPage: false,`,
    `        hasPrevPage: false,`,
    `      };`,
    `    }`,
    `    (where as Record<string, unknown>).id = ids;`,
    `  }`,
    ``,
    `  return findDocuments<${docType}>(${slug}, { ...options, where }, user);`,
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
