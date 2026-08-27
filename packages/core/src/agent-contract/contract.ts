import {
  NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  npAgentApprovalModes,
  npAgentCapabilityIds,
  npAgentCapabilityRisks,
  npAgentCapabilityScopeDerivations,
  npAgentExecutionModes,
  npAgentGatewayExposureModes,
  npAgentGatewayExposureRank,
  npAgentGatewayTransports,
  npAgentIdempotencyModes,
  npAgentScopes,
  npAgentScopeDerivations,
  type NpAgentApprovalMode,
  type NpAgentCapabilityDescriptor,
  type NpAgentCapabilityId,
  type NpAgentCapabilityRisk,
  type NpAgentContractIssue,
  type NpAgentContractIssueCode,
  type NpAgentContractResult,
  type NpAgentEffectProfileDescriptor,
  type NpAgentEnabledGatewayExposureMode,
  type NpAgentExecutionMode,
  type NpAgentGatewayExposureMode,
  type NpAgentGatewaySettingsV1,
  type NpAgentGatewayTransport,
  type NpAgentIdempotencyMode,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentJsonValue,
  type NpAgentMcpToolDefinitionV1,
  type NpAgentScope,
  type NpAgentScopeDerivation,
} from "./types.js";

export const npAgentContractLimits = {
  coreCapabilityDescriptors: 21,
  coreRecipeDefinitions: 5,
  changeSetOperations: 500,
  changeSetCollections: 64,
  changeSetExplanatoryCharacters: 4_000,
  changeSetSnapshotBytes: 256 * 1024,
  changeSetAggregateSnapshotBytes: 2 * 1024 * 1024,
  mcpTools: 18,
  mcpResourceTemplates: 11,
  mcpPrompts: 4,
  identifierCharacters: 128,
  titleCharacters: 120,
  descriptionCharacters: 2_000,
  scopesPerPrincipalOrDescriptor: 23,
  jsonSchemaBytes: 512 * 1024,
  jsonSchemaDepth: 16,
  jsonSchemaNodes: 4_096,
  jsonSchemaDefinitions: 128,
  jsonSchemaObjectProperties: 128,
  jsonSchemaMaxItems: 1_000,
  jsonSchemaMaxStringCharacters: 262_144,
  invocationBytes: 4 * 1024 * 1024,
  invocationDepth: 32,
  invocationNodes: 20_000,
  invocationArrayItems: 5_000,
  invocationObjectProperties: 512,
  invocationStringCharacters: 262_144,
  mcpFrameBytes: 5 * 1024 * 1024,
  inlineMcpStructuredResultBytes: 3 * 1024 * 1024,
  inlineMcpCompatibilityTextBytes: 256 * 1024,
  pageSizeDefault: 20,
  pageSizeMaximum: 100,
  cursorBytes: 2_048,
  cursorTtlSeconds: 15 * 60,
  promptArguments: 8,
  promptArgumentCharacters: 4_000,
  taskPollMinimumMs: 1_000,
  taskPollDefaultMs: 2_000,
  taskPollMaximumHintMs: 10_000,
  taskWallClockMaximumSeconds: 86_400,
  taskAvailabilityMinimumSeconds: 60,
  taskAvailabilityDefaultSeconds: 60 * 60,
  taskAvailabilityMaximumSeconds: 24 * 60 * 60,
  directMutationPrimaryTargets: 1,
  actionEvidenceReferences: 100,
  actorRestrictionTtlMinimumSeconds: NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  actorRestrictionTtlDefaultSeconds: NP_AGENT_ACTOR_RESTRICTION_TTL_DEFAULT_SECONDS,
  actorRestrictionTtlMaximumSeconds: NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
} as const;

export const npAgentMcpToolDefinitionsV1: readonly NpAgentMcpToolDefinitionV1[] = [
  { name: "inspect_site", capabilityIds: ["site.inspect"], listedFrom: "read" },
  { name: "query_content", capabilityIds: ["content.query"], listedFrom: "read" },
  { name: "create_changeset", capabilityIds: ["changeset.create"], listedFrom: "propose" },
  {
    name: "validate_changeset",
    capabilityIds: ["changeset.validate"],
    listedFrom: "propose",
  },
  {
    name: "preview_changeset",
    capabilityIds: ["changeset.preview"],
    listedFrom: "propose",
  },
  {
    name: "schedule_changeset",
    capabilityIds: ["changeset.schedule"],
    listedFrom: "propose",
  },
  { name: "apply_changeset", capabilityIds: ["changeset.apply"], listedFrom: "propose" },
  {
    name: "rollback_changeset",
    capabilityIds: ["changeset.rollback"],
    listedFrom: "propose",
  },
  {
    name: "query_changesets",
    capabilityIds: ["changeset.get", "changeset.list"],
    listedFrom: "read",
  },
  { name: "run_site_audit", capabilityIds: ["audit.run"], listedFrom: "read" },
  { name: "get_ops_status", capabilityIds: ["ops.status"], listedFrom: "read" },
  { name: "plan_ops_action", capabilityIds: ["ops.plan"], listedFrom: "propose" },
  {
    name: "execute_approved_action",
    capabilityIds: ["ops.execute"],
    listedFrom: "approved-execute",
  },
  {
    name: "query_incidents",
    capabilityIds: ["incident.get", "incident.list"],
    listedFrom: "read",
  },
  {
    name: "quarantine_content",
    capabilityIds: ["moderation.quarantine"],
    listedFrom: "propose",
  },
  {
    name: "restore_content",
    capabilityIds: ["moderation.restore"],
    listedFrom: "propose",
  },
  {
    name: "temporarily_limit_actor",
    capabilityIds: ["security.limitActor"],
    listedFrom: "propose",
  },
  {
    name: "revoke_sessions",
    capabilityIds: ["security.revokeSessions"],
    listedFrom: "propose",
  },
];

const CAPABILITY_IDS = new Set<string>(npAgentCapabilityIds);
const SCOPES = new Set<string>(npAgentScopes);
const RISKS = new Set<string>(npAgentCapabilityRisks);
const APPROVALS = new Set<string>(npAgentApprovalModes);
const EXPOSURES = new Set<string>(npAgentGatewayExposureModes);
const ENABLED_EXPOSURES = new Set<string>(["read", "propose", "approved-execute"]);
const TRANSPORTS = new Set<string>(npAgentGatewayTransports);
const EXECUTION_MODES = new Set<string>(npAgentExecutionModes);
const IDEMPOTENCY_MODES = new Set<string>(npAgentIdempotencyModes);
const SCOPE_DERIVATIONS = new Set<string>(npAgentScopeDerivations);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,39}(?:\.[a-z][a-z0-9_-]{0,39})*$/u;
const APP_SOURCE_PATTERN = /^app:[a-z][a-z0-9-]{0,62}$/u;
const LOCAL_SCHEMA_REF_PATTERN = /^#\/\$defs\/[A-Za-z0-9._-]{1,128}$/u;

interface InspectionState {
  seen: WeakSet<object>;
}

interface JsonState {
  inspection: InspectionState;
  nodes: number;
  maximumDepth: number;
  maximumNodes: number;
  maximumArrayItems: number;
  maximumObjectProperties: number;
  maximumStringCharacters: number;
}

export class NpAgentContractError extends Error {
  readonly contractIssues: NpAgentContractIssue[];

  constructor(message: string, issues: NpAgentContractIssue[]) {
    const first = issues[0];
    super(first ? `${message} at ${first.path}: ${first.message}` : message);
    this.name = "NpAgentContractError";
    this.contractIssues = issues;
  }
}

function fail(code: NpAgentContractIssueCode, path: string, message: string): never {
  throw new NpAgentContractError("Invalid Agent contract", [{ code, path, message }]);
}

function analyze<T>(path: string, parser: () => T): NpAgentContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    if (error instanceof NpAgentContractError) {
      return { ok: false, issues: error.contractIssues };
    }
    return {
      ok: false,
      issues: [
        {
          code: "unsafe-value",
          path,
          message: "could not be inspected safely",
        },
      ],
    };
  }
}

export function npRequireAgentContractResult<T>(
  result: NpAgentContractResult<T>,
  message = "Invalid Agent contract",
): T {
  if (result.ok) return result.value;
  throw new NpAgentContractError(message, result.issues);
}

function claimContainer(value: object, path: string, state: InspectionState): void {
  if (state.seen.has(value)) {
    fail("shape", path, "must not contain cycles or shared references");
  }
  state.seen.add(value);
}

function defineDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function plainRecord(
  value: unknown,
  path: string,
  allowed: readonly string[] | null,
  required: readonly string[],
  state: InspectionState,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("shape", path, "must be an ordinary plain object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail("shape", path, "must use the ordinary object prototype");
  }
  claimContainer(value, path, state);

  const allowedKeys = allowed ? new Set(allowed) : null;
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("shape", path, "must not contain symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("shape", `${path}.${key}`, "must be an enumerable plain data property");
    }
    if (allowedKeys && !allowedKeys.has(key)) {
      fail("unknown-field", `${path}.${key}`, "is not part of this exact contract");
    }
    defineDataProperty(result, key, descriptor.value as unknown);
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) {
      fail("missing-field", `${path}.${key}`, "is required");
    }
  }
  return result;
}

function plainArray(
  value: unknown,
  path: string,
  maximum: number,
  state: InspectionState,
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("shape", path, "must be an ordinary dense array");
  }
  claimContainer(value, path, state);
  if (value.length > maximum) {
    fail("limit", path, `may contain at most ${maximum.toString()} entries`);
  }

  const indices = new Set(Array.from({ length: value.length }, (_, index) => index.toString()));
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" || (typeof key === "string" && indices.has(key))) continue;
    fail("shape", path, "must not contain non-index array properties");
  }

  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("shape", `${path}[${index.toString()}]`, "must be a plain data element");
    }
    result.push(descriptor.value as unknown);
  }
  return result;
}

function hasUnsafeUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function text(
  value: unknown,
  path: string,
  maximum: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string {
  if (typeof value !== "string") fail("invalid-field", path, "must be a string");
  if (!options.allowEmpty && value.length === 0) {
    fail("invalid-field", path, "must not be empty");
  }
  if (options.trim && value.trim() !== value) {
    fail("invalid-field", path, "must not contain surrounding whitespace");
  }
  if (hasUnsafeUnicode(value)) {
    fail("unsafe-value", path, "must contain only safe Unicode scalar values");
  }
  if (scalarLength(value) > maximum) {
    fail("limit", path, `may contain at most ${maximum.toString()} Unicode scalar values`);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  const parsed = text(value, path, npAgentContractLimits.identifierCharacters, { trim: true });
  if (!IDENTIFIER_PATTERN.test(parsed)) {
    fail("invalid-field", path, "must use the canonical Agent identifier grammar");
  }
  return parsed;
}

function enumValue<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail("invalid-field", path, "is not a supported value");
  }
  return value as T;
}

function parseSortedEnumArray<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  maximum: number,
  state: InspectionState,
): T[] {
  const entries = plainArray(value, path, maximum, state);
  const result: T[] = [];
  let previous: string | null = null;
  for (const [index, entry] of entries.entries()) {
    const current = enumValue<T>(entry, `${path}[${index.toString()}]`, allowed);
    if (previous !== null && current <= previous) {
      fail(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical ASCII value",
      );
    }
    result.push(current);
    previous = current;
  }
  return result;
}

function parseJsonValue(
  value: unknown,
  path: string,
  depth: number,
  state: JsonState,
): NpAgentJsonValue {
  state.nodes += 1;
  if (state.nodes > state.maximumNodes) {
    fail("limit", path, "exceeds the JSON node limit");
  }
  if (depth > state.maximumDepth) {
    fail("limit", path, "exceeds the JSON depth limit");
  }

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail("unsafe-value", path, "must be a finite safe JSON number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    return text(value, path, state.maximumStringCharacters, { allowEmpty: true });
  }
  if (Array.isArray(value)) {
    const entries = plainArray(value, path, state.maximumArrayItems, state.inspection);
    return entries.map((entry, index) =>
      parseJsonValue(entry, `${path}[${index.toString()}]`, depth + 1, state),
    );
  }

  const record = plainRecord(value, path, null, [], state.inspection);
  const keys = Object.keys(record);
  if (keys.length > state.maximumObjectProperties) {
    fail(
      "limit",
      path,
      `may contain at most ${state.maximumObjectProperties.toString()} properties`,
    );
  }
  const parsed: NpAgentJsonObject = {};
  for (const key of keys) {
    state.nodes += 1;
    if (state.nodes > state.maximumNodes) {
      fail("limit", `${path}.${key}`, "exceeds the JSON node limit");
    }
    text(key, `${path}.${key}`, npAgentContractLimits.identifierCharacters, { allowEmpty: false });
    defineDataProperty(
      parsed,
      key,
      parseJsonValue(record[key], `${path}.${key}`, depth + 1, state),
    );
  }
  return parsed;
}

function inspectSchemaNode(value: NpAgentJsonValue, path: string, definitions: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectSchemaNode(entry, `${path}[${index.toString()}]`, definitions),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value;
  const reference = record.$ref;
  if (reference !== undefined) {
    if (typeof reference !== "string" || !LOCAL_SCHEMA_REF_PATTERN.test(reference)) {
      fail("invalid-field", `${path}.$ref`, "must reference one local $defs entry");
    }
    const name = reference.slice("#/$defs/".length);
    if (!definitions.has(name)) {
      fail("invalid-field", `${path}.$ref`, "references an unknown local definition");
    }
  }

  if (record.type === "string") {
    const maximum = record.maxLength;
    if (
      typeof maximum !== "number" ||
      !Number.isSafeInteger(maximum) ||
      maximum < 0 ||
      maximum > npAgentContractLimits.jsonSchemaMaxStringCharacters
    ) {
      fail("invalid-field", `${path}.maxLength`, "must declare a bounded string maximum");
    }
  }
  if (record.type === "array") {
    const maximum = record.maxItems;
    if (
      typeof maximum !== "number" ||
      !Number.isSafeInteger(maximum) ||
      maximum < 0 ||
      maximum > npAgentContractLimits.jsonSchemaMaxItems
    ) {
      fail("invalid-field", `${path}.maxItems`, "must declare a bounded array maximum");
    }
  }
  if (record.type === "object" && record.additionalProperties !== false) {
    fail("invalid-field", `${path}.additionalProperties`, "must be false for object schemas");
  }

  for (const [key, entry] of Object.entries(record)) {
    inspectSchemaNode(entry, `${path}.${key}`, definitions);
  }
}

function parseJsonSchema(
  value: unknown,
  path: string,
  inspection: InspectionState,
): NpAgentJsonSchema {
  const parsed = parseJsonValue(value, path, 0, {
    inspection,
    nodes: 0,
    maximumDepth: npAgentContractLimits.jsonSchemaDepth,
    maximumNodes: npAgentContractLimits.jsonSchemaNodes,
    maximumArrayItems: npAgentContractLimits.jsonSchemaMaxItems,
    maximumObjectProperties: npAgentContractLimits.jsonSchemaObjectProperties,
    maximumStringCharacters: npAgentContractLimits.jsonSchemaMaxStringCharacters,
  });
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("shape", path, "must be an object-root JSON Schema");
  }
  const record = parsed;
  if (record.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail("invalid-field", `${path}.$schema`, "must select JSON Schema 2020-12");
  }
  if (record.type !== "object") {
    fail("invalid-field", `${path}.type`, "must be object");
  }
  if (record.additionalProperties !== false) {
    fail("invalid-field", `${path}.additionalProperties`, "must be false");
  }

  const definitions = new Set<string>();
  const rawDefinitions = record.$defs;
  if (rawDefinitions !== undefined) {
    if (
      typeof rawDefinitions !== "object" ||
      rawDefinitions === null ||
      Array.isArray(rawDefinitions)
    ) {
      fail("shape", `${path}.$defs`, "must be an object");
    }
    const names = Object.keys(rawDefinitions);
    if (names.length > npAgentContractLimits.jsonSchemaDefinitions) {
      fail("limit", `${path}.$defs`, "contains too many local definitions");
    }
    names.forEach((name) => definitions.add(name));
  }
  inspectSchemaNode(record, path, definitions);

  const bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  if (bytes > npAgentContractLimits.jsonSchemaBytes) {
    fail("limit", path, "exceeds the serialized JSON Schema byte limit");
  }
  return record as NpAgentJsonSchema;
}

function parseEffectProfile(
  value: unknown,
  path: string,
  state: InspectionState,
): NpAgentEffectProfileDescriptor {
  const record = plainRecord(
    value,
    path,
    ["id", "kind", "reversibility", "minimumGatewayExposure", "verifierId", "compensatorId"],
    ["id", "kind", "reversibility", "minimumGatewayExposure", "verifierId", "compensatorId"],
    state,
  );
  const id = identifier(record.id, `${path}.id`);
  const kind = enumValue<"read" | "mutation">(
    record.kind,
    `${path}.kind`,
    new Set(["read", "mutation"]),
  );
  const reversibility = enumValue<"none" | "compensatable">(
    record.reversibility,
    `${path}.reversibility`,
    new Set(["none", "compensatable"]),
  );
  const minimumGatewayExposure =
    record.minimumGatewayExposure === null
      ? null
      : enumValue<NpAgentEnabledGatewayExposureMode>(
          record.minimumGatewayExposure,
          `${path}.minimumGatewayExposure`,
          ENABLED_EXPOSURES,
        );
  const verifierId =
    record.verifierId === null ? null : identifier(record.verifierId, `${path}.verifierId`);
  const compensatorId =
    record.compensatorId === null
      ? null
      : identifier(record.compensatorId, `${path}.compensatorId`);

  if (kind === "read") {
    if (reversibility !== "none" || verifierId !== null || compensatorId !== null) {
      fail("invalid-field", path, "read profiles must be non-reversible and verifier-free");
    }
  } else {
    if (minimumGatewayExposure === "read") {
      fail(
        "invalid-field",
        `${path}.minimumGatewayExposure`,
        "mutations require propose or higher",
      );
    }
    if (verifierId === null) {
      fail("invalid-field", `${path}.verifierId`, "mutation profiles require a verifier");
    }
    if (reversibility === "compensatable" && compensatorId === null) {
      fail(
        "invalid-field",
        `${path}.compensatorId`,
        "compensatable profiles require a compensator",
      );
    }
    if (reversibility === "none" && compensatorId !== null) {
      fail(
        "invalid-field",
        `${path}.compensatorId`,
        "non-compensatable profiles forbid a compensator",
      );
    }
  }

  return {
    id,
    kind,
    reversibility,
    minimumGatewayExposure,
    verifierId,
    compensatorId,
  };
}

/**
 * Validates the shared effect-profile shape independently of a capability.
 * Admin operation, capability-registry, OpenAPI, and Doctor projections use
 * this same parser so verifier/compensator invariants cannot drift.
 */
export function npAnalyzeAgentEffectProfileDescriptor(
  value: unknown,
): NpAgentContractResult<NpAgentEffectProfileDescriptor> {
  return analyze("agent.effectProfile", () =>
    parseEffectProfile(value, "agent.effectProfile", { seen: new WeakSet<object>() }),
  );
}

export function npRequireAgentEffectProfileDescriptor(
  value: unknown,
): NpAgentEffectProfileDescriptor {
  return npRequireAgentContractResult(
    npAnalyzeAgentEffectProfileDescriptor(value),
    "Invalid Agent effect profile descriptor",
  );
}

function parseDescriptor(value: unknown): NpAgentCapabilityDescriptor {
  const inspection: InspectionState = { seen: new WeakSet<object>() };
  const path = "agent.capability";
  const record = plainRecord(
    value,
    path,
    [
      "schemaVersion",
      "id",
      "contractVersion",
      "source",
      "title",
      "description",
      "requiredScopes",
      "scopeDerivation",
      "risk",
      "approval",
      "effectProfiles",
      "bootstrapIntent",
      "execution",
      "idempotency",
      "gateway",
      "inputSchema",
      "outputSchema",
    ],
    [
      "schemaVersion",
      "id",
      "contractVersion",
      "source",
      "title",
      "description",
      "requiredScopes",
      "scopeDerivation",
      "risk",
      "approval",
      "effectProfiles",
      "bootstrapIntent",
      "execution",
      "idempotency",
      "gateway",
      "inputSchema",
      "outputSchema",
    ],
    inspection,
  );
  if (record.schemaVersion !== "np.agent-capability.v1") {
    fail("invalid-field", `${path}.schemaVersion`, "must be np.agent-capability.v1");
  }
  if (record.contractVersion !== 1) {
    fail("invalid-field", `${path}.contractVersion`, "must be 1");
  }
  const id = enumValue<NpAgentCapabilityId>(record.id, `${path}.id`, CAPABILITY_IDS);
  const source = text(record.source, `${path}.source`, 67, { trim: true });
  if (source !== "core" && !APP_SOURCE_PATTERN.test(source)) {
    fail("invalid-field", `${path}.source`, "must be core or one canonical app source");
  }
  const title = text(record.title, `${path}.title`, npAgentContractLimits.titleCharacters, {
    trim: true,
  });
  const description = text(
    record.description,
    `${path}.description`,
    npAgentContractLimits.descriptionCharacters,
    { trim: true },
  );
  const requiredScopes = parseSortedEnumArray<NpAgentScope>(
    record.requiredScopes,
    `${path}.requiredScopes`,
    SCOPES,
    npAgentContractLimits.scopesPerPrincipalOrDescriptor,
    inspection,
  );
  if (requiredScopes.length === 0) {
    fail("invalid-field", `${path}.requiredScopes`, "must contain at least one scope");
  }
  const scopeDerivation = enumValue<NpAgentScopeDerivation>(
    record.scopeDerivation,
    `${path}.scopeDerivation`,
    SCOPE_DERIVATIONS,
  );
  if (scopeDerivation !== npAgentCapabilityScopeDerivations[id]) {
    fail("invalid-field", `${path}.scopeDerivation`, "does not match the capability inventory");
  }
  const risk = enumValue<NpAgentCapabilityRisk>(record.risk, `${path}.risk`, RISKS);
  const approval = enumValue<NpAgentApprovalMode>(record.approval, `${path}.approval`, APPROVALS);
  if ((risk === "sensitive" || risk === "destructive") && approval === "none") {
    fail(
      "invalid-field",
      `${path}.approval`,
      "sensitive and destructive capabilities need approval",
    );
  }

  const rawProfiles = plainArray(record.effectProfiles, `${path}.effectProfiles`, 16, inspection);
  if (rawProfiles.length === 0) {
    fail("invalid-field", `${path}.effectProfiles`, "must not be empty");
  }
  const effectProfiles = rawProfiles.map((profile, index) =>
    parseEffectProfile(profile, `${path}.effectProfiles[${index.toString()}]`, inspection),
  );
  for (let index = 1; index < effectProfiles.length; index += 1) {
    const previous = effectProfiles[index - 1]?.id;
    const current = effectProfiles[index]?.id;
    if (previous && current && current <= previous) {
      fail(
        current === previous ? "duplicate" : "order",
        `${path}.effectProfiles[${index.toString()}].id`,
        "must be sorted unique",
      );
    }
  }

  const bootstrapIntent = enumValue<"plugins" | "write">(
    record.bootstrapIntent,
    `${path}.bootstrapIntent`,
    new Set(["plugins", "write"]),
  );
  const execution = enumValue<NpAgentExecutionMode>(
    record.execution,
    `${path}.execution`,
    EXECUTION_MODES,
  );
  const idempotency = enumValue<NpAgentIdempotencyMode>(
    record.idempotency,
    `${path}.idempotency`,
    IDEMPOTENCY_MODES,
  );
  if (effectProfiles.some((profile) => profile.kind === "mutation") && idempotency !== "required") {
    fail("invalid-field", `${path}.idempotency`, "mutation profiles require idempotency");
  }

  let gateway: NpAgentCapabilityDescriptor["gateway"];
  if (record.gateway === null) {
    gateway = null;
    if (effectProfiles.some((profile) => profile.minimumGatewayExposure !== null)) {
      fail("invalid-field", `${path}.gateway`, "internal capabilities require internal effects");
    }
  } else {
    const gatewayRecord = plainRecord(
      record.gateway,
      `${path}.gateway`,
      ["transports"],
      ["transports"],
      inspection,
    );
    const transports = parseSortedEnumArray<NpAgentGatewayTransport>(
      gatewayRecord.transports,
      `${path}.gateway.transports`,
      TRANSPORTS,
      npAgentGatewayTransports.length,
      inspection,
    );
    if (transports.length === 0) {
      fail("invalid-field", `${path}.gateway.transports`, "must not be empty");
    }
    if (!effectProfiles.some((profile) => profile.minimumGatewayExposure !== null)) {
      fail("invalid-field", `${path}.gateway`, "must project at least one effect profile");
    }
    gateway = { transports };
  }

  return {
    schemaVersion: "np.agent-capability.v1",
    id,
    contractVersion: 1,
    source: source as NpAgentCapabilityDescriptor["source"],
    title,
    description,
    requiredScopes,
    scopeDerivation,
    risk,
    approval,
    effectProfiles,
    bootstrapIntent,
    execution,
    idempotency,
    gateway,
    inputSchema: parseJsonSchema(record.inputSchema, `${path}.inputSchema`, inspection),
    outputSchema: parseJsonSchema(record.outputSchema, `${path}.outputSchema`, inspection),
  };
}

export function npAnalyzeAgentCapabilityDescriptor(
  value: unknown,
): NpAgentContractResult<NpAgentCapabilityDescriptor> {
  return analyze("agent.capability", () => parseDescriptor(value));
}

export function npRequireAgentCapabilityDescriptor(value: unknown): NpAgentCapabilityDescriptor {
  return npRequireAgentContractResult(
    npAnalyzeAgentCapabilityDescriptor(value),
    "Invalid Agent capability descriptor",
  );
}

export function npAnalyzeAgentJsonSchema(value: unknown): NpAgentContractResult<NpAgentJsonSchema> {
  return analyze("agent.schema", () =>
    parseJsonSchema(value, "agent.schema", { seen: new WeakSet<object>() }),
  );
}

export function npRequireAgentJsonSchema(value: unknown): NpAgentJsonSchema {
  return npRequireAgentContractResult(npAnalyzeAgentJsonSchema(value), "Invalid Agent JSON Schema");
}

function parseGatewaySettings(value: unknown): NpAgentGatewaySettingsV1 {
  const path = "agent.gatewaySettings";
  const record = plainRecord(
    value,
    path,
    ["schemaVersion", "stdio", "mcpHttp", "agentHttp"],
    ["schemaVersion", "stdio", "mcpHttp", "agentHttp"],
    { seen: new WeakSet<object>() },
  );
  if (record.schemaVersion !== "np.agent-gateway-settings.v1") {
    fail("invalid-field", `${path}.schemaVersion`, "must be np.agent-gateway-settings.v1");
  }
  return {
    schemaVersion: "np.agent-gateway-settings.v1",
    stdio: enumValue<NpAgentGatewayExposureMode>(record.stdio, `${path}.stdio`, EXPOSURES),
    mcpHttp: enumValue<NpAgentGatewayExposureMode>(record.mcpHttp, `${path}.mcpHttp`, EXPOSURES),
    agentHttp: enumValue<NpAgentGatewayExposureMode>(
      record.agentHttp,
      `${path}.agentHttp`,
      EXPOSURES,
    ),
  };
}

export function npAnalyzeAgentGatewaySettings(
  value: unknown,
): NpAgentContractResult<NpAgentGatewaySettingsV1> {
  return analyze("agent.gatewaySettings", () => parseGatewaySettings(value));
}

export function npRequireAgentGatewaySettings(value: unknown): NpAgentGatewaySettingsV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentGatewaySettings(value),
    "Invalid Agent Gateway settings",
  );
}

export function npAgentGatewayExposureAtLeast(
  current: NpAgentGatewayExposureMode,
  required: NpAgentEnabledGatewayExposureMode,
): boolean {
  return npAgentGatewayExposureRank[current] >= npAgentGatewayExposureRank[required];
}

export function npNarrowAgentGatewayExposure(
  ...ceilings: readonly NpAgentGatewayExposureMode[]
): NpAgentGatewayExposureMode {
  if (ceilings.length === 0) return "disabled";
  return ceilings.reduce((current, candidate) =>
    npAgentGatewayExposureRank[candidate] < npAgentGatewayExposureRank[current]
      ? candidate
      : current,
  );
}
