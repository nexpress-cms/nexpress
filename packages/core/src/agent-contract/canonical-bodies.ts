import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyAscii,
  canonicalBodyCapabilities,
  canonicalBodyCapabilityId,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUserRole,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import type {
  NpAgentCanonicalBodyBytesV1,
  NpAgentCanonicalPurposeV1,
  NpAgentConnectionKind,
  NpAgentConnectionSecretPurpose,
  NpAgentContractResult,
  NpAgentEffectProfileCanonicalV1,
  NpAgentEnabledGatewayExposureMode,
  NpAgentRunLimitsCanonicalV1,
  NpAgentStaffSiteAuthorizationCanonicalV1,
  NpAgentVaultAadCanonicalV1,
  NpAgentVaultAlgorithm,
} from "./types.js";

const SAFE_INTEGER_MAXIMUM = Number.MAX_SAFE_INTEGER;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const RUN_WALL_CLOCK_MAXIMUM_SECONDS = 86_400;
const EFFECT_KINDS = new Set<string>(["read", "mutation"]);
const REVERSIBILITIES = new Set<string>(["none", "compensatable"]);
const EFFECT_EXPOSURES = new Set<string>(["read", "propose", "approved-execute"]);
const STAFF_AUTHORITY_KINDS = new Set<string>(["super-admin", "site-role"]);
const STAFF_AUTHORITY_SOURCES = new Set<string>(["membership", "default-site-fallback"]);
const CONNECTION_KINDS = new Set<string>(["model", "notification"]);
const CONNECTION_SECRET_PURPOSES = new Set<string>([
  "connection-credential",
  "provider-oauth-pkce",
  "provider-oauth-code",
]);
const CUSTOM_VAULT_ALGORITHM_PATTERN = /^custom:[a-z0-9][a-z0-9._-]{0,63}$/u;

export const npAgentEffectProfileCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "capabilityId",
  "capabilityContractVersion",
  "implementationVersion",
  "profileId",
  "kind",
  "reversibility",
  "minimumGatewayExposure",
  "effectContractVersion",
  "verifierId",
  "compensatorId",
] as const satisfies readonly (keyof NpAgentEffectProfileCanonicalV1)[];

export const npAgentEffectProfileCanonicalExcludedKeysV1 = [
  "effectFingerprint",
  "capabilityFingerprint",
  "registeredAt",
  "sourceFunction",
  "verify",
  "deriveUndo",
  "compensate",
] as const;

export const npAgentRunLimitsCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "maxAttempts",
  "maxProviderCalls",
  "maxCapabilityCalls",
  "maxInputTokens",
  "maxOutputTokens",
  "maxCostMicros",
  "maxWallClockSeconds",
] as const satisfies readonly (keyof NpAgentRunLimitsCanonicalV1)[];

export const npAgentRunLimitsCanonicalExcludedKeysV1 = [
  "limitsHash",
  "runLimitsHash",
  "resolvedAt",
  "sourceRefs",
] as const;

export const npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "userId",
  "userTokenVersion",
  "authority",
] as const satisfies readonly (keyof NpAgentStaffSiteAuthorizationCanonicalV1)[];

export const npAgentStaffSiteAuthorizationCanonicalExcludedKeysV1 = [
  "siteAuthorizationDigest",
  "sessionId",
  "sessionFingerprint",
  "issuedAt",
  "expiresAt",
  "viewerToken",
] as const;

export const npAgentStaffSiteAuthorizationCanonicalSuperAdminIncludedKeysV1 = [
  "kind",
  "capabilities",
] as const satisfies readonly (keyof Extract<
  NpAgentStaffSiteAuthorizationCanonicalV1["authority"],
  { kind: "super-admin" }
>)[];

export const npAgentStaffSiteAuthorizationCanonicalSiteRoleIncludedKeysV1 = [
  "kind",
  "source",
  "role",
  "capabilities",
] as const satisfies readonly (keyof Extract<
  NpAgentStaffSiteAuthorizationCanonicalV1["authority"],
  { kind: "site-role" }
>)[];

export const npAgentVaultAadCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "connectionId",
  "connectionKind",
  "purpose",
  "secretVersionId",
  "secretVersion",
  "vaultAdapterId",
  "vaultAdapterContractVersion",
  "vaultAdapterFingerprint",
  "credentialEnvelopeVersion",
  "algorithm",
] as const satisfies readonly (keyof NpAgentVaultAadCanonicalV1)[];

export const npAgentVaultAadCanonicalExcludedKeysV1 = [
  "aadDigest",
  "nonce",
  "ciphertext",
  "authenticationTag",
  "wrappedDek",
  "keyId",
  "keyVersion",
  "secretRef",
  "idempotencyKey",
  "requestDigest",
  "resultDigest",
  "adapterReceipt",
  "createdAt",
  "updatedAt",
] as const;

function nullableIdentifier(value: unknown, path: string): string | null {
  return value === null ? null : canonicalBodyIdentifier(value, path);
}

function parseEffectProfileCanonical(value: unknown): NpAgentEffectProfileCanonicalV1 {
  const path = "agent.canonical.effectProfile";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentEffectProfileCanonicalIncludedKeysV1,
    npAgentEffectProfileCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== "np.agent-effect-profile.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-effect-profile.v1",
    );
  }
  const kind = canonicalBodyEnum<"read" | "mutation">(record.kind, `${path}.kind`, EFFECT_KINDS);
  const reversibility = canonicalBodyEnum<"none" | "compensatable">(
    record.reversibility,
    `${path}.reversibility`,
    REVERSIBILITIES,
  );
  const minimumGatewayExposure =
    record.minimumGatewayExposure === null
      ? null
      : canonicalBodyEnum<NpAgentEnabledGatewayExposureMode>(
          record.minimumGatewayExposure,
          `${path}.minimumGatewayExposure`,
          EFFECT_EXPOSURES,
        );
  const verifierId = nullableIdentifier(record.verifierId, `${path}.verifierId`);
  const compensatorId = nullableIdentifier(record.compensatorId, `${path}.compensatorId`);

  if (kind === "read") {
    if (reversibility !== "none" || verifierId !== null || compensatorId !== null) {
      failCanonicalBody(
        "invalid-field",
        path,
        "read profiles must be non-reversible and verifier-free",
      );
    }
  } else {
    if (minimumGatewayExposure === "read") {
      failCanonicalBody(
        "invalid-field",
        `${path}.minimumGatewayExposure`,
        "mutation profiles require propose or higher",
      );
    }
    if (verifierId === null) {
      failCanonicalBody(
        "invalid-field",
        `${path}.verifierId`,
        "mutation profiles require a verifier",
      );
    }
    if (reversibility === "compensatable" && compensatorId === null) {
      failCanonicalBody(
        "invalid-field",
        `${path}.compensatorId`,
        "compensatable profiles require a compensator",
      );
    }
    if (reversibility === "none" && compensatorId !== null) {
      failCanonicalBody(
        "invalid-field",
        `${path}.compensatorId`,
        "non-compensatable profiles forbid a compensator",
      );
    }
  }

  return {
    schemaVersion: "np.agent-effect-profile.v1",
    capabilityId: canonicalBodyCapabilityId(record.capabilityId, `${path}.capabilityId`),
    capabilityContractVersion: canonicalBodyInteger(
      record.capabilityContractVersion,
      `${path}.capabilityContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    implementationVersion: canonicalBodyInteger(
      record.implementationVersion,
      `${path}.implementationVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    profileId: canonicalBodyIdentifier(record.profileId, `${path}.profileId`),
    kind,
    reversibility,
    minimumGatewayExposure,
    effectContractVersion: canonicalBodyInteger(
      record.effectContractVersion,
      `${path}.effectContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    verifierId,
    compensatorId,
  };
}

function parseRunLimitsCanonical(value: unknown): NpAgentRunLimitsCanonicalV1 {
  const path = "agent.canonical.runLimits";
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRunLimitsCanonicalIncludedKeysV1,
    npAgentRunLimitsCanonicalIncludedKeysV1,
    { seen: new WeakSet<object>() },
  );
  if (record.schemaVersion !== "np.agent-run-limits.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-run-limits.v1");
  }
  return {
    schemaVersion: "np.agent-run-limits.v1",
    maxAttempts: canonicalBodyInteger(
      record.maxAttempts,
      `${path}.maxAttempts`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxProviderCalls: canonicalBodyInteger(
      record.maxProviderCalls,
      `${path}.maxProviderCalls`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxCapabilityCalls: canonicalBodyInteger(
      record.maxCapabilityCalls,
      `${path}.maxCapabilityCalls`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxInputTokens: canonicalBodyInteger(
      record.maxInputTokens,
      `${path}.maxInputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxOutputTokens: canonicalBodyInteger(
      record.maxOutputTokens,
      `${path}.maxOutputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxCostMicros: canonicalBodyInteger(
      record.maxCostMicros,
      `${path}.maxCostMicros`,
      0,
      SAFE_INTEGER_MAXIMUM,
    ),
    maxWallClockSeconds: canonicalBodyInteger(
      record.maxWallClockSeconds,
      `${path}.maxWallClockSeconds`,
      1,
      RUN_WALL_CLOCK_MAXIMUM_SECONDS,
    ),
  };
}

function parseStaffAuthority(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentStaffSiteAuthorizationCanonicalV1["authority"] {
  const record = canonicalBodyRecord(
    value,
    path,
    ["kind", "source", "role", "capabilities"],
    ["kind", "capabilities"],
    state,
  );
  const kind = canonicalBodyEnum<"super-admin" | "site-role">(
    record.kind,
    `${path}.kind`,
    STAFF_AUTHORITY_KINDS,
  );
  const capabilities = canonicalBodyCapabilities(
    record.capabilities,
    `${path}.capabilities`,
    state,
  );
  if (kind === "super-admin") {
    if (Object.hasOwn(record, "source") || Object.hasOwn(record, "role")) {
      failCanonicalBody("unknown-field", path, "super-admin authority forbids site-role fields");
    }
    return { kind, capabilities };
  }
  if (!Object.hasOwn(record, "source") || !Object.hasOwn(record, "role")) {
    failCanonicalBody("missing-field", path, "site-role authority requires source and role");
  }
  return {
    kind,
    source: canonicalBodyEnum<"membership" | "default-site-fallback">(
      record.source,
      `${path}.source`,
      STAFF_AUTHORITY_SOURCES,
    ),
    role: canonicalBodyUserRole(record.role, `${path}.role`),
    capabilities,
  };
}

function parseStaffSiteAuthorizationCanonical(
  value: unknown,
): NpAgentStaffSiteAuthorizationCanonicalV1 {
  const path = "agent.canonical.staffSiteAuthorization";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1,
    npAgentStaffSiteAuthorizationCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== "np.agent-staff-site-authorization.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-staff-site-authorization.v1",
    );
  }
  return {
    schemaVersion: "np.agent-staff-site-authorization.v1",
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    userId: canonicalBodyUuid(record.userId, `${path}.userId`),
    userTokenVersion: canonicalBodyInteger(
      record.userTokenVersion,
      `${path}.userTokenVersion`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    authority: parseStaffAuthority(record.authority, `${path}.authority`, state),
  };
}

function parseVaultAlgorithm(value: unknown, path: string): NpAgentVaultAlgorithm {
  if (value === "AES-256-GCM") return value;
  if (typeof value !== "string" || !CUSTOM_VAULT_ALGORITHM_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be AES-256-GCM or one canonical custom id");
  }
  return value as NpAgentVaultAlgorithm;
}

function parseVaultAadCanonical(value: unknown): NpAgentVaultAadCanonicalV1 {
  const path = "agent.canonical.vaultAad";
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentVaultAadCanonicalIncludedKeysV1,
    npAgentVaultAadCanonicalIncludedKeysV1,
    { seen: new WeakSet<object>() },
  );
  if (record.schemaVersion !== "np.agent-vault-aad.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-vault-aad.v1");
  }
  if (record.credentialEnvelopeVersion !== 1) {
    failCanonicalBody("invalid-field", `${path}.credentialEnvelopeVersion`, "must be 1");
  }
  return {
    schemaVersion: "np.agent-vault-aad.v1",
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    connectionId: canonicalBodyUuid(record.connectionId, `${path}.connectionId`),
    connectionKind: canonicalBodyEnum<NpAgentConnectionKind>(
      record.connectionKind,
      `${path}.connectionKind`,
      CONNECTION_KINDS,
    ),
    purpose: canonicalBodyEnum<NpAgentConnectionSecretPurpose>(
      record.purpose,
      `${path}.purpose`,
      CONNECTION_SECRET_PURPOSES,
    ),
    secretVersionId: canonicalBodyUuid(record.secretVersionId, `${path}.secretVersionId`),
    secretVersion: canonicalBodyInteger(
      record.secretVersion,
      `${path}.secretVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    vaultAdapterId: canonicalBodyIdentifier(record.vaultAdapterId, `${path}.vaultAdapterId`),
    vaultAdapterContractVersion: canonicalBodyInteger(
      record.vaultAdapterContractVersion,
      `${path}.vaultAdapterContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    vaultAdapterFingerprint: canonicalBodyAscii(
      record.vaultAdapterFingerprint,
      `${path}.vaultAdapterFingerprint`,
      256,
    ),
    credentialEnvelopeVersion: 1,
    algorithm: parseVaultAlgorithm(record.algorithm, `${path}.algorithm`),
  };
}

export function npAnalyzeAgentEffectProfileCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentEffectProfileCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.effectProfile", () =>
    parseEffectProfileCanonical(value),
  );
}

export function npRequireAgentEffectProfileCanonical(
  value: unknown,
): NpAgentEffectProfileCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentEffectProfileCanonical(value),
    "Invalid Agent effect-profile canonical body",
  );
}

export function npAnalyzeAgentRunLimitsCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentRunLimitsCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.runLimits", () => parseRunLimitsCanonical(value));
}

export function npRequireAgentRunLimitsCanonical(value: unknown): NpAgentRunLimitsCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRunLimitsCanonical(value),
    "Invalid Agent run-limits canonical body",
  );
}

export function npAnalyzeAgentStaffSiteAuthorizationCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentStaffSiteAuthorizationCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.staffSiteAuthorization", () =>
    parseStaffSiteAuthorizationCanonical(value),
  );
}

export function npRequireAgentStaffSiteAuthorizationCanonical(
  value: unknown,
): NpAgentStaffSiteAuthorizationCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentStaffSiteAuthorizationCanonical(value),
    "Invalid Agent staff-site-authorization canonical body",
  );
}

export function npAnalyzeAgentVaultAadCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentVaultAadCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.vaultAad", () => parseVaultAadCanonical(value));
}

export function npRequireAgentVaultAadCanonical(value: unknown): NpAgentVaultAadCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentVaultAadCanonical(value),
    "Invalid Agent vault-AAD canonical body",
  );
}

function buildCanonicalBodyBytes<P extends NpAgentCanonicalPurposeV1, B extends object>(
  purpose: P,
  body: B,
): NpAgentCanonicalBodyBytesV1<P, B> {
  return buildAgentCanonicalFoundationBytes(purpose, body) as NpAgentCanonicalBodyBytesV1<P, B>;
}

export function npBuildAgentEffectProfileCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-effect-profile.v1", NpAgentEffectProfileCanonicalV1> {
  return buildCanonicalBodyBytes(
    "np.agent-effect-profile.v1",
    npRequireAgentEffectProfileCanonical(value),
  );
}

export function npBuildAgentRunLimitsCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-run-limits.v1", NpAgentRunLimitsCanonicalV1> {
  return buildCanonicalBodyBytes("np.agent-run-limits.v1", npRequireAgentRunLimitsCanonical(value));
}

export function npBuildAgentStaffSiteAuthorizationCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-staff-site-authorization.v1",
  NpAgentStaffSiteAuthorizationCanonicalV1
> {
  return buildCanonicalBodyBytes(
    "np.agent-staff-site-authorization.v1",
    npRequireAgentStaffSiteAuthorizationCanonical(value),
  );
}

export function npBuildAgentVaultAadCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-vault-aad.v1", NpAgentVaultAadCanonicalV1> {
  return buildCanonicalBodyBytes("np.agent-vault-aad.v1", npRequireAgentVaultAadCanonical(value));
}

export async function npDigestAgentEffectProfileCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentEffectProfileCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export async function npDigestAgentRunLimitsCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(npBuildAgentRunLimitsCanonicalBytes(value).domainSeparatedUtf8);
}

export async function npDigestAgentStaffSiteAuthorizationCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentStaffSiteAuthorizationCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export async function npDigestAgentVaultAadCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(npBuildAgentVaultAadCanonicalBytes(value).domainSeparatedUtf8);
}
