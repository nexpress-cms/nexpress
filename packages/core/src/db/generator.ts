import {
  type NpArrayField,
  type NpCollectionConfig,
  type NpFieldConfig,
  type NpRelationshipField,
} from "../config/types.js";

interface TableRelation {
  key: string;
  kind: "one" | "many";
  targetIdentifier: string;
  fields?: string[];
  references?: string[];
}

interface GeneratedTable {
  identifier: string;
  tableName: string;
  columns: string[];
  indexes: string[];
  relations: TableRelation[];
}

interface ScalarFieldResult {
  columns: string[];
  relations: TableRelation[];
}

interface TableContext {
  collectionSlug: string;
  tableIdentifier: string;
  tableName: string;
  relationKeyPrefix: string;
  fieldPath: string[];
  parentReferenceName: string;
  parentTargetIdentifier?: string;
}

export interface GenerateDrizzleSchemaOptions {
  /**
   * Module specifier to import the core schema tables (npUsers, npMedia) from.
   * Defaults to "@nexpress/core". Override when the consumer's tooling
   * (e.g. drizzle-kit's CJS resolver) can't load the core package via its
   * exports map — point at a relative path to core's source in that case.
   */
  schemaImport?: string;
}

export function generateDrizzleSchema(
  collections: NpCollectionConfig[],
  options?: GenerateDrizzleSchemaOptions,
): string {
  const schemaImport = options?.schemaImport ?? "@nexpress/core";
  const collectionTables = new Map<string, string>();

  for (const collection of collections) {
    collectionTables.set(collection.slug, getCollectionTableIdentifier(collection.slug));
  }

  const tables: GeneratedTable[] = [];

  for (const collection of collections) {
    const tableIdentifier = getCollectionTableIdentifier(collection.slug);
    const tableName = `np_c_${collection.slug}`;
    const columns = getBaseColumns(collection);
    const indexes = [`index("${tableName}_status_idx").on(table.status)`];
    const relations: TableRelation[] = [
      {
        key: "createdByUser",
        kind: "one",
        targetIdentifier: "npUsers",
        fields: ["createdBy"],
        references: ["id"],
      },
      {
        key: "updatedByUser",
        kind: "one",
        targetIdentifier: "npUsers",
        fields: ["updatedBy"],
        references: ["id"],
      },
    ];

    // Phase 9.7b: collections that opt into member-write track the
    // member-author on the row itself so update/delete can perform
    // the owner check without a separate audit-log lookup. Nullable
    // because staff-authored docs in the same table leave it null;
    // the FK to np_members keeps the column safe under member
    // deletes (cascade).
    const memberAuthored = Boolean(collection.community?.memberWrite?.create);
    if (memberAuthored) {
      columns.push(
        'memberAuthorId: uuid("member_author_id").references((): AnyPgColumn => npMembers.id, { onDelete: "set null" })',
      );
      indexes.push(`index("${tableName}_member_author_idx").on(table.memberAuthorId)`);
      relations.push({
        key: "memberAuthor",
        kind: "one",
        targetIdentifier: "npMembers",
        fields: ["memberAuthorId"],
        references: ["id"],
      });
    }

    const scalarResult = collectScalarColumns(collection.fields, [], collectionTables);
    columns.push(...scalarResult.columns);
    relations.push(...scalarResult.relations);

    if (hasSlugField(collection)) {
      columns.push('slug: text("slug").notNull()');
      // Phase 15.2 — multi-site scoping. Every collection
      // table gets a `site_id` column so the same slug can
      // exist in multiple sites (e.g., `/about` on the main
      // site and on `acme.example.com`). i18n collections
      // additionally key on locale, so the unique becomes
      // `(site_id, locale, slug)`; non-i18n becomes
      // `(site_id, slug)`. Single-tenant installs leave
      // every row at `site_id = 'default'`, so the
      // uniqueness constraint behaves identically to the
      // pre-15.2 `slug-only` index.
      if (collection.i18n) {
        indexes.push(
          `uniqueIndex("${tableName}_site_locale_slug_idx").on(table.siteId, table.locale, table.slug)`,
        );
      } else {
        indexes.push(`uniqueIndex("${tableName}_site_slug_idx").on(table.siteId, table.slug)`);
      }
    }

    if (collection.i18n) {
      columns.push('locale: text("locale").notNull()');
      columns.push('translationGroupId: uuid("translation_group_id").notNull()');
      indexes.push(`index("${tableName}_translation_group_idx").on(table.translationGroupId)`);
      indexes.push(`index("${tableName}_locale_idx").on(table.locale)`);
    }

    // Phase 15.2 — multi-site scoping column. Default is
    // 'default' so existing single-tenant deployments keep
    // working without operator intervention; the migration
    // backfills existing rows. NOT NULL so writes always
    // commit a site id; pipeline reads `getCurrentSiteId()`
    // (or falls back to 'default') and stamps every row.
    // FK to `np_sites.id` is intentionally omitted from
    // codegen — adding it forces every test fixture to
    // create the default site row first; the framework
    // invariant (default site always exists post-migration)
    // gives us the same safety without the schema-level FK.
    columns.push('siteId: text("site_id").default("default").notNull()');
    indexes.push(`index("${tableName}_site_idx").on(table.siteId)`);

    if (hasDraftVersions(collection) && !hasTopLevelField(collection, "publishedAt")) {
      columns.push('publishedAt: timestamp("published_at", { withTimezone: true })');
    }

    columns.push('searchVector: tsvector("search_vector")');

    tables.push({
      identifier: tableIdentifier,
      tableName,
      columns,
      indexes,
      relations,
    });

    createNestedTables(
      {
        collectionSlug: collection.slug,
        tableIdentifier,
        tableName,
        relationKeyPrefix: toCamelCase(collection.slug),
        fieldPath: [],
        parentReferenceName: `${toCamelCase(collection.slug)}Id`,
      },
      collection.fields,
      tables,
      collectionTables,
    );
  }

  const body = tables.map(renderTable).join("\n\n");
  const usesMembers = collections.some((c) => c.community?.memberWrite?.create);
  const schemaImports = ["npMedia", "npUsers", ...(usesMembers ? ["npMembers"] : [])];

  return [
    'import { relations } from "drizzle-orm";',
    'import { boolean, customType, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";',
    `import { ${schemaImports.join(", ")} } from "${schemaImport}";`,
    "",
    "const tsvector = customType<{ data: string }>({",
    "  dataType() {",
    '    return "tsvector";',
    "  },",
    "});",
    "",
    body,
  ].join("\n");
}

function createNestedTables(
  context: TableContext,
  fields: NpFieldConfig[],
  tables: GeneratedTable[],
  collectionTables: Map<string, string>,
): void {
  for (const field of fields) {
    if (field.type === "group") {
      createNestedTables(context, field.fields, tables, collectionTables);
      continue;
    }

    if (field.type === "row" || field.type === "collapsible") {
      createNestedTables(context, field.fields, tables, collectionTables);
      continue;
    }

    if (field.type === "array") {
      tables.push(createArrayTable(context, field, tables, collectionTables));
      continue;
    }

    if (field.type === "relationship" && field.hasMany && typeof field.relationTo === "string") {
      tables.push(
        createHasManyJoinTable(
          context,
          { ...field, relationTo: field.relationTo, hasMany: true },
          collectionTables,
        ),
      );
    }
  }
}

function createArrayTable(
  context: TableContext,
  field: NpArrayField,
  tables: GeneratedTable[],
  collectionTables: Map<string, string>,
): GeneratedTable {
  const path = [...context.fieldPath, field.name];
  const tableName = `np_c_${context.collectionSlug}__${path.join("__")}`;
  const identifier = getNestedTableIdentifier(context.collectionSlug, path);
  const columns = [
    'id: uuid("id").defaultRandom().primaryKey()',
    `parentId: uuid("parent_id").notNull().references((): AnyPgColumn => ${context.tableIdentifier}.id, { onDelete: "cascade" })`,
    'order: integer("order").default(0).notNull()',
  ];
  const relations: TableRelation[] = [
    {
      key: "parent",
      kind: "one",
      targetIdentifier: context.tableIdentifier,
      fields: ["parentId"],
      references: ["id"],
    },
  ];
  const scalarResult = collectScalarColumns(field.fields, [], collectionTables);
  columns.push(...scalarResult.columns);
  relations.push(...scalarResult.relations);

  const nestedContext: TableContext = {
    collectionSlug: context.collectionSlug,
    tableIdentifier: identifier,
    tableName,
    relationKeyPrefix: `${context.relationKeyPrefix}${toPascalCase(field.name)}`,
    fieldPath: path,
    parentReferenceName: "parentId",
    parentTargetIdentifier: context.tableIdentifier,
  };

  createNestedTables(nestedContext, field.fields, tables, collectionTables);

  return {
    identifier,
    tableName,
    columns,
    indexes: [`index("${tableName}_parent_idx").on(table.parentId)`],
    relations,
  };
}

function createHasManyJoinTable(
  context: TableContext,
  field: NpRelationshipField & { relationTo: string; hasMany: true },
  collectionTables: Map<string, string>,
): GeneratedTable {
  const path = [...context.fieldPath, field.name];
  const tableName = `np_c_${context.collectionSlug}__${path.join("__")}`;
  const identifier = getNestedTableIdentifier(context.collectionSlug, path);
  const targetIdentifier = resolveRelationTarget(field.relationTo, collectionTables);
  const parentReferenceName =
    context.fieldPath.length === 0 ? `${toCamelCase(context.collectionSlug)}Id` : "parentId";

  return {
    identifier,
    tableName,
    columns: [
      'id: uuid("id").defaultRandom().primaryKey()',
      `${parentReferenceName}: uuid("${toSnakeCase(parentReferenceName)}").notNull().references((): AnyPgColumn => ${context.tableIdentifier}.id, { onDelete: "cascade" })`,
      `targetId: uuid("target_id").notNull().references((): AnyPgColumn => ${targetIdentifier}.id, { onDelete: "cascade" })`,
      'order: integer("order").default(0).notNull()',
    ],
    indexes: [
      `index("${tableName}_${toSnakeCase(parentReferenceName)}_idx").on(table.${parentReferenceName})`,
      `uniqueIndex("${tableName}_parent_target_uidx").on(table.${parentReferenceName}, table.targetId)`,
    ],
    relations: [
      {
        key: "parent",
        kind: "one",
        targetIdentifier: context.tableIdentifier,
        fields: [parentReferenceName],
        references: ["id"],
      },
      {
        key: "target",
        kind: "one",
        targetIdentifier,
        fields: ["targetId"],
        references: ["id"],
      },
    ],
  };
}

function collectScalarColumns(
  fields: NpFieldConfig[],
  prefix: string[],
  collectionTables: Map<string, string>,
): ScalarFieldResult {
  const columns: string[] = [];
  const relations: TableRelation[] = [];

  for (const field of fields) {
    if (field.type === "group") {
      const nested = collectScalarColumns(field.fields, [...prefix, field.name], collectionTables);
      columns.push(...nested.columns);
      relations.push(...nested.relations);
      continue;
    }

    if (field.type === "row" || field.type === "collapsible") {
      const nested = collectScalarColumns(field.fields, prefix, collectionTables);
      columns.push(...nested.columns);
      relations.push(...nested.relations);
      continue;
    }

    if (field.type === "array") {
      continue;
    }

    if (field.type === "relationship" && field.hasMany) {
      continue;
    }

    const propertyName = getFlattenedFieldName(prefix, field.name);
    const columnName = toSnakeCase(propertyName);
    const column = buildScalarColumn(field, propertyName, columnName, collectionTables);

    if (!column) {
      continue;
    }

    columns.push(...column.columns);
    relations.push(...column.relations);
  }

  return { columns, relations };
}

function buildScalarColumn(
  field: Exclude<NpFieldConfig, { type: "row" | "collapsible" | "group" | "array" }>,
  propertyName: string,
  columnName: string,
  collectionTables: Map<string, string>,
): ScalarFieldResult | null {
  const notNull = field.required ? ".notNull()" : "";

  // Honors `field.defaultValue` for SQL-mappable scalar types
  // (text family, number, checkbox, date). Drizzle's
  // `.default(<expr>)` emits a `DEFAULT` clause in the generated
  // migration, which is required for adding a NOT NULL column to
  // a table that already has rows. Non-scalar types
  // (`relationship`, `upload`, `array`, `group`, `richText`,
  // `blocks`, `json`) ignore the value — those either don't map
  // to a single column or have no sensible server-side default.
  //
  // For `date` fields the value accepts three shapes:
  //   - the literal `"now"` sentinel → emit `.defaultNow()`
  //     (Drizzle's helper that compiles to `DEFAULT now()`).
  //   - a JS `Date` instance → emit
  //     `.default(new Date("<iso>"))`; Drizzle converts at
  //     query-build time.
  //   - an ISO 8601 string → parsed via `new Date(...)` and
  //     emitted the same way.
  // Anything else is dropped silently (same defensive shape as
  // mismatched scalars).
  const defaultClause = ((): string => {
    if (field.defaultValue === undefined || field.defaultValue === null) return "";
    if (
      field.type === "text" ||
      field.type === "textarea" ||
      field.type === "email" ||
      field.type === "select" ||
      field.type === "radio"
    ) {
      if (typeof field.defaultValue !== "string") return "";
      // Escape `\` and `"` so the emitted TS literal is a valid
      // double-quoted string. The generator's output is consumed
      // by tsc, which would reject an unescaped embedded quote.
      const literal = field.defaultValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `.default("${literal}")`;
    }
    if (field.type === "number") {
      if (typeof field.defaultValue !== "number" || !Number.isFinite(field.defaultValue)) return "";
      return `.default(${field.defaultValue.toString()})`;
    }
    if (field.type === "checkbox") {
      if (typeof field.defaultValue !== "boolean") return "";
      return `.default(${field.defaultValue.toString()})`;
    }
    if (field.type === "date") {
      if (field.defaultValue === "now") return ".defaultNow()";
      if (field.defaultValue instanceof Date && !Number.isNaN(field.defaultValue.getTime())) {
        return `.default(new Date("${field.defaultValue.toISOString()}"))`;
      }
      if (typeof field.defaultValue === "string") {
        const parsed = new Date(field.defaultValue);
        if (!Number.isNaN(parsed.getTime())) {
          return `.default(new Date("${parsed.toISOString()}"))`;
        }
      }
      return "";
    }
    return "";
  })();

  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "select":
    case "radio":
      return {
        columns: [`${propertyName}: text("${columnName}")${defaultClause}${notNull}`],
        relations: [],
      };
    case "number": {
      const builder = field.integerOnly ? "integer" : "doublePrecision";
      return {
        columns: [`${propertyName}: ${builder}("${columnName}")${defaultClause}${notNull}`],
        relations: [],
      };
    }
    case "richText":
    case "blocks":
    case "json":
      return { columns: [`${propertyName}: jsonb("${columnName}")${notNull}`], relations: [] };
    case "checkbox":
      return {
        columns: [`${propertyName}: boolean("${columnName}")${defaultClause}${notNull}`],
        relations: [],
      };
    case "date":
      return {
        columns: [
          `${propertyName}: timestamp("${columnName}", { withTimezone: true })${defaultClause}${notNull}`,
        ],
        relations: [],
      };
    case "upload": {
      return {
        columns: [
          `${propertyName}: uuid("${columnName}").references((): AnyPgColumn => npMedia.id)${notNull}`,
        ],
        relations: [
          {
            key: propertyName,
            kind: "one",
            targetIdentifier: "npMedia",
            fields: [propertyName],
            references: ["id"],
          },
        ],
      };
    }
    case "relationship": {
      if (typeof field.relationTo !== "string") {
        return null;
      }

      const targetIdentifier = resolveRelationTarget(field.relationTo, collectionTables);
      return {
        columns: [
          `${propertyName}: uuid("${columnName}").references((): AnyPgColumn => ${targetIdentifier}.id)${notNull}`,
        ],
        relations: [
          {
            key: propertyName,
            kind: "one",
            targetIdentifier,
            fields: [propertyName],
            references: ["id"],
          },
        ],
      };
    }
    default:
      return null;
  }
}

function getBaseColumns(collection: NpCollectionConfig): string[] {
  const columns = ['id: uuid("id").defaultRandom().primaryKey()'];

  columns.push(
    'status: text("status", { enum: ["draft", "scheduled", "published", "archived", "pending"] }).default("draft").notNull()',
  );

  columns.push('createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()');
  columns.push('updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()');
  columns.push('createdBy: uuid("created_by").references((): AnyPgColumn => npUsers.id)');
  columns.push('updatedBy: uuid("updated_by").references((): AnyPgColumn => npUsers.id)');

  // Phase 21.17 — per-doc visibility flag. Orthogonal to
  // `status` (workflow state): a row can be published-public,
  // published-private, draft-public, etc. Anonymous reads in
  // `findDocuments` auto-filter to `visibility = "public"` so a
  // newly-imported "private" row never leaks to crawlers; an
  // authenticated principal (member or staff) sees both. WP
  // imports use this to round-trip `<wp:status>private</wp:status>`
  // posts as `status=published, visibility=private` rather than
  // the old draft-coercion that lost the publish state.
  const visibility =
    'visibility: text("visibility", { enum: ["public", "private"] }).default("public").notNull()';

  if (collection.timestamps === false) {
    return [columns[0], columns[1], columns[4], columns[5], visibility];
  }

  columns.push(visibility);
  return columns;
}

function renderTable(table: GeneratedTable): string {
  const tableSource = [
    `export const ${table.identifier} = pgTable(`,
    `  "${table.tableName}",`,
    "  {",
    ...table.columns.map((column) => `    ${column},`),
    "  },",
    `  (table) => [${table.indexes.join(", ")}],`,
    ");",
  ].join("\n");

  const relationsSource = [
    `export const ${table.identifier}Relations = relations(${table.identifier}, ({ many, one }) => ({`,
    ...table.relations.map((relation) => renderRelation(relation, table.identifier)),
    "}));",
  ].join("\n");

  return `${tableSource}\n\n${relationsSource}`;
}

function renderRelation(relation: TableRelation, ownerIdentifier: string): string {
  if (relation.kind === "many") {
    return `  ${relation.key}: many(${relation.targetIdentifier}),`;
  }

  const fields = (relation.fields ?? []).map((field) => `${ownerIdentifier}.${field}`).join(", ");
  const references = (relation.references ?? [])
    .map((reference) => `${relation.targetIdentifier}.${reference}`)
    .join(", ");

  return `  ${relation.key}: one(${relation.targetIdentifier}, { fields: [${fields}], references: [${references}] }),`;
}

function hasSlugField(collection: NpCollectionConfig): boolean {
  return collection.slugField !== undefined && collection.slugField !== false;
}

function hasDraftVersions(collection: NpCollectionConfig): boolean {
  return Boolean(collection.versions?.drafts);
}

function hasTopLevelField(collection: NpCollectionConfig, name: string): boolean {
  return collection.fields.some((field) => {
    if (field.type === "row" || field.type === "collapsible") {
      return hasTopLevelField({ ...collection, fields: field.fields }, name);
    }
    return field.name === name;
  });
}

function resolveRelationTarget(relationTo: string, collectionTables: Map<string, string>): string {
  if (relationTo === "media") {
    return "npMedia";
  }

  if (relationTo === "users") {
    return "npUsers";
  }

  return collectionTables.get(relationTo) ?? getCollectionTableIdentifier(relationTo);
}

function getCollectionTableIdentifier(slug: string): string {
  return `${toCamelCase(slug)}Table`;
}

function getNestedTableIdentifier(collectionSlug: string, path: string[]): string {
  return `${toCamelCase(collectionSlug)}${path.map(toPascalCase).join("")}Table`;
}

function getFlattenedFieldName(prefix: string[], name: string): string {
  if (prefix.length === 0) {
    return toCamelCase(name);
  }

  return `${prefix.map(toPascalCase).join("")}${toPascalCase(name)}`.replace(/^./u, (char) =>
    char.toLowerCase(),
  );
}

function toCamelCase(value: string): string {
  const parts = splitName(value);
  const [first = "", ...rest] = parts;
  return `${first}${rest.map(capitalize).join("")}`;
}

function toPascalCase(value: string): string {
  return splitName(value).map(capitalize).join("");
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
}

function splitName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
