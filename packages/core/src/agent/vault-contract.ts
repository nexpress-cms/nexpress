import type { NpAgentVaultAadCanonicalV1, NpAgentVaultAlgorithm } from "../agent-contract/index.js";

export const npAgentVaultLimitsV1 = Object.freeze({
  adapterIdCharacters: 128,
  adapterFingerprintCharacters: 256,
  secretRefCharacters: 2_048,
  keyIdCharacters: 128,
  keyVersionCharacters: 128,
  idempotencyKeyCharacters: 256,
  digestCharacters: 256,
  safeCodeCharacters: 64,
  healthSafeCodes: 32,
  aadBytes: 8 * 1_024,
  plaintextEnvelopeBytes: 160 * 1_024,
  plaintextLeaseSeconds: 5 * 60,
  adapterCallMilliseconds: 60 * 1_000,
  workerLeaseSeconds: 90,
  maximumAttempt: 65_535,
  retryBackoffSeconds: [5, 15, 30, 60, 300, 900, 3_600] as const,
});

export type NpAgentConnectionCredentialEnvelopeV1 =
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "api_key";
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      secret: Uint8Array;
    }
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "oauth";
      adapterId: string;
      adapterContractVersion: number;
      adapterFingerprint: string;
      tokenType: "Bearer";
      accessToken: Uint8Array;
      accessExpiresAt: string;
      refresh:
        { mode: "present"; token: Uint8Array; expiresAt: string | null } | { mode: "absent" };
      grantedPermissions: string[];
    };

export type NpAgentVaultPlaintextEnvelopeV1 =
  | NpAgentConnectionCredentialEnvelopeV1
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "provider_oauth_pkce";
      verifier: Uint8Array;
    }
  | {
      schemaVersion: "np.agent-credential-envelope.v1";
      kind: "provider_oauth_code";
      code: Uint8Array;
    };

export interface NpVaultSealRequestV1 {
  schemaVersion: "np.agent-vault-seal.v1";
  aad: NpAgentVaultAadCanonicalV1;
  plaintext: Uint8Array;
  idempotencyKey: string;
  requestDigest: string;
}

export interface NpVaultStoredValueV1 {
  secretRef: string;
  secretVersionId: string;
  aadDigest: string;
  algorithm: NpAgentVaultAlgorithm;
  keyId: string;
  keyVersion: string;
}

export type NpVaultSealResultV1 = NpVaultStoredValueV1 & {
  schemaVersion: "np.agent-vault-seal-result.v1";
  status: "sealed" | "already_sealed";
};

export type NpVaultRewrapResultV1 = NpVaultStoredValueV1 & {
  schemaVersion: "np.agent-vault-rewrap-result.v1";
  status: "rewrapped" | "already_rewrapped";
};

export interface NpVaultOpenRequestV1 {
  schemaVersion: "np.agent-vault-open.v1";
  secretRef: string;
  expectedAad: NpAgentVaultAadCanonicalV1;
}

export interface NpVaultPlaintextLeaseV1 {
  readonly secretVersionId: string;
  readonly aadDigest: string;
  readonly expiresAt: string;
  use<T>(consumer: (bytes: Uint8Array) => Promise<T>): Promise<T>;
  dispose(): void;
}

export interface NpProviderCredentialLeaseV1 {
  readonly secretVersionId: string;
  readonly envelopeVersion: 1;
  readonly expiresAt: string;
  use<T>(consumer: (credential: NpAgentConnectionCredentialEnvelopeV1) => Promise<T>): Promise<T>;
  dispose(): void;
}

export interface NpProviderOAuthCodeLeaseV1 {
  readonly secretVersionId: string;
  readonly purpose: "provider-oauth-code";
  readonly expiresAt: string;
  use<T>(consumer: (code: Uint8Array) => Promise<T>): Promise<T>;
  dispose(): void;
}

export interface NpProviderOAuthPkceLeaseV1 {
  readonly secretVersionId: string;
  readonly purpose: "provider-oauth-pkce";
  readonly expiresAt: string;
  use<T>(consumer: (verifier: Uint8Array) => Promise<T>): Promise<T>;
  dispose(): void;
}

export interface NpVaultRewrapRequestV1 {
  schemaVersion: "np.agent-vault-rewrap.v1";
  secretRef: string;
  expectedAad: NpAgentVaultAadCanonicalV1;
  targetKeyId: string;
  targetKeyVersion: string;
  idempotencyKey: string;
  requestDigest: string;
}

export interface NpVaultDestroyRequestV1 {
  schemaVersion: "np.agent-vault-destroy.v1";
  secretRef: string;
  expectedAad: NpAgentVaultAadCanonicalV1;
  idempotencyKey: string;
  requestDigest: string;
}

export interface NpVaultDestroyResultV1 {
  schemaVersion: "np.agent-vault-destroy-result.v1";
  status: "destroyed" | "already_absent";
  resultDigest: string;
}

export interface NpVaultHealthV1 {
  schemaVersion: "np.agent-vault-health.v1";
  status: "ready" | "degraded" | "unavailable";
  checkedAt: string;
  keyId: string | null;
  safeCodes: string[];
}

export interface NpVaultOperationInspectRequestV1 {
  schemaVersion: "np.agent-vault-operation-inspect.v1";
  kind: "seal" | "rewrap" | "destroy";
  idempotencyKey: string;
  requestDigest: string;
}

export type NpVaultOperationInspectResultV1 =
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "seal" | "rewrap" | "destroy";
      state: "pending" | "absent";
      sealed: null;
      destroyed: null;
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "seal" | "rewrap" | "destroy";
      state: "failed";
      sealed: null;
      destroyed: null;
      safeCode: string;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "seal";
      state: "succeeded";
      sealed: NpVaultSealResultV1;
      destroyed: null;
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "rewrap";
      state: "succeeded";
      sealed: NpVaultRewrapResultV1;
      destroyed: null;
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1";
      kind: "destroy";
      state: "succeeded";
      sealed: null;
      destroyed: NpVaultDestroyResultV1;
      safeCode: null;
      resultDigest: string;
    };

export interface NpAgentVaultAdapterV1 {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly kind: "local-envelope" | `custom:${string}`;
  readonly algorithm: NpAgentVaultAlgorithm;
  seal(input: NpVaultSealRequestV1, options: { signal: AbortSignal }): Promise<NpVaultSealResultV1>;
  open(
    input: NpVaultOpenRequestV1,
    options: { signal: AbortSignal },
  ): Promise<NpVaultPlaintextLeaseV1>;
  rewrap?(
    input: NpVaultRewrapRequestV1,
    options: { signal: AbortSignal },
  ): Promise<NpVaultRewrapResultV1>;
  destroy(
    input: NpVaultDestroyRequestV1,
    options: { signal: AbortSignal },
  ): Promise<NpVaultDestroyResultV1>;
  inspectOperation(
    input: NpVaultOperationInspectRequestV1,
    options: { signal: AbortSignal },
  ): Promise<NpVaultOperationInspectResultV1>;
  healthCheck?(options: { signal: AbortSignal }): Promise<NpVaultHealthV1>;
  shutdown?(options: { signal: AbortSignal }): void | Promise<void>;
}

export class NpAgentVaultError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "NpAgentVaultError";
  }
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CUSTOM_PATTERN = /^custom:[a-z0-9][a-z0-9._-]{0,63}$/u;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const DIGEST_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}:(?:[a-z0-9-]+:)*[A-Za-z0-9._-]{1,128}$/u;

function fail(path: string, message: string): never {
  throw new NpAgentVaultError("VAULT_CONTRACT_INVALID", `Invalid ${path}: ${message}.`);
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, "must use the ordinary object prototype");
  }
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string") || actual.length !== keys.length) {
    return fail(path, "must contain the exact declared fields");
  }
  const allowed = new Set(keys);
  for (const key of actual) {
    if (typeof key !== "string" || !allowed.has(key)) {
      return fail(path, "must contain the exact declared fields");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail(`${path}.${key}`, "must be one enumerable data property");
    }
  }
  return value as Record<string, unknown>;
}

function requireIdentifier(value: unknown, path: string, maximum = 128): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return fail(path, "must use the bounded lowercase identifier grammar");
  }
  return value;
}

function requireVisibleAscii(value: unknown, path: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !VISIBLE_ASCII_PATTERN.test(value)
  ) {
    return fail(path, "must be bounded visible ASCII");
  }
  return value;
}

function requireDigest(value: unknown, path: string): string {
  const digest = requireVisibleAscii(value, path, npAgentVaultLimitsV1.digestCharacters);
  if (!DIGEST_PATTERN.test(digest)) return fail(path, "must use a declared digest grammar");
  return digest;
}

function requireSafeCode(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAFE_CODE_PATTERN.test(value)) {
    return fail(path, "must use the stable safe-code grammar");
  }
  return value;
}

function requireCanonicalTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "must be a canonical UTC timestamp");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return fail(path, "must be a canonical UTC timestamp");
  }
  return value;
}

function requireStoredValue(
  value: unknown,
  path: string,
  schemaVersion: "np.agent-vault-seal-result.v1" | "np.agent-vault-rewrap-result.v1",
  statuses: readonly string[],
): NpVaultSealResultV1 | NpVaultRewrapResultV1 {
  const record = exactRecord(value, path, [
    "schemaVersion",
    "status",
    "secretRef",
    "secretVersionId",
    "aadDigest",
    "algorithm",
    "keyId",
    "keyVersion",
  ]);
  if (record.schemaVersion !== schemaVersion || !statuses.includes(String(record.status))) {
    return fail(path, "has an invalid schema version or status");
  }
  const algorithm = record.algorithm;
  if (
    algorithm !== "AES-256-GCM" &&
    (typeof algorithm !== "string" || !CUSTOM_PATTERN.test(algorithm))
  ) {
    return fail(`${path}.algorithm`, "must be AES-256-GCM or one custom algorithm");
  }
  return {
    schemaVersion,
    status: record.status as never,
    secretRef: requireVisibleAscii(
      record.secretRef,
      `${path}.secretRef`,
      npAgentVaultLimitsV1.secretRefCharacters,
    ),
    secretVersionId: requireVisibleAscii(record.secretVersionId, `${path}.secretVersionId`, 128),
    aadDigest: requireDigest(record.aadDigest, `${path}.aadDigest`),
    algorithm,
    keyId: requireIdentifier(record.keyId, `${path}.keyId`),
    keyVersion: requireIdentifier(record.keyVersion, `${path}.keyVersion`),
  } as NpVaultSealResultV1 | NpVaultRewrapResultV1;
}

export function npRequireVaultSealResultV1(value: unknown): NpVaultSealResultV1 {
  return requireStoredValue(value, "agent.vault.sealResult", "np.agent-vault-seal-result.v1", [
    "sealed",
    "already_sealed",
  ]) as NpVaultSealResultV1;
}

export function npRequireVaultRewrapResultV1(value: unknown): NpVaultRewrapResultV1 {
  return requireStoredValue(value, "agent.vault.rewrapResult", "np.agent-vault-rewrap-result.v1", [
    "rewrapped",
    "already_rewrapped",
  ]) as NpVaultRewrapResultV1;
}

export function npRequireVaultDestroyResultV1(value: unknown): NpVaultDestroyResultV1 {
  const path = "agent.vault.destroyResult";
  const record = exactRecord(value, path, ["schemaVersion", "status", "resultDigest"]);
  if (
    record.schemaVersion !== "np.agent-vault-destroy-result.v1" ||
    (record.status !== "destroyed" && record.status !== "already_absent")
  ) {
    return fail(path, "has an invalid schema version or status");
  }
  return {
    schemaVersion: "np.agent-vault-destroy-result.v1",
    status: record.status,
    resultDigest: requireDigest(record.resultDigest, `${path}.resultDigest`),
  };
}

export function npRequireVaultInspectResultV1(
  value: unknown,
  expectedKind: NpVaultOperationInspectRequestV1["kind"],
): NpVaultOperationInspectResultV1 {
  const path = "agent.vault.inspectResult";
  const record = exactRecord(value, path, [
    "schemaVersion",
    "kind",
    "state",
    "sealed",
    "destroyed",
    "safeCode",
    "resultDigest",
  ]);
  if (
    record.schemaVersion !== "np.agent-vault-operation-inspect-result.v1" ||
    record.kind !== expectedKind
  ) {
    return fail(path, "must echo the requested kind and schema version");
  }
  const resultDigest = requireDigest(record.resultDigest, `${path}.resultDigest`);
  if (record.state === "pending" || record.state === "absent") {
    if (record.sealed !== null || record.destroyed !== null || record.safeCode !== null) {
      return fail(path, "pending/absent must contain only null result branches");
    }
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: expectedKind,
      state: record.state,
      sealed: null,
      destroyed: null,
      safeCode: null,
      resultDigest,
    };
  }
  if (record.state === "failed") {
    if (record.sealed !== null || record.destroyed !== null) {
      return fail(path, "failed inspection must not carry a success receipt");
    }
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: expectedKind,
      state: "failed",
      sealed: null,
      destroyed: null,
      safeCode: requireSafeCode(record.safeCode, `${path}.safeCode`),
      resultDigest,
    };
  }
  if (record.state !== "succeeded" || record.safeCode !== null) {
    return fail(path, "must use a supported total inspection state");
  }
  if (expectedKind === "destroy") {
    if (record.sealed !== null || record.destroyed === null) {
      return fail(path, "destroy success must contain only a destroy receipt");
    }
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: "destroy",
      state: "succeeded",
      sealed: null,
      destroyed: npRequireVaultDestroyResultV1(record.destroyed),
      safeCode: null,
      resultDigest,
    };
  }
  if (record.sealed === null || record.destroyed !== null) {
    return fail(path, "seal/rewrap success must contain only its stored-value receipt");
  }
  if (expectedKind === "seal") {
    return {
      schemaVersion: "np.agent-vault-operation-inspect-result.v1",
      kind: "seal",
      state: "succeeded",
      sealed: npRequireVaultSealResultV1(record.sealed),
      destroyed: null,
      safeCode: null,
      resultDigest,
    };
  }
  return {
    schemaVersion: "np.agent-vault-operation-inspect-result.v1",
    kind: "rewrap",
    state: "succeeded",
    sealed: npRequireVaultRewrapResultV1(record.sealed),
    destroyed: null,
    safeCode: null,
    resultDigest,
  };
}

export function npRequireVaultHealthV1(value: unknown): NpVaultHealthV1 {
  const path = "agent.vault.health";
  const record = exactRecord(value, path, [
    "schemaVersion",
    "status",
    "checkedAt",
    "keyId",
    "safeCodes",
  ]);
  if (
    record.schemaVersion !== "np.agent-vault-health.v1" ||
    !["ready", "degraded", "unavailable"].includes(String(record.status))
  ) {
    return fail(path, "has an invalid schema version or status");
  }
  if (
    !Array.isArray(record.safeCodes) ||
    record.safeCodes.length > npAgentVaultLimitsV1.healthSafeCodes
  ) {
    return fail(`${path}.safeCodes`, "must be a bounded array");
  }
  const safeCodes = record.safeCodes.map((code, index) =>
    requireSafeCode(code, `${path}.safeCodes[${index.toString()}]`),
  );
  if (
    new Set(safeCodes).size !== safeCodes.length ||
    safeCodes.some((code, index) => index > 0 && safeCodes[index - 1] >= code)
  ) {
    return fail(`${path}.safeCodes`, "must be sorted and unique");
  }
  return {
    schemaVersion: "np.agent-vault-health.v1",
    status: record.status as NpVaultHealthV1["status"],
    checkedAt: requireCanonicalTimestamp(record.checkedAt, `${path}.checkedAt`),
    keyId: record.keyId === null ? null : requireIdentifier(record.keyId, `${path}.keyId`),
    safeCodes,
  };
}

export function npRequireAgentVaultAdapterV1(value: unknown): NpAgentVaultAdapterV1 {
  if (typeof value !== "object" || value === null) {
    return fail("agent.vault.adapter", "must be an object");
  }
  const adapter = value as Partial<NpAgentVaultAdapterV1>;
  requireIdentifier(adapter.id, "agent.vault.adapter.id");
  if (!Number.isSafeInteger(adapter.contractVersion) || Number(adapter.contractVersion) <= 0) {
    return fail("agent.vault.adapter.contractVersion", "must be a positive safe integer");
  }
  requireVisibleAscii(
    adapter.fingerprint,
    "agent.vault.adapter.fingerprint",
    npAgentVaultLimitsV1.adapterFingerprintCharacters,
  );
  if (
    adapter.kind !== "local-envelope" &&
    (typeof adapter.kind !== "string" || !CUSTOM_PATTERN.test(adapter.kind))
  ) {
    return fail("agent.vault.adapter.kind", "must be local-envelope or one custom kind");
  }
  if (
    adapter.algorithm !== "AES-256-GCM" &&
    (typeof adapter.algorithm !== "string" || !CUSTOM_PATTERN.test(adapter.algorithm))
  ) {
    return fail("agent.vault.adapter.algorithm", "must be AES-256-GCM or one custom algorithm");
  }
  if (
    adapter.kind === "local-envelope" &&
    (adapter.id !== "local-envelope" || adapter.algorithm !== "AES-256-GCM")
  ) {
    return fail("agent.vault.adapter", "the built-in adapter identity and algorithm are fixed");
  }
  for (const method of ["seal", "open", "destroy", "inspectOperation"] as const) {
    if (typeof adapter[method] !== "function") {
      return fail(`agent.vault.adapter.${method}`, "must be a function");
    }
  }
  for (const method of ["rewrap", "healthCheck", "shutdown"] as const) {
    if (adapter[method] !== undefined && typeof adapter[method] !== "function") {
      return fail(`agent.vault.adapter.${method}`, "must be a function when provided");
    }
  }
  return adapter as NpAgentVaultAdapterV1;
}

export function npAgentVaultRetryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > npAgentVaultLimitsV1.maximumAttempt) {
    return fail("agent.vault.attempt", "must be within the frozen attempt range");
  }
  const index = Math.min(attempt - 1, npAgentVaultLimitsV1.retryBackoffSeconds.length - 1);
  return npAgentVaultLimitsV1.retryBackoffSeconds[index];
}
