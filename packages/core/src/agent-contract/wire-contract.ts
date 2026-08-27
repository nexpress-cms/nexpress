import { npAnalyzeAgentGatewaySettings, npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { npAnalyzeAgentRunLimitsCanonical } from "./canonical-bodies.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  SIGNED_32_BIT_MAXIMUM,
  canonicalRuntimeStableCode,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  compareCanonicalJson,
  parseAgentTargetRef,
  parseCanonicalCapabilityId,
  parseCanonicalIdentifier,
  parseCanonicalJsonObject,
  parseCanonicalSha256,
  parseCanonicalSiteId,
  parseCanonicalUtc,
  parseCanonicalUuid,
  parseCapabilityRisk,
  parseProviderDataClass,
  parseSortedScopes,
  requireNestedCanonicalResult,
} from "./canonical-runtime-primitives.js";
import {
  npAgentActionStates,
  npAgentAutonomyModes,
  npAgentCausalDepthMaximumV1,
  npAgentRunStates,
  type NpAgentActionState,
  type NpAgentAutonomyMode,
  type NpAgentCapabilityId,
  type NpAgentCapabilityRisk,
  type NpAgentConnectionKind,
  type NpAgentContractResult,
  type NpAgentEnabledGatewayExposureMode,
  type NpAgentGatewaySettingsV1,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
  type NpAgentProviderDataClass,
  type NpAgentRunLimitsV1,
  type NpAgentRunState,
  type NpAgentScope,
  type NpAgentTargetRef,
} from "./types.js";

const SAFE_INTEGER_MAXIMUM = Number.MAX_SAFE_INTEGER;
const WIRE_BODY_MAXIMUM_BYTES = 512 * 1024;
const SMALL_WIRE_BODY_MAXIMUM_BYTES = 64 * 1024;
const CONNECTION_CONFIG_MAXIMUM_BYTES = 256 * 1024;
const PAGE_MAXIMUM_ITEMS = 100;
const CURSOR_MAXIMUM_BYTES = 2_048;
const ACTION_TARGET_MAXIMUM = 100;
const ENABLED_EXPOSURES = new Set<string>(["read", "propose", "approved-execute"]);
const PRINCIPAL_KINDS = new Set<string>(["runtime", "external"]);
const PRINCIPAL_STATUSES = new Set<string>(["active", "suspended", "revoked"]);
const CONNECTION_KINDS = new Set<string>(["model", "notification"]);
const CONNECTION_AUTH_KINDS = new Set<string>(["api_key", "oauth"]);
const CONNECTION_STATUSES = new Set<string>(["pending", "ready", "error", "disabled", "revoked"]);
const RUN_ORIGINS = new Set<string>(["gateway", "runtime"]);
const RUN_STATES = new Set<string>(npAgentRunStates);
const ACTION_STATES = new Set<string>(npAgentActionStates);
const AUTONOMY_MODES = new Set<string>(npAgentAutonomyModes);
const VERIFICATION_STATES = new Set<string>(["pending", "passed", "failed", "ambiguous"]);
const PRICING_CATALOG_FINGERPRINT_PATTERN = /^pc1:sha256:[A-Za-z0-9_-]{43}$/u;
const SAFE_CONFIG_FORBIDDEN_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorizationheader",
  "clientsecret",
  "cookie",
  "credential",
  "password",
  "privatekey",
  "refreshtoken",
  "secretref",
  "signedurl",
  "tokenhash",
]);

export const npAgentPrincipalKindsV1 = ["runtime", "external"] as const;
export type NpAgentPrincipalKindV1 = (typeof npAgentPrincipalKindsV1)[number];

export const npAgentPrincipalStatusesV1 = ["active", "suspended", "revoked"] as const;
export type NpAgentPrincipalStatusV1 = (typeof npAgentPrincipalStatusesV1)[number];

export type NpAgentPrincipalAuthorityV1 =
  | {
      kind: "user";
      userId: string | null;
      fingerprint: string;
      deletedAt: string | null;
    }
  | {
      kind: "deployment";
      policyId: string;
      fingerprint: string;
    };

/** Browser-safe identity projection. Credential, grant and token ids are deliberately absent. */
export interface NpAgentPrincipalV1 {
  schemaVersion: "np.agent-principal.v1";
  id: string;
  siteId: string;
  kind: NpAgentPrincipalKindV1;
  name: string;
  description: string | null;
  status: NpAgentPrincipalStatusV1;
  scopes: NpAgentScope[];
  authority: NpAgentPrincipalAuthorityV1;
  tokenVersion: number;
  autonomy: NpAgentAutonomyMode | null;
  gatewayExposureCeiling: NpAgentEnabledGatewayExposureMode | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export const npAgentPrincipalWireExcludedKeysV1 = [
  "credentialId",
  "oauthGrantId",
  "clientId",
  "serviceTokenId",
  "tokenHash",
  "refreshFamilyId",
] as const;

export interface NpAgentBudgetV1 {
  schemaVersion: "np.agent-budget.v1";
  costCurrency: "USD";
  maxConcurrentRuns: number | null;
  maxConcurrentProviderCalls: number | null;
  runsPerHour: number | null;
  providerCallsPerHour: number | null;
  providerCallsPerRun: number | null;
  inputTokensPerRun: number | null;
  outputTokensPerRun: number | null;
  inputTokensPerDay: number | null;
  outputTokensPerDay: number | null;
  inputTokensPerMonth: number | null;
  outputTokensPerMonth: number | null;
  costMicrosPerDay: number | null;
  costMicrosPerMonth: number | null;
  attemptsPerRun: number | null;
  capabilityCallsPerRun: number | null;
  incidentAnalysesPerFingerprintPerDay: number | null;
  incidentAnalysisCooldownSeconds: number | null;
  directActionsPerHour: number | null;
  directActionsPerSubjectPerHour: number | null;
  warningBasisPoints: number;
}

export const npAgentConnectionStatusesV1 = [
  "pending",
  "ready",
  "error",
  "disabled",
  "revoked",
] as const;
export type NpAgentConnectionStatusV1 = (typeof npAgentConnectionStatusesV1)[number];

export type NpAgentConnectionCredentialProjectionV1 =
  { state: "absent" } | { state: "stored"; version: number };

export interface NpAgentConnectionVerificationV1 {
  verifiedAt: string;
  configVersion: number;
  credentialVersion: number;
  resultDigest: string;
}

/** Browser-safe connection projection. Vault locators and subject/destination digests are absent. */
export interface NpAgentConnectionV1 {
  schemaVersion: "np.agent-connection.v1";
  id: string;
  siteId: string;
  kind: NpAgentConnectionKind;
  provider: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  name: string;
  authKind: "api_key" | "oauth";
  safeConfig: NpAgentJsonObject;
  configVersion: number;
  configHash: string;
  pricingCatalogFingerprint: string;
  dataProcessingCeiling: NpAgentProviderDataClass;
  status: NpAgentConnectionStatusV1;
  credential: NpAgentConnectionCredentialProjectionV1;
  verification: NpAgentConnectionVerificationV1 | null;
  lastErrorCode: string | null;
  dependentAgentCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const npAgentConnectionWireExcludedKeysV1 = [
  "activeSecretVersionId",
  "activeConfigSnapshotId",
  "activeAccountSubjectKeyId",
  "activeAccountSubjectDigest",
  "activeDestinationKeyId",
  "activeDestinationDescriptor",
  "activeDestinationFingerprint",
  "secretRef",
  "credentialMaterial",
  "accessToken",
  "refreshToken",
  "apiKey",
] as const;

export interface NpAgentRunUsageV1 {
  providerCalls: number;
  capabilityCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface NpAgentRunV1 {
  schemaVersion: "np.agent-run.v1";
  id: string;
  siteId: string;
  origin: "gateway" | "runtime";
  agent: { id: string; versionId: string } | null;
  principalId: string;
  rootRunId: string;
  parentRunId: string | null;
  causalDepth: number;
  state: NpAgentRunState;
  goal: string;
  runLimits: NpAgentRunLimitsV1;
  usage: NpAgentRunUsageV1;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  deadlineAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type NpAgentActionVerificationStateV1 = "pending" | "passed" | "failed" | "ambiguous";

/** Safe activity projection. Full canonical input and opaque undo material are absent. */
export interface NpAgentActionProjectionV1 {
  schemaVersion: "np.agent-action-projection.v1";
  id: string;
  siteId: string;
  runId: string | null;
  sequence: number;
  capabilityId: NpAgentCapabilityId;
  capabilityContractVersion: number;
  capabilityFingerprint: string;
  effectProfile: { id: string; contractVersion: number };
  risk: NpAgentCapabilityRisk;
  state: NpAgentActionState;
  inputRedacted: NpAgentJsonObject;
  outputRedacted: NpAgentJsonObject | null;
  requiredScopes: NpAgentScope[];
  targetRefs: NpAgentTargetRef[];
  proposalHash: string;
  approvalId: string | null;
  verificationState: NpAgentActionVerificationStateV1 | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const npAgentActionProjectionExcludedKeysV1 = [
  "inputCanonical",
  "capabilityDefinitionBody",
  "undoRef",
  "verificationEvidence",
  "compensationEvidence",
] as const;

export interface NpAgentCursorPageV1<T, S extends string = string> {
  schemaVersion: S;
  items: T[];
  nextCursor: string | null;
}

export interface NpAgentBudgetAnalyzerOptionsV1 {
  requireConcrete?: boolean;
}

export interface NpAgentCursorPageAnalyzerOptionsV1<T, S extends string> {
  schemaVersion: S;
  analyzeItem: (value: unknown) => NpAgentContractResult<T>;
  itemIssueRoot: string;
  maximumItems?: number;
  maximumBytes?: number;
}

function parseNullableInteger(
  value: unknown,
  path: string,
  maximum: number,
  requireConcrete: boolean,
): number | null {
  if (value === null) {
    if (requireConcrete) {
      failCanonicalBody("invalid-field", path, "must be concrete at the deployment layer");
    }
    return null;
  }
  return canonicalBodyInteger(value, path, 0, maximum);
}

function compareUtc(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function inspectSafeProjection(value: NpAgentJsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectSafeProjection(entry, `${path}[${index.toString()}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_.]/gu, "").toLowerCase();
    if (SAFE_CONFIG_FORBIDDEN_KEYS.has(normalized)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "must not expose credential material");
    }
    inspectSafeProjection(entry, `${path}.${key}`);
  }
}

function parseAuthority(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentPrincipalAuthorityV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact principal authority branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  if (kind === "user") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "userId", "fingerprint", "deletedAt"],
      ["kind", "userId", "fingerprint", "deletedAt"],
      state,
    );
    const userId =
      record.userId === null ? null : parseCanonicalUuid(record.userId, `${path}.userId`);
    const deletedAt =
      record.deletedAt === null ? null : parseCanonicalUtc(record.deletedAt, `${path}.deletedAt`);
    if ((userId === null) !== (deletedAt !== null)) {
      failCanonicalBody(
        "invalid-field",
        path,
        "must retain either one live user reference or one deleted-authority tombstone",
      );
    }
    return {
      kind,
      userId,
      fingerprint: parseCanonicalSha256(record.fingerprint, `${path}.fingerprint`),
      deletedAt,
    };
  }
  if (kind === "deployment") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["kind", "policyId", "fingerprint"],
      ["kind", "policyId", "fingerprint"],
      state,
    );
    return {
      kind,
      policyId: parseCanonicalIdentifier(record.policyId, `${path}.policyId`),
      fingerprint: parseCanonicalSha256(record.fingerprint, `${path}.fingerprint`),
    };
  }
  failCanonicalBody("invalid-field", `${path}.kind`, "must be user or deployment");
}

function parsePrincipal(value: unknown): NpAgentPrincipalV1 {
  const path = "agent.wire.principal";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, SMALL_WIRE_BODY_MAXIMUM_BYTES, { maximumDepth: 8 }),
    path,
    [
      "schemaVersion",
      "id",
      "siteId",
      "kind",
      "name",
      "description",
      "status",
      "scopes",
      "authority",
      "tokenVersion",
      "autonomy",
      "gatewayExposureCeiling",
      "createdAt",
      "updatedAt",
      "revokedAt",
    ],
    [
      "schemaVersion",
      "id",
      "siteId",
      "kind",
      "name",
      "description",
      "status",
      "scopes",
      "authority",
      "tokenVersion",
      "autonomy",
      "gatewayExposureCeiling",
      "createdAt",
      "updatedAt",
      "revokedAt",
    ],
    state,
  );
  if (record.schemaVersion !== "np.agent-principal.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-principal.v1");
  }
  const kind = canonicalBodyEnum<NpAgentPrincipalKindV1>(
    record.kind,
    `${path}.kind`,
    PRINCIPAL_KINDS,
  );
  const status = canonicalBodyEnum<NpAgentPrincipalStatusV1>(
    record.status,
    `${path}.status`,
    PRINCIPAL_STATUSES,
  );
  const scopes = parseSortedScopes(record.scopes, `${path}.scopes`, state);
  const authority = parseAuthority(record.authority, `${path}.authority`, state);
  const autonomy =
    record.autonomy === null
      ? null
      : canonicalBodyEnum<NpAgentAutonomyMode>(record.autonomy, `${path}.autonomy`, AUTONOMY_MODES);
  const gatewayExposureCeiling =
    record.gatewayExposureCeiling === null
      ? null
      : canonicalBodyEnum<NpAgentEnabledGatewayExposureMode>(
          record.gatewayExposureCeiling,
          `${path}.gatewayExposureCeiling`,
          ENABLED_EXPOSURES,
        );
  if (kind === "runtime" && (autonomy === null || gatewayExposureCeiling !== null)) {
    failCanonicalBody(
      "invalid-field",
      path,
      "runtime principals require autonomy and forbid an external gateway ceiling",
    );
  }
  if (kind === "external" && (autonomy !== null || gatewayExposureCeiling === null)) {
    failCanonicalBody(
      "invalid-field",
      path,
      "external principals require a gateway ceiling and forbid runtime autonomy",
    );
  }
  if (status === "active" && !scopes.includes("site:read")) {
    failCanonicalBody("invalid-field", `${path}.scopes`, "active principals require site:read");
  }
  if (status === "active" && authority.kind === "user" && authority.userId === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.authority.userId`,
      "active principals require a live user authority",
    );
  }
  const createdAt = parseCanonicalUtc(record.createdAt, `${path}.createdAt`);
  const updatedAt = parseCanonicalUtc(record.updatedAt, `${path}.updatedAt`);
  const revokedAt =
    record.revokedAt === null ? null : parseCanonicalUtc(record.revokedAt, `${path}.revokedAt`);
  if ((status === "revoked") !== (revokedAt !== null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.revokedAt`,
      "must be present only for revoked principals",
    );
  }
  if (
    compareUtc(updatedAt, createdAt) < 0 ||
    (revokedAt !== null &&
      (compareUtc(revokedAt, createdAt) < 0 || compareUtc(updatedAt, revokedAt) < 0)) ||
    (authority.kind === "user" &&
      authority.deletedAt !== null &&
      (compareUtc(authority.deletedAt, createdAt) < 0 ||
        compareUtc(updatedAt, authority.deletedAt) < 0))
  ) {
    failCanonicalBody("invalid-field", path, "timestamps must follow principal creation");
  }
  return {
    schemaVersion: "np.agent-principal.v1",
    id: parseCanonicalUuid(record.id, `${path}.id`),
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    kind,
    name: canonicalRuntimeText(record.name, `${path}.name`, 120, { requireTrimmed: true }),
    description:
      record.description === null
        ? null
        : canonicalRuntimeText(record.description, `${path}.description`, 2_000, {
            requireTrimmed: true,
          }),
    status,
    scopes,
    authority,
    tokenVersion: canonicalBodyInteger(
      record.tokenVersion,
      `${path}.tokenVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    autonomy,
    gatewayExposureCeiling,
    createdAt,
    updatedAt,
    revokedAt,
  };
}

const BUDGET_KEYS = [
  "schemaVersion",
  "costCurrency",
  "maxConcurrentRuns",
  "maxConcurrentProviderCalls",
  "runsPerHour",
  "providerCallsPerHour",
  "providerCallsPerRun",
  "inputTokensPerRun",
  "outputTokensPerRun",
  "inputTokensPerDay",
  "outputTokensPerDay",
  "inputTokensPerMonth",
  "outputTokensPerMonth",
  "costMicrosPerDay",
  "costMicrosPerMonth",
  "attemptsPerRun",
  "capabilityCallsPerRun",
  "incidentAnalysesPerFingerprintPerDay",
  "incidentAnalysisCooldownSeconds",
  "directActionsPerHour",
  "directActionsPerSubjectPerHour",
  "warningBasisPoints",
] as const satisfies readonly (keyof NpAgentBudgetV1)[];

function parseBudget(value: unknown, options: NpAgentBudgetAnalyzerOptionsV1): NpAgentBudgetV1 {
  const path = "agent.wire.budget";
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 16 * 1024, { maximumDepth: 4 }),
    path,
    BUDGET_KEYS,
    BUDGET_KEYS,
    { seen: new WeakSet<object>() },
  );
  if (record.schemaVersion !== "np.agent-budget.v1" || record.costCurrency !== "USD") {
    failCanonicalBody("invalid-field", path, "must use the exact np.agent-budget.v1 USD envelope");
  }
  const concrete = options.requireConcrete === true;
  const count = (key: keyof NpAgentBudgetV1) =>
    parseNullableInteger(record[key], `${path}.${key}`, SIGNED_32_BIT_MAXIMUM, concrete);
  const cost = (key: "costMicrosPerDay" | "costMicrosPerMonth") =>
    parseNullableInteger(record[key], `${path}.${key}`, SAFE_INTEGER_MAXIMUM, concrete);
  return {
    schemaVersion: "np.agent-budget.v1",
    costCurrency: "USD",
    maxConcurrentRuns: count("maxConcurrentRuns"),
    maxConcurrentProviderCalls: count("maxConcurrentProviderCalls"),
    runsPerHour: count("runsPerHour"),
    providerCallsPerHour: count("providerCallsPerHour"),
    providerCallsPerRun: count("providerCallsPerRun"),
    inputTokensPerRun: count("inputTokensPerRun"),
    outputTokensPerRun: count("outputTokensPerRun"),
    inputTokensPerDay: count("inputTokensPerDay"),
    outputTokensPerDay: count("outputTokensPerDay"),
    inputTokensPerMonth: count("inputTokensPerMonth"),
    outputTokensPerMonth: count("outputTokensPerMonth"),
    costMicrosPerDay: cost("costMicrosPerDay"),
    costMicrosPerMonth: cost("costMicrosPerMonth"),
    attemptsPerRun: count("attemptsPerRun"),
    capabilityCallsPerRun: count("capabilityCallsPerRun"),
    incidentAnalysesPerFingerprintPerDay: count("incidentAnalysesPerFingerprintPerDay"),
    incidentAnalysisCooldownSeconds: parseNullableInteger(
      record.incidentAnalysisCooldownSeconds,
      `${path}.incidentAnalysisCooldownSeconds`,
      86_400,
      concrete,
    ),
    directActionsPerHour: count("directActionsPerHour"),
    directActionsPerSubjectPerHour: count("directActionsPerSubjectPerHour"),
    warningBasisPoints: canonicalBodyInteger(
      record.warningBasisPoints,
      `${path}.warningBasisPoints`,
      0,
      10_000,
    ),
  };
}

function parseCredential(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentConnectionCredentialProjectionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact credential projection branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "state")?.value;
  if (kind === "absent") {
    canonicalBodyRecord(value, path, ["state"], ["state"], state);
    return { state: "absent" };
  }
  if (kind === "stored") {
    const record = canonicalBodyRecord(
      value,
      path,
      ["state", "version"],
      ["state", "version"],
      state,
    );
    return {
      state: "stored",
      version: canonicalBodyInteger(record.version, `${path}.version`, 1, SIGNED_32_BIT_MAXIMUM),
    };
  }
  failCanonicalBody("invalid-field", `${path}.state`, "must be absent or stored");
}

function parseVerification(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentConnectionVerificationV1 | null {
  if (value === null) return null;
  const record = canonicalBodyRecord(
    value,
    path,
    ["verifiedAt", "configVersion", "credentialVersion", "resultDigest"],
    ["verifiedAt", "configVersion", "credentialVersion", "resultDigest"],
    state,
  );
  return {
    verifiedAt: parseCanonicalUtc(record.verifiedAt, `${path}.verifiedAt`),
    configVersion: canonicalBodyInteger(
      record.configVersion,
      `${path}.configVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    credentialVersion: canonicalBodyInteger(
      record.credentialVersion,
      `${path}.credentialVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    resultDigest: parseCanonicalSha256(record.resultDigest, `${path}.resultDigest`),
  };
}

function parseConnection(value: unknown): NpAgentConnectionV1 {
  const path = "agent.wire.connection";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const keys = [
    "schemaVersion",
    "id",
    "siteId",
    "kind",
    "provider",
    "adapterId",
    "adapterContractVersion",
    "adapterFingerprint",
    "name",
    "authKind",
    "safeConfig",
    "configVersion",
    "configHash",
    "pricingCatalogFingerprint",
    "dataProcessingCeiling",
    "status",
    "credential",
    "verification",
    "lastErrorCode",
    "dependentAgentCount",
    "createdBy",
    "createdAt",
    "updatedAt",
  ] as const satisfies readonly (keyof NpAgentConnectionV1)[];
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, WIRE_BODY_MAXIMUM_BYTES, { maximumDepth: 16 }),
    path,
    keys,
    keys,
    state,
  );
  if (record.schemaVersion !== "np.agent-connection.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-connection.v1");
  }
  const status = canonicalBodyEnum<NpAgentConnectionStatusV1>(
    record.status,
    `${path}.status`,
    CONNECTION_STATUSES,
  );
  const credential = parseCredential(record.credential, `${path}.credential`, state);
  const verification = parseVerification(record.verification, `${path}.verification`, state);
  const configVersion = canonicalBodyInteger(
    record.configVersion,
    `${path}.configVersion`,
    1,
    SIGNED_32_BIT_MAXIMUM,
  );
  const lastErrorCode =
    record.lastErrorCode === null
      ? null
      : canonicalRuntimeStableCode(record.lastErrorCode, `${path}.lastErrorCode`);
  if ((status === "ready" || status === "disabled") && credential.state !== "stored") {
    failCanonicalBody(
      "invalid-field",
      `${path}.credential`,
      `${status} connections require stored credentials`,
    );
  }
  if ((status === "pending" || status === "revoked") && credential.state !== "absent") {
    failCanonicalBody(
      "invalid-field",
      `${path}.credential`,
      `${status} connections forbid stored credentials`,
    );
  }
  if (status === "error" && lastErrorCode === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.lastErrorCode`,
      "error connections require a safe code",
    );
  }
  if (status !== "error" && lastErrorCode !== null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.lastErrorCode`,
      "is present only for error connections",
    );
  }
  if (status === "ready" || status === "disabled") {
    if (
      verification === null ||
      credential.state !== "stored" ||
      verification.configVersion !== configVersion ||
      verification.credentialVersion !== credential.version
    ) {
      failCanonicalBody(
        "invalid-field",
        `${path}.verification`,
        `${status} connections require the exact current successful probe tuple`,
      );
    }
  }
  if (status === "pending" && verification !== null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.verification`,
      "pending connections forbid verification",
    );
  }
  if (status === "error") {
    if (
      (credential.state === "absent" && verification !== null) ||
      (credential.state === "stored" &&
        (verification === null ||
          verification.configVersion !== configVersion ||
          verification.credentialVersion !== credential.version))
    ) {
      failCanonicalBody(
        "invalid-field",
        `${path}.verification`,
        "error connections must retain the exact probe tuple only with stored credentials",
      );
    }
  }
  const safeConfig = parseCanonicalJsonObject(record.safeConfig, `${path}.safeConfig`);
  const configBytes = new TextEncoder().encode(serializeAgentCanonicalJson(safeConfig)).byteLength;
  if (configBytes > CONNECTION_CONFIG_MAXIMUM_BYTES) {
    failCanonicalBody("limit", `${path}.safeConfig`, "exceeds the non-secret config byte limit");
  }
  inspectSafeProjection(safeConfig, `${path}.safeConfig`);
  if (
    typeof record.pricingCatalogFingerprint !== "string" ||
    !PRICING_CATALOG_FINGERPRINT_PATTERN.test(record.pricingCatalogFingerprint)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.pricingCatalogFingerprint`,
      "must be a canonical pc1 catalog fingerprint",
    );
  }
  const createdAt = parseCanonicalUtc(record.createdAt, `${path}.createdAt`);
  const updatedAt = parseCanonicalUtc(record.updatedAt, `${path}.updatedAt`);
  if (compareUtc(updatedAt, createdAt) < 0) {
    failCanonicalBody("invalid-field", `${path}.updatedAt`, "must not precede creation");
  }
  if (
    verification !== null &&
    (compareUtc(verification.verifiedAt, createdAt) < 0 ||
      compareUtc(updatedAt, verification.verifiedAt) < 0)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.verification.verifiedAt`,
      "must be within the connection lifetime",
    );
  }
  return {
    schemaVersion: "np.agent-connection.v1",
    id: parseCanonicalUuid(record.id, `${path}.id`),
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    kind: canonicalBodyEnum<NpAgentConnectionKind>(record.kind, `${path}.kind`, CONNECTION_KINDS),
    provider: parseCanonicalIdentifier(record.provider, `${path}.provider`),
    adapterId: parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`),
    adapterContractVersion: canonicalBodyInteger(
      record.adapterContractVersion,
      `${path}.adapterContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    adapterFingerprint: parseCanonicalSha256(
      record.adapterFingerprint,
      `${path}.adapterFingerprint`,
    ),
    name: canonicalRuntimeText(record.name, `${path}.name`, 120, { requireTrimmed: true }),
    authKind: canonicalBodyEnum(record.authKind, `${path}.authKind`, CONNECTION_AUTH_KINDS),
    safeConfig,
    configVersion,
    configHash: parseCanonicalSha256(record.configHash, `${path}.configHash`),
    pricingCatalogFingerprint: record.pricingCatalogFingerprint,
    dataProcessingCeiling: parseProviderDataClass(
      record.dataProcessingCeiling,
      `${path}.dataProcessingCeiling`,
    ),
    status,
    credential,
    verification,
    lastErrorCode,
    dependentAgentCount: canonicalBodyInteger(
      record.dependentAgentCount,
      `${path}.dependentAgentCount`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    createdBy:
      record.createdBy === null ? null : parseCanonicalUuid(record.createdBy, `${path}.createdBy`),
    createdAt,
    updatedAt,
  };
}

function parseRunAgent(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunV1["agent"] {
  if (value === null) return null;
  const record = canonicalBodyRecord(value, path, ["id", "versionId"], ["id", "versionId"], state);
  return {
    id: parseCanonicalUuid(record.id, `${path}.id`),
    versionId: parseCanonicalUuid(record.versionId, `${path}.versionId`),
  };
}

function parseRunUsage(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunUsageV1 {
  const keys = [
    "providerCalls",
    "capabilityCalls",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "costMicros",
  ] as const satisfies readonly (keyof NpAgentRunUsageV1)[];
  const record = canonicalBodyRecord(value, path, keys, keys, state);
  const result: NpAgentRunUsageV1 = {
    providerCalls: canonicalBodyInteger(
      record.providerCalls,
      `${path}.providerCalls`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    capabilityCalls: canonicalBodyInteger(
      record.capabilityCalls,
      `${path}.capabilityCalls`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    inputTokens: canonicalBodyInteger(
      record.inputTokens,
      `${path}.inputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    cachedInputTokens: canonicalBodyInteger(
      record.cachedInputTokens,
      `${path}.cachedInputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    outputTokens: canonicalBodyInteger(
      record.outputTokens,
      `${path}.outputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    costMicros: canonicalBodyInteger(
      record.costMicros,
      `${path}.costMicros`,
      0,
      SAFE_INTEGER_MAXIMUM,
    ),
  };
  if (result.cachedInputTokens > result.inputTokens) {
    failCanonicalBody("invalid-field", `${path}.cachedInputTokens`, "must not exceed input tokens");
  }
  return result;
}

function parseNullableSafeErrorMessage(value: unknown, path: string): string | null {
  return value === null ? null : canonicalRuntimeText(value, path, 2_000, { requireTrimmed: true });
}

function parseRun(value: unknown): NpAgentRunV1 {
  const path = "agent.wire.run";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const keys = [
    "schemaVersion",
    "id",
    "siteId",
    "origin",
    "agent",
    "principalId",
    "rootRunId",
    "parentRunId",
    "causalDepth",
    "state",
    "goal",
    "runLimits",
    "usage",
    "attempt",
    "errorCode",
    "errorMessage",
    "queuedAt",
    "deadlineAt",
    "startedAt",
    "finishedAt",
  ] as const satisfies readonly (keyof NpAgentRunV1)[];
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, SMALL_WIRE_BODY_MAXIMUM_BYTES, { maximumDepth: 8 }),
    path,
    keys,
    keys,
    state,
  );
  if (record.schemaVersion !== "np.agent-run.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-run.v1");
  }
  const origin = canonicalBodyEnum<"gateway" | "runtime">(
    record.origin,
    `${path}.origin`,
    RUN_ORIGINS,
  );
  const agent = parseRunAgent(record.agent, `${path}.agent`, state);
  if ((origin === "runtime") !== (agent !== null)) {
    failCanonicalBody("invalid-field", `${path}.agent`, "must be present only for runtime runs");
  }
  const runState = canonicalBodyEnum<NpAgentRunState>(record.state, `${path}.state`, RUN_STATES);
  const errorCode =
    record.errorCode === null
      ? null
      : canonicalRuntimeStableCode(record.errorCode, `${path}.errorCode`);
  const errorMessage = parseNullableSafeErrorMessage(record.errorMessage, `${path}.errorMessage`);
  if ((errorCode === null) !== (errorMessage === null)) {
    failCanonicalBody("invalid-field", path, "error code and message must be paired");
  }
  if (["failed", "policy_blocked", "budget_blocked"].includes(runState) && errorCode === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.errorCode`,
      `${runState} runs require a safe error`,
    );
  }
  if (runState === "succeeded" && errorCode !== null) {
    failCanonicalBody("invalid-field", `${path}.errorCode`, "succeeded runs forbid errors");
  }
  const queuedAt = parseCanonicalUtc(record.queuedAt, `${path}.queuedAt`);
  const deadlineAt = parseCanonicalUtc(record.deadlineAt, `${path}.deadlineAt`);
  const startedAt =
    record.startedAt === null ? null : parseCanonicalUtc(record.startedAt, `${path}.startedAt`);
  const finishedAt =
    record.finishedAt === null ? null : parseCanonicalUtc(record.finishedAt, `${path}.finishedAt`);
  const terminal = [
    "succeeded",
    "failed",
    "cancelled",
    "policy_blocked",
    "budget_blocked",
  ].includes(runState);
  if (terminal !== (finishedAt !== null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.finishedAt`,
      "must be present exactly for terminal runs",
    );
  }
  if (runState === "queued" && startedAt !== null) {
    failCanonicalBody("invalid-field", `${path}.startedAt`, "queued runs have not started");
  }
  if (!terminal && runState !== "queued" && startedAt === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.startedAt`,
      `${runState} runs require a start time`,
    );
  }
  if (
    compareUtc(deadlineAt, queuedAt) <= 0 ||
    (startedAt !== null && compareUtc(startedAt, queuedAt) < 0) ||
    (finishedAt !== null && compareUtc(finishedAt, startedAt ?? queuedAt) < 0)
  ) {
    failCanonicalBody("invalid-field", path, "run timestamps must follow queue order");
  }
  const runLimits = requireNestedCanonicalResult(
    npAnalyzeAgentRunLimitsCanonical(record.runLimits),
    "agent.canonical.runLimits",
    `${path}.runLimits`,
  );
  const id = parseCanonicalUuid(record.id, `${path}.id`);
  const rootRunId = parseCanonicalUuid(record.rootRunId, `${path}.rootRunId`);
  const parentRunId =
    record.parentRunId === null
      ? null
      : parseCanonicalUuid(record.parentRunId, `${path}.parentRunId`);
  const causalDepth = canonicalBodyInteger(
    record.causalDepth,
    `${path}.causalDepth`,
    0,
    npAgentCausalDepthMaximumV1,
  );
  if (
    (parentRunId === null && (rootRunId !== id || causalDepth !== 0)) ||
    (parentRunId !== null && (parentRunId === id || rootRunId === id || causalDepth === 0))
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.parentRunId`,
      "must describe either one self-rooted run or one non-self child lineage",
    );
  }
  const usage = parseRunUsage(record.usage, `${path}.usage`, state);
  if (
    usage.providerCalls > runLimits.maxProviderCalls ||
    usage.capabilityCalls > runLimits.maxCapabilityCalls ||
    usage.inputTokens > runLimits.maxInputTokens ||
    usage.outputTokens > runLimits.maxOutputTokens ||
    usage.costMicros > runLimits.maxCostMicros
  ) {
    failCanonicalBody("limit", `${path}.usage`, "must remain within the frozen run limits");
  }
  if (compareUtc(deadlineAt, queuedAt) !== runLimits.maxWallClockSeconds * 1_000) {
    failCanonicalBody(
      "invalid-field",
      `${path}.deadlineAt`,
      "must equal queuedAt plus the frozen wall-clock limit",
    );
  }
  return {
    schemaVersion: "np.agent-run.v1",
    id,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    origin,
    agent,
    principalId: parseCanonicalUuid(record.principalId, `${path}.principalId`),
    rootRunId,
    parentRunId,
    causalDepth,
    state: runState,
    goal: canonicalRuntimeText(record.goal, `${path}.goal`, 2_000, { requireTrimmed: true }),
    runLimits,
    usage,
    attempt: canonicalBodyInteger(record.attempt, `${path}.attempt`, 1, SIGNED_32_BIT_MAXIMUM),
    errorCode,
    errorMessage,
    queuedAt,
    deadlineAt,
    startedAt,
    finishedAt,
  };
}

function parseTargetRefs(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentTargetRef[] {
  const entries = canonicalBodyArray(value, path, ACTION_TARGET_MAXIMUM, state);
  const result: NpAgentTargetRef[] = [];
  let previous: NpAgentTargetRef | undefined;
  entries.forEach((entry, index) => {
    const current = parseAgentTargetRef(entry, `${path}[${index.toString()}]`, state);
    if (previous !== undefined) {
      const order = compareCanonicalJson(current, previous);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          `${path}[${index.toString()}]`,
          "must be sorted unique by canonical target reference",
        );
      }
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseAction(value: unknown): NpAgentActionProjectionV1 {
  const path = "agent.wire.action";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const keys = [
    "schemaVersion",
    "id",
    "siteId",
    "runId",
    "sequence",
    "capabilityId",
    "capabilityContractVersion",
    "capabilityFingerprint",
    "effectProfile",
    "risk",
    "state",
    "inputRedacted",
    "outputRedacted",
    "requiredScopes",
    "targetRefs",
    "proposalHash",
    "approvalId",
    "verificationState",
    "errorCode",
    "createdAt",
    "startedAt",
    "finishedAt",
  ] as const satisfies readonly (keyof NpAgentActionProjectionV1)[];
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, WIRE_BODY_MAXIMUM_BYTES, { maximumDepth: 24 }),
    path,
    keys,
    keys,
    state,
  );
  if (record.schemaVersion !== "np.agent-action-projection.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-action-projection.v1",
    );
  }
  const effect = canonicalBodyRecord(
    record.effectProfile,
    `${path}.effectProfile`,
    ["id", "contractVersion"],
    ["id", "contractVersion"],
    state,
  );
  const actionState = canonicalBodyEnum<NpAgentActionState>(
    record.state,
    `${path}.state`,
    ACTION_STATES,
  );
  const inputRedacted = parseCanonicalJsonObject(record.inputRedacted, `${path}.inputRedacted`);
  const outputRedacted =
    record.outputRedacted === null
      ? null
      : parseCanonicalJsonObject(record.outputRedacted, `${path}.outputRedacted`);
  inspectSafeProjection(inputRedacted, `${path}.inputRedacted`);
  if (outputRedacted !== null) inspectSafeProjection(outputRedacted, `${path}.outputRedacted`);
  const errorCode =
    record.errorCode === null
      ? null
      : canonicalRuntimeStableCode(record.errorCode, `${path}.errorCode`);
  if (["policy_blocked", "failed"].includes(actionState) && errorCode === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.errorCode`,
      `${actionState} actions require a safe code`,
    );
  }
  if (["succeeded", "compensated"].includes(actionState) && errorCode !== null) {
    failCanonicalBody("invalid-field", `${path}.errorCode`, `${actionState} actions forbid errors`);
  }
  if (
    ["proposed", "policy_blocked", "approval_pending", "approved", "executing"].includes(
      actionState,
    ) &&
    outputRedacted !== null
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.outputRedacted`,
      `${actionState} actions have no execution output`,
    );
  }
  if (["succeeded", "compensated"].includes(actionState) && outputRedacted === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.outputRedacted`,
      `${actionState} actions require a safe output projection`,
    );
  }
  if (["approval_pending", "approved"].includes(actionState) && record.approvalId === null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.approvalId`,
      `${actionState} actions require an approval reference`,
    );
  }
  const createdAt = parseCanonicalUtc(record.createdAt, `${path}.createdAt`);
  const startedAt =
    record.startedAt === null ? null : parseCanonicalUtc(record.startedAt, `${path}.startedAt`);
  const finishedAt =
    record.finishedAt === null ? null : parseCanonicalUtc(record.finishedAt, `${path}.finishedAt`);
  const executing = actionState === "executing";
  const executionTerminal = ["succeeded", "failed", "compensated"].includes(actionState);
  if (executing && (startedAt === null || finishedAt !== null)) {
    failCanonicalBody("invalid-field", path, "executing actions require only a start time");
  }
  if (executionTerminal && (startedAt === null || finishedAt === null)) {
    failCanonicalBody(
      "invalid-field",
      path,
      `${actionState} actions require start and finish times`,
    );
  }
  if (!executing && !executionTerminal && (startedAt !== null || finishedAt !== null)) {
    failCanonicalBody("invalid-field", path, `${actionState} actions have not entered execution`);
  }
  if (
    (startedAt !== null && compareUtc(startedAt, createdAt) < 0) ||
    (finishedAt !== null && compareUtc(finishedAt, startedAt ?? createdAt) < 0)
  ) {
    failCanonicalBody("invalid-field", path, "action timestamps must follow creation order");
  }
  const verificationState =
    record.verificationState === null
      ? null
      : canonicalBodyEnum<NpAgentActionVerificationStateV1>(
          record.verificationState,
          `${path}.verificationState`,
          VERIFICATION_STATES,
        );
  return {
    schemaVersion: "np.agent-action-projection.v1",
    id: parseCanonicalUuid(record.id, `${path}.id`),
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    runId: record.runId === null ? null : parseCanonicalUuid(record.runId, `${path}.runId`),
    sequence: canonicalBodyInteger(record.sequence, `${path}.sequence`, 1, SIGNED_32_BIT_MAXIMUM),
    capabilityId: parseCanonicalCapabilityId(record.capabilityId, `${path}.capabilityId`),
    capabilityContractVersion: canonicalBodyInteger(
      record.capabilityContractVersion,
      `${path}.capabilityContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    capabilityFingerprint: parseCanonicalSha256(
      record.capabilityFingerprint,
      `${path}.capabilityFingerprint`,
    ),
    effectProfile: {
      id: parseCanonicalIdentifier(effect.id, `${path}.effectProfile.id`),
      contractVersion: canonicalBodyInteger(
        effect.contractVersion,
        `${path}.effectProfile.contractVersion`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
    },
    risk: parseCapabilityRisk(record.risk, `${path}.risk`),
    state: actionState,
    inputRedacted,
    outputRedacted,
    requiredScopes: parseSortedScopes(record.requiredScopes, `${path}.requiredScopes`, state),
    targetRefs: parseTargetRefs(record.targetRefs, `${path}.targetRefs`, state),
    proposalHash: parseCanonicalSha256(record.proposalHash, `${path}.proposalHash`),
    approvalId:
      record.approvalId === null
        ? null
        : parseCanonicalUuid(record.approvalId, `${path}.approvalId`),
    verificationState,
    errorCode,
    createdAt,
    startedAt,
    finishedAt,
  };
}

export function npAnalyzeAgentScopesV1(value: unknown): NpAgentContractResult<NpAgentScope[]> {
  return analyzeCanonicalBody("agent.wire.scopes", () => {
    const path = "agent.wire.scopes";
    const cloned = cloneCanonicalRuntimeInput(value, path, 16 * 1024, { maximumDepth: 2 });
    return parseSortedScopes(cloned, path, { seen: new WeakSet<object>() });
  });
}

export function npRequireAgentScopesV1(value: unknown): NpAgentScope[] {
  return npRequireAgentContractResult(npAnalyzeAgentScopesV1(value), "Invalid Agent scopes");
}

export function npAnalyzeAgentRunStateV1(value: unknown): NpAgentContractResult<NpAgentRunState> {
  return analyzeCanonicalBody("agent.wire.runState", () =>
    canonicalBodyEnum(value, "agent.wire.runState", RUN_STATES),
  );
}

export function npAnalyzeAgentActionStateV1(
  value: unknown,
): NpAgentContractResult<NpAgentActionState> {
  return analyzeCanonicalBody("agent.wire.actionState", () =>
    canonicalBodyEnum(value, "agent.wire.actionState", ACTION_STATES),
  );
}

export function npAnalyzeAgentPrincipalV1(
  value: unknown,
): NpAgentContractResult<NpAgentPrincipalV1> {
  return analyzeCanonicalBody("agent.wire.principal", () => parsePrincipal(value));
}

export function npRequireAgentPrincipalV1(value: unknown): NpAgentPrincipalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPrincipalV1(value),
    "Invalid Agent principal wire",
  );
}

export function npAnalyzeAgentBudgetV1(
  value: unknown,
  options: NpAgentBudgetAnalyzerOptionsV1 = {},
): NpAgentContractResult<NpAgentBudgetV1> {
  return analyzeCanonicalBody("agent.wire.budget", () => parseBudget(value, options));
}

export function npRequireAgentBudgetV1(
  value: unknown,
  options: NpAgentBudgetAnalyzerOptionsV1 = {},
): NpAgentBudgetV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentBudgetV1(value, options),
    "Invalid Agent budget wire",
  );
}

export function npAnalyzeAgentConnectionV1(
  value: unknown,
): NpAgentContractResult<NpAgentConnectionV1> {
  return analyzeCanonicalBody("agent.wire.connection", () => parseConnection(value));
}

export function npRequireAgentConnectionV1(value: unknown): NpAgentConnectionV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentConnectionV1(value),
    "Invalid Agent connection wire",
  );
}

export function npAnalyzeAgentRunV1(value: unknown): NpAgentContractResult<NpAgentRunV1> {
  return analyzeCanonicalBody("agent.wire.run", () => parseRun(value));
}

export function npRequireAgentRunV1(value: unknown): NpAgentRunV1 {
  return npRequireAgentContractResult(npAnalyzeAgentRunV1(value), "Invalid Agent run wire");
}

export function npAnalyzeAgentActionProjectionV1(
  value: unknown,
): NpAgentContractResult<NpAgentActionProjectionV1> {
  return analyzeCanonicalBody("agent.wire.action", () => parseAction(value));
}

export function npRequireAgentActionProjectionV1(value: unknown): NpAgentActionProjectionV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentActionProjectionV1(value),
    "Invalid Agent action projection wire",
  );
}

export function npAnalyzeAgentCursorPageV1<T, S extends string>(
  value: unknown,
  options: NpAgentCursorPageAnalyzerOptionsV1<T, S>,
): NpAgentContractResult<NpAgentCursorPageV1<T, S>> {
  const path = "agent.wire.page";
  return analyzeCanonicalBody(path, () => {
    const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
    const record = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, options.maximumBytes ?? WIRE_BODY_MAXIMUM_BYTES, {
        maximumDepth: 32,
      }),
      path,
      ["schemaVersion", "items", "nextCursor"],
      ["schemaVersion", "items", "nextCursor"],
      state,
    );
    if (record.schemaVersion !== options.schemaVersion) {
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        `must be ${options.schemaVersion}`,
      );
    }
    const entries = canonicalBodyArray(
      record.items,
      `${path}.items`,
      Math.min(options.maximumItems ?? PAGE_MAXIMUM_ITEMS, PAGE_MAXIMUM_ITEMS),
      state,
    );
    const items = entries.map((entry, index) =>
      requireNestedCanonicalResult(
        options.analyzeItem(entry),
        options.itemIssueRoot,
        `${path}.items[${index.toString()}]`,
      ),
    );
    return {
      schemaVersion: options.schemaVersion,
      items,
      nextCursor:
        record.nextCursor === null
          ? null
          : canonicalBodyAscii(record.nextCursor, `${path}.nextCursor`, CURSOR_MAXIMUM_BYTES),
    };
  });
}

export function npRequireAgentCursorPageV1<T, S extends string>(
  value: unknown,
  options: NpAgentCursorPageAnalyzerOptionsV1<T, S>,
): NpAgentCursorPageV1<T, S> {
  return npRequireAgentContractResult(
    npAnalyzeAgentCursorPageV1(value, options),
    "Invalid Agent cursor page wire",
  );
}

export const npAgentWireContractSchemaVersionsV1 = Object.freeze([
  "np.agent-gateway-settings.v1",
  "np.agent-principal.v1",
  "np.agent-budget.v1",
  "np.agent-connection.v1",
  "np.agent-run-limits.v1",
  "np.agent-run.v1",
  "np.agent-action-projection.v1",
] as const);
export type NpAgentWireContractSchemaVersionV1 =
  (typeof npAgentWireContractSchemaVersionsV1)[number];

export interface NpAgentWireContractBodyMapV1 {
  "np.agent-gateway-settings.v1": NpAgentGatewaySettingsV1;
  "np.agent-principal.v1": NpAgentPrincipalV1;
  "np.agent-budget.v1": NpAgentBudgetV1;
  "np.agent-connection.v1": NpAgentConnectionV1;
  "np.agent-run-limits.v1": NpAgentRunLimitsV1;
  "np.agent-run.v1": NpAgentRunV1;
  "np.agent-action-projection.v1": NpAgentActionProjectionV1;
}

export interface NpAgentWireContractDescriptorV1 {
  schemaVersion: NpAgentWireContractSchemaVersionV1;
  domain: "gateway" | "identity" | "budget" | "connection" | "run" | "action";
  maximumBytes: number;
  sensitivity: "client-safe";
  canonicalPurpose: "np.agent-run-limits.v1" | null;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export const npAgentWireContractRegistryV1 = deepFreeze([
  {
    schemaVersion: "np.agent-gateway-settings.v1",
    domain: "gateway",
    maximumBytes: 16 * 1024,
    sensitivity: "client-safe",
    canonicalPurpose: null,
  },
  {
    schemaVersion: "np.agent-principal.v1",
    domain: "identity",
    maximumBytes: SMALL_WIRE_BODY_MAXIMUM_BYTES,
    sensitivity: "client-safe",
    canonicalPurpose: null,
  },
  {
    schemaVersion: "np.agent-budget.v1",
    domain: "budget",
    maximumBytes: 16 * 1024,
    sensitivity: "client-safe",
    canonicalPurpose: null,
  },
  {
    schemaVersion: "np.agent-connection.v1",
    domain: "connection",
    maximumBytes: WIRE_BODY_MAXIMUM_BYTES,
    sensitivity: "client-safe",
    canonicalPurpose: null,
  },
  {
    schemaVersion: "np.agent-run-limits.v1",
    domain: "run",
    maximumBytes: 16 * 1024,
    sensitivity: "client-safe",
    canonicalPurpose: "np.agent-run-limits.v1",
  },
  {
    schemaVersion: "np.agent-run.v1",
    domain: "run",
    maximumBytes: SMALL_WIRE_BODY_MAXIMUM_BYTES,
    sensitivity: "client-safe",
    canonicalPurpose: null,
  },
  {
    schemaVersion: "np.agent-action-projection.v1",
    domain: "action",
    maximumBytes: WIRE_BODY_MAXIMUM_BYTES,
    sensitivity: "client-safe",
    canonicalPurpose: null,
  },
] as const satisfies readonly NpAgentWireContractDescriptorV1[]);

export const npAgentWireContractsV1 = Object.freeze(
  Object.fromEntries(
    npAgentWireContractRegistryV1.map((entry) => [entry.schemaVersion, entry]),
  ) as Readonly<Record<NpAgentWireContractSchemaVersionV1, NpAgentWireContractDescriptorV1>>,
);

export function npAnalyzeAgentWireContractV1<K extends NpAgentWireContractSchemaVersionV1>(
  schemaVersion: K,
  value: unknown,
): NpAgentContractResult<NpAgentWireContractBodyMapV1[K]> {
  let result: NpAgentContractResult<unknown>;
  switch (schemaVersion) {
    case "np.agent-gateway-settings.v1":
      result = npAnalyzeAgentGatewaySettings(value);
      break;
    case "np.agent-principal.v1":
      result = npAnalyzeAgentPrincipalV1(value);
      break;
    case "np.agent-budget.v1":
      result = npAnalyzeAgentBudgetV1(value);
      break;
    case "np.agent-connection.v1":
      result = npAnalyzeAgentConnectionV1(value);
      break;
    case "np.agent-run-limits.v1":
      result = npAnalyzeAgentRunLimitsCanonical(value);
      break;
    case "np.agent-run.v1":
      result = npAnalyzeAgentRunV1(value);
      break;
    case "np.agent-action-projection.v1":
      result = npAnalyzeAgentActionProjectionV1(value);
      break;
    default:
      return {
        ok: false,
        issues: [
          {
            code: "invalid-field",
            path: "agent.wire.schemaVersion",
            message: "is not a registered Agent wire contract",
          },
        ],
      };
  }
  return result as NpAgentContractResult<NpAgentWireContractBodyMapV1[K]>;
}

export function npRequireAgentWireContractV1<K extends NpAgentWireContractSchemaVersionV1>(
  schemaVersion: K,
  value: unknown,
): NpAgentWireContractBodyMapV1[K] {
  return npRequireAgentContractResult(
    npAnalyzeAgentWireContractV1(schemaVersion, value),
    `Invalid Agent wire contract ${schemaVersion}`,
  );
}

function buildFingerprintBytes(domain: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(`${domain}\0${serializeAgentCanonicalJson(value)}`);
}

/** Canonical fingerprint for one validated public wire body and its exact schema version. */
export async function npDigestAgentWireContractV1<K extends NpAgentWireContractSchemaVersionV1>(
  schemaVersion: K,
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    buildFingerprintBytes(
      `np.agent-wire-contract.v1:${schemaVersion}`,
      npRequireAgentWireContractV1(schemaVersion, value),
    ),
  );
}

/** Aggregate client-surface fixture fingerprint. Analyzer callbacks are never fingerprint input. */
export async function npDigestAgentWireContractRegistryV1(): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    buildFingerprintBytes("np.agent-wire-contract-registry.v1", npAgentWireContractRegistryV1),
  );
}
