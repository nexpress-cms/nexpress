import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npAnalyzeAgentJsonSchema,
  npRequireAgentCapabilityDescriptor,
  npRequireAgentContractResult,
} from "./contract.js";
import { parseCanonicalJsonObject } from "./canonical-runtime-primitives.js";
import type {
  NpAgentCapabilityDescriptor,
  NpAgentContractResult,
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentJsonValue,
} from "./types.js";

export const npAgentReadCapabilityIdsV1 = ["content.query", "schema.get", "site.inspect"] as const;
export type NpAgentReadCapabilityIdV1 = (typeof npAgentReadCapabilityIdsV1)[number];

export type NpAgentEmptyInputV1 = Record<string, never>;
export type NpAgentSchemaGetInputV1 =
  | { selector: "catalog" }
  | { selector: "collection"; slug: string }
  | { selector: "blocks" }
  | { selector: "block"; type: string };
export type NpAgentContentScalarV1 = string | number | boolean | null;
export type NpAgentContentFilterV1 =
  | {
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      field: string;
      value: NpAgentContentScalarV1;
    }
  | { op: "in"; field: string; values: NpAgentContentScalarV1[] }
  | { op: "exists"; field: string; value: boolean }
  | { op: "all" | "any"; terms: NpAgentContentFilterV1[] };

export interface NpAgentContentQueryInputV1 extends NpAgentJsonObject {
  collection: string;
  filter: NpAgentContentFilterV1 | null;
  fields: string[];
  audience: "public" | "member" | "private";
  status: "draft" | "published" | "any";
  sort: Array<{ field: string; direction: "asc" | "desc" }>;
  limit: number;
  cursor: string | null;
}

export interface NpAgentSiteInspectOutputV1 extends NpAgentJsonObject {
  schemaVersion: "np.agent-site-inspect.v1";
  site: { id: string; name: string; defaultLocale: string; locales: string[] };
  features: {
    remoteMcp: boolean;
    agentHttp: boolean;
    runtime: "disabled" | "ready" | "paused" | "degraded";
  };
  counts: { collections: number; blocks: number; activePlugins: number };
  resourceUris: string[];
}

export interface NpAgentSchemaGetOutputV1 extends NpAgentJsonObject {
  schemaVersion: "np.agent-schema-resource.v1";
  selector: NpAgentSchemaGetInputV1;
  digest: string;
  schema: NpAgentJsonSchema;
}

export interface NpAgentContentDocumentV1 extends NpAgentJsonObject {
  id: string;
  slug: string | null;
  status: "draft" | "published" | "archived";
  locale: string | null;
  version: string;
  digest: string;
  updatedAt: string;
  data: NpAgentJsonObject;
}

export interface NpAgentContentQueryOutputV1 extends NpAgentJsonObject {
  schemaVersion: "np.agent-content-query.v1";
  collection: string;
  items: NpAgentContentDocumentV1[];
  nextCursor: string | null;
}

export interface NpAgentReadCapabilityInputMapV1 {
  "site.inspect": NpAgentEmptyInputV1;
  "schema.get": NpAgentSchemaGetInputV1;
  "content.query": NpAgentContentQueryInputV1;
}
export interface NpAgentReadCapabilityOutputMapV1 {
  "site.inspect": NpAgentSiteInspectOutputV1;
  "schema.get": NpAgentSchemaGetOutputV1;
  "content.query": NpAgentContentQueryOutputV1;
}
export type NpAgentReadCapabilityInvocationRequestV1 = {
  [C in NpAgentReadCapabilityIdV1]: {
    schemaVersion: "np.agent-invocation-request.v1";
    capabilityId: C;
    arguments: { input: NpAgentReadCapabilityInputMapV1[C]; idempotencyKey: null };
  };
}[NpAgentReadCapabilityIdV1];

const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,127}$/u;
const RESOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const BLOCK_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const MAX_FILTER_DEPTH = 8;
const MAX_FILTER_TERMS = 32;
const MAX_FIELDS = 64;
const MAX_SORTS = 8;
const MAX_IN_VALUES = 100;
const MAX_ITEMS = 100;
const MAX_RESOURCES = 1_000;
const MAX_CURSOR_BYTES = 2_048;
const MAX_SCALAR_CHARS = 262_144;
const MAX_CONTENT_INPUT_BYTES = 1_024 * 1_024;

function pattern(value: unknown, path: string, expected: RegExp, label: string): string {
  if (typeof value !== "string" || !expected.test(value)) {
    failCanonicalBody("invalid-field", path, `must be a canonical ${label}`);
  }
  return value;
}

function boundedText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be a non-empty string of at most ${maximum} characters`,
    );
  }
  return value;
}

function scalar(value: unknown, path: string): NpAgentContentScalarV1 {
  if (typeof value === "string") {
    if (value.length > MAX_SCALAR_CHARS) {
      failCanonicalBody("limit", path, `must be at most ${MAX_SCALAR_CHARS} characters`);
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
  failCanonicalBody("invalid-field", path, "must be a finite JSON scalar");
}

function sortedStrings(
  value: unknown,
  path: string,
  maximum: number,
  expected: RegExp,
  state: CanonicalBodyInspectionState,
): string[] {
  const values = canonicalBodyArray(value, path, maximum, state).map((entry, index) =>
    pattern(entry, `${path}[${index.toString()}]`, expected, "identifier"),
  );
  values.forEach((entry, index) => {
    const previous = values[index - 1];
    if (previous !== undefined && entry <= previous) {
      failCanonicalBody(
        entry === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique",
      );
    }
  });
  return values;
}

function filter(
  value: unknown,
  path: string,
  depth: number,
  state: CanonicalBodyInspectionState,
): NpAgentContentFilterV1 {
  if (depth > MAX_FILTER_DEPTH) failCanonicalBody("limit", path, "filter is too deep");
  const opValue =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.getOwnPropertyDescriptor(value, "op")?.value
      : undefined;
  const op = canonicalBodyEnum<NpAgentContentFilterV1["op"]>(
    opValue,
    `${path}.op`,
    new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "exists", "all", "any"]),
  );
  if (op === "all" || op === "any") {
    const record = canonicalBodyRecord(value, path, ["op", "terms"], ["op", "terms"], state);
    const terms = canonicalBodyArray(record.terms, `${path}.terms`, MAX_FILTER_TERMS, state);
    if (terms.length === 0)
      failCanonicalBody("invalid-field", `${path}.terms`, "must not be empty");
    return {
      op,
      terms: terms.map((term, index) =>
        filter(term, `${path}.terms[${index.toString()}]`, depth + 1, state),
      ),
    };
  }
  if (op === "in") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["op", "field", "values"],
      ["op", "field", "values"],
      state,
    );
    const values = canonicalBodyArray(record.values, `${path}.values`, MAX_IN_VALUES, state);
    if (values.length === 0)
      failCanonicalBody("invalid-field", `${path}.values`, "must not be empty");
    return {
      op,
      field: pattern(record.field, `${path}.field`, FIELD_PATTERN, "field name"),
      values: values.map((entry, index) => scalar(entry, `${path}.values[${index.toString()}]`)),
    };
  }
  const record = canonicalBodyRecord(
    value,
    path,
    ["op", "field", "value"],
    ["op", "field", "value"],
    state,
  );
  const field = pattern(record.field, `${path}.field`, FIELD_PATTERN, "field name");
  if (op === "exists") {
    if (typeof record.value !== "boolean") {
      failCanonicalBody("invalid-field", `${path}.value`, "must be boolean");
    }
    return { op, field, value: record.value };
  }
  return { op, field, value: scalar(record.value, `${path}.value`) };
}

function emptyInput(value: unknown): NpAgentEmptyInputV1 {
  canonicalBodyRecord(value, "agent.read.siteInspect", [], [], { seen: new WeakSet<object>() });
  return {};
}

function schemaInput(value: unknown): NpAgentSchemaGetInputV1 {
  const path = "agent.read.schemaGet";
  const selector =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.getOwnPropertyDescriptor(value, "selector")?.value
      : undefined;
  if (selector === "collection") {
    const record = canonicalBodyRecord(value, path, ["selector", "slug"], ["selector", "slug"], {
      seen: new WeakSet<object>(),
    });
    return {
      selector,
      slug: pattern(record.slug, `${path}.slug`, RESOURCE_PATTERN, "collection slug"),
    };
  }
  if (selector === "block") {
    const record = canonicalBodyRecord(value, path, ["selector", "type"], ["selector", "type"], {
      seen: new WeakSet<object>(),
    });
    return { selector, type: pattern(record.type, `${path}.type`, BLOCK_PATTERN, "block type") };
  }
  const record = canonicalBodyRecord(value, path, ["selector"], ["selector"], {
    seen: new WeakSet<object>(),
  });
  return {
    selector: canonicalBodyEnum<"catalog" | "blocks">(
      record.selector,
      `${path}.selector`,
      new Set(["catalog", "blocks"]),
    ),
  };
}

function contentInput(value: unknown): NpAgentContentQueryInputV1 {
  const path = "agent.read.contentQuery";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    ["collection", "filter", "fields", "audience", "status", "sort", "limit", "cursor"],
    ["collection", "filter", "fields", "audience", "status", "sort", "limit", "cursor"],
    state,
  );
  const sort = canonicalBodyArray(record.sort, `${path}.sort`, MAX_SORTS, state).map(
    (entry, index) => {
      const itemPath = `${path}.sort[${index.toString()}]`;
      const item = canonicalBodyRecord(
        entry,
        itemPath,
        ["field", "direction"],
        ["field", "direction"],
        state,
      );
      return {
        field: pattern(item.field, `${itemPath}.field`, FIELD_PATTERN, "field name"),
        direction: canonicalBodyEnum<"asc" | "desc">(
          item.direction,
          `${itemPath}.direction`,
          new Set(["asc", "desc"]),
        ),
      };
    },
  );
  if (new Set(sort.map((entry) => entry.field)).size !== sort.length) {
    failCanonicalBody("duplicate", `${path}.sort`, "fields must be unique");
  }
  const parsed: NpAgentContentQueryInputV1 = {
    collection: pattern(
      record.collection,
      `${path}.collection`,
      RESOURCE_PATTERN,
      "collection slug",
    ),
    filter: record.filter === null ? null : filter(record.filter, `${path}.filter`, 1, state),
    fields: sortedStrings(record.fields, `${path}.fields`, MAX_FIELDS, FIELD_PATTERN, state),
    audience: canonicalBodyEnum<"public" | "member" | "private">(
      record.audience,
      `${path}.audience`,
      new Set(["public", "member", "private"]),
    ),
    status: canonicalBodyEnum<"draft" | "published" | "any">(
      record.status,
      `${path}.status`,
      new Set(["draft", "published", "any"]),
    ),
    sort,
    limit: canonicalBodyInteger(record.limit, `${path}.limit`, 1, MAX_ITEMS),
    cursor:
      record.cursor === null
        ? null
        : canonicalBodyAscii(record.cursor, `${path}.cursor`, MAX_CURSOR_BYTES),
  };
  if (
    new TextEncoder().encode(serializeAgentCanonicalJson(parsed)).byteLength >
    MAX_CONTENT_INPUT_BYTES
  ) {
    failCanonicalBody("limit", path, `must be at most ${MAX_CONTENT_INPUT_BYTES} canonical bytes`);
  }
  return parsed;
}

function siteOutput(value: unknown): NpAgentSiteInspectOutputV1 {
  const path = "agent.read.siteInspectOutput";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const root = canonicalBodyRecord(
    value,
    path,
    ["schemaVersion", "site", "features", "counts", "resourceUris"],
    ["schemaVersion", "site", "features", "counts", "resourceUris"],
    state,
  );
  if (root.schemaVersion !== "np.agent-site-inspect.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-site-inspect.v1");
  }
  const site = canonicalBodyRecord(
    root.site,
    `${path}.site`,
    ["id", "name", "defaultLocale", "locales"],
    ["id", "name", "defaultLocale", "locales"],
    state,
  );
  const features = canonicalBodyRecord(
    root.features,
    `${path}.features`,
    ["remoteMcp", "agentHttp", "runtime"],
    ["remoteMcp", "agentHttp", "runtime"],
    state,
  );
  const counts = canonicalBodyRecord(
    root.counts,
    `${path}.counts`,
    ["collections", "blocks", "activePlugins"],
    ["collections", "blocks", "activePlugins"],
    state,
  );
  const locales = sortedStrings(site.locales, `${path}.site.locales`, 64, LOCALE_PATTERN, state);
  if (typeof site.defaultLocale !== "string" || !locales.includes(site.defaultLocale)) {
    failCanonicalBody("invalid-field", `${path}.site.defaultLocale`, "must be one of locales");
  }
  if (typeof features.remoteMcp !== "boolean" || typeof features.agentHttp !== "boolean") {
    failCanonicalBody("invalid-field", `${path}.features`, "feature flags must be boolean");
  }
  const resourceUris = canonicalBodyArray(
    root.resourceUris,
    `${path}.resourceUris`,
    MAX_RESOURCES,
    state,
  ).map((uri, index) =>
    canonicalBodyAscii(uri, `${path}.resourceUris[${index.toString()}]`, 2_048),
  );
  resourceUris.forEach((uri, index) => {
    const previous = resourceUris[index - 1];
    if (previous !== undefined && uri <= previous) {
      failCanonicalBody(
        uri === previous ? "duplicate" : "order",
        `${path}.resourceUris[${index.toString()}]`,
        "must be sorted unique",
      );
    }
  });
  return {
    schemaVersion: "np.agent-site-inspect.v1",
    site: {
      id: pattern(site.id, `${path}.site.id`, RESOURCE_PATTERN, "site id"),
      name: boundedText(site.name, `${path}.site.name`, 120),
      defaultLocale: site.defaultLocale,
      locales,
    },
    features: {
      remoteMcp: features.remoteMcp,
      agentHttp: features.agentHttp,
      runtime: canonicalBodyEnum<NpAgentSiteInspectOutputV1["features"]["runtime"]>(
        features.runtime,
        `${path}.features.runtime`,
        new Set(["disabled", "ready", "paused", "degraded"]),
      ),
    },
    counts: {
      collections: canonicalBodyInteger(
        counts.collections,
        `${path}.counts.collections`,
        0,
        10_000,
      ),
      blocks: canonicalBodyInteger(counts.blocks, `${path}.counts.blocks`, 0, 10_000),
      activePlugins: canonicalBodyInteger(
        counts.activePlugins,
        `${path}.counts.activePlugins`,
        0,
        10_000,
      ),
    },
    resourceUris,
  };
}

function schemaOutput(value: unknown): NpAgentSchemaGetOutputV1 {
  const path = "agent.read.schemaGetOutput";
  const record = canonicalBodyRecord(
    value,
    path,
    ["schemaVersion", "selector", "digest", "schema"],
    ["schemaVersion", "selector", "digest", "schema"],
    { seen: new WeakSet<object>() },
  );
  if (record.schemaVersion !== "np.agent-schema-resource.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-schema-resource.v1",
    );
  }
  return {
    schemaVersion: "np.agent-schema-resource.v1",
    selector: schemaInput(record.selector),
    digest: canonicalBodySha256Digest(record.digest, `${path}.digest`),
    schema: npRequireAgentContractResult(
      npAnalyzeAgentJsonSchema(record.schema),
      "Invalid schema resource",
    ),
  };
}

function contentDocument(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentContentDocumentV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    ["id", "slug", "status", "locale", "version", "digest", "updatedAt", "data"],
    ["id", "slug", "status", "locale", "version", "digest", "updatedAt", "data"],
    state,
  );
  return {
    id: boundedText(record.id, `${path}.id`, 128),
    slug: record.slug === null ? null : boundedText(record.slug, `${path}.slug`, 512),
    status: canonicalBodyEnum<NpAgentContentDocumentV1["status"]>(
      record.status,
      `${path}.status`,
      new Set(["draft", "published", "archived"]),
    ),
    locale:
      record.locale === null
        ? null
        : pattern(record.locale, `${path}.locale`, LOCALE_PATTERN, "locale"),
    version: boundedText(record.version, `${path}.version`, 128),
    digest: canonicalBodySha256Digest(record.digest, `${path}.digest`),
    updatedAt: canonicalBodyUtc(record.updatedAt, `${path}.updatedAt`),
    data: parseCanonicalJsonObject(
      JSON.parse(serializeAgentCanonicalJson(record.data)) as unknown,
      `${path}.data`,
    ),
  };
}

function contentOutput(value: unknown): NpAgentContentQueryOutputV1 {
  const path = "agent.read.contentQueryOutput";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    ["schemaVersion", "collection", "items", "nextCursor"],
    ["schemaVersion", "collection", "items", "nextCursor"],
    state,
  );
  if (record.schemaVersion !== "np.agent-content-query.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-content-query.v1",
    );
  }
  return {
    schemaVersion: "np.agent-content-query.v1",
    collection: pattern(
      record.collection,
      `${path}.collection`,
      RESOURCE_PATTERN,
      "collection slug",
    ),
    items: canonicalBodyArray(record.items, `${path}.items`, MAX_ITEMS, state).map((item, index) =>
      contentDocument(item, `${path}.items[${index.toString()}]`, state),
    ),
    nextCursor:
      record.nextCursor === null
        ? null
        : canonicalBodyAscii(record.nextCursor, `${path}.nextCursor`, MAX_CURSOR_BYTES),
  };
}

export const npAnalyzeAgentEmptyInputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.read.siteInspect", () => emptyInput(value));
export const npAnalyzeAgentSchemaGetInputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.read.schemaGet", () => schemaInput(value));
export const npAnalyzeAgentContentQueryInputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.read.contentQuery", () => contentInput(value));
export const npAnalyzeAgentSiteInspectOutputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.read.siteInspectOutput", () => siteOutput(value));
export const npAnalyzeAgentSchemaGetOutputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.read.schemaGetOutput", () => schemaOutput(value));
export const npAnalyzeAgentContentQueryOutputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.read.contentQueryOutput", () => contentOutput(value));

export function npRequireAgentSiteInspectOutputV1(value: unknown): NpAgentSiteInspectOutputV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentSiteInspectOutputV1(value),
    "Invalid Agent site inspection output",
  );
}

export function npRequireAgentSchemaGetOutputV1(value: unknown): NpAgentSchemaGetOutputV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentSchemaGetOutputV1(value),
    "Invalid Agent schema resource output",
  );
}

export function npRequireAgentContentQueryOutputV1(value: unknown): NpAgentContentQueryOutputV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentContentQueryOutputV1(value),
    "Invalid Agent content query output",
  );
}

export function npRequireAgentReadCapabilityInputV1<C extends NpAgentReadCapabilityIdV1>(
  capabilityId: C,
  value: unknown,
): NpAgentReadCapabilityInputMapV1[C] {
  const result =
    capabilityId === "site.inspect"
      ? npAnalyzeAgentEmptyInputV1(value)
      : capabilityId === "schema.get"
        ? npAnalyzeAgentSchemaGetInputV1(value)
        : npAnalyzeAgentContentQueryInputV1(value);
  return npRequireAgentContractResult(
    result as NpAgentContractResult<NpAgentReadCapabilityInputMapV1[C]>,
    "Invalid Agent read capability input",
  );
}

export function npRequireAgentReadCapabilityOutputV1<C extends NpAgentReadCapabilityIdV1>(
  capabilityId: C,
  value: unknown,
): NpAgentReadCapabilityOutputMapV1[C] {
  const result =
    capabilityId === "site.inspect"
      ? npAnalyzeAgentSiteInspectOutputV1(value)
      : capabilityId === "schema.get"
        ? npAnalyzeAgentSchemaGetOutputV1(value)
        : npAnalyzeAgentContentQueryOutputV1(value);
  return npRequireAgentContractResult(
    result as NpAgentContractResult<NpAgentReadCapabilityOutputMapV1[C]>,
    "Invalid Agent read capability output",
  );
}

export function npAnalyzeAgentReadCapabilityInvocationRequestV1(
  value: unknown,
): NpAgentContractResult<NpAgentReadCapabilityInvocationRequestV1> {
  return analyzeCanonicalBody("agent.read.invocation", () => {
    const path = "agent.read.invocation";
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    const record = canonicalBodyRecord(
      value,
      path,
      ["schemaVersion", "capabilityId", "arguments"],
      ["schemaVersion", "capabilityId", "arguments"],
      state,
    );
    if (record.schemaVersion !== "np.agent-invocation-request.v1") {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be np.agent-invocation-request.v1",
      );
    }
    const capabilityId = canonicalBodyEnum<NpAgentReadCapabilityIdV1>(
      record.capabilityId,
      `${path}.capabilityId`,
      new Set(npAgentReadCapabilityIdsV1),
    );
    const args = canonicalBodyRecord(
      record.arguments,
      `${path}.arguments`,
      ["input", "idempotencyKey"],
      ["input", "idempotencyKey"],
      state,
    );
    if (args.idempotencyKey !== null) {
      failCanonicalBody(
        "invalid-field",
        `${path}.arguments.idempotencyKey`,
        "must be null for direct reads",
      );
    }
    return {
      schemaVersion: "np.agent-invocation-request.v1",
      capabilityId,
      arguments: {
        input: npRequireAgentReadCapabilityInputV1(capabilityId, args.input),
        idempotencyKey: null,
      },
    } as NpAgentReadCapabilityInvocationRequestV1;
  });
}

export function npRequireAgentReadCapabilityInvocationRequestV1(
  value: unknown,
): NpAgentReadCapabilityInvocationRequestV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentReadCapabilityInvocationRequestV1(value),
    "Invalid Agent read capability invocation",
  );
}

const META = "https://json-schema.org/draft/2020-12/schema" as const;
const objectSchema = (
  properties: Record<string, NpAgentJsonValue>,
  required: string[],
): NpAgentJsonSchema => ({
  $schema: META,
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const EMPTY_SCHEMA = objectSchema({}, []);
const exactObjectNode = (
  properties: Record<string, NpAgentJsonValue>,
  required: string[],
): NpAgentJsonValue => ({ type: "object", additionalProperties: false, properties, required });
const nullableStringNode = (maximum: number): NpAgentJsonValue => ({
  oneOf: [{ type: "string", maxLength: maximum }, { type: "null" }],
});
const selectorNode = (): NpAgentJsonValue => ({
  oneOf: [
    exactObjectNode({ selector: { const: "catalog" } }, ["selector"]),
    exactObjectNode(
      {
        selector: { const: "collection" },
        slug: { type: "string", maxLength: 128, pattern: RESOURCE_PATTERN.source },
      },
      ["selector", "slug"],
    ),
    exactObjectNode({ selector: { const: "blocks" } }, ["selector"]),
    exactObjectNode(
      {
        selector: { const: "block" },
        type: { type: "string", maxLength: 128, pattern: BLOCK_PATTERN.source },
      },
      ["selector", "type"],
    ),
  ],
});
const SCHEMA_INPUT_SELECTOR_NODE = selectorNode();
const SCHEMA_INPUT: NpAgentJsonSchema = {
  ...objectSchema(
    {
      selector: {
        type: "string",
        enum: ["catalog", "collection", "blocks", "block"],
        maxLength: 10,
      },
      slug: { type: "string", maxLength: 128, pattern: RESOURCE_PATTERN.source },
      type: { type: "string", maxLength: 128, pattern: BLOCK_PATTERN.source },
    },
    ["selector"],
  ),
  oneOf: (SCHEMA_INPUT_SELECTOR_NODE as NpAgentJsonObject).oneOf,
};
const scalarNode = (): NpAgentJsonValue => ({
  oneOf: [
    { type: "string", maxLength: MAX_SCALAR_CHARS },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
});
const FIELD_VALUE_FILTERS: NpAgentJsonValue[] = ["eq", "neq", "gt", "gte", "lt", "lte"].map((op) =>
  exactObjectNode(
    {
      op: { const: op },
      field: { type: "string", maxLength: 128, pattern: FIELD_PATTERN.source },
      value: scalarNode(),
    },
    ["op", "field", "value"],
  ),
);
const FILTER_NODE: NpAgentJsonValue = {
  oneOf: [
    ...FIELD_VALUE_FILTERS,
    exactObjectNode(
      {
        op: { const: "in" },
        field: { type: "string", maxLength: 128, pattern: FIELD_PATTERN.source },
        values: {
          type: "array",
          minItems: 1,
          maxItems: MAX_IN_VALUES,
          items: scalarNode(),
        },
      },
      ["op", "field", "values"],
    ),
    exactObjectNode(
      {
        op: { const: "exists" },
        field: { type: "string", maxLength: 128, pattern: FIELD_PATTERN.source },
        value: { type: "boolean" },
      },
      ["op", "field", "value"],
    ),
    ...["all", "any"].map((op) =>
      exactObjectNode(
        {
          op: { const: op },
          terms: {
            type: "array",
            minItems: 1,
            maxItems: MAX_FILTER_TERMS,
            items: { $ref: "#/$defs/filter" },
          },
        },
        ["op", "terms"],
      ),
    ),
  ],
};
const CONTENT_INPUT: NpAgentJsonSchema = {
  ...objectSchema(
    {
      collection: { type: "string", maxLength: 128, pattern: RESOURCE_PATTERN.source },
      filter: { oneOf: [{ $ref: "#/$defs/filter" }, { type: "null" }] },
      fields: {
        type: "array",
        uniqueItems: true,
        maxItems: MAX_FIELDS,
        items: { type: "string", maxLength: 128, pattern: FIELD_PATTERN.source },
      },
      audience: { type: "string", enum: ["public", "member", "private"], maxLength: 7 },
      status: { type: "string", enum: ["draft", "published", "any"], maxLength: 9 },
      sort: {
        type: "array",
        maxItems: MAX_SORTS,
        items: exactObjectNode(
          {
            field: { type: "string", maxLength: 128, pattern: FIELD_PATTERN.source },
            direction: { type: "string", maxLength: 4, enum: ["asc", "desc"] },
          },
          ["field", "direction"],
        ),
      },
      limit: { type: "integer", minimum: 1, maximum: MAX_ITEMS },
      cursor: nullableStringNode(MAX_CURSOR_BYTES),
    },
    ["collection", "filter", "fields", "audience", "status", "sort", "limit", "cursor"],
  ),
  $defs: { filter: FILTER_NODE },
};
const SITE_OUTPUT = objectSchema(
  {
    schemaVersion: { const: "np.agent-site-inspect.v1" },
    site: exactObjectNode(
      {
        id: { type: "string", maxLength: 128, pattern: RESOURCE_PATTERN.source },
        name: { type: "string", maxLength: 120 },
        defaultLocale: { type: "string", maxLength: 64, pattern: LOCALE_PATTERN.source },
        locales: {
          type: "array",
          uniqueItems: true,
          maxItems: 64,
          items: { type: "string", maxLength: 64, pattern: LOCALE_PATTERN.source },
        },
      },
      ["id", "name", "defaultLocale", "locales"],
    ),
    features: exactObjectNode(
      {
        remoteMcp: { type: "boolean" },
        agentHttp: { type: "boolean" },
        runtime: {
          type: "string",
          maxLength: 8,
          enum: ["disabled", "ready", "paused", "degraded"],
        },
      },
      ["remoteMcp", "agentHttp", "runtime"],
    ),
    counts: exactObjectNode(
      {
        collections: { type: "integer", minimum: 0, maximum: 10_000 },
        blocks: { type: "integer", minimum: 0, maximum: 10_000 },
        activePlugins: { type: "integer", minimum: 0, maximum: 10_000 },
      },
      ["collections", "blocks", "activePlugins"],
    ),
    resourceUris: {
      type: "array",
      uniqueItems: true,
      maxItems: MAX_RESOURCES,
      items: { type: "string", maxLength: 2_048 },
    },
  },
  ["schemaVersion", "site", "features", "counts", "resourceUris"],
);
const SCHEMA_OUTPUT = objectSchema(
  {
    schemaVersion: { const: "np.agent-schema-resource.v1" },
    selector: selectorNode(),
    digest: { type: "string", maxLength: 64, pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$" },
    schema: {
      type: "object",
      additionalProperties: false,
      patternProperties: { ".*": {} },
    },
  },
  ["schemaVersion", "selector", "digest", "schema"],
);
const CONTENT_OUTPUT = objectSchema(
  {
    schemaVersion: { const: "np.agent-content-query.v1" },
    collection: { type: "string", maxLength: 128, pattern: RESOURCE_PATTERN.source },
    items: {
      type: "array",
      maxItems: MAX_ITEMS,
      items: exactObjectNode(
        {
          id: { type: "string", maxLength: 128 },
          slug: nullableStringNode(512),
          status: {
            type: "string",
            maxLength: 9,
            enum: ["draft", "published", "archived"],
          },
          locale: nullableStringNode(64),
          version: { type: "string", maxLength: 128 },
          digest: {
            type: "string",
            maxLength: 64,
            pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$",
          },
          updatedAt: { type: "string", maxLength: 32, format: "date-time" },
          data: {
            type: "object",
            additionalProperties: false,
            patternProperties: { ".*": {} },
          },
        },
        ["id", "slug", "status", "locale", "version", "digest", "updatedAt", "data"],
      ),
    },
    nextCursor: nullableStringNode(MAX_CURSOR_BYTES),
  },
  ["schemaVersion", "collection", "items", "nextCursor"],
);

function descriptor(
  id: NpAgentReadCapabilityIdV1,
  title: string,
  description: string,
  scope: "site:read" | "schema:read" | "content:read",
  derivation: "none" | "schema-resource" | "content-query",
  inputSchema: NpAgentJsonSchema,
  outputSchema: NpAgentJsonSchema,
): NpAgentCapabilityDescriptor {
  return npRequireAgentCapabilityDescriptor({
    schemaVersion: "np.agent-capability.v1",
    id,
    contractVersion: 1,
    source: "core",
    title,
    description,
    requiredScopes: [scope],
    scopeDerivation: derivation,
    risk: "read",
    approval: "none",
    effectProfiles: [
      {
        id: "domain.read",
        kind: "read",
        reversibility: "none",
        minimumGatewayExposure: "read",
        verifierId: null,
        compensatorId: null,
      },
    ],
    bootstrapIntent: "plugins",
    execution: "inline",
    idempotency: "none",
    gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
    inputSchema,
    outputSchema,
  });
}

export const npAgentReadCapabilityDescriptorsV1 = Object.freeze({
  "content.query": descriptor(
    "content.query",
    "Query content",
    "Read one bounded, authorized content projection.",
    "content:read",
    "content-query",
    CONTENT_INPUT,
    CONTENT_OUTPUT,
  ),
  "schema.get": descriptor(
    "schema.get",
    "Get schema",
    "Read one bounded collection or block schema resource.",
    "schema:read",
    "schema-resource",
    SCHEMA_INPUT,
    SCHEMA_OUTPUT,
  ),
  "site.inspect": descriptor(
    "site.inspect",
    "Inspect site",
    "Read one safe site and resource-catalog summary.",
    "site:read",
    "none",
    EMPTY_SCHEMA,
    SITE_OUTPUT,
  ),
} satisfies Record<NpAgentReadCapabilityIdV1, NpAgentCapabilityDescriptor>);
