import { createHash, createHmac } from "node:crypto";

import {
  npDigestAgentConnectionConfigCanonical,
  npMacAgentConnectionDestinationCanonical,
  npRequireAgentConnectionConfigCanonical,
  npRequireAgentConnectionDestinationCanonical,
  npRequireAgentJsonSchema,
  type NpAgentConnectionDestinationCanonicalV1,
  type NpAgentConnectionDestinationDescriptorV1,
  type NpAgentConnectionKind,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentJsonValue,
  type NpAgentModelPricingV1,
  type NpAgentProviderDataClass,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type {
  NpAgentConnectionCredentialEnvelopeV1,
  NpProviderCredentialLeaseV1,
  NpProviderOAuthCodeLeaseV1,
  NpProviderOAuthPkceLeaseV1,
} from "./vault-contract.js";

const TEXT_ENCODER = new TextEncoder();
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const DIGEST_PATTERN = /^cj1:sha256:[A-Za-z0-9_-]{43}$/u;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const FORBIDDEN_DESCRIPTOR_KEYS = new Set([
  "credential",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authorizationheader",
  "cookie",
  "signedurl",
]);
const FORBIDDEN_CONFIG_KEYS = new Set([
  ...FORBIDDEN_DESCRIPTOR_KEYS,
  "password",
  "secret",
  "clientsecret",
  "privatekey",
]);

export const npAgentProviderAdapterLimitsV1 = Object.freeze({
  identifierCharacters: 128,
  safeAccountHintCharacters: 256,
  safeCodeCharacters: 64,
  authorizationOrigins: 32,
  permissionItems: 128,
  permissionCharacters: 256,
  capabilityIds: 128,
  apiKeyBytes: 64 * 1024,
  accessTokenBytes: 64 * 1024,
  refreshTokenBytes: 64 * 1024,
  authorizationCodeBytes: 8 * 1024,
  pkceVerifierMinimumBytes: 43,
  pkceVerifierMaximumBytes: 128,
  providerSubjectBytes: 4 * 1024,
  authorizationUrlCharacters: 4_096,
  parsedConfigBytes: 256 * 1024,
  parsedConfigDepth: 8,
  destinationDescriptorBytes: 16 * 1024,
  destinationDescriptorDepth: 6,
  pricingEntries: 256,
  adapterCallMilliseconds: 60 * 1_000,
  workerLeaseSeconds: 90,
});

export class NpAgentProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "NpAgentProviderError";
  }
}

export interface NpAgentParsedConnectionConfigV1 {
  schemaVersion: "np.agent-parsed-connection-config.v1";
  connectionId: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  configVersion: number;
  configHash: string;
  config: NpAgentJsonObject;
  pricingCatalog: NpAgentModelPricingV1[];
  pricingCatalogFingerprint: string;
}

export interface NpAgentProviderOAuthAuthorizeInputV1 {
  schemaVersion: "np.agent-provider-oauth-authorize.v1";
  connection: NpAgentParsedConnectionConfigV1;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  requestedPermissions: string[];
  expiresAt: string;
}

export interface NpAgentProviderOAuthAuthorizeOutputV1 {
  schemaVersion: "np.agent-provider-oauth-authorize-result.v1";
  authorizationUrl: string;
}

export interface NpAgentProviderOAuthExchangeInputV1 {
  schemaVersion: "np.agent-provider-oauth-exchange.v1";
  connection: NpAgentParsedConnectionConfigV1;
  redirectUri: string;
  requestedPermissions: string[];
  expectedConfigVersion: number;
  expectedConfigHash: string;
}

export interface NpAgentProviderOAuthRefreshInputV1 {
  schemaVersion: "np.agent-provider-oauth-refresh.v1";
  connection: NpAgentParsedConnectionConfigV1;
  requestedPermissions: string[];
  expectedConfigVersion: number;
  expectedConfigHash: string;
  expectedSecretVersionId: string;
  expectedCredentialVersion: number;
  expectedRefreshGeneration: number;
}

export interface NpAgentProviderOAuthCredentialMaterialV1 {
  schemaVersion: "np.agent-provider-oauth-credential.v1";
  tokenType: "Bearer";
  accessToken: Uint8Array;
  refreshToken:
    | { mode: "replace"; token: Uint8Array; refreshExpiresAt: string | null }
    | { mode: "retain" }
    | { mode: "none" };
  accessExpiresAt: string;
  grantedPermissions: string[];
  providerSubject: Uint8Array | null;
}

export type NpAgentProviderAuthOperationResultV1 =
  | {
      schemaVersion: "np.agent-provider-auth-operation-result.v1";
      status: "success";
      credential: NpAgentProviderOAuthCredentialMaterialV1;
      safeAccountHint: string | null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-provider-auth-operation-result.v1";
      status: "failed";
      errorClass: "authorization" | "configuration" | "provider" | "network";
      retryable: boolean;
      safeCode: string;
      resultDigest: string;
    };

export type NpAgentProviderProbeResultV1 =
  | {
      schemaVersion: "np.agent-provider-probe-result.v1";
      status: "ready";
      providerSubject: Uint8Array;
      grantedPermissions: string[];
      capabilityIds: string[];
      safeCode: null;
      resultDigest: string;
    }
  | {
      schemaVersion: "np.agent-provider-probe-result.v1";
      status: "unauthorized" | "forbidden" | "unavailable";
      providerSubject: Uint8Array | null;
      grantedPermissions: [];
      capabilityIds: [];
      safeCode: string;
      resultDigest: string;
    };

export interface NpAgentProviderConnectionConfigInputV1 {
  schemaVersion: "np.agent-connection-config-parse.v1";
  connectionId: string;
  configVersion: number;
  config: NpAgentJsonObject;
}

export interface NpAgentConnectionAuthAdapterV1 {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly credentialEnvelopeVersions: readonly [1];
  readonly supportedConnectionKinds: readonly NpAgentConnectionKind[];
  readonly supportedAuthKinds: readonly ("api_key" | "oauth")[];
  readonly configSchema: NpAgentJsonSchema;
  readonly destinationDescriptorSchema: NpAgentJsonSchema | null;
  readonly oauth: {
    readonly authorizationOrigins: readonly string[];
    readonly permissionInventory: readonly string[];
    buildAuthorizationUrl(
      input: NpAgentProviderOAuthAuthorizeInputV1,
    ): NpAgentProviderOAuthAuthorizeOutputV1;
    exchangeAuthorizationCode(
      input: NpAgentProviderOAuthExchangeInputV1,
      context: {
        codeLease: NpProviderOAuthCodeLeaseV1;
        pkceLease: NpProviderOAuthPkceLeaseV1;
        signal: AbortSignal;
      },
    ): Promise<NpAgentProviderAuthOperationResultV1>;
    refreshCredential(
      input: NpAgentProviderOAuthRefreshInputV1,
      context: { credentialLease: NpProviderCredentialLeaseV1; signal: AbortSignal },
    ): Promise<NpAgentProviderAuthOperationResultV1>;
  } | null;
  parseConfig(input: NpAgentProviderConnectionConfigInputV1): NpAgentParsedConnectionConfigV1;
  deriveDestinationDescriptor(input: {
    parsedConfig: NpAgentParsedConnectionConfigV1;
  }): NpAgentConnectionDestinationDescriptorV1 | null;
  probeCredential(
    connection: NpAgentParsedConnectionConfigV1,
    context: { credentialLease: NpProviderCredentialLeaseV1; signal: AbortSignal },
  ): Promise<NpAgentProviderProbeResultV1>;
}

export interface NpAgentAccountSubjectKeyV1 {
  owner: "connection-account-subject";
  id: string;
  bytes: Uint8Array;
}

export interface NpAgentConnectionProjectionKeyringV1 {
  accountSubject: NpAgentAccountSubjectKeyV1;
  accountSubjectPrevious?: Readonly<Record<string, Uint8Array>>;
  destination: {
    owner: "connection-destination";
    id: string;
    bytes: Uint8Array;
  };
  destinationPrevious?: Readonly<Record<string, Uint8Array>>;
}

function fail(code: string, message: string): never {
  throw new NpAgentProviderError(code, message);
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("PROVIDER_CONTRACT_INVALID", `${path} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return fail("PROVIDER_CONTRACT_INVALID", `${path} must use an ordinary object prototype.`);
  }
  const actual = Reflect.ownKeys(value);
  const allowed = new Set(keys);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    return fail("PROVIDER_CONTRACT_INVALID", `${path} must contain the exact declared fields.`);
  }
  for (const key of actual) {
    if (typeof key !== "string")
      return fail("PROVIDER_CONTRACT_INVALID", `${path} contains a symbol field.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail("PROVIDER_CONTRACT_INVALID", `${path}.${key} must be an enumerable data field.`);
    }
  }
  return value as Record<string, unknown>;
}

function requireIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail("PROVIDER_CONTRACT_INVALID", `${path} must use the bounded identifier grammar.`);
  }
  return value;
}

function requireFingerprint(value: unknown, path: string): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    return fail("PROVIDER_CONTRACT_INVALID", `${path} must be a canonical Agent SHA-256 digest.`);
  }
  return value;
}

function requireDigest(value: unknown, path: string): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    return fail(
      "PROVIDER_RESULT_INVALID",
      `${path} must use the canonical SHA-256 digest grammar.`,
    );
  }
  return value;
}

function requireTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string")
    return fail("PROVIDER_RESULT_INVALID", `${path} must be UTC text.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return fail("PROVIDER_RESULT_INVALID", `${path} must be canonical UTC text.`);
  }
  return value;
}

function requireByteSource(value: unknown, path: string, maximum: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum) {
    return fail(
      "PROVIDER_RESULT_INVALID",
      `${path} must be non-empty bytes within its frozen ceiling.`,
    );
  }
  return value;
}

function requireBytes(value: unknown, path: string, maximum: number): Uint8Array {
  return new Uint8Array(requireByteSource(value, path, maximum));
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function requireSortedUnique(
  value: unknown,
  path: string,
  maximumItems: number,
  maximumCharacters: number,
  inventory?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return fail("PROVIDER_RESULT_INVALID", `${path} must be a bounded array.`);
  }
  const result = value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > maximumCharacters ||
      hasControlCharacters(entry) ||
      (inventory && !inventory.has(entry))
    ) {
      return fail("PROVIDER_RESULT_INVALID", `${path}[${index.toString()}] is invalid.`);
    }
    return entry;
  });
  if (
    new Set(result).size !== result.length ||
    result.some((entry, index) => index > 0 && result[index - 1] >= entry)
  ) {
    return fail("PROVIDER_RESULT_INVALID", `${path} must be sorted and unique.`);
  }
  return result;
}

function jsonDepthAndBytes(value: unknown): { depth: number; bytes: number } {
  const text = serializeAgentCanonicalJson(value);
  const walk = (entry: unknown, depth: number): number => {
    if (Array.isArray(entry)) return Math.max(depth, ...entry.map((item) => walk(item, depth + 1)));
    if (typeof entry === "object" && entry !== null) {
      return Math.max(depth, ...Object.values(entry).map((item) => walk(item, depth + 1)));
    }
    return depth;
  };
  return { depth: walk(value, 1), bytes: TEXT_ENCODER.encode(text).byteLength };
}

function requireJsonBounds(value: unknown, path: string, bytes: number, depth: number): void {
  let measured: { depth: number; bytes: number };
  try {
    measured = jsonDepthAndBytes(value);
  } catch {
    return fail("PROVIDER_CONTRACT_INVALID", `${path} must be canonical JSON.`);
  }
  if (measured.bytes > bytes || measured.depth > depth) {
    fail("PROVIDER_CONTRACT_INVALID", `${path} exceeds its frozen size or depth ceiling.`);
  }
}

function schemaTypeMatches(type: unknown, value: NpAgentJsonValue): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

/** A closed validator for the JSON-Schema subset used by provider configuration metadata. */
export function npRequireAgentProviderSchemaValueV1(
  schemaValue: NpAgentJsonSchema,
  value: NpAgentJsonValue,
  path = "agent.provider.schemaValue",
): void {
  validateSchemaValue(schemaValue, value, path, schemaValue, new Set());
}

function validateSchemaValue(
  schemaValue: NpAgentJsonSchema,
  value: NpAgentJsonValue,
  path: string,
  root: NpAgentJsonSchema,
  references: ReadonlySet<string>,
): void {
  const schema = schemaValue as Record<string, unknown>;
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.slice("#/$defs/".length);
    const definitions = root.$defs as Record<string, NpAgentJsonSchema> | undefined;
    const referenced = definitions?.[name];
    if (!referenced || references.has(name)) {
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} has an unresolved schema reference.`);
    }
    validateSchemaValue(referenced, value, path, root, new Set([...references, name]));
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((entry, index) =>
      validateSchemaValue(
        entry as NpAgentJsonSchema,
        value,
        `${path}.allOf[${index.toString()}]`,
        root,
        references,
      ),
    );
  }
  const alternatives = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : null;
  if (alternatives) {
    let matches = 0;
    for (const alternative of alternatives) {
      try {
        validateSchemaValue(alternative as NpAgentJsonSchema, value, path, root, references);
        matches += 1;
      } catch (error) {
        if (!(error instanceof NpAgentProviderError)) throw error;
      }
    }
    if (matches === 0 || (Array.isArray(schema.oneOf) && matches !== 1)) {
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} does not match its schema alternatives.`);
    }
  }
  if (
    schema.const !== undefined &&
    serializeAgentCanonicalJson(schema.const) !== serializeAgentCanonicalJson(value)
  ) {
    fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} does not match its schema constant.`);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some(
      (entry) => serializeAgentCanonicalJson(entry) === serializeAgentCanonicalJson(value),
    )
  ) {
    fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} is not a declared enum member.`);
  }
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
      ? []
      : [schema.type];
  if (types.length > 0 && !types.some((type) => schemaTypeMatches(type, value))) {
    fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} has the wrong JSON type.`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} is too short.`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} is too long.`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value))
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} does not match its pattern.`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} is below its minimum.`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} exceeds its maximum.`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} has too few items.`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} has too many items.`);
    if (
      schema.uniqueItems === true &&
      new Set(value.map(serializeAgentCanonicalJson)).size !== value.length
    )
      fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path} must have unique items.`);
    if (schema.items && typeof schema.items === "object")
      value.forEach((entry, index) =>
        validateSchemaValue(
          schema.items as NpAgentJsonSchema,
          entry,
          `${path}[${index.toString()}]`,
          root,
          references,
        ),
      );
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value;
    const properties = (schema.properties ?? {}) as Record<string, NpAgentJsonSchema>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    for (const key of required)
      if (!Object.hasOwn(object, key))
        fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path}.${key} is required.`);
    for (const [key, entry] of Object.entries(object)) {
      if (properties[key])
        validateSchemaValue(properties[key], entry, `${path}.${key}`, root, references);
      else if (schema.additionalProperties === false)
        fail("PROVIDER_CONFIG_SCHEMA_MISMATCH", `${path}.${key} is not declared.`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object")
        validateSchemaValue(
          schema.additionalProperties as NpAgentJsonSchema,
          entry,
          `${path}.${key}`,
          root,
          references,
        );
    }
  }
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  "$defs",
  "$ref",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "description",
  "enum",
  "items",
  "maximum",
  "maxItems",
  "maxLength",
  "minimum",
  "minItems",
  "minLength",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
  "uniqueItems",
]);

function requireSupportedSchema(schemaValue: NpAgentJsonSchema, path: string): void {
  const schema = schemaValue as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      fail("PROVIDER_CONTRACT_INVALID", `${path}.${key} is not supported by the provider host.`);
    }
  }
  if (typeof schema.pattern === "string") {
    try {
      new RegExp(schema.pattern, "u");
    } catch {
      fail("PROVIDER_CONTRACT_INVALID", `${path}.pattern is not a valid Unicode pattern.`);
    }
  }
  const properties = schema.properties as Record<string, NpAgentJsonSchema> | undefined;
  for (const [key, child] of Object.entries(properties ?? {})) {
    requireSupportedSchema(child, `${path}.properties.${key}`);
  }
  const definitions = schema.$defs as Record<string, NpAgentJsonSchema> | undefined;
  for (const [key, child] of Object.entries(definitions ?? {})) {
    requireSupportedSchema(child, `${path}.$defs.${key}`);
  }
  if (schema.items && typeof schema.items === "object") {
    requireSupportedSchema(schema.items as NpAgentJsonSchema, `${path}.items`);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const alternatives = schema[keyword];
    if (Array.isArray(alternatives)) {
      alternatives.forEach((child, index) =>
        requireSupportedSchema(
          child as NpAgentJsonSchema,
          `${path}.${keyword}[${index.toString()}]`,
        ),
      );
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    requireSupportedSchema(
      schema.additionalProperties as NpAgentJsonSchema,
      `${path}.additionalProperties`,
    );
  }
}

function requireKey(value: NpAgentAccountSubjectKeyV1): NpAgentAccountSubjectKeyV1 {
  if (
    value?.owner !== "connection-account-subject" ||
    !KEY_ID_PATTERN.test(value.id) ||
    !(value.bytes instanceof Uint8Array) ||
    value.bytes.byteLength < 32
  ) {
    return fail("PROVIDER_PROJECTION_KEY_INVALID", "The account-subject HMAC key is invalid.");
  }
  return { owner: value.owner, id: value.id, bytes: new Uint8Array(value.bytes) };
}

function frame(value: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + value.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, value.byteLength, false);
  result.set(value, 4);
  return result;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function npBuildAgentAccountSubjectDigestBytesV1(input: {
  siteId: string;
  adapterId: string;
  providerSubject: Uint8Array;
}): Uint8Array {
  requireIdentifier(input.adapterId, "agent.provider.accountSubject.adapterId");
  const subject = requireBytes(
    input.providerSubject,
    "agent.provider.accountSubject.providerSubject",
    npAgentProviderAdapterLimitsV1.providerSubjectBytes,
  );
  try {
    return concat(
      [
        TEXT_ENCODER.encode("np-agent-account-subject/v1"),
        TEXT_ENCODER.encode(input.siteId),
        TEXT_ENCODER.encode(input.adapterId),
        subject,
      ].map(frame),
    );
  } finally {
    subject.fill(0);
  }
}

export function npProjectAgentAccountSubjectV1(
  input: { siteId: string; adapterId: string; providerSubject: Uint8Array },
  keyValue: NpAgentAccountSubjectKeyV1,
): { keyId: string; digest: string } {
  const key = requireKey(keyValue);
  const bytes = npBuildAgentAccountSubjectDigestBytesV1(input);
  try {
    return {
      keyId: key.id,
      digest: createHmac("sha256", key.bytes).update(bytes).digest("base64url"),
    };
  } finally {
    key.bytes.fill(0);
    bytes.fill(0);
  }
}

function pricingFingerprint(value: readonly NpAgentModelPricingV1[]): `pc1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update("np-agent-pricing-catalog/v1\0", "utf8");
  hash.update(serializeAgentCanonicalJson([...value]), "utf8");
  return `pc1:sha256:${hash.digest("base64url")}`;
}

export async function npParseAgentProviderConnectionConfigV1(input: {
  adapter: NpAgentConnectionAuthAdapterV1;
  siteId: string;
  connectionId: string;
  kind: NpAgentConnectionKind;
  provider: string;
  authKind: "api_key" | "oauth";
  configVersion: number;
  config: NpAgentJsonObject;
  dataProcessingCeiling: NpAgentProviderDataClass;
  effectiveAt?: Date;
}): Promise<NpAgentParsedConnectionConfigV1> {
  if (
    !input.adapter.supportedConnectionKinds.includes(input.kind) ||
    !input.adapter.supportedAuthKinds.includes(input.authKind)
  ) {
    fail(
      "PROVIDER_CAPABILITY_UNSUPPORTED",
      "The provider adapter does not support the connection/auth pair.",
    );
  }
  requireJsonBounds(
    input.config,
    "agent.provider.config",
    npAgentProviderAdapterLimitsV1.parsedConfigBytes,
    npAgentProviderAdapterLimitsV1.parsedConfigDepth,
  );
  inspectJsonForForbiddenKeys(
    input.config,
    "agent.provider.config",
    FORBIDDEN_CONFIG_KEYS,
    "PROVIDER_CONFIG_SECRET_FORBIDDEN",
  );
  npRequireAgentProviderSchemaValueV1(
    input.adapter.configSchema,
    input.config,
    "agent.provider.config",
  );
  const parserInput = (): NpAgentProviderConnectionConfigInputV1 => ({
    schemaVersion: "np.agent-connection-config-parse.v1",
    connectionId: input.connectionId,
    configVersion: input.configVersion,
    config: structuredClone(input.config),
  });
  const [parsed, repeated] = (() => {
    try {
      return [input.adapter.parseConfig(parserInput()), input.adapter.parseConfig(parserInput())];
    } catch {
      return fail(
        "PROVIDER_CONFIG_CALLBACK_FAILED",
        "The provider config parser failed without a safe result.",
      );
    }
  })();
  const record = exactRecord(parsed, "agent.provider.parsedConfig", [
    "schemaVersion",
    "connectionId",
    "adapterId",
    "adapterContractVersion",
    "adapterFingerprint",
    "configVersion",
    "configHash",
    "config",
    "pricingCatalog",
    "pricingCatalogFingerprint",
  ]);
  exactRecord(repeated, "agent.provider.repeatedParsedConfig", [
    "schemaVersion",
    "connectionId",
    "adapterId",
    "adapterContractVersion",
    "adapterFingerprint",
    "configVersion",
    "configHash",
    "config",
    "pricingCatalog",
    "pricingCatalogFingerprint",
  ]);
  if (serializeAgentCanonicalJson(parsed) !== serializeAgentCanonicalJson(repeated)) {
    fail("PROVIDER_CONFIG_NONDETERMINISTIC", "The provider config parser is not deterministic.");
  }
  if (
    record.schemaVersion !== "np.agent-parsed-connection-config.v1" ||
    record.connectionId !== input.connectionId ||
    record.adapterId !== input.adapter.id ||
    record.adapterContractVersion !== input.adapter.contractVersion ||
    record.adapterFingerprint !== input.adapter.fingerprint ||
    record.configVersion !== input.configVersion
  ) {
    fail(
      "PROVIDER_CONFIG_RESULT_MISMATCH",
      "The parsed config does not preserve its frozen adapter identity.",
    );
  }
  const canonical = npRequireAgentConnectionConfigCanonical({
    schemaVersion: "np.agent-connection-config.v1",
    siteId: input.siteId,
    connectionId: input.connectionId,
    kind: input.kind,
    provider: input.provider,
    adapterId: input.adapter.id,
    adapterContractVersion: input.adapter.contractVersion,
    adapterFingerprint: input.adapter.fingerprint,
    authKind: input.authKind,
    configVersion: input.configVersion,
    config: record.config,
    pricingCatalog: record.pricingCatalog,
    dataProcessingCeiling: input.dataProcessingCeiling,
  });
  npRequireAgentProviderSchemaValueV1(
    input.adapter.configSchema,
    canonical.config,
    "agent.provider.parsedConfig.config",
  );
  inspectJsonForForbiddenKeys(
    canonical.config,
    "agent.provider.parsedConfig.config",
    FORBIDDEN_CONFIG_KEYS,
    "PROVIDER_CONFIG_SECRET_FORBIDDEN",
  );
  const effectiveAt = input.effectiveAt ?? new Date();
  if (!Number.isFinite(effectiveAt.getTime())) {
    fail("PROVIDER_CONFIG_RESULT_MISMATCH", "The pricing activation timestamp is invalid.");
  }
  for (const modelId of new Set(canonical.pricingCatalog.map((entry) => entry.modelId))) {
    const effective = canonical.pricingCatalog.filter(
      (entry) =>
        entry.modelId === modelId &&
        new Date(entry.effectiveFrom) <= effectiveAt &&
        (entry.effectiveUntil === null || effectiveAt < new Date(entry.effectiveUntil)),
    );
    if (effective.length !== 1) {
      fail(
        "PROVIDER_PRICING_NOT_EFFECTIVE",
        "Every configured model must have exactly one price at activation.",
      );
    }
  }
  const configHash = await npDigestAgentConnectionConfigCanonical(canonical);
  const catalogFingerprint = pricingFingerprint(canonical.pricingCatalog);
  // Adapter-declared hashes are advisory output from a pure parser. Non-empty mismatches fail closed.
  if (
    (record.configHash !== "" && record.configHash !== configHash) ||
    (record.pricingCatalogFingerprint !== "" &&
      record.pricingCatalogFingerprint !== catalogFingerprint)
  ) {
    fail(
      "PROVIDER_CONFIG_RESULT_MISMATCH",
      "The host cannot reproduce the provider config fingerprints.",
    );
  }
  return {
    schemaVersion: "np.agent-parsed-connection-config.v1",
    connectionId: input.connectionId,
    adapterId: input.adapter.id,
    adapterContractVersion: input.adapter.contractVersion,
    adapterFingerprint: input.adapter.fingerprint,
    configVersion: input.configVersion,
    configHash,
    config: canonical.config,
    pricingCatalog: canonical.pricingCatalog,
    pricingCatalogFingerprint: catalogFingerprint,
  };
}

function inspectDescriptorForSecrets(value: NpAgentJsonValue, path: string): void {
  inspectJsonForForbiddenKeys(
    value,
    path,
    FORBIDDEN_DESCRIPTOR_KEYS,
    "PROVIDER_DESTINATION_INVALID",
  );
}

function inspectJsonForForbiddenKeys(
  value: NpAgentJsonValue,
  path: string,
  forbidden: ReadonlySet<string>,
  code: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectJsonForForbiddenKeys(entry, `${path}[${index.toString()}]`, forbidden, code),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_.]/gu, "").toLowerCase();
    if (forbidden.has(normalized)) {
      fail(code, `${path}.${key} may contain credential material.`);
    }
    inspectJsonForForbiddenKeys(entry, `${path}.${key}`, forbidden, code);
  }
}

export async function npProjectAgentConnectionDestinationV1(input: {
  adapter: NpAgentConnectionAuthAdapterV1;
  siteId: string;
  connectionKind: NpAgentConnectionKind;
  parsedConfig: NpAgentParsedConnectionConfigV1;
  accountSubjectKeyId: string;
  accountSubjectDigest: string;
  destinationKey: NpAgentConnectionProjectionKeyringV1["destination"];
}): Promise<{
  keyId: string;
  descriptor: NpAgentConnectionDestinationDescriptorV1 | null;
  fingerprint: string | null;
}> {
  const [descriptor, repeatedDescriptor] = (() => {
    try {
      return [
        input.adapter.deriveDestinationDescriptor({
          parsedConfig: structuredClone(input.parsedConfig),
        }),
        input.adapter.deriveDestinationDescriptor({
          parsedConfig: structuredClone(input.parsedConfig),
        }),
      ];
    } catch {
      return fail(
        "PROVIDER_DESTINATION_CALLBACK_FAILED",
        "The provider destination callback failed without a safe result.",
      );
    }
  })();
  if (serializeAgentCanonicalJson(descriptor) !== serializeAgentCanonicalJson(repeatedDescriptor)) {
    fail(
      "PROVIDER_DESTINATION_NONDETERMINISTIC",
      "The provider destination derivation is not deterministic.",
    );
  }
  if (descriptor === null) {
    if (input.connectionKind === "notification")
      fail(
        "PROVIDER_DESTINATION_INVALID",
        "The notification adapter omitted its destination descriptor.",
      );
    return { keyId: input.destinationKey.id, descriptor: null, fingerprint: null };
  }
  if (input.connectionKind !== "notification")
    fail(
      "PROVIDER_DESTINATION_INVALID",
      "A non-notification connection returned a destination descriptor.",
    );
  if (input.adapter.destinationDescriptorSchema === null)
    fail(
      "PROVIDER_DESTINATION_INVALID",
      "The adapter returned an undeclared destination descriptor.",
    );
  exactRecord(descriptor, "agent.provider.destinationDescriptor", [
    "schemaVersion",
    "kind",
    "adapterId",
    "descriptor",
  ]);
  if (
    descriptor.schemaVersion !== "np.agent-connection-destination-descriptor.v1" ||
    descriptor.kind !== "notification" ||
    descriptor.adapterId !== input.adapter.id
  ) {
    fail("PROVIDER_DESTINATION_INVALID", "The destination descriptor envelope is invalid.");
  }
  requireJsonBounds(
    descriptor.descriptor,
    "agent.provider.destinationDescriptor.descriptor",
    npAgentProviderAdapterLimitsV1.destinationDescriptorBytes,
    npAgentProviderAdapterLimitsV1.destinationDescriptorDepth,
  );
  inspectDescriptorForSecrets(
    descriptor.descriptor,
    "agent.provider.destinationDescriptor.descriptor",
  );
  npRequireAgentProviderSchemaValueV1(
    input.adapter.destinationDescriptorSchema,
    descriptor.descriptor,
    "agent.provider.destinationDescriptor.descriptor",
  );
  const canonical: NpAgentConnectionDestinationCanonicalV1 =
    npRequireAgentConnectionDestinationCanonical({
      schemaVersion: "np.agent-connection-destination.v1",
      siteId: input.siteId,
      connectionId: input.parsedConfig.connectionId,
      adapterId: input.adapter.id,
      adapterContractVersion: input.adapter.contractVersion,
      adapterFingerprint: input.adapter.fingerprint,
      accountSubjectKeyId: input.accountSubjectKeyId,
      accountSubjectDigest: input.accountSubjectDigest,
      destinationDescriptor: descriptor,
    });
  return {
    keyId: input.destinationKey.id,
    descriptor: canonical.destinationDescriptor,
    fingerprint: await npMacAgentConnectionDestinationCanonical(canonical, input.destinationKey),
  };
}

export function npRequireAgentProviderAuthorizationUrlV1(
  value: unknown,
  authorizationOrigins: readonly string[],
): NpAgentProviderOAuthAuthorizeOutputV1 {
  const record = exactRecord(value, "agent.provider.authorizationResult", [
    "schemaVersion",
    "authorizationUrl",
  ]);
  if (
    record.schemaVersion !== "np.agent-provider-oauth-authorize-result.v1" ||
    typeof record.authorizationUrl !== "string" ||
    record.authorizationUrl.length > npAgentProviderAdapterLimitsV1.authorizationUrlCharacters
  ) {
    return fail(
      "PROVIDER_AUTHORIZATION_URL_INVALID",
      "The provider authorization result is invalid.",
    );
  }
  let url: URL;
  try {
    url = new URL(record.authorizationUrl);
  } catch {
    return fail("PROVIDER_AUTHORIZATION_URL_INVALID", "The provider authorization URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !authorizationOrigins.includes(url.origin)
  ) {
    return fail(
      "PROVIDER_AUTHORIZATION_URL_INVALID",
      "The provider authorization URL violates the registered origin policy.",
    );
  }
  if (url.toString() !== record.authorizationUrl) {
    fail(
      "PROVIDER_AUTHORIZATION_URL_INVALID",
      "The provider authorization URL must already be canonical.",
    );
  }
  return {
    schemaVersion: "np.agent-provider-oauth-authorize-result.v1",
    authorizationUrl: url.toString(),
  };
}

function requireCredentialMaterial(
  value: unknown,
  permissions: ReadonlySet<string>,
  mode: "exchange" | "refresh",
): NpAgentProviderOAuthCredentialMaterialV1 {
  const record = exactRecord(value, "agent.provider.credential", [
    "schemaVersion",
    "tokenType",
    "accessToken",
    "refreshToken",
    "accessExpiresAt",
    "grantedPermissions",
    "providerSubject",
  ]);
  if (
    record.schemaVersion !== "np.agent-provider-oauth-credential.v1" ||
    record.tokenType !== "Bearer"
  )
    fail("PROVIDER_RESULT_INVALID", "The OAuth credential envelope is invalid.");
  const refreshValue = record.refreshToken;
  if (typeof refreshValue !== "object" || refreshValue === null || Array.isArray(refreshValue))
    fail("PROVIDER_RESULT_INVALID", "The OAuth refresh branch is invalid.");
  const refreshMode = (refreshValue as { mode?: unknown }).mode;
  let refreshTokenSource: NpAgentProviderOAuthCredentialMaterialV1["refreshToken"];
  if (refreshMode === "replace") {
    const branch = exactRecord(refreshValue, "agent.provider.credential.refreshToken", [
      "mode",
      "token",
      "refreshExpiresAt",
    ]);
    refreshTokenSource = {
      mode: "replace",
      token: requireByteSource(
        branch.token,
        "agent.provider.credential.refreshToken.token",
        npAgentProviderAdapterLimitsV1.refreshTokenBytes,
      ),
      refreshExpiresAt:
        branch.refreshExpiresAt === null
          ? null
          : requireTimestamp(
              branch.refreshExpiresAt,
              "agent.provider.credential.refreshToken.refreshExpiresAt",
            ),
    };
  } else if (refreshMode === "retain") {
    exactRecord(refreshValue, "agent.provider.credential.refreshToken", ["mode"]);
    if (mode === "exchange")
      fail(
        "PROVIDER_RESULT_INVALID",
        "Authorization-code exchange cannot retain an absent prior refresh token.",
      );
    refreshTokenSource = { mode: "retain" };
  } else if (refreshMode === "none") {
    exactRecord(refreshValue, "agent.provider.credential.refreshToken", ["mode"]);
    refreshTokenSource = { mode: "none" };
  } else {
    return fail("PROVIDER_RESULT_INVALID", "The OAuth refresh branch is invalid.");
  }
  const accessTokenSource = requireByteSource(
    record.accessToken,
    "agent.provider.credential.accessToken",
    npAgentProviderAdapterLimitsV1.accessTokenBytes,
  );
  const accessExpiresAt = requireTimestamp(
    record.accessExpiresAt,
    "agent.provider.credential.accessExpiresAt",
  );
  const grantedPermissions = requireSortedUnique(
    record.grantedPermissions,
    "agent.provider.credential.grantedPermissions",
    npAgentProviderAdapterLimitsV1.permissionItems,
    npAgentProviderAdapterLimitsV1.permissionCharacters,
    permissions,
  );
  const providerSubjectSource =
    record.providerSubject === null
      ? null
      : requireByteSource(
          record.providerSubject,
          "agent.provider.credential.providerSubject",
          npAgentProviderAdapterLimitsV1.providerSubjectBytes,
        );
  return {
    schemaVersion: "np.agent-provider-oauth-credential.v1",
    tokenType: "Bearer",
    accessToken: new Uint8Array(accessTokenSource),
    refreshToken:
      refreshTokenSource.mode === "replace"
        ? { ...refreshTokenSource, token: new Uint8Array(refreshTokenSource.token) }
        : refreshTokenSource,
    accessExpiresAt,
    grantedPermissions,
    providerSubject: providerSubjectSource === null ? null : new Uint8Array(providerSubjectSource),
  };
}

export function npRequireAgentProviderAuthOperationResultV1(
  value: unknown,
  adapter: NpAgentConnectionAuthAdapterV1,
  mode: "exchange" | "refresh",
): NpAgentProviderAuthOperationResultV1 {
  if (!adapter.oauth) fail("PROVIDER_CAPABILITY_UNSUPPORTED", "The adapter has no OAuth contract.");
  const status = (value as { status?: unknown } | null)?.status;
  if (status === "success") {
    const record = exactRecord(value, "agent.provider.authResult", [
      "schemaVersion",
      "status",
      "credential",
      "safeAccountHint",
      "resultDigest",
    ]);
    if (record.schemaVersion !== "np.agent-provider-auth-operation-result.v1")
      fail("PROVIDER_RESULT_INVALID", "The provider auth result schema is invalid.");
    if (
      record.safeAccountHint !== null &&
      (typeof record.safeAccountHint !== "string" ||
        record.safeAccountHint.length > npAgentProviderAdapterLimitsV1.safeAccountHintCharacters)
    )
      fail("PROVIDER_RESULT_INVALID", "The safe account hint is invalid.");
    if (
      typeof record.safeAccountHint === "string" &&
      hasControlCharacters(record.safeAccountHint)
    ) {
      fail("PROVIDER_RESULT_INVALID", "The safe account hint contains control characters.");
    }
    const resultDigest = requireDigest(
      record.resultDigest,
      "agent.provider.authResult.resultDigest",
    );
    return {
      schemaVersion: "np.agent-provider-auth-operation-result.v1",
      status: "success",
      credential: requireCredentialMaterial(
        record.credential,
        new Set(adapter.oauth.permissionInventory),
        mode,
      ),
      safeAccountHint: record.safeAccountHint,
      resultDigest,
    };
  }
  if (status === "failed") {
    const record = exactRecord(value, "agent.provider.authResult", [
      "schemaVersion",
      "status",
      "errorClass",
      "retryable",
      "safeCode",
      "resultDigest",
    ]);
    if (
      record.schemaVersion !== "np.agent-provider-auth-operation-result.v1" ||
      !["authorization", "configuration", "provider", "network"].includes(
        record.errorClass as string,
      ) ||
      typeof record.retryable !== "boolean" ||
      typeof record.safeCode !== "string" ||
      !SAFE_CODE_PATTERN.test(record.safeCode)
    )
      fail("PROVIDER_RESULT_INVALID", "The provider failure result is invalid.");
    return {
      schemaVersion: "np.agent-provider-auth-operation-result.v1",
      status: "failed",
      errorClass: record.errorClass as "authorization" | "configuration" | "provider" | "network",
      retryable: record.retryable,
      safeCode: record.safeCode,
      resultDigest: requireDigest(record.resultDigest, "agent.provider.authResult.resultDigest"),
    };
  }
  return fail("PROVIDER_RESULT_INVALID", "The provider auth result has an unknown branch.");
}

export function npRequireAgentProviderProbeResultV1(
  value: unknown,
  adapter: NpAgentConnectionAuthAdapterV1,
): NpAgentProviderProbeResultV1 {
  const status = (value as { status?: unknown } | null)?.status;
  const record = exactRecord(value, "agent.provider.probeResult", [
    "schemaVersion",
    "status",
    "providerSubject",
    "grantedPermissions",
    "capabilityIds",
    "safeCode",
    "resultDigest",
  ]);
  if (record.schemaVersion !== "np.agent-provider-probe-result.v1")
    fail("PROVIDER_RESULT_INVALID", "The provider probe schema is invalid.");
  if (status === "ready") {
    const permissions = new Set(adapter.oauth?.permissionInventory ?? []);
    const providerSubject = requireByteSource(
      record.providerSubject,
      "agent.provider.probeResult.providerSubject",
      npAgentProviderAdapterLimitsV1.providerSubjectBytes,
    );
    const grantedPermissions = requireSortedUnique(
      record.grantedPermissions,
      "agent.provider.probeResult.grantedPermissions",
      npAgentProviderAdapterLimitsV1.permissionItems,
      npAgentProviderAdapterLimitsV1.permissionCharacters,
      adapter.oauth ? permissions : undefined,
    );
    const capabilityIds = requireSortedUnique(
      record.capabilityIds,
      "agent.provider.probeResult.capabilityIds",
      npAgentProviderAdapterLimitsV1.capabilityIds,
      npAgentProviderAdapterLimitsV1.identifierCharacters,
    ).map((entry) => requireIdentifier(entry, "agent.provider.probeResult.capabilityIds[]"));
    if (record.safeCode !== null) {
      fail("PROVIDER_RESULT_INVALID", "A ready probe cannot contain a safe code.");
    }
    const resultDigest = requireDigest(
      record.resultDigest,
      "agent.provider.probeResult.resultDigest",
    );
    return {
      schemaVersion: "np.agent-provider-probe-result.v1",
      status: "ready",
      providerSubject: new Uint8Array(providerSubject),
      grantedPermissions,
      capabilityIds,
      safeCode: null,
      resultDigest,
    };
  }
  if (
    !["unauthorized", "forbidden", "unavailable"].includes(status as string) ||
    record.providerSubject !== null ||
    !Array.isArray(record.grantedPermissions) ||
    record.grantedPermissions.length !== 0 ||
    !Array.isArray(record.capabilityIds) ||
    record.capabilityIds.length !== 0 ||
    typeof record.safeCode !== "string" ||
    !SAFE_CODE_PATTERN.test(record.safeCode)
  ) {
    return fail(
      "PROVIDER_RESULT_INVALID",
      "A non-ready probe must use the exact closed result branch.",
    );
  }
  return {
    schemaVersion: "np.agent-provider-probe-result.v1",
    status: status as "unauthorized" | "forbidden" | "unavailable",
    providerSubject: null,
    grantedPermissions: [],
    capabilityIds: [],
    safeCode: record.safeCode,
    resultDigest: requireDigest(record.resultDigest, "agent.provider.probeResult.resultDigest"),
  };
}

export function npZeroAgentProviderAuthResultV1(
  result: NpAgentProviderAuthOperationResultV1,
): void {
  const credential = (result as { credential?: unknown } | null)?.credential;
  if (typeof credential !== "object" || credential === null) return;
  const record = credential as Record<string, unknown>;
  if (record.accessToken instanceof Uint8Array) record.accessToken.fill(0);
  if (record.providerSubject instanceof Uint8Array) record.providerSubject.fill(0);
  const refresh = record.refreshToken;
  if (typeof refresh === "object" && refresh !== null) {
    const token = (refresh as Record<string, unknown>).token;
    if (token instanceof Uint8Array) token.fill(0);
  }
}

export function npZeroAgentProviderProbeResultV1(result: NpAgentProviderProbeResultV1): void {
  const providerSubject = (result as { providerSubject?: unknown } | null)?.providerSubject;
  if (providerSubject instanceof Uint8Array) providerSubject.fill(0);
}

export function npBuildAgentOAuthCredentialEnvelopeV1(input: {
  adapter: NpAgentConnectionAuthAdapterV1;
  credential: NpAgentProviderOAuthCredentialMaterialV1;
  retainedRefresh?: { token: Uint8Array; expiresAt: string | null } | null;
}): NpAgentConnectionCredentialEnvelopeV1 {
  const refresh =
    input.credential.refreshToken.mode === "replace"
      ? {
          mode: "present" as const,
          token: new Uint8Array(input.credential.refreshToken.token),
          expiresAt: input.credential.refreshToken.refreshExpiresAt,
        }
      : input.credential.refreshToken.mode === "retain"
        ? input.retainedRefresh
          ? {
              mode: "present" as const,
              token: new Uint8Array(input.retainedRefresh.token),
              expiresAt: input.retainedRefresh.expiresAt,
            }
          : fail(
              "PROVIDER_RESULT_INVALID",
              "OAuth refresh requested retain without prior material.",
            )
        : { mode: "absent" as const };
  return {
    schemaVersion: "np.agent-credential-envelope.v1",
    kind: "oauth",
    adapterId: input.adapter.id,
    adapterContractVersion: input.adapter.contractVersion,
    adapterFingerprint: input.adapter.fingerprint,
    tokenType: "Bearer",
    accessToken: new Uint8Array(input.credential.accessToken),
    accessExpiresAt: input.credential.accessExpiresAt,
    refresh,
    grantedPermissions: [...input.credential.grantedPermissions],
  };
}

function requireAdapter(value: NpAgentConnectionAuthAdapterV1): NpAgentConnectionAuthAdapterV1 {
  requireIdentifier(value?.id, "agent.provider.adapter.id");
  if (!Number.isSafeInteger(value.contractVersion) || value.contractVersion < 1)
    fail("PROVIDER_CONTRACT_INVALID", "The adapter contract version is invalid.");
  requireFingerprint(value.fingerprint, "agent.provider.adapter.fingerprint");
  if (
    !Array.isArray(value.credentialEnvelopeVersions) ||
    value.credentialEnvelopeVersions.length !== 1 ||
    value.credentialEnvelopeVersions[0] !== 1
  )
    fail("PROVIDER_CONTRACT_INVALID", "The adapter must support exactly credential envelope v1.");
  const kinds = requireSortedUnique(
    value.supportedConnectionKinds,
    "agent.provider.adapter.supportedConnectionKinds",
    2,
    32,
  );
  if (kinds.some((kind) => kind !== "model" && kind !== "notification"))
    fail("PROVIDER_CONTRACT_INVALID", "The adapter has an unsupported connection kind.");
  const authKinds = requireSortedUnique(
    value.supportedAuthKinds,
    "agent.provider.adapter.supportedAuthKinds",
    2,
    32,
  );
  if (authKinds.some((kind) => kind !== "api_key" && kind !== "oauth"))
    fail("PROVIDER_CONTRACT_INVALID", "The adapter has an unsupported auth kind.");
  npRequireAgentJsonSchema(value.configSchema);
  requireSupportedSchema(value.configSchema, "agent.provider.adapter.configSchema");
  if (value.destinationDescriptorSchema !== null) {
    npRequireAgentJsonSchema(value.destinationDescriptorSchema);
    requireSupportedSchema(
      value.destinationDescriptorSchema,
      "agent.provider.adapter.destinationDescriptorSchema",
    );
  }
  if (authKinds.includes("oauth") !== (value.oauth !== null))
    fail("PROVIDER_CONTRACT_INVALID", "OAuth support and metadata must be present together.");
  if (kinds.includes("notification") !== (value.destinationDescriptorSchema !== null))
    fail(
      "PROVIDER_CONTRACT_INVALID",
      "Notification support and destination schema must be present together.",
    );
  if (value.oauth) {
    if (
      value.oauth.authorizationOrigins.length === 0 ||
      value.oauth.authorizationOrigins.length > npAgentProviderAdapterLimitsV1.authorizationOrigins
    )
      fail("PROVIDER_CONTRACT_INVALID", "The OAuth authorization origin inventory is invalid.");
    const origins = value.oauth.authorizationOrigins.map((entry) => {
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        return fail("PROVIDER_CONTRACT_INVALID", "An OAuth authorization origin is invalid.");
      }
      if (
        url.protocol !== "https:" ||
        url.origin !== entry ||
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== ""
      )
        fail("PROVIDER_CONTRACT_INVALID", "OAuth origins must be exact HTTPS origins.");
      return entry;
    });
    if (
      new Set(origins).size !== origins.length ||
      origins.some((entry, index) => index > 0 && origins[index - 1] >= entry)
    )
      fail("PROVIDER_CONTRACT_INVALID", "OAuth origins must be sorted and unique.");
    requireSortedUnique(
      value.oauth.permissionInventory,
      "agent.provider.adapter.oauth.permissionInventory",
      npAgentProviderAdapterLimitsV1.permissionItems,
      npAgentProviderAdapterLimitsV1.permissionCharacters,
    );
    if (
      typeof value.oauth.buildAuthorizationUrl !== "function" ||
      typeof value.oauth.exchangeAuthorizationCode !== "function" ||
      typeof value.oauth.refreshCredential !== "function"
    ) {
      fail("PROVIDER_CONTRACT_INVALID", "The provider OAuth callbacks are incomplete.");
    }
  }
  if (
    typeof value.parseConfig !== "function" ||
    typeof value.deriveDestinationDescriptor !== "function" ||
    typeof value.probeCredential !== "function"
  )
    fail("PROVIDER_CONTRACT_INVALID", "The provider adapter callbacks are incomplete.");
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hardenAdapter(adapter: NpAgentConnectionAuthAdapterV1): NpAgentConnectionAuthAdapterV1 {
  const configSchema = deepFreeze(structuredClone(adapter.configSchema));
  const destinationDescriptorSchema =
    adapter.destinationDescriptorSchema === null
      ? null
      : deepFreeze(structuredClone(adapter.destinationDescriptorSchema));
  const oauth = adapter.oauth
    ? Object.freeze({
        authorizationOrigins: Object.freeze([...adapter.oauth.authorizationOrigins]),
        permissionInventory: Object.freeze([...adapter.oauth.permissionInventory]),
        buildAuthorizationUrl: adapter.oauth.buildAuthorizationUrl.bind(adapter.oauth),
        exchangeAuthorizationCode: adapter.oauth.exchangeAuthorizationCode.bind(adapter.oauth),
        refreshCredential: adapter.oauth.refreshCredential.bind(adapter.oauth),
      })
    : null;
  const credentialEnvelopeVersions: readonly [1] = Object.freeze([1]);
  return Object.freeze({
    id: adapter.id,
    contractVersion: adapter.contractVersion,
    fingerprint: adapter.fingerprint,
    credentialEnvelopeVersions,
    supportedConnectionKinds: Object.freeze([...adapter.supportedConnectionKinds]),
    supportedAuthKinds: Object.freeze([...adapter.supportedAuthKinds]),
    configSchema,
    destinationDescriptorSchema,
    oauth,
    parseConfig: adapter.parseConfig.bind(adapter),
    deriveDestinationDescriptor: adapter.deriveDestinationDescriptor.bind(adapter),
    probeCredential: adapter.probeCredential.bind(adapter),
  });
}

export class NpAgentConnectionAuthAdapterRegistryV1 {
  readonly #adapters = new Map<string, NpAgentConnectionAuthAdapterV1>();

  register(adapterValue: NpAgentConnectionAuthAdapterV1): this {
    const adapter = hardenAdapter(requireAdapter(adapterValue));
    const key = `${adapter.id}:${adapter.contractVersion.toString()}`;
    const existing = this.#adapters.get(key);
    if (existing) {
      if (existing.fingerprint === adapter.fingerprint) return this;
      fail(
        "PROVIDER_ADAPTER_CONFLICT",
        "The provider adapter identity is already bound to another fingerprint.",
      );
    }
    this.#adapters.set(key, adapter);
    return this;
  }

  resolve(input: {
    id: string;
    contractVersion: number;
    fingerprint: string;
  }): NpAgentConnectionAuthAdapterV1 {
    const adapter = this.#adapters.get(`${input.id}:${input.contractVersion.toString()}`);
    if (!adapter || adapter.fingerprint !== input.fingerprint)
      fail("PROVIDER_ADAPTER_UNAVAILABLE", "The frozen provider adapter is unavailable.");
    return adapter;
  }

  list(): readonly NpAgentConnectionAuthAdapterV1[] {
    return Object.freeze(
      [...this.#adapters.values()].sort(
        (left, right) =>
          left.id.localeCompare(right.id) || left.contractVersion - right.contractVersion,
      ),
    );
  }
}

export function npCreateAgentProviderResultDigestV1(
  kind: string,
  value: unknown,
): `cj1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(`np-agent-provider-result/v1\0${kind}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

export function npRequireAgentProviderPkceVerifierV1(value: Uint8Array): Uint8Array {
  const bytes = requireBytes(
    value,
    "agent.provider.pkceVerifier",
    npAgentProviderAdapterLimitsV1.pkceVerifierMaximumBytes,
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    !PKCE_PATTERN.test(text) ||
    TEXT_ENCODER.encode(text).byteLength < npAgentProviderAdapterLimitsV1.pkceVerifierMinimumBytes
  ) {
    bytes.fill(0);
    return fail("PROVIDER_PKCE_INVALID", "The provider PKCE verifier is invalid.");
  }
  return bytes;
}
