import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  digestAgentCanonicalSha256,
  macAgentCanonicalHmacSha256,
  verifyAgentCanonicalHmacSha256,
} from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  SIGNED_32_BIT_MAXIMUM,
  canonicalRuntimeIdempotencyKey,
  cloneCanonicalRuntimeInput,
  parseAgentModelPricing,
  parseCanonicalIdentifier,
  parseCanonicalInteger,
  parseCanonicalJsonObject,
  parseCanonicalSha256,
  parseCanonicalSiteId,
  parseCanonicalUuid,
  parseProviderDataClass,
} from "./canonical-runtime-primitives.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentConnectionOperationKinds,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentConnectionConfigCanonicalV1,
  type NpAgentConnectionDestinationCanonicalV1,
  type NpAgentConnectionDestinationDescriptorV1,
  type NpAgentConnectionDestinationKeyV1,
  type NpAgentConnectionOperationAuthorityCanonicalV1,
  type NpAgentConnectionOperationKind,
  type NpAgentConnectionOperationRequestCanonicalV1,
  type NpAgentContractResult,
  type NpAgentJsonValue,
  type NpAgentModelPricingV1,
} from "./types.js";

const CONFIG_PURPOSE = "np.agent-connection-config.v1" as const;
const DESTINATION_PURPOSE = "np.agent-connection-destination.v1" as const;
const OPERATION_PURPOSE = "np.agent-connection-operation.v1" as const;
const MAXIMUM_PRICING_ENTRIES = 256;
const MAXIMUM_SECRET_VERSION_IDS = 3;
const CONNECTION_CONFIG_BYTES = 256 * 1024;
const DESTINATION_DESCRIPTOR_BYTES = 16 * 1024;
const ACCOUNT_SUBJECT_DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const KEY_ID_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;
const BASE64URL_SHA_256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CONNECTION_KINDS = new Set<string>(["model", "notification"]);
const AUTH_KINDS = new Set<string>(["api_key", "oauth"]);
const OPERATION_KINDS = new Set<string>(npAgentConnectionOperationKinds);
const FORBIDDEN_DESCRIPTOR_KEYS = new Set([
  "credential",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authorizationheader",
  "cookie",
  "signedurl",
]);

export const npAgentConnectionConfigCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "connectionId",
  "kind",
  "provider",
  "adapterId",
  "adapterContractVersion",
  "adapterFingerprint",
  "authKind",
  "configVersion",
  "config",
  "pricingCatalog",
  "dataProcessingCeiling",
] as const satisfies readonly (keyof NpAgentConnectionConfigCanonicalV1)[];

export const npAgentConnectionConfigCanonicalExcludedKeysV1 = [
  "configHash",
  "pricingCatalogFingerprint",
  "activeSecretVersionId",
  "credentialVersion",
  "accountSubjectKeyId",
  "accountSubjectDigest",
  "destinationFingerprintKeyId",
  "destinationFingerprint",
  "status",
  "lastVerifiedAt",
  "lastProbeResultDigest",
  "lastErrorCode",
  "createdAt",
  "updatedAt",
] as const;

export const npAgentConnectionDestinationCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "connectionId",
  "adapterId",
  "adapterContractVersion",
  "adapterFingerprint",
  "accountSubjectKeyId",
  "accountSubjectDigest",
  "destinationDescriptor",
] as const satisfies readonly (keyof NpAgentConnectionDestinationCanonicalV1)[];

export const npAgentConnectionDestinationCanonicalExcludedKeysV1 = [
  "destinationHmac",
  "destinationHmacKeyId",
  "destinationFingerprint",
  "destinationFingerprintKeyId",
  "credential",
  "accessToken",
  "refreshToken",
  "apiKey",
  "providerMessageId",
] as const;

export const npAgentConnectionDestinationDescriptorIncludedKeysV1 = [
  "schemaVersion",
  "kind",
  "adapterId",
  "descriptor",
] as const satisfies readonly (keyof NpAgentConnectionDestinationDescriptorV1)[];

export const npAgentConnectionOperationCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "operationId",
  "connectionId",
  "authority",
  "kind",
  "expectedConfigVersion",
  "expectedConfigHash",
  "configSnapshotId",
  "adapterContractVersion",
  "adapterFingerprint",
  "inputSecretVersionIds",
  "expectedSecretVersionId",
  "expectedCredentialVersion",
  "expectedRefreshGeneration",
  "idempotencyKey",
] as const satisfies readonly (keyof NpAgentConnectionOperationRequestCanonicalV1)[];

export const npAgentConnectionOperationCanonicalExcludedKeysV1 = [
  "requestHash",
  "source",
  "invocationId",
  "authRequestId",
  "runId",
  "state",
  "attempt",
  "resultRedacted",
  "resultDigest",
  "lastErrorCode",
  "deadlineAt",
  "leaseUntil",
  "createdByUserId",
  "createdAt",
  "startedAt",
  "finishedAt",
] as const;

function comparePricing(left: NpAgentModelPricingV1, right: NpAgentModelPricingV1): number {
  if (left.modelId !== right.modelId) return left.modelId < right.modelId ? -1 : 1;
  if (left.effectiveFrom !== right.effectiveFrom) {
    return left.effectiveFrom < right.effectiveFrom ? -1 : 1;
  }
  if (left.pricingId !== right.pricingId) return left.pricingId < right.pricingId ? -1 : 1;
  return left.version - right.version;
}

function parsePricingCatalog(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentModelPricingV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_PRICING_ENTRIES, state);
  const result: NpAgentModelPricingV1[] = [];
  let previous: NpAgentModelPricingV1 | undefined;
  const lastByModel = new Map<string, NpAgentModelPricingV1>();
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const current = parseAgentModelPricing(entry, entryPath, state);
    if (previous !== undefined) {
      const order = comparePricing(current, previous);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          entryPath,
          "must be sorted unique by (modelId,effectiveFrom,pricingId,version)",
        );
      }
    }
    const priorModelRule = lastByModel.get(current.modelId);
    if (
      priorModelRule?.effectiveUntil === null ||
      (priorModelRule !== undefined && current.effectiveFrom < priorModelRule.effectiveUntil)
    ) {
      failCanonicalBody(
        "invalid-field",
        entryPath,
        "must not overlap another model pricing interval",
      );
    }
    result.push(current);
    previous = current;
    lastByModel.set(current.modelId, current);
  });
  return result;
}

function parseConnectionConfigCanonical(value: unknown): NpAgentConnectionConfigCanonicalV1 {
  const path = "agent.canonical.connectionConfig";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[CONFIG_PURPOSE]),
    path,
    npAgentConnectionConfigCanonicalIncludedKeysV1,
    npAgentConnectionConfigCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== CONFIG_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${CONFIG_PURPOSE}`);
  }
  const result: NpAgentConnectionConfigCanonicalV1 = {
    schemaVersion: CONFIG_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    connectionId: parseCanonicalUuid(record.connectionId, `${path}.connectionId`),
    kind: canonicalBodyEnum(record.kind, `${path}.kind`, CONNECTION_KINDS),
    provider: parseCanonicalIdentifier(record.provider, `${path}.provider`),
    adapterId: parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`),
    adapterContractVersion: parseCanonicalInteger(
      record.adapterContractVersion,
      `${path}.adapterContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    adapterFingerprint: parseCanonicalSha256(
      record.adapterFingerprint,
      `${path}.adapterFingerprint`,
    ),
    authKind: canonicalBodyEnum(record.authKind, `${path}.authKind`, AUTH_KINDS),
    configVersion: parseCanonicalInteger(
      record.configVersion,
      `${path}.configVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    config: parseCanonicalJsonObject(
      cloneCanonicalRuntimeInput(record.config, `${path}.config`, CONNECTION_CONFIG_BYTES, {
        maximumDepth: 8,
      }),
      `${path}.config`,
    ),
    pricingCatalog: parsePricingCatalog(record.pricingCatalog, `${path}.pricingCatalog`, state),
    dataProcessingCeiling: parseProviderDataClass(
      record.dataProcessingCeiling,
      `${path}.dataProcessingCeiling`,
    ),
  };
  if (result.kind === "model" && result.pricingCatalog.length === 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.pricingCatalog`,
      "model connections require pricing",
    );
  }
  if (result.kind === "notification" && result.pricingCatalog.length !== 0) {
    failCanonicalBody(
      "invalid-field",
      `${path}.pricingCatalog`,
      "notification connections forbid pricing",
    );
  }
  buildAgentCanonicalFoundationBytes(CONFIG_PURPOSE, result);
  return result;
}

function inspectDescriptorForSecrets(value: NpAgentJsonValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectDescriptorForSecrets(entry, `${path}[${index.toString()}]`),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_.]/gu, "").toLowerCase();
    if (FORBIDDEN_DESCRIPTOR_KEYS.has(normalized)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "must not contain credential material");
    }
    inspectDescriptorForSecrets(entry, `${path}.${key}`);
  }
}

function parseDestinationDescriptor(
  value: unknown,
  path: string,
  adapterId: string,
  state: CanonicalBodyInspectionState,
): NpAgentConnectionDestinationDescriptorV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentConnectionDestinationDescriptorIncludedKeysV1,
    npAgentConnectionDestinationDescriptorIncludedKeysV1,
    state,
  );
  if (
    record.schemaVersion !== "np.agent-connection-destination-descriptor.v1" ||
    record.kind !== "notification"
  ) {
    failCanonicalBody("invalid-field", path, "must use the exact notification descriptor envelope");
  }
  const descriptorAdapterId = parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`);
  if (descriptorAdapterId !== adapterId) {
    failCanonicalBody("invalid-field", `${path}.adapterId`, "must equal the frozen adapter id");
  }
  const descriptor = parseCanonicalJsonObject(
    cloneCanonicalRuntimeInput(
      record.descriptor,
      `${path}.descriptor`,
      DESTINATION_DESCRIPTOR_BYTES,
      {
        maximumDepth: 6,
      },
    ),
    `${path}.descriptor`,
  );
  inspectDescriptorForSecrets(descriptor, `${path}.descriptor`);
  return {
    schemaVersion: "np.agent-connection-destination-descriptor.v1",
    kind: "notification",
    adapterId: descriptorAdapterId,
    descriptor,
  };
}

function parseConnectionDestinationCanonical(
  value: unknown,
): NpAgentConnectionDestinationCanonicalV1 {
  const path = "agent.canonical.connectionDestination";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[DESTINATION_PURPOSE], {
      maximumDepth: 8,
      maximumStringCharacters: DESTINATION_DESCRIPTOR_BYTES,
    }),
    path,
    npAgentConnectionDestinationCanonicalIncludedKeysV1,
    npAgentConnectionDestinationCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== DESTINATION_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${DESTINATION_PURPOSE}`);
  }
  const adapterId = parseCanonicalIdentifier(record.adapterId, `${path}.adapterId`);
  if (
    typeof record.accountSubjectDigest !== "string" ||
    !ACCOUNT_SUBJECT_DIGEST_PATTERN.test(record.accountSubjectDigest)
  ) {
    failCanonicalBody(
      "invalid-field",
      `${path}.accountSubjectDigest`,
      "must be a 43-character base64url HMAC",
    );
  }
  const result: NpAgentConnectionDestinationCanonicalV1 = {
    schemaVersion: DESTINATION_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    connectionId: parseCanonicalUuid(record.connectionId, `${path}.connectionId`),
    adapterId,
    adapterContractVersion: parseCanonicalInteger(
      record.adapterContractVersion,
      `${path}.adapterContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    adapterFingerprint: parseCanonicalSha256(
      record.adapterFingerprint,
      `${path}.adapterFingerprint`,
    ),
    accountSubjectKeyId: parseCanonicalIdentifier(
      record.accountSubjectKeyId,
      `${path}.accountSubjectKeyId`,
    ),
    accountSubjectDigest: record.accountSubjectDigest,
    destinationDescriptor: parseDestinationDescriptor(
      record.destinationDescriptor,
      `${path}.destinationDescriptor`,
      adapterId,
      state,
    ),
  };
  buildAgentCanonicalFoundationBytes(DESTINATION_PURPOSE, result);
  return result;
}

function parseAuthority(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentConnectionOperationAuthorityCanonicalV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be one exact operation authority branch");
  }
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  const idKey =
    kind === "admin-invocation"
      ? "invocationId"
      : kind === "oauth-setup"
        ? "authRequestId"
        : kind === "runtime-refresh"
          ? "runId"
          : null;
  if (idKey === null) {
    failCanonicalBody("invalid-field", `${path}.kind`, "is not a supported authority kind");
  }
  const record = canonicalBodyRecord(value, path, ["kind", idKey], ["kind", idKey], state);
  const id = parseCanonicalUuid(record[idKey], `${path}.${idKey}`);
  return kind === "admin-invocation"
    ? { kind, invocationId: id }
    : kind === "oauth-setup"
      ? { kind, authRequestId: id }
      : { kind: "runtime-refresh", runId: id };
}

function parseSecretVersionIds(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_SECRET_VERSION_IDS, state);
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const current = parseCanonicalUuid(entry, `${path}[${index.toString()}]`);
    if (seen.has(current)) {
      failCanonicalBody(
        "duplicate",
        `${path}[${index.toString()}]`,
        "must be unique in semantic-purpose order",
      );
    }
    seen.add(current);
    return current;
  });
}

function requireAuthorityForKind(
  kind: NpAgentConnectionOperationKind,
  authority: NpAgentConnectionOperationAuthorityCanonicalV1,
  path: string,
): void {
  const expected =
    kind === "oauth-exchange"
      ? "oauth-setup"
      : kind === "oauth-refresh"
        ? "runtime-refresh"
        : "admin-invocation";
  if (authority.kind !== expected) {
    failCanonicalBody("invalid-field", path, `must be ${expected} for ${kind}`);
  }
}

function parseConnectionOperationCanonical(
  value: unknown,
): NpAgentConnectionOperationRequestCanonicalV1 {
  const path = "agent.canonical.connectionOperation";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, npAgentCanonicalBodyMaxBytesV1[OPERATION_PURPOSE]),
    path,
    npAgentConnectionOperationCanonicalIncludedKeysV1,
    npAgentConnectionOperationCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== OPERATION_PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${OPERATION_PURPOSE}`);
  }
  const kind = canonicalBodyEnum<NpAgentConnectionOperationKind>(
    record.kind,
    `${path}.kind`,
    OPERATION_KINDS,
  );
  const authority = parseAuthority(record.authority, `${path}.authority`, state);
  requireAuthorityForKind(kind, authority, `${path}.authority.kind`);
  const expectedSecretVersionId =
    record.expectedSecretVersionId === null
      ? null
      : parseCanonicalUuid(record.expectedSecretVersionId, `${path}.expectedSecretVersionId`);
  const expectedCredentialVersion =
    record.expectedCredentialVersion === null
      ? null
      : parseCanonicalInteger(
          record.expectedCredentialVersion,
          `${path}.expectedCredentialVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        );
  if ((expectedSecretVersionId === null) !== (expectedCredentialVersion === null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.expectedSecretVersionId`,
      "secret id and credential version must be both null or both non-null",
    );
  }
  const expectedRefreshGeneration =
    record.expectedRefreshGeneration === null
      ? null
      : parseCanonicalInteger(
          record.expectedRefreshGeneration,
          `${path}.expectedRefreshGeneration`,
          0,
          SIGNED_32_BIT_MAXIMUM,
        );
  if ((kind === "oauth-refresh") !== (expectedRefreshGeneration !== null)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.expectedRefreshGeneration`,
      "must be non-null exactly for oauth-refresh",
    );
  }
  const result: NpAgentConnectionOperationRequestCanonicalV1 = {
    schemaVersion: OPERATION_PURPOSE,
    siteId: parseCanonicalSiteId(record.siteId, `${path}.siteId`),
    operationId: parseCanonicalUuid(record.operationId, `${path}.operationId`),
    connectionId: parseCanonicalUuid(record.connectionId, `${path}.connectionId`),
    authority,
    kind,
    expectedConfigVersion: parseCanonicalInteger(
      record.expectedConfigVersion,
      `${path}.expectedConfigVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    expectedConfigHash: parseCanonicalSha256(
      record.expectedConfigHash,
      `${path}.expectedConfigHash`,
    ),
    configSnapshotId: parseCanonicalUuid(record.configSnapshotId, `${path}.configSnapshotId`),
    adapterContractVersion: parseCanonicalInteger(
      record.adapterContractVersion,
      `${path}.adapterContractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    adapterFingerprint: parseCanonicalSha256(
      record.adapterFingerprint,
      `${path}.adapterFingerprint`,
    ),
    inputSecretVersionIds: parseSecretVersionIds(
      record.inputSecretVersionIds,
      `${path}.inputSecretVersionIds`,
      state,
    ),
    expectedSecretVersionId,
    expectedCredentialVersion,
    expectedRefreshGeneration,
    idempotencyKey: canonicalRuntimeIdempotencyKey(record.idempotencyKey, `${path}.idempotencyKey`),
  };
  buildAgentCanonicalFoundationBytes(OPERATION_PURPOSE, result);
  return result;
}

function parseDestinationKey(value: unknown): NpAgentConnectionDestinationKeyV1 {
  const path = "agent.canonical.connectionDestinationKey";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failCanonicalBody("shape", path, "must be an ordinary key object");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    failCanonicalBody("shape", path, "must use the ordinary object prototype");
  }
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !new Set(["owner", "id", "bytes"]).has(key)) {
      failCanonicalBody("unknown-field", path, "contains an unknown key field");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      failCanonicalBody("shape", `${path}.${key}`, "must be an enumerable data property");
    }
    record[key] = descriptor.value;
  }
  if (record.owner !== "connection-destination") {
    failCanonicalBody("invalid-field", `${path}.owner`, "must be connection-destination");
  }
  if (typeof record.id !== "string" || !KEY_ID_PATTERN.test(record.id)) {
    failCanonicalBody("invalid-field", `${path}.id`, "must be a bounded non-secret key id");
  }
  if (!(record.bytes instanceof Uint8Array) || record.bytes.byteLength === 0) {
    failCanonicalBody("invalid-field", `${path}.bytes`, "must contain non-empty HMAC key bytes");
  }
  return { owner: "connection-destination", id: record.id, bytes: new Uint8Array(record.bytes) };
}

function decodeBase64UrlSha256(value: string): Uint8Array | null {
  if (!BASE64URL_SHA_256_PATTERN.test(value)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const result: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    accumulator = accumulator * 64 + digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result.push(Math.floor(accumulator / 2 ** bits) & 0xff);
      accumulator %= 2 ** bits;
    }
  }
  return result.length === 32 && accumulator === 0 ? Uint8Array.from(result) : null;
}

export function npAnalyzeAgentConnectionConfigCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentConnectionConfigCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.connectionConfig", () =>
    parseConnectionConfigCanonical(value),
  );
}

export function npRequireAgentConnectionConfigCanonical(
  value: unknown,
): NpAgentConnectionConfigCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentConnectionConfigCanonical(value),
    "Invalid Agent connection-config canonical body",
  );
}

export function npBuildAgentConnectionConfigCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-connection-config.v1",
  NpAgentConnectionConfigCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    CONFIG_PURPOSE,
    npRequireAgentConnectionConfigCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-connection-config.v1",
    NpAgentConnectionConfigCanonicalV1
  >;
}

export async function npDigestAgentConnectionConfigCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentConnectionConfigCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export function npAnalyzeAgentConnectionDestinationCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentConnectionDestinationCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.connectionDestination", () =>
    parseConnectionDestinationCanonical(value),
  );
}

export function npRequireAgentConnectionDestinationCanonical(
  value: unknown,
): NpAgentConnectionDestinationCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentConnectionDestinationCanonical(value),
    "Invalid Agent connection-destination canonical body",
  );
}

export function npBuildAgentConnectionDestinationCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-connection-destination.v1",
  NpAgentConnectionDestinationCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    DESTINATION_PURPOSE,
    npRequireAgentConnectionDestinationCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-connection-destination.v1",
    NpAgentConnectionDestinationCanonicalV1
  >;
}

export async function npMacAgentConnectionDestinationCanonical(
  value: unknown,
  keyValue: unknown,
): Promise<`cj1:hmac-sha256:${string}:${string}`> {
  const key = parseDestinationKey(keyValue);
  const mac = await macAgentCanonicalHmacSha256(
    npBuildAgentConnectionDestinationCanonicalBytes(value).domainSeparatedUtf8,
    key.bytes,
  );
  return `cj1:hmac-sha256:${key.id}:${mac}`;
}

export async function npVerifyAgentConnectionDestinationCanonicalMac(
  value: unknown,
  expectedMac: unknown,
  keyValue: unknown,
): Promise<boolean> {
  const key = parseDestinationKey(keyValue);
  if (typeof expectedMac !== "string") return false;
  const prefix = `cj1:hmac-sha256:${key.id}:`;
  if (!expectedMac.startsWith(prefix)) return false;
  const decoded = decodeBase64UrlSha256(expectedMac.slice(prefix.length));
  if (decoded === null) return false;
  return verifyAgentCanonicalHmacSha256(
    npBuildAgentConnectionDestinationCanonicalBytes(value).domainSeparatedUtf8,
    key.bytes,
    decoded,
  );
}

export function npAnalyzeAgentConnectionOperationCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentConnectionOperationRequestCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.connectionOperation", () =>
    parseConnectionOperationCanonical(value),
  );
}

export function npRequireAgentConnectionOperationCanonical(
  value: unknown,
): NpAgentConnectionOperationRequestCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentConnectionOperationCanonical(value),
    "Invalid Agent connection-operation canonical body",
  );
}

export function npBuildAgentConnectionOperationCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-connection-operation.v1",
  NpAgentConnectionOperationRequestCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    OPERATION_PURPOSE,
    npRequireAgentConnectionOperationCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-connection-operation.v1",
    NpAgentConnectionOperationRequestCanonicalV1
  >;
}

export async function npDigestAgentConnectionOperationCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentConnectionOperationCanonicalBytes(value).domainSeparatedUtf8,
  );
}
