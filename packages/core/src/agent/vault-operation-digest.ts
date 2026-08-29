import { createHmac, timingSafeEqual } from "node:crypto";

import {
  npBuildAgentVaultAadCanonicalBytes,
  npRequireAgentVaultAadCanonical,
  type NpAgentVaultAadCanonicalV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentVaultError, npAgentVaultLimitsV1 } from "./vault-contract.js";

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;
const DIGEST_PATTERN = /^cj1:hmac-sha256:([a-z0-9][a-z0-9._-]{0,127}):([A-Za-z0-9_-]{43})$/u;

export interface NpAgentVaultRequestDigestKeyV1 {
  id: string;
  key: Uint8Array;
}

export interface NpAgentVaultRequestDigestKeyringV1 {
  active: NpAgentVaultRequestDigestKeyV1;
  previous?: Readonly<Record<string, Uint8Array>>;
}

export type NpAgentVaultOperationDigestInputV1 =
  | { kind: "seal"; plaintextEnvelope: Uint8Array }
  | {
      kind: "rewrap";
      secretRef: string;
      targetKeyId: string;
      targetKeyVersion: string;
    }
  | { kind: "destroy"; secretRef: string };

function fail(code: string, message: string): never {
  throw new NpAgentVaultError(code, message);
}

function requireKey(value: NpAgentVaultRequestDigestKeyV1): NpAgentVaultRequestDigestKeyV1 {
  if (
    !value ||
    !KEY_ID_PATTERN.test(value.id) ||
    !(value.key instanceof Uint8Array) ||
    value.key.byteLength < 32
  ) {
    return fail(
      "VAULT_REQUEST_DIGEST_KEY_INVALID",
      "The Agent vault request-digest key is invalid.",
    );
  }
  return { id: value.id, key: new Uint8Array(value.key) };
}

export function npCloneAgentVaultRequestDigestKeyringV1(
  value: NpAgentVaultRequestDigestKeyringV1,
): NpAgentVaultRequestDigestKeyringV1 {
  const active = requireKey(value.active);
  const previous: Record<string, Uint8Array> = {};
  try {
    for (const [id, bytes] of Object.entries(value.previous ?? {})) {
      const key = requireKey({ id, key: bytes });
      if (id === active.id || previous[id]) {
        key.key.fill(0);
        return fail(
          "VAULT_REQUEST_DIGEST_KEY_INVALID",
          "The Agent vault request-digest keyring contains duplicate ids.",
        );
      }
      previous[id] = key.key;
    }
    return { active, previous };
  } catch (error) {
    active.key.fill(0);
    for (const retained of Object.values(previous)) retained.fill(0);
    throw error;
  }
}

export function npResolveAgentVaultRequestDigestKeyV1(
  keyring: NpAgentVaultRequestDigestKeyringV1,
  keyId: string,
): NpAgentVaultRequestDigestKeyV1 {
  if (keyring.active.id === keyId) return keyring.active;
  const key = keyring.previous?.[keyId];
  if (!key) {
    return fail(
      "VAULT_REQUEST_DIGEST_KEY_UNAVAILABLE",
      "The frozen Agent vault request-digest key is unavailable.",
    );
  }
  return { id: keyId, key };
}

function frame(value: Uint8Array): Uint8Array {
  if (value.byteLength > 0xffff_ffff)
    return fail("VAULT_CONTRACT_INVALID", "A digest frame is too large.");
  const size = value.byteLength;
  const result = new Uint8Array(4 + size);
  result.set(
    Uint8Array.of((size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
  );
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

function canonicalOperationInput(input: NpAgentVaultOperationDigestInputV1): Uint8Array {
  if (input.kind === "seal") {
    if (
      !(input.plaintextEnvelope instanceof Uint8Array) ||
      input.plaintextEnvelope.byteLength === 0 ||
      input.plaintextEnvelope.byteLength > npAgentVaultLimitsV1.plaintextEnvelopeBytes
    ) {
      return fail("VAULT_CONTRACT_INVALID", "The seal digest input is invalid.");
    }
    return new Uint8Array(input.plaintextEnvelope);
  }
  if (
    typeof input.secretRef !== "string" ||
    input.secretRef.length === 0 ||
    input.secretRef.length > npAgentVaultLimitsV1.secretRefCharacters ||
    !VISIBLE_ASCII_PATTERN.test(input.secretRef)
  ) {
    return fail("VAULT_CONTRACT_INVALID", "The vault digest secret locator is invalid.");
  }
  if (
    input.kind === "rewrap" &&
    (typeof input.targetKeyId !== "string" ||
      typeof input.targetKeyVersion !== "string" ||
      !IDENTIFIER_PATTERN.test(input.targetKeyId) ||
      !IDENTIFIER_PATTERN.test(input.targetKeyVersion))
  ) {
    return fail("VAULT_CONTRACT_INVALID", "The rewrap digest target key is invalid.");
  }
  const value =
    input.kind === "rewrap"
      ? {
          secretRef: input.secretRef,
          targetKeyId: input.targetKeyId,
          targetKeyVersion: input.targetKeyVersion,
        }
      : { secretRef: input.secretRef };
  return new TextEncoder().encode(serializeAgentCanonicalJson(value));
}

export function npBuildAgentVaultOperationRequestDigestBytesV1(input: {
  siteId: string;
  kind: "seal" | "rewrap" | "destroy";
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  secretVersionId: string;
  idempotencyKey: string;
  aad: NpAgentVaultAadCanonicalV1;
  operationInput: NpAgentVaultOperationDigestInputV1;
}): Uint8Array {
  if (input.operationInput.kind !== input.kind) {
    return fail("VAULT_CONTRACT_INVALID", "The vault digest kind does not match its input branch.");
  }
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.length === 0 ||
    input.idempotencyKey.length > npAgentVaultLimitsV1.idempotencyKeyCharacters ||
    !VISIBLE_ASCII_PATTERN.test(input.idempotencyKey)
  ) {
    return fail("VAULT_CONTRACT_INVALID", "The vault digest idempotency key is invalid.");
  }
  const aad = npRequireAgentVaultAadCanonical(input.aad);
  if (
    aad.siteId !== input.siteId ||
    aad.secretVersionId !== input.secretVersionId ||
    aad.vaultAdapterId !== input.adapterId ||
    aad.vaultAdapterContractVersion !== input.adapterContractVersion ||
    aad.vaultAdapterFingerprint !== input.adapterFingerprint
  ) {
    return fail("VAULT_AAD_MISMATCH", "The vault digest metadata does not match its AAD.");
  }
  const encode = (value: string) => new TextEncoder().encode(value);
  const operationInput = canonicalOperationInput(input.operationInput);
  try {
    return concat(
      [
        encode("np-agent-vault-operation-request/v1"),
        encode(input.siteId),
        encode(input.kind),
        encode(input.adapterId),
        encode(input.adapterContractVersion.toString()),
        encode(input.adapterFingerprint),
        encode(input.secretVersionId),
        encode(input.idempotencyKey),
        npBuildAgentVaultAadCanonicalBytes(aad).canonicalJsonUtf8,
        operationInput,
      ].map(frame),
    );
  } finally {
    operationInput.fill(0);
  }
}

export function npDigestAgentVaultOperationRequestV1(
  input: Parameters<typeof npBuildAgentVaultOperationRequestDigestBytesV1>[0],
  keyValue: NpAgentVaultRequestDigestKeyV1,
): `cj1:hmac-sha256:${string}:${string}` {
  const key = requireKey(keyValue);
  const framed = npBuildAgentVaultOperationRequestDigestBytesV1(input);
  try {
    const mac = createHmac("sha256", key.key).update(framed).digest("base64url");
    return `cj1:hmac-sha256:${key.id}:${mac}`;
  } finally {
    key.key.fill(0);
    framed.fill(0);
  }
}

export function npVerifyAgentVaultOperationRequestDigestV1(
  digest: string,
  input: Parameters<typeof npBuildAgentVaultOperationRequestDigestBytesV1>[0],
  keyring: NpAgentVaultRequestDigestKeyringV1,
): boolean {
  const match = DIGEST_PATTERN.exec(digest);
  if (!match) return false;
  const key = npResolveAgentVaultRequestDigestKeyV1(keyring, match[1]);
  const expected = npDigestAgentVaultOperationRequestV1(input, key);
  const left = Buffer.from(digest, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
