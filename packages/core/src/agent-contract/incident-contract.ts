import { npSiteIdPattern } from "../sites/id-contract.js";
import { npAuthUuidPattern } from "../auth-contract/index.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput, parseAgentSubject } from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentIncidentCategories,
  npAgentIncidentSeverities,
  type NpAgentIncidentCategory,
  type NpAgentIncidentSeverity,
  type NpAgentSubject,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentJsonValue,
} from "./types.js";

export const npAgentIncidentStates = [
  "open",
  "investigating",
  "contained",
  "monitoring",
  "resolved",
  "dismissed",
] as const;
export type NpAgentIncidentState = (typeof npAgentIncidentStates)[number];

/** Safe bounded projection; raw signal evidence and timeline details remain private. */
export interface NpAgentIncidentV1 {
  version: "np.agent-incident.v1";
  id: string;
  siteId: string;
  fingerprint: string;
  category: NpAgentIncidentCategory;
  severity: NpAgentIncidentSeverity;
  status: NpAgentIncidentState;
  title: string;
  summary: string;
  primarySubject: NpAgentSubject | null;
  assignedAgentId: string | null;
  signalIds: string[];
  eventCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  containedAt: string | null;
  resolvedAt: string | null;
  resolutionCode: string | null;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
}
export interface NpAgentIncidentGetInputV1 {
  incidentId: string;
}
export interface NpAgentIncidentListInputV1 {
  statuses: NpAgentIncidentState[];
  categories: NpAgentIncidentCategory[];
  severities: NpAgentIncidentSeverity[];
  updatedAfter: string | null;
  limit: number;
  cursor: string | null;
}
export interface NpAgentIncidentOutputV1 {
  schemaVersion: "np.agent-incident-result.v1";
  incident: NpAgentIncidentV1;
}
export interface NpAgentIncidentListOutputV1 {
  schemaVersion: "np.agent-incident-list.v1";
  items: NpAgentIncidentV1[];
  nextCursor: string | null;
}
const record = (
  value: unknown,
  path: string,
  keys: readonly string[],
  state: CanonicalBodyInspectionState,
) => canonicalBodyRecord(value, path, keys, keys, state);
const nullableUtc = (value: unknown, path: string) =>
  value === null ? null : canonicalBodyUtc(value, path);
const cursor = (value: unknown, path: string) =>
  value === null ? null : canonicalBodyAscii(value, path, 2048);
function unique<T>(items: T[], path: string): T[] {
  if (new Set(items).size !== items.length)
    failCanonicalBody("invalid-field", path, "entries must be distinct");
  return items;
}
function text(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /[\p{Cc}\p{Cs}]/u.test(value)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "must be bounded non-empty text without control characters",
    );
  return value;
}
function stableCode(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value))
    failCanonicalBody(
      "invalid-field",
      path,
      "must be an uppercase stable code of at most 64 characters",
    );
  return value;
}
function parseGet(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentIncidentGetInputV1 {
  const raw = record(value, path, ["incidentId"], state);
  return { incidentId: canonicalBodyUuid(raw.incidentId, `${path}.incidentId`) };
}
function parseList(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentIncidentListInputV1 {
  const raw = record(
    value,
    path,
    ["statuses", "categories", "severities", "updatedAfter", "limit", "cursor"],
    state,
  );
  const enums = <T extends string>(key: string, values: readonly T[]): T[] =>
    unique(
      canonicalBodyArray(raw[key], `${path}.${key}`, values.length, state).map((item, index) =>
        canonicalBodyEnum<T>(item, `${path}.${key}[${index}]`, new Set(values)),
      ),
      `${path}.${key}`,
    );
  return {
    statuses: enums("statuses", npAgentIncidentStates),
    categories: enums("categories", npAgentIncidentCategories),
    severities: enums("severities", npAgentIncidentSeverities),
    updatedAfter: nullableUtc(raw.updatedAfter, `${path}.updatedAfter`),
    limit: canonicalBodyInteger(raw.limit, `${path}.limit`, 1, 100),
    cursor: cursor(raw.cursor, `${path}.cursor`),
  };
}
function parseIncident(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentIncidentV1 {
  const raw = record(
    value,
    path,
    [
      "version",
      "id",
      "siteId",
      "fingerprint",
      "category",
      "severity",
      "status",
      "title",
      "summary",
      "primarySubject",
      "assignedAgentId",
      "signalIds",
      "eventCount",
      "firstObservedAt",
      "lastObservedAt",
      "containedAt",
      "resolvedAt",
      "resolutionCode",
      "versionNumber",
      "createdAt",
      "updatedAt",
    ],
    state,
  );
  if (raw.version !== "np.agent-incident.v1")
    failCanonicalBody("invalid-field", `${path}.version`, "invalid incident version");
  const result: NpAgentIncidentV1 = {
    version: "np.agent-incident.v1",
    id: canonicalBodyUuid(raw.id, `${path}.id`),
    siteId: canonicalBodySiteId(raw.siteId, `${path}.siteId`),
    fingerprint: canonicalBodyAscii(raw.fingerprint, `${path}.fingerprint`, 256),
    category: canonicalBodyEnum(
      raw.category,
      `${path}.category`,
      new Set(npAgentIncidentCategories),
    ),
    severity: canonicalBodyEnum(
      raw.severity,
      `${path}.severity`,
      new Set(npAgentIncidentSeverities),
    ),
    status: canonicalBodyEnum(raw.status, `${path}.status`, new Set(npAgentIncidentStates)),
    title: text(raw.title, `${path}.title`, 200),
    summary: text(raw.summary, `${path}.summary`, 2000),
    primarySubject:
      raw.primarySubject === null
        ? null
        : parseAgentSubject(raw.primarySubject, `${path}.primarySubject`, state),
    assignedAgentId:
      raw.assignedAgentId === null
        ? null
        : canonicalBodyUuid(raw.assignedAgentId, `${path}.assignedAgentId`),
    signalIds: unique(
      canonicalBodyArray(raw.signalIds, `${path}.signalIds`, 100, state).map((id, index) =>
        canonicalBodyUuid(id, `${path}.signalIds[${index}]`),
      ),
      `${path}.signalIds`,
    ),
    eventCount: canonicalBodyInteger(raw.eventCount, `${path}.eventCount`, 0, 2147483647),
    firstObservedAt: canonicalBodyUtc(raw.firstObservedAt, `${path}.firstObservedAt`),
    lastObservedAt: canonicalBodyUtc(raw.lastObservedAt, `${path}.lastObservedAt`),
    containedAt: nullableUtc(raw.containedAt, `${path}.containedAt`),
    resolvedAt: nullableUtc(raw.resolvedAt, `${path}.resolvedAt`),
    resolutionCode:
      raw.resolutionCode === null ? null : stableCode(raw.resolutionCode, `${path}.resolutionCode`),
    versionNumber: canonicalBodyInteger(raw.versionNumber, `${path}.versionNumber`, 1, 2147483647),
    createdAt: canonicalBodyUtc(raw.createdAt, `${path}.createdAt`),
    updatedAt: canonicalBodyUtc(raw.updatedAt, `${path}.updatedAt`),
  };
  const terminal = result.status === "resolved" || result.status === "dismissed";
  if (
    terminal !== (result.resolvedAt !== null) ||
    terminal !== (result.resolutionCode !== null) ||
    (result.status === "contained" && result.containedAt === null)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "incident state must match resolution and containment facts",
    );
  if (
    result.firstObservedAt > result.lastObservedAt ||
    result.createdAt > result.updatedAt ||
    result.lastObservedAt > result.updatedAt ||
    (result.containedAt !== null &&
      (result.containedAt < result.firstObservedAt || result.containedAt > result.updatedAt)) ||
    (result.resolvedAt !== null &&
      (result.resolvedAt < result.lastObservedAt ||
        result.resolvedAt > result.updatedAt ||
        (result.containedAt !== null && result.containedAt > result.resolvedAt)))
  )
    failCanonicalBody("invalid-field", path, "incident timestamps must be ordered");
  if (result.primarySubject?.kind === "site" && result.primarySubject.siteId !== result.siteId)
    failCanonicalBody(
      "invalid-field",
      `${path}.primarySubject`,
      "subject must belong to incident site",
    );
  return result;
}
function parseOutput(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentIncidentOutputV1 {
  const raw = record(value, path, ["schemaVersion", "incident"], state);
  if (raw.schemaVersion !== "np.agent-incident-result.v1")
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid incident result version");
  return {
    schemaVersion: "np.agent-incident-result.v1",
    incident: parseIncident(raw.incident, `${path}.incident`, state),
  };
}
function parseListOutput(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentIncidentListOutputV1 {
  const raw = record(value, path, ["schemaVersion", "items", "nextCursor"], state);
  if (raw.schemaVersion !== "np.agent-incident-list.v1")
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid incident list version");
  const items = canonicalBodyArray(raw.items, `${path}.items`, 100, state).map((item, index) =>
    parseIncident(item, `${path}.items[${index}]`, state),
  );
  unique(
    items.map((item) => item.id),
    `${path}.items`,
  );
  return {
    schemaVersion: "np.agent-incident-list.v1",
    items,
    nextCursor: cursor(raw.nextCursor, `${path}.nextCursor`),
  };
}

export const npAnalyzeAgentIncidentV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.incident", () =>
    parseIncident(cloneCanonicalRuntimeInput(value, "agent.incident", 16384), "agent.incident", {
      seen: new WeakSet<object>(),
    }),
  );
export const npRequireAgentIncidentV1 = (value: unknown): NpAgentIncidentV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentV1(value));

export const npAnalyzeAgentIncidentGetInputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.incident", () =>
    parseGet(cloneCanonicalRuntimeInput(value, "agent.incident", 1024), "agent.incident", {
      seen: new WeakSet<object>(),
    }),
  );
export const npRequireAgentIncidentGetInputV1 = (value: unknown): NpAgentIncidentGetInputV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentGetInputV1(value));

export const npAnalyzeAgentIncidentListInputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.incident", () =>
    parseList(cloneCanonicalRuntimeInput(value, "agent.incident", 8192), "agent.incident", {
      seen: new WeakSet<object>(),
    }),
  );
export const npRequireAgentIncidentListInputV1 = (value: unknown): NpAgentIncidentListInputV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentListInputV1(value));

export const npAnalyzeAgentIncidentOutputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.incident", () =>
    parseOutput(cloneCanonicalRuntimeInput(value, "agent.incident", 32768), "agent.incident", {
      seen: new WeakSet<object>(),
    }),
  );
export const npRequireAgentIncidentOutputV1 = (value: unknown): NpAgentIncidentOutputV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentOutputV1(value));

export const npAnalyzeAgentIncidentListOutputV1 = (value: unknown) =>
  analyzeCanonicalBody("agent.incident", () =>
    parseListOutput(
      cloneCanonicalRuntimeInput(value, "agent.incident", 2097152),
      "agent.incident",
      { seen: new WeakSet<object>() },
    ),
  );
export const npRequireAgentIncidentListOutputV1 = (value: unknown): NpAgentIncidentListOutputV1 =>
  npRequireAgentContractResult(npAnalyzeAgentIncidentListOutputV1(value));

// Discovery schemas bound the same wire shape; parsers additionally enforce temporal/state rules.
const objectNode = (properties: Record<string, NpAgentJsonValue>): NpAgentJsonObject => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const nullableNode = (node: NpAgentJsonValue): NpAgentJsonObject => ({
  oneOf: [node, { type: "null" }],
});
const stringNode = (maximum: number, pattern?: string): NpAgentJsonObject => ({
  type: "string",
  minLength: 1,
  maxLength: maximum,
  ...(pattern === undefined ? {} : { pattern }),
});
const asciiNode = (maximum: number) => stringNode(maximum, "^[\\x21-\\x7e]+$");
const identifierNode = (maximum: number) =>
  stringNode(maximum, "^[a-z][a-z0-9_-]{0,39}(?:\\.[a-z][a-z0-9_-]{0,39})*$");
const uuidNode = stringNode(36, npAuthUuidPattern);
const utcNode = stringNode(24, "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");
const siteNode = stringNode(63, npSiteIdPattern);
const integerNode = (minimum: number): NpAgentJsonObject => ({
  type: "integer",
  minimum,
  maximum: 2147483647,
});
const enumNode = (values: readonly string[]): NpAgentJsonObject => ({
  type: "string",
  enum: [...values],
  maxLength: Math.max(...values.map((value) => value.length)),
});
const filterNode = (values: readonly string[]): NpAgentJsonObject => ({
  type: "array",
  maxItems: values.length,
  uniqueItems: true,
  items: enumNode(values),
});
const subjectNode = nullableNode({
  oneOf: [
    objectNode({
      kind: { const: "document" },
      collection: identifierNode(96),
      documentId: asciiNode(128),
    }),
    objectNode({
      kind: { const: "comment" },
      collection: identifierNode(96),
      documentId: asciiNode(128),
      commentId: asciiNode(128),
    }),
    objectNode({ kind: { const: "member" }, memberId: uuidNode }),
    objectNode({ kind: { const: "staff" }, userId: uuidNode }),
    objectNode({
      kind: { const: "session" },
      actorKind: enumNode(["staff", "member"]),
      sessionFamilyId: uuidNode,
    }),
    objectNode({
      kind: { const: "actor-bucket" },
      purpose: enumNode(["network-address", "login-identifier"]),
      projectionVersion: integerNode(1),
      projectionFingerprint: stringNode(54, "^cj1:sha256:[A-Za-z0-9_-]{43}$"),
      keyId: identifierNode(128),
      bucket: stringNode(43, "^[A-Za-z0-9_-]{43}$"),
    }),
    objectNode({ kind: { const: "job" }, jobName: identifierNode(96), jobId: asciiNode(128) }),
    objectNode({ kind: { const: "plugin" }, pluginId: identifierNode(96) }),
    objectNode({ kind: { const: "connection" }, connectionId: uuidNode }),
    objectNode({
      kind: { const: "agent" },
      agentId: uuidNode,
      agentVersionId: nullableNode(uuidNode),
    }),
    objectNode({ kind: { const: "site" }, siteId: siteNode }),
  ],
});
const incidentNode = objectNode({
  version: { const: "np.agent-incident.v1" },
  id: uuidNode,
  siteId: siteNode,
  fingerprint: asciiNode(256),
  category: enumNode(npAgentIncidentCategories),
  severity: enumNode(npAgentIncidentSeverities),
  status: enumNode(npAgentIncidentStates),
  title: stringNode(200),
  summary: stringNode(2000),
  primarySubject: subjectNode,
  assignedAgentId: nullableNode(uuidNode),
  signalIds: { type: "array", maxItems: 100, uniqueItems: true, items: uuidNode },
  eventCount: integerNode(0),
  firstObservedAt: utcNode,
  lastObservedAt: utcNode,
  containedAt: nullableNode(utcNode),
  resolvedAt: nullableNode(utcNode),
  resolutionCode: nullableNode(stringNode(64, "^[A-Z][A-Z0-9_]{0,63}$")),
  versionNumber: integerNode(1),
  createdAt: utcNode,
  updatedAt: utcNode,
});
const schema = (properties: Record<string, NpAgentJsonValue>): NpAgentJsonSchema =>
  JSON.parse(
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...objectNode(properties),
    }),
  ) as NpAgentJsonSchema;
export const npAgentIncidentGetInputSchemaV1 = schema({ incidentId: uuidNode });
export const npAgentIncidentListInputSchemaV1 = schema({
  statuses: filterNode(npAgentIncidentStates),
  categories: filterNode(npAgentIncidentCategories),
  severities: filterNode(npAgentIncidentSeverities),
  updatedAfter: nullableNode(utcNode),
  limit: { type: "integer", minimum: 1, maximum: 100 },
  cursor: nullableNode(asciiNode(2048)),
});
export const npAgentIncidentOutputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-incident-result.v1" },
  incident: incidentNode,
});
export const npAgentIncidentListOutputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-incident-list.v1" },
  items: { type: "array", maxItems: 100, items: incidentNode },
  nextCursor: nullableNode(asciiNode(2048)),
});
