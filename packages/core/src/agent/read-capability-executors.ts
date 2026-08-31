import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  npAgentDisabledGatewaySettingsV1,
  npRequireAgentGatewaySettings,
  npRequireAgentJsonSchema,
  type NpAgentContentFilterV1,
  type NpAgentContentQueryInputV1,
  type NpAgentContentQueryOutputV1,
  type NpAgentGatewaySettingsV1,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentJsonValue,
  type NpAgentSchemaGetInputV1,
  type NpAgentSchemaGetOutputV1,
  type NpAgentSiteInspectOutputV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  findDocuments,
  getAllCollectionSlugs,
  getCollectionConfig,
  getCollectionTable,
} from "../collections/index.js";
import type { NpAuthUser, NpCollectionConfig, NpFieldConfig } from "../config/types.js";
import { getDb } from "../db/runtime.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { getI18nConfig } from "../i18n/registry.js";
import { listEnabledPluginIds } from "../plugins/persistence.js";
import { getSiteById } from "../sites/registry.js";
import type {
  NpAgentReadCapabilityContextV1,
  NpAgentReadCapabilityExecutorsV1,
} from "./capability-registry.js";

const META = "https://json-schema.org/draft/2020-12/schema" as const;
const CURSOR_TTL_MS = 15 * 60 * 1_000;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const CURSOR_KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const BLOCK_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const MAX_CONTENT_OUTPUT_BYTES = 3 * 1_024 * 1_024;
const MAX_BLOCK_SCHEMAS = 1_000;
const MAX_PROJECTED_DEPTH = 32;
const MAX_PROJECTED_NODES = 20_000;
const MAX_PROJECTED_ARRAY_ITEMS = 5_000;
const MAX_PROJECTED_OBJECT_PROPERTIES = 512;
const MAX_PROJECTED_STRING_CHARACTERS = 262_144;

type ContentRow = Record<string, unknown>;
type NamedField = Exclude<NpFieldConfig, { type: "row" } | { type: "collapsible" }>;

export interface NpAgentCoreReadCapabilityOptionsV1 {
  cursorHmacKey: { id: string; key: Uint8Array };
  resolveUser: (userId: string) => NpAuthUser | null | Promise<NpAuthUser | null>;
  resolveBlockSchemas: (
    siteId: string,
  ) =>
    | readonly { type: string; schema: NpAgentJsonSchema }[]
    | Promise<readonly { type: string; schema: NpAgentJsonSchema }[]>;
  resolveGatewaySettings?: (
    siteId: string,
  ) => NpAgentGatewaySettingsV1 | Promise<NpAgentGatewaySettingsV1>;
  runtimeState?: (
    siteId: string,
  ) =>
    | NpAgentSiteInspectOutputV1["features"]["runtime"]
    | Promise<NpAgentSiteInspectOutputV1["features"]["runtime"]>;
}

interface CursorBody extends NpAgentJsonObject {
  schemaVersion: "np.agent-content-cursor.v1";
  keyId: string;
  siteId: string;
  principalId: string;
  queryDigest: string;
  offset: number;
  expiresAt: string;
}

function digest(domain: string, value: unknown): `cj1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function jsonSchema(
  properties: Record<string, NpAgentJsonValue>,
  required: string[],
): NpAgentJsonSchema {
  return npRequireAgentJsonSchema({
    $schema: META,
    type: "object",
    additionalProperties: false,
    properties,
    required,
  });
}

function safeFieldEntries(fields: readonly NpFieldConfig[]): NamedField[] {
  const safe: NamedField[] = [];
  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      safe.push(...safeFieldEntries(field.fields));
    } else if (field.hidden !== true) {
      safe.push(field);
    }
  }
  return safe;
}

function fieldSchema(
  field: NamedField,
  blockSchemas: ReadonlyMap<string, NpAgentJsonSchema>,
): NpAgentJsonValue {
  const nullable = field.required === true ? undefined : ["null"];
  switch (field.type) {
    case "text":
      return {
        type: nullable ? ["string", ...nullable] : "string",
        ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
        maxLength: field.maxLength ?? 32_768,
      };
    case "textarea":
      return {
        type: nullable ? ["string", ...nullable] : "string",
        ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
        maxLength: field.maxLength ?? MAX_PROJECTED_STRING_CHARACTERS,
      };
    case "email":
      return {
        type: nullable ? ["string", ...nullable] : "string",
        maxLength: 320,
        format: "email",
      };
    case "richText":
      return {
        type: nullable ? ["object", ...nullable] : "object",
        additionalProperties: false,
        patternProperties: { ".*": {} },
      };
    case "number":
      return {
        type: nullable
          ? [field.integerOnly ? "integer" : "number", ...nullable]
          : field.integerOnly
            ? "integer"
            : "number",
        ...(field.min === undefined ? {} : { minimum: field.min }),
        ...(field.max === undefined ? {} : { maximum: field.max }),
      };
    case "checkbox":
      return { type: nullable ? ["boolean", ...nullable] : "boolean" };
    case "date":
      return {
        type: nullable ? ["string", ...nullable] : "string",
        maxLength: 32,
        format: "date-time",
      };
    case "select":
    case "radio": {
      const values = field.options.map((option) => option.value).sort();
      if (field.type === "select" && field.hasMany) {
        return {
          type: nullable ? ["array", ...nullable] : "array",
          maxItems: 1_000,
          items: { type: "string", maxLength: 1_024, enum: values },
        };
      }
      return {
        type: nullable ? ["string", ...nullable] : "string",
        maxLength: 1_024,
        enum: values,
      };
    }
    case "upload":
      return { type: nullable ? ["string", ...nullable] : "string", maxLength: 128 };
    case "relationship":
      return field.hasMany
        ? {
            type: nullable ? ["array", ...nullable] : "array",
            maxItems: 1_000,
            items: { type: "string", maxLength: 128 },
          }
        : { type: nullable ? ["string", ...nullable] : "string", maxLength: 128 };
    case "blocks": {
      const allowedTypes = field.allowedBlocks ?? [...blockSchemas.keys()];
      const allowed = allowedTypes.map((type) => {
        const schema = blockSchemas.get(type);
        if (!schema) {
          throw new Error(
            `Collection block field references unavailable block ${JSON.stringify(type)}.`,
          );
        }
        return schema;
      });
      return {
        type: nullable ? ["array", ...nullable] : "array",
        maxItems: field.maxRows ?? 1_000,
        items: allowed.length === 0 ? { not: {} } : { oneOf: allowed },
      };
    }
    case "json":
      return {
        oneOf: [
          { type: "string", maxLength: 262_144 },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
          { type: "array", maxItems: 10_000, items: {} },
          { type: "object", additionalProperties: false, patternProperties: { ".*": {} } },
        ],
      };
    case "array": {
      const entries = safeFieldEntries(field.fields);
      return {
        type: nullable ? ["array", ...nullable] : "array",
        maxItems: field.maxRows ?? 1_000,
        items: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            entries.map((entry) => [entry.name, fieldSchema(entry, blockSchemas)]),
          ),
          required: entries
            .filter((entry) => entry.required === true)
            .map((entry) => entry.name)
            .sort(),
        },
      };
    }
    case "group": {
      const entries = safeFieldEntries(field.fields);
      return {
        type: nullable ? ["object", ...nullable] : "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          entries.map((entry) => [entry.name, fieldSchema(entry, blockSchemas)]),
        ),
        required: entries
          .filter((entry) => entry.required === true)
          .map((entry) => entry.name)
          .sort(),
      };
    }
  }
}

function collectionSchema(
  config: NpCollectionConfig,
  blockSchemas: ReadonlyMap<string, NpAgentJsonSchema>,
): NpAgentJsonSchema {
  const fields = safeFieldEntries(config.fields).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return jsonSchema(
    {
      id: { type: "string", maxLength: 128 },
      status: { type: "string", maxLength: 9, enum: ["archived", "draft", "published"] },
      slug: { type: ["string", "null"], maxLength: 512 },
      locale: { type: ["string", "null"], maxLength: 64 },
      updatedAt: { type: "string", maxLength: 32, format: "date-time" },
      data: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          fields.map((field) => [field.name, fieldSchema(field, blockSchemas)]),
        ),
        required: [],
      },
    },
    ["id", "status", "slug", "locale", "updatedAt", "data"],
  );
}

function catalogSchema(
  collections: readonly string[],
  blocks: readonly string[],
): NpAgentJsonSchema {
  return jsonSchema(
    {
      collections: {
        type: "array",
        maxItems: 1_000,
        items: { type: "string", maxLength: 128, enum: [...collections] },
      },
      blocks: {
        type: "array",
        maxItems: MAX_BLOCK_SCHEMAS,
        items: { type: "string", maxLength: 128, enum: [...blocks] },
      },
    },
    ["collections", "blocks"],
  );
}

function blocksSchema(
  blocks: readonly { type: string; schema: NpAgentJsonSchema }[],
  blockType?: string,
): NpAgentJsonSchema {
  if (blockType !== undefined) {
    const selected = blocks.find((entry) => entry.type === blockType);
    if (!selected) throw new NpNotFoundError("agent-block-schema", blockType);
    return selected.schema;
  }
  return npRequireAgentJsonSchema({
    $schema: META,
    type: "object",
    additionalProperties: false,
    ...(blocks.length === 0 ? { not: {} } : { oneOf: blocks.map((entry) => entry.schema) }),
  });
}

function schemaFor(
  input: NpAgentSchemaGetInputV1,
  collections: readonly NpCollectionConfig[],
  blocks: readonly { type: string; schema: NpAgentJsonSchema }[],
): NpAgentJsonSchema {
  switch (input.selector) {
    case "catalog":
      return catalogSchema(
        collections.map((config) => config.slug),
        blocks.map((entry) => entry.type),
      );
    case "collection": {
      const config = collections.find((entry) => entry.slug === input.slug);
      if (!config) throw new NpNotFoundError("agent-collection-schema", input.slug);
      return collectionSchema(config, new Map(blocks.map((entry) => [entry.type, entry.schema])));
    }
    case "blocks":
      return blocksSchema(blocks);
    case "block":
      return blocksSchema(blocks, input.type);
  }
}

async function visibleSchemaCollections(
  context: NpAgentReadCapabilityContextV1,
  resolveUser: NpAgentCoreReadCapabilityOptionsV1["resolveUser"],
): Promise<NpCollectionConfig[]> {
  if (context.principal.authority.kind !== "user") {
    throw new NpForbiddenError("schema", "agent schema visibility");
  }
  const user = await resolveUser(context.principal.authority.userId);
  if (!user) throw new NpForbiddenError("schema", "agent schema visibility");
  const visible: NpCollectionConfig[] = [];
  for (const slug of getAllCollectionSlugs().sort()) {
    const config = getCollectionConfig(slug);
    if (!config.access?.read || (await config.access.read({ user }))) visible.push(config);
  }
  return visible;
}

async function exactBlockSchemas(
  siteId: string,
  resolver: NpAgentCoreReadCapabilityOptionsV1["resolveBlockSchemas"],
): Promise<Array<{ type: string; schema: NpAgentJsonSchema }>> {
  const resolved = await resolver(siteId);
  if (!Array.isArray(resolved) || resolved.length > MAX_BLOCK_SCHEMAS) {
    throw new Error(`Agent block schema inventory must contain at most ${MAX_BLOCK_SCHEMAS} rows.`);
  }
  const entries = resolved
    .map((entry) => {
      if (!BLOCK_TYPE_PATTERN.test(entry.type)) {
        throw new Error("Agent block schema inventory contains an invalid block type.");
      }
      return { type: entry.type, schema: npRequireAgentJsonSchema(entry.schema) };
    })
    .sort((left, right) => left.type.localeCompare(right.type));
  if (entries.some((entry, index) => entry.type === entries[index - 1]?.type)) {
    throw new Error("Agent block schema inventory contains a duplicate block type.");
  }
  return entries;
}

function tableColumn(table: PgTable, field: string): AnyPgColumn {
  const column = (table as unknown as Record<string, unknown>)[field];
  if (!column)
    throw new NpValidationError("Invalid Agent content query", [
      { field, message: "Field is not queryable." },
    ]);
  return column as AnyPgColumn;
}

type QueryableFieldKind = "string" | "number" | "boolean" | "date";

function queryableFields(
  config: NpCollectionConfig,
  table: PgTable,
): Map<string, QueryableFieldKind> {
  const candidates = new Map<string, QueryableFieldKind>([
    ["id", "string"],
    ["locale", "string"],
    ["slug", "string"],
    ["status", "string"],
    ["updatedAt", "date"],
  ]);
  for (const field of safeFieldEntries(config.fields)) {
    if (field.type === "number") candidates.set(field.name, "number");
    else if (field.type === "checkbox") candidates.set(field.name, "boolean");
    else if (field.type === "date") candidates.set(field.name, "date");
    else if (
      field.type === "text" ||
      field.type === "textarea" ||
      field.type === "email" ||
      field.type === "select" ||
      field.type === "radio" ||
      field.type === "upload" ||
      (field.type === "relationship" && !field.hasMany)
    )
      candidates.set(field.name, "string");
  }
  return new Map(
    [...candidates].filter(
      ([field]) => (table as unknown as Record<string, unknown>)[field] !== undefined,
    ),
  );
}

function compileFilter(
  filter: NpAgentContentFilterV1,
  table: PgTable,
  allowed: ReadonlyMap<string, QueryableFieldKind>,
): SQL {
  if ("terms" in filter) {
    const terms = filter.terms.map((term) => compileFilter(term, table, allowed));
    const combined = filter.op === "all" ? and(...terms) : or(...terms);
    if (!combined) throw new Error("Validated content filters must contain one term.");
    return combined;
  }
  const kind = allowed.get(filter.field);
  if (!kind) {
    throw new NpValidationError("Invalid Agent content query", [
      { field: filter.field, message: "Field is not queryable." },
    ]);
  }
  const column = tableColumn(table, filter.field);
  if (filter.op === "exists") return filter.value ? isNotNull(column) : isNull(column);
  if (filter.op === "in") {
    if (
      filter.values.some(
        (value) =>
          value !== null &&
          ((kind === "number" && typeof value !== "number") ||
            (kind === "boolean" && typeof value !== "boolean") ||
            ((kind === "string" || kind === "date") && typeof value !== "string")),
      )
    ) {
      throw new NpValidationError("Invalid Agent content query", [
        { field: filter.field, message: "Filter value does not match the field type." },
      ]);
    }
    const includesNull = filter.values.includes(null);
    const values = filter.values.filter((value) => value !== null);
    if (values.length === 0) return isNull(column);
    const included = inArray(column, values);
    return includesNull ? (or(isNull(column), included) as SQL) : included;
  }
  if (filter.value === null) {
    if (filter.op === "eq") return isNull(column);
    if (filter.op === "neq") return isNotNull(column);
    throw new NpValidationError("Invalid Agent content query", [
      { field: filter.field, message: "Range comparisons cannot use null." },
    ]);
  }
  if (
    (kind === "number" && typeof filter.value !== "number") ||
    (kind === "boolean" && typeof filter.value !== "boolean") ||
    ((kind === "string" || kind === "date") && typeof filter.value !== "string") ||
    (kind === "boolean" && !["eq", "neq"].includes(filter.op))
  ) {
    throw new NpValidationError("Invalid Agent content query", [
      { field: filter.field, message: "Filter operator or value does not match the field type." },
    ]);
  }
  switch (filter.op) {
    case "eq":
      return eq(column, filter.value);
    case "neq":
      return ne(column, filter.value);
    case "gt":
      return gt(column, filter.value);
    case "gte":
      return gte(column, filter.value);
    case "lt":
      return lt(column, filter.value);
    case "lte":
      return lte(column, filter.value);
  }
}

function encodeCursor(body: CursorBody, key: Uint8Array): string {
  const encoded = Buffer.from(serializeAgentCanonicalJson(body), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encoded, "ascii").digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeCursor(
  value: string,
  expected: Omit<CursorBody, "offset" | "expiresAt">,
  key: Uint8Array,
  now: Date,
): number {
  if (!CURSOR_PATTERN.test(value))
    throw new NpValidationError("Invalid Agent content cursor", [
      { field: "cursor", message: "Cursor is invalid." },
    ]);
  const [encoded = "", signature = ""] = value.split(".");
  const actual = Buffer.from(signature, "base64url");
  const wanted = createHmac("sha256", key).update(encoded, "ascii").digest();
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new NpValidationError("Invalid Agent content cursor", [
      { field: "cursor", message: "Cursor is invalid." },
    ]);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new NpValidationError("Invalid Agent content cursor", [
      { field: "cursor", message: "Cursor is invalid." },
    ]);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !==
      "expiresAt,keyId,offset,principalId,queryDigest,schemaVersion,siteId" ||
    (body as CursorBody).schemaVersion !== expected.schemaVersion ||
    (body as CursorBody).keyId !== expected.keyId ||
    (body as CursorBody).siteId !== expected.siteId ||
    (body as CursorBody).principalId !== expected.principalId ||
    (body as CursorBody).queryDigest !== expected.queryDigest ||
    !Number.isSafeInteger((body as CursorBody).offset) ||
    (body as CursorBody).offset < 0 ||
    typeof (body as CursorBody).expiresAt !== "string" ||
    Date.parse((body as CursorBody).expiresAt) <= now.getTime()
  ) {
    throw new NpValidationError("Invalid Agent content cursor", [
      { field: "cursor", message: "Cursor is invalid or expired." },
    ]);
  }
  return (body as CursorBody).offset;
}

interface JsonProjectionState {
  seen: WeakSet<object>;
  nodes: number;
}

function toJson(
  value: unknown,
  path: string,
  state: JsonProjectionState = { seen: new WeakSet<object>(), nodes: 0 },
  depth = 0,
): NpAgentJsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_PROJECTED_NODES || depth > MAX_PROJECTED_DEPTH) {
    throw new Error(`Content field ${path} exceeds the bounded JSON projection shape.`);
  }
  if (typeof value === "string") {
    if (value.length > MAX_PROJECTED_STRING_CHARACTERS) {
      throw new Error(`Content field ${path} exceeds the bounded string size.`);
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (Array.isArray(value)) {
    if (value.length > MAX_PROJECTED_ARRAY_ITEMS || state.seen.has(value)) {
      throw new Error(`Content field ${path} exceeds the bounded array shape.`);
    }
    state.seen.add(value);
    const projected: NpAgentJsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(`Content field ${path} contains a sparse or computed array value.`);
      }
      projected.push(toJson(descriptor.value, `${path}[${index.toString()}]`, state, depth + 1));
    }
    return projected;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    if (state.seen.has(value)) {
      throw new Error(`Content field ${path} contains a repeated or cyclic object.`);
    }
    state.seen.add(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new Error(`Content field ${path} contains symbol properties.`);
    }
    const projected: Record<string, NpAgentJsonValue> = {};
    const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (descriptors.length > MAX_PROJECTED_OBJECT_PROPERTIES) {
      throw new Error(`Content field ${path} exceeds the bounded object shape.`);
    }
    for (const [key, descriptor] of descriptors) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        throw new Error(`Content field ${path}.${key} is computed and cannot be projected.`);
      }
      if (descriptor.value !== undefined) {
        projected[key] = toJson(descriptor.value, `${path}.${key}`, state, depth + 1);
      }
    }
    return projected;
  }
  throw new Error(`Content field ${path} cannot be projected as bounded JSON.`);
}

function dateIso(value: unknown): string | null {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function contentStatus(value: unknown): "draft" | "published" | "archived" {
  if (value !== "draft" && value !== "published" && value !== "archived") {
    throw new Error("Content query returned an unsupported lifecycle state.");
  }
  return value;
}

async function resolveReadUser(
  input: NpAgentContentQueryInputV1,
  context: NpAgentReadCapabilityContextV1,
  resolver: NpAgentCoreReadCapabilityOptionsV1["resolveUser"],
): Promise<NpAuthUser | undefined> {
  if (input.audience === "public" && input.status === "published") return undefined;
  if (context.principal.authority.kind !== "user") {
    throw new NpForbiddenError(input.collection, "agent content audience");
  }
  const user = await resolver(context.principal.authority.userId);
  if (!user) throw new NpForbiddenError(input.collection, "agent content audience");
  return user;
}

async function queryContent(
  input: NpAgentContentQueryInputV1,
  context: NpAgentReadCapabilityContextV1,
  options: NpAgentCoreReadCapabilityOptionsV1,
): Promise<NpAgentContentQueryOutputV1> {
  const config = getCollectionConfig(input.collection);
  const table = getCollectionTable(input.collection) as PgTable;
  const db = getDb();
  const user = await resolveReadUser(input, context, options.resolveUser);
  if (config.access?.read && !(await config.access.read({ user: user ?? null }))) {
    throw new NpForbiddenError(input.collection, "read");
  }
  const projectionFields = new Set(safeFieldEntries(config.fields).map((field) => field.name));
  for (const field of input.fields) {
    if (!projectionFields.has(field)) {
      throw new NpValidationError("Invalid Agent content query", [
        { field, message: "Field is not readable." },
      ]);
    }
  }
  const queryable = queryableFields(config, table);
  for (const sort of input.sort) {
    if (!queryable.has(sort.field)) {
      throw new NpValidationError("Invalid Agent content query", [
        { field: sort.field, message: "Sort field is not queryable." },
      ]);
    }
  }
  const queryBody = { ...input, cursor: null } as NpAgentJsonObject;
  const queryDigest = digest("np.agent-content-query-cursor.v1", queryBody);
  const cursorBase = {
    schemaVersion: "np.agent-content-cursor.v1" as const,
    keyId: options.cursorHmacKey.id,
    siteId: context.siteId,
    principalId: context.principal.principalId,
    queryDigest,
  };
  const now = new Date(context.requestedAt);
  const offset =
    input.cursor === null
      ? 0
      : decodeCursor(input.cursor, cursorBase, options.cursorHmacKey.key, now);
  const statuses: Array<"archived" | "draft" | "published"> =
    input.status === "any" ? ["archived", "draft", "published"] : [input.status];
  const visibility =
    input.audience === "public" ? "public" : input.audience === "private" ? "private" : null;
  const conditions: SQL[] = [
    eq(tableColumn(table, "siteId"), context.siteId),
    inArray(tableColumn(table, "status"), statuses),
  ];
  if (visibility) conditions.push(eq(tableColumn(table, "visibility"), visibility));
  if (input.filter) conditions.push(compileFilter(input.filter, table, queryable));
  const where = and(...conditions);
  if (!where) throw new Error("Agent content query lost its site boundary.");
  const order = [
    ...input.sort.map((entry) =>
      entry.direction === "desc"
        ? desc(tableColumn(table, entry.field))
        : asc(tableColumn(table, entry.field)),
    ),
    asc(tableColumn(table, "id")),
  ];
  const rows = (await db
    .select({ id: tableColumn(table, "id") })
    .from(table)
    .where(where)
    .orderBy(...order)
    .limit(input.limit + 1)
    .offset(offset)) as Array<{ id: string }>;
  const selected = rows.slice(0, input.limit);
  const ids = selected.map((row) => row.id);
  let docs: ContentRow[] = [];
  if (ids.length > 0) {
    const hydrated = await findDocuments<ContentRow>(
      input.collection,
      {
        limit: ids.length,
        where: {
          id: ids,
          siteId: context.siteId,
          status: statuses,
          ...(visibility === null ? {} : { visibility }),
        },
      },
      user,
    );
    const byId = new Map(hydrated.docs.map((doc) => [doc.id, doc]));
    docs = ids.flatMap((id) => {
      const doc = byId.get(id);
      return doc ? [doc] : [];
    });
  }
  const items = docs.map((doc) => {
    const data = Object.fromEntries(
      input.fields.flatMap((field) => {
        const descriptor = Object.getOwnPropertyDescriptor(doc, field);
        if (!descriptor) return [];
        if (!("value" in descriptor)) {
          throw new Error(`Content field content.${field} is computed and cannot be projected.`);
        }
        return descriptor.value === undefined
          ? []
          : [[field, toJson(descriptor.value, `content.${field}`)]];
      }),
    );
    const status = contentStatus(doc.status);
    const updatedAt = dateIso(doc.updatedAt) ?? "1970-01-01T00:00:00.000Z";
    const body = {
      id: String(doc.id),
      slug: typeof doc.slug === "string" ? doc.slug : null,
      status,
      locale: typeof doc.locale === "string" ? doc.locale : null,
      updatedAt,
      data,
    };
    const documentDigest = digest("np.agent-content-document.v1", body);
    return { ...body, version: documentDigest, digest: documentDigest };
  });
  const nextCursor =
    rows.length > input.limit
      ? encodeCursor(
          {
            ...cursorBase,
            offset: offset + input.limit,
            expiresAt: new Date(now.getTime() + CURSOR_TTL_MS).toISOString(),
          },
          options.cursorHmacKey.key,
        )
      : null;
  const output = {
    schemaVersion: "np.agent-content-query.v1",
    collection: input.collection,
    items,
    nextCursor,
  } satisfies NpAgentContentQueryOutputV1;
  if (Buffer.byteLength(serializeAgentCanonicalJson(output), "utf8") > MAX_CONTENT_OUTPUT_BYTES) {
    throw new NpValidationError("Agent content query output exceeds the safe response limit.", [
      { field: "limit", message: "Request fewer or smaller projected fields." },
    ]);
  }
  return output;
}

export function createAgentCoreReadCapabilityExecutorsV1(
  options: NpAgentCoreReadCapabilityOptionsV1,
): NpAgentReadCapabilityExecutorsV1 {
  if (
    !CURSOR_KEY_ID_PATTERN.test(options.cursorHmacKey.id) ||
    !(options.cursorHmacKey.key instanceof Uint8Array) ||
    options.cursorHmacKey.key.byteLength < 32
  ) {
    throw new Error("Agent content cursors require a named HMAC key of at least 256 bits.");
  }
  const runtimeOptions: NpAgentCoreReadCapabilityOptionsV1 = {
    ...options,
    cursorHmacKey: {
      id: options.cursorHmacKey.id,
      key: new Uint8Array(options.cursorHmacKey.key),
    },
  };
  return {
    "site.inspect": async (_input, context) => {
      const site = await getSiteById(context.siteId);
      if (!site) throw new NpNotFoundError("site", context.siteId);
      const [collections, blockSchemas] = await Promise.all([
        visibleSchemaCollections(context, runtimeOptions.resolveUser),
        exactBlockSchemas(context.siteId, runtimeOptions.resolveBlockSchemas),
      ]);
      const collectionSlugs = collections.map((config) => config.slug);
      const blocks = blockSchemas.map((entry) => entry.type);
      const plugins = await listEnabledPluginIds(getDb(), context.siteId);
      const i18n = getI18nConfig();
      const defaultLocale = site.settings.defaultLocale ?? i18n?.defaultLocale ?? "en";
      const locales = [...new Set([...(i18n?.locales ?? []), defaultLocale])].sort();
      const settings = npRequireAgentGatewaySettings(
        await (runtimeOptions.resolveGatewaySettings?.(context.siteId) ??
          npAgentDisabledGatewaySettingsV1),
      );
      const resources = context.principal.scopes.includes("schema:read")
        ? [
            `nexpress://site/${context.siteId}/schema`,
            `nexpress://site/${context.siteId}/schema/blocks`,
            ...collectionSlugs.map(
              (slug) => `nexpress://site/${context.siteId}/schema/collections/${slug}`,
            ),
          ].sort()
        : [];
      return {
        schemaVersion: "np.agent-site-inspect.v1",
        site: { id: site.id, name: site.name, defaultLocale, locales },
        features: {
          remoteMcp: settings.mcpHttp !== "disabled",
          agentHttp: settings.agentHttp !== "disabled",
          runtime: await (runtimeOptions.runtimeState?.(context.siteId) ?? "disabled"),
        },
        counts: {
          collections: collectionSlugs.length,
          blocks: blocks.length,
          activePlugins: plugins.length,
        },
        resourceUris: resources,
      };
    },
    "schema.get": async (input, context) => {
      const [collections, blocks] = await Promise.all([
        visibleSchemaCollections(context, runtimeOptions.resolveUser),
        exactBlockSchemas(context.siteId, runtimeOptions.resolveBlockSchemas),
      ]);
      const schema = schemaFor(input, collections, blocks);
      return {
        schemaVersion: "np.agent-schema-resource.v1",
        selector: input,
        digest: digest("np.agent-schema-resource.v1", { selector: input, schema }),
        schema,
      } satisfies NpAgentSchemaGetOutputV1;
    },
    "content.query": (input, context) => queryContent(input, context, runtimeOptions),
  };
}
