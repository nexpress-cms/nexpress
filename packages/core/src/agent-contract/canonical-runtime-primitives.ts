import {
  NpAgentContractError,
  npAgentContractLimits,
  npAnalyzeAgentJsonSchema,
} from "./contract.js";
import {
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyCapabilityId,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  serializeAgentCanonicalJson,
  type AgentCanonicalJsonInspectionLimits,
} from "./canonical-foundation.js";
import {
  npAgentActorBucketPurposesV1,
  npAgentCapabilityIds,
  npAgentCapabilityRisks,
  npAgentExecutableOpsActionIds,
  npAgentIncidentCategories,
  npAgentIncidentSeverities,
  npAgentPlanOnlyOpsActionIds,
  npAgentProviderDataClasses,
  npAgentScopes,
  type NpAgentActorBucketPurposeV1,
  type NpAgentActorBucketRefV1,
  type NpAgentActorProjection,
  type NpAgentActorSubjectV1,
  type NpAgentCapabilityId,
  type NpAgentCapabilityRisk,
  type NpAgentContractIssue,
  type NpAgentContractResult,
  type NpAgentIncidentCategory,
  type NpAgentIncidentSeverity,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentJsonValue,
  type NpAgentModelPricingV1,
  type NpAgentOpsPlanActionId,
  type NpAgentProviderDataClass,
  type NpAgentScope,
  type NpAgentSubject,
  type NpAgentTargetRef,
} from "./types.js";

export const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
export const SAFE_IDENTIFIER_MAXIMUM = 128;
export const DOMAIN_IDENTIFIER_MAXIMUM = 96;
export const SAFE_TEXT_MAXIMUM = 2_000;
export const PROVIDER_COMPONENT_MAXIMUM = 2 * 1024 * 1024;

const ACTOR_BUCKET_PURPOSES = new Set<string>(npAgentActorBucketPurposesV1);
const CAPABILITY_IDS = new Set<string>(npAgentCapabilityIds);
const CAPABILITY_RISKS = new Set<string>(npAgentCapabilityRisks);
const INCIDENT_CATEGORIES = new Set<string>(npAgentIncidentCategories);
const INCIDENT_SEVERITIES = new Set<string>(npAgentIncidentSeverities);
const OPS_ACTION_IDS = new Set<string>([
  ...npAgentExecutableOpsActionIds,
  ...npAgentPlanOnlyOpsActionIds,
]);
const PROVIDER_DATA_CLASSES = new Set<string>(npAgentProviderDataClasses);
const SCOPES = new Set<string>(npAgentScopes);
const ACTOR_BUCKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PRICING_FINGERPRINT_PATTERN = /^pr1:sha256:[A-Za-z0-9_-]{43}$/u;
const LOWERCASE_SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const DEDUPLICATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export const npAgentActorBucketIncludedKeysV1 = [
  "purpose",
  "projectionVersion",
  "projectionFingerprint",
  "keyId",
  "bucket",
] as const satisfies readonly (keyof NpAgentActorBucketRefV1)[];

function remapIssues(
  issues: readonly NpAgentContractIssue[],
  sourceRoot: string,
  targetRoot: string,
): NpAgentContractIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path.startsWith(sourceRoot)
      ? `${targetRoot}${issue.path.slice(sourceRoot.length)}`
      : targetRoot,
  }));
}

export function requireNestedCanonicalResult<T>(
  result: NpAgentContractResult<T>,
  sourceRoot: string,
  targetRoot: string,
  message = "Invalid Agent canonical body",
): T {
  if (result.ok) return result.value;
  throw new NpAgentContractError(message, remapIssues(result.issues, sourceRoot, targetRoot));
}

export function cloneCanonicalRuntimeInput(
  value: unknown,
  path: string,
  maximumCanonicalBytes: number,
  overrides: Partial<AgentCanonicalJsonInspectionLimits> = {},
): NpAgentJsonValue {
  const limits: AgentCanonicalJsonInspectionLimits = {
    maximumDepth: npAgentContractLimits.invocationDepth,
    maximumNodes: Math.min(maximumCanonicalBytes, npAgentContractLimits.invocationNodes),
    maximumArrayItems: npAgentContractLimits.invocationArrayItems,
    maximumObjectProperties: npAgentContractLimits.invocationObjectProperties,
    maximumStringCharacters: Math.min(
      maximumCanonicalBytes,
      npAgentContractLimits.invocationStringCharacters,
    ),
    maximumCanonicalBytes,
    ...overrides,
  };
  return requireNestedCanonicalResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, limits),
    path,
    path,
  );
}

export function canonicalRuntimeText(
  value: unknown,
  path: string,
  maximum: number,
  options: { allowEmpty?: boolean; requireTrimmed?: boolean } = {},
): string {
  const { allowEmpty = false, requireTrimmed = false } = options;
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum ||
    (requireTrimmed && value.trim() !== value)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      `must be ${allowEmpty ? "0" : "1"}..${maximum.toString()} safe text characters`,
    );
  }
  return value;
}

export function canonicalRuntimeStableCode(value: unknown, path: string): string {
  if (typeof value !== "string" || !STABLE_CODE_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical uppercase stable code");
  }
  return value;
}

export function canonicalRuntimeLowercaseSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !LOWERCASE_SHA_256_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be one lowercase hexadecimal SHA-256 digest");
  }
  return value;
}

export function canonicalRuntimeDeduplicationKey(value: unknown, path: string): string {
  if (typeof value !== "string" || !DEDUPLICATION_KEY_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must use the canonical deduplication-key grammar");
  }
  return value;
}

export function canonicalRuntimeIdempotencyKey(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must use the canonical idempotency-key grammar");
  }
  return value;
}

export function parseCanonicalJsonObject(value: unknown, path: string): NpAgentJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be an object-root canonical JSON value");
  }
  return value as NpAgentJsonObject;
}

export function parseCanonicalJsonSchema(value: unknown, path: string): NpAgentJsonSchema {
  return requireNestedCanonicalResult(npAnalyzeAgentJsonSchema(value), "agent.schema", path);
}

export function parseActorBucket(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
  requiredPurpose?: NpAgentActorBucketPurposeV1,
): NpAgentActorBucketRefV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentActorBucketIncludedKeysV1,
    npAgentActorBucketIncludedKeysV1,
    state,
  );
  const purpose = canonicalBodyEnum<NpAgentActorBucketPurposeV1>(
    record.purpose,
    `${path}.purpose`,
    ACTOR_BUCKET_PURPOSES,
  );
  if (requiredPurpose !== undefined && purpose !== requiredPurpose) {
    failCanonicalBody("invalid-field", `${path}.purpose`, `must be ${requiredPurpose}`);
  }
  if (typeof record.bucket !== "string" || !ACTOR_BUCKET_PATTERN.test(record.bucket)) {
    failCanonicalBody("invalid-field", `${path}.bucket`, "must be a 43-character base64url HMAC");
  }
  return {
    purpose,
    projectionVersion: canonicalBodyInteger(
      record.projectionVersion,
      `${path}.projectionVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    projectionFingerprint: canonicalBodySha256Digest(
      record.projectionFingerprint,
      `${path}.projectionFingerprint`,
    ),
    keyId: canonicalBodyIdentifier(record.keyId, `${path}.keyId`, SAFE_IDENTIFIER_MAXIMUM),
    bucket: record.bucket,
  };
}

function parseSubjectRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
  state: CanonicalBodyInspectionState,
): Record<string, unknown> {
  return canonicalBodyRecord(value, path, keys, keys, state);
}

export function parseAgentSubject(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentSubject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact Agent subject branch");
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor) || typeof kindDescriptor.value !== "string") {
    failCanonicalBody("missing-field", `${path}.kind`, "is required");
  }
  switch (kindDescriptor.value) {
    case "document": {
      const record = parseSubjectRecord(value, path, ["kind", "collection", "documentId"], state);
      return {
        kind: "document",
        collection: canonicalBodyIdentifier(record.collection, `${path}.collection`, 96),
        documentId: canonicalBodyAscii(record.documentId, `${path}.documentId`, 128),
      };
    }
    case "comment": {
      const record = parseSubjectRecord(
        value,
        path,
        ["kind", "commentId", "collection", "documentId"],
        state,
      );
      return {
        kind: "comment",
        commentId: canonicalBodyAscii(record.commentId, `${path}.commentId`, 128),
        collection: canonicalBodyIdentifier(record.collection, `${path}.collection`, 96),
        documentId: canonicalBodyAscii(record.documentId, `${path}.documentId`, 128),
      };
    }
    case "member": {
      const record = parseSubjectRecord(value, path, ["kind", "memberId"], state);
      return { kind: "member", memberId: canonicalBodyUuid(record.memberId, `${path}.memberId`) };
    }
    case "staff": {
      const record = parseSubjectRecord(value, path, ["kind", "userId"], state);
      return { kind: "staff", userId: canonicalBodyUuid(record.userId, `${path}.userId`) };
    }
    case "session": {
      const record = parseSubjectRecord(
        value,
        path,
        ["kind", "actorKind", "sessionFamilyId"],
        state,
      );
      return {
        kind: "session",
        actorKind: canonicalBodyEnum(
          record.actorKind,
          `${path}.actorKind`,
          new Set(["staff", "member"]),
        ),
        sessionFamilyId: canonicalBodyUuid(record.sessionFamilyId, `${path}.sessionFamilyId`),
      };
    }
    case "actor-bucket": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", ...npAgentActorBucketIncludedKeysV1],
        ["kind", ...npAgentActorBucketIncludedKeysV1],
        state,
      );
      const bucket = parseActorBucket(
        {
          purpose: record.purpose,
          projectionVersion: record.projectionVersion,
          projectionFingerprint: record.projectionFingerprint,
          keyId: record.keyId,
          bucket: record.bucket,
        },
        path,
        { seen: new WeakSet<object>() },
      );
      return { kind: "actor-bucket", ...bucket };
    }
    case "job": {
      const record = parseSubjectRecord(value, path, ["kind", "jobName", "jobId"], state);
      return {
        kind: "job",
        jobName: canonicalBodyIdentifier(record.jobName, `${path}.jobName`, 96),
        jobId: canonicalBodyAscii(record.jobId, `${path}.jobId`, 128),
      };
    }
    case "plugin": {
      const record = parseSubjectRecord(value, path, ["kind", "pluginId"], state);
      return {
        kind: "plugin",
        pluginId: canonicalBodyIdentifier(record.pluginId, `${path}.pluginId`, 96),
      };
    }
    case "connection": {
      const record = parseSubjectRecord(value, path, ["kind", "connectionId"], state);
      return {
        kind: "connection",
        connectionId: canonicalBodyUuid(record.connectionId, `${path}.connectionId`),
      };
    }
    case "agent": {
      const record = parseSubjectRecord(value, path, ["kind", "agentId", "agentVersionId"], state);
      return {
        kind: "agent",
        agentId: canonicalBodyUuid(record.agentId, `${path}.agentId`),
        agentVersionId:
          record.agentVersionId === null
            ? null
            : canonicalBodyUuid(record.agentVersionId, `${path}.agentVersionId`),
      };
    }
    case "site": {
      const record = parseSubjectRecord(value, path, ["kind", "siteId"], state);
      return { kind: "site", siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`) };
    }
    default:
      failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported Agent subject kind");
  }
}

export function parseAgentActorProjection(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentActorProjection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact Agent actor projection branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "anonymous") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", ...npAgentActorBucketIncludedKeysV1],
      ["kind", ...npAgentActorBucketIncludedKeysV1],
      state,
    );
    const bucket = parseActorBucket(
      {
        purpose: record.purpose,
        projectionVersion: record.projectionVersion,
        projectionFingerprint: record.projectionFingerprint,
        keyId: record.keyId,
        bucket: record.bucket,
      },
      path,
      { seen: new WeakSet<object>() },
    );
    return { kind: "anonymous", ...bucket };
  }
  const branch =
    kind === "staff"
      ? (["kind", "userId"] as const)
      : kind === "member"
        ? (["kind", "memberId"] as const)
        : kind === "agent-principal"
          ? (["kind", "principalId"] as const)
          : kind === "system"
            ? (["kind", "component"] as const)
            : null;
  if (branch === null) {
    failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported actor projection kind");
  }
  const record = canonicalBodyRecord(value, path, branch, branch, state);
  if (kind === "staff") {
    return { kind, userId: canonicalBodyUuid(record.userId, `${path}.userId`) };
  }
  if (kind === "member") {
    return { kind, memberId: canonicalBodyUuid(record.memberId, `${path}.memberId`) };
  }
  if (kind === "agent-principal") {
    return { kind, principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`) };
  }
  return {
    kind: "system",
    component: canonicalBodyIdentifier(record.component, `${path}.component`, 96),
  };
}

function parseActorTargetSubject(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentActorSubjectV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact actor target subject");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "actor-bucket") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", ...npAgentActorBucketIncludedKeysV1],
      ["kind", ...npAgentActorBucketIncludedKeysV1],
      state,
    );
    const bucket = parseActorBucket(
      {
        purpose: record.purpose,
        projectionVersion: record.projectionVersion,
        projectionFingerprint: record.projectionFingerprint,
        keyId: record.keyId,
        bucket: record.bucket,
      },
      path,
      { seen: new WeakSet<object>() },
    );
    return { kind: "actor-bucket", ...bucket };
  }
  const record = canonicalBodyRecord(
    value,
    path,
    ["kind", "principalKind", "principalId"],
    ["kind", "principalKind", "principalId"],
    state,
  );
  if (record.kind !== "principal") {
    failCanonicalBody("invalid-field", `${path}.kind`, "must be principal or actor-bucket");
  }
  return {
    kind: "principal",
    principalKind: canonicalBodyEnum(
      record.principalKind,
      `${path}.principalKind`,
      new Set(["staff", "member", "agent-gateway"]),
    ),
    principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`),
  };
}

export function parseAgentTargetRef(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentTargetRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact Agent target reference");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  switch (kind) {
    case "document": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "collection", "documentId"],
        ["kind", "collection", "documentId"],
        state,
      );
      return {
        kind,
        collection: canonicalBodyIdentifier(record.collection, `${path}.collection`, 96),
        documentId: canonicalBodyAscii(record.documentId, `${path}.documentId`, 128),
      };
    }
    case "media": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "mediaId"],
        ["kind", "mediaId"],
        state,
      );
      return { kind, mediaId: canonicalBodyUuid(record.mediaId, `${path}.mediaId`) };
    }
    case "navigation": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "location"],
        ["kind", "location"],
        state,
      );
      return { kind, location: canonicalBodyIdentifier(record.location, `${path}.location`, 96) };
    }
    case "theme_tokens": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "themeId"],
        ["kind", "themeId"],
        state,
      );
      return { kind, themeId: canonicalBodyIdentifier(record.themeId, `${path}.themeId`, 96) };
    }
    case "setting": {
      const record = canonicalBodyRecord(value, path, ["kind", "key"], ["kind", "key"], state);
      return { kind, key: canonicalBodyIdentifier(record.key, `${path}.key`, 96) };
    }
    case "actor": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "subject"],
        ["kind", "subject"],
        state,
      );
      return { kind, subject: parseActorTargetSubject(record.subject, `${path}.subject`, state) };
    }
    case "incident": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "incidentId"],
        ["kind", "incidentId"],
        state,
      );
      return { kind, incidentId: canonicalBodyUuid(record.incidentId, `${path}.incidentId`) };
    }
    case "ops": {
      const record = canonicalBodyRecord(
        value,
        path,
        ["kind", "action"],
        ["kind", "action"],
        state,
      );
      return {
        kind,
        action: canonicalBodyEnum<NpAgentOpsPlanActionId>(
          record.action,
          `${path}.action`,
          OPS_ACTION_IDS,
        ),
      };
    }
    default:
      failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported Agent target kind");
  }
}

export function parseSortedScopes(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentScope[] {
  return parseSortedUniqueEnumArray(value, path, SCOPES, npAgentScopes.length, state);
}

export function parseCapabilityRisk(value: unknown, path: string): NpAgentCapabilityRisk {
  return canonicalBodyEnum(value, path, CAPABILITY_RISKS);
}

export function parseCapabilityId(value: unknown, path: string): NpAgentCapabilityId {
  return canonicalBodyEnum(value, path, CAPABILITY_IDS);
}

export function parseIncidentCategory(value: unknown, path: string): NpAgentIncidentCategory {
  return canonicalBodyEnum(value, path, INCIDENT_CATEGORIES);
}

export function parseIncidentSeverity(value: unknown, path: string): NpAgentIncidentSeverity {
  return canonicalBodyEnum(value, path, INCIDENT_SEVERITIES);
}

export function parseProviderDataClass(value: unknown, path: string): NpAgentProviderDataClass {
  return canonicalBodyEnum(value, path, PROVIDER_DATA_CLASSES);
}

export function parseSortedUniqueEnumArray<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  maximum: number,
  state: CanonicalBodyInspectionState,
  minimum = 0,
): T[] {
  const entries = canonicalBodyArray(value, path, maximum, state);
  if (entries.length < minimum) {
    failCanonicalBody("invalid-field", path, `must contain at least ${minimum.toString()} entry`);
  }
  const result: T[] = [];
  let previous: string | undefined;
  entries.forEach((entry, index) => {
    const current = canonicalBodyEnum<T>(entry, `${path}[${index.toString()}]`, allowed);
    if (previous !== undefined && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical value",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

export function parseSortedUniqueStrings(
  value: unknown,
  path: string,
  maximumEntries: number,
  maximumCharacters: number,
  state: CanonicalBodyInspectionState,
  options: { identifier?: boolean; minimum?: number } = {},
): string[] {
  const entries = canonicalBodyArray(value, path, maximumEntries, state);
  if (entries.length < (options.minimum ?? 0)) {
    failCanonicalBody("invalid-field", path, "must contain the required minimum entries");
  }
  const result: string[] = [];
  let previous: string | undefined;
  entries.forEach((entry, index) => {
    const current = options.identifier
      ? canonicalBodyIdentifier(entry, `${path}[${index.toString()}]`, maximumCharacters)
      : canonicalBodyAscii(entry, `${path}[${index.toString()}]`, maximumCharacters);
    if (previous !== undefined && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by canonical value",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

export const npAgentModelPricingIncludedKeysV1 = [
  "schemaVersion",
  "pricingId",
  "version",
  "fingerprint",
  "modelId",
  "currency",
  "unitTokens",
  "inputMicrosPerUnit",
  "cachedInputMicrosPerUnit",
  "outputMicrosPerUnit",
  "minimumRequestMicros",
  "rounding",
  "effectiveFrom",
  "effectiveUntil",
] as const satisfies readonly (keyof NpAgentModelPricingV1)[];

export function parseAgentModelPricing(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentModelPricingV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentModelPricingIncludedKeysV1,
    npAgentModelPricingIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== "np.agent-model-pricing.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-model-pricing.v1",
    );
  }
  if (
    record.currency !== "USD" ||
    record.unitTokens !== 1_000_000 ||
    record.rounding !== "ceil-each-component"
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must use the exact v1 USD pricing units and rounding",
    );
  }
  if (
    typeof record.fingerprint !== "string" ||
    !PRICING_FINGERPRINT_PATTERN.test(record.fingerprint)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.fingerprint`,
      "must be a canonical pr1 fingerprint",
    );
  }
  const result: NpAgentModelPricingV1 = {
    schemaVersion: "np.agent-model-pricing.v1",
    pricingId: canonicalBodyIdentifier(record.pricingId, `${path}.pricingId`, 128),
    version: canonicalBodyInteger(record.version, `${path}.version`, 1, SIGNED_32_BIT_MAXIMUM),
    fingerprint: record.fingerprint,
    modelId: canonicalBodyAscii(record.modelId, `${path}.modelId`, 128),
    currency: "USD",
    unitTokens: 1_000_000,
    inputMicrosPerUnit: canonicalBodyInteger(
      record.inputMicrosPerUnit,
      `${path}.inputMicrosPerUnit`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    cachedInputMicrosPerUnit: canonicalBodyInteger(
      record.cachedInputMicrosPerUnit,
      `${path}.cachedInputMicrosPerUnit`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    outputMicrosPerUnit: canonicalBodyInteger(
      record.outputMicrosPerUnit,
      `${path}.outputMicrosPerUnit`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    minimumRequestMicros: canonicalBodyInteger(
      record.minimumRequestMicros,
      `${path}.minimumRequestMicros`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    rounding: "ceil-each-component",
    effectiveFrom: canonicalBodyUtc(record.effectiveFrom, `${path}.effectiveFrom`),
    effectiveUntil:
      record.effectiveUntil === null
        ? null
        : canonicalBodyUtc(record.effectiveUntil, `${path}.effectiveUntil`),
  };
  if (result.cachedInputMicrosPerUnit > result.inputMicrosPerUnit) {
    failCanonicalBody(
      "invalid-field",
      `${path}.cachedInputMicrosPerUnit`,
      "must not exceed input pricing",
    );
  }
  if (result.effectiveUntil !== null && result.effectiveUntil <= result.effectiveFrom) {
    failCanonicalBody(
      "invalid-field",
      `${path}.effectiveUntil`,
      "must be later than effectiveFrom",
    );
  }
  return result;
}

export function compareCanonicalJson(left: unknown, right: unknown): number {
  const leftJson = serializeAgentCanonicalJson(left);
  const rightJson = serializeAgentCanonicalJson(right);
  return leftJson === rightJson ? 0 : leftJson < rightJson ? -1 : 1;
}

export function parseNullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : canonicalBodyUuid(value, path);
}

export function parseNullableStableCode(value: unknown, path: string): string | null {
  return value === null ? null : canonicalRuntimeStableCode(value, path);
}

export function parseNullableAscii(value: unknown, path: string, maximum: number): string | null {
  return value === null ? null : canonicalBodyAscii(value, path, maximum);
}

export function parseCanonicalSiteId(value: unknown, path: string): string {
  return canonicalBodySiteId(value, path);
}

export function parseCanonicalUuid(value: unknown, path: string): string {
  return canonicalBodyUuid(value, path);
}

export function parseCanonicalIdentifier(value: unknown, path: string, maximum = 128): string {
  return canonicalBodyIdentifier(value, path, maximum);
}

export function parseCanonicalAscii(value: unknown, path: string, maximum = 128): string {
  return canonicalBodyAscii(value, path, maximum);
}

export function parseCanonicalInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  return canonicalBodyInteger(value, path, minimum, maximum);
}

export function parseCanonicalUtc(value: unknown, path: string): string {
  return canonicalBodyUtc(value, path);
}

export function parseCanonicalSha256(value: unknown, path: string): string {
  return canonicalBodySha256Digest(value, path);
}

export function parseCanonicalCapabilityId(value: unknown, path: string): NpAgentCapabilityId {
  return canonicalBodyCapabilityId(value, path);
}
