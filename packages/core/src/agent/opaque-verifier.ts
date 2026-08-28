import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { npAuthUuidPattern } from "../auth-contract/contract.js";
import { npIsCanonicalSiteId } from "../settings/contract.js";

export const npAgentOpaqueVerifierPurposesV1 = [
  "service-token",
  "authorization-code",
  "refresh-token",
  "oauth-consent",
  "provider-state",
  "approval-challenge",
] as const;

export type NpAgentOpaqueVerifierPurposeV1 = (typeof npAgentOpaqueVerifierPurposesV1)[number];

export interface NpAgentTokenHashKeyring {
  active: { id: string; key: Uint8Array };
  previous?: Readonly<Record<string, Uint8Array>>;
}

export interface NpAgentMintedOpaqueVerifierV1 {
  value: string;
  prefix: string;
  publicId: string;
  hashKeyId: string;
  verifier: string;
}

const UUID_SOURCE = npAuthUuidPattern.slice(1, -1);
const UUID_PATTERN = new RegExp(npAuthUuidPattern, "u");
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const VERIFIER_PATTERN = /^ov1:hmac-sha256:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9_-]{43})$/u;
const encoder = new TextEncoder();

const purposePrefixes: Readonly<Record<NpAgentOpaqueVerifierPurposeV1, string>> = Object.freeze({
  "service-token": "npst1",
  "authorization-code": "npac1",
  "refresh-token": "nprt1",
  "oauth-consent": "npoc1",
  "provider-state": "npps1",
  "approval-challenge": "npap1",
});

function requireKey(id: string, key: Uint8Array): void {
  if (!KEY_ID_PATTERN.test(id) || key.byteLength !== 32) {
    throw new Error("Agent token hash keys require a canonical id and exactly 32 bytes.");
  }
}

function requireContext(siteId: string, publicId: string): void {
  if (!npIsCanonicalSiteId(siteId) || !UUID_PATTERN.test(publicId)) {
    throw new Error("Agent opaque verifier context is not canonical.");
  }
}

function secretBytes(secret: string): Buffer | null {
  if (!SECRET_PATTERN.test(secret)) return null;
  const decoded = Buffer.from(secret, "base64url");
  return decoded.byteLength === 32 && decoded.toString("base64url") === secret ? decoded : null;
}

function verifierDigest(
  key: Uint8Array,
  purpose: NpAgentOpaqueVerifierPurposeV1,
  siteId: string,
  publicId: string,
  secret: Uint8Array,
): Buffer {
  const domain = encoder.encode(
    `np.agent-opaque-verifier.v1\0${purpose}\0${siteId}\0${publicId}\0`,
  );
  return createHmac("sha256", key).update(domain).update(secret).digest();
}

function resolveKey(keyring: NpAgentTokenHashKeyring, keyId: string): Uint8Array | null {
  requireKey(keyring.active.id, keyring.active.key);
  for (const [id, key] of Object.entries(keyring.previous ?? {})) requireKey(id, key);
  if (keyring.active.id === keyId) return keyring.active.key;
  return keyring.previous?.[keyId] ?? null;
}

/** Mint one 256-bit opaque verifier. The returned value must be displayed once and never stored. */
export function npMintAgentOpaqueVerifierV1(input: {
  purpose: NpAgentOpaqueVerifierPurposeV1;
  siteId: string;
  publicId: string;
  keyring: NpAgentTokenHashKeyring;
}): NpAgentMintedOpaqueVerifierV1 {
  requireContext(input.siteId, input.publicId);
  requireKey(input.keyring.active.id, input.keyring.active.key);
  const prefix = purposePrefixes[input.purpose];
  const secret = randomBytes(32);
  const value = `${prefix}_${input.publicId}_${secret.toString("base64url")}`;
  if (Buffer.byteLength(value, "ascii") > 96) {
    throw new Error("Agent opaque verifier exceeds its wire bound.");
  }
  const digest = verifierDigest(
    input.keyring.active.key,
    input.purpose,
    input.siteId,
    input.publicId,
    secret,
  );
  return {
    value,
    prefix: `${prefix}_${input.publicId}`,
    publicId: input.publicId,
    hashKeyId: input.keyring.active.id,
    verifier: `ov1:hmac-sha256:${input.keyring.active.id}:${digest.toString("base64url")}`,
  };
}

/** Parse only the closed grammar needed for a bounded public-id lookup. */
export function npParseAgentOpaqueVerifierV1(
  purpose: NpAgentOpaqueVerifierPurposeV1,
  value: unknown,
): { publicId: string; secret: Uint8Array } | null {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 96) return null;
  const expectedPrefix = purposePrefixes[purpose];
  const match = new RegExp(`^${expectedPrefix}_(${UUID_SOURCE})_([A-Za-z0-9_-]{43})$`, "u").exec(
    value,
  );
  if (!match) return null;
  const publicId = match[1];
  const secret = secretBytes(match[2] ?? "");
  return publicId && secret ? { publicId, secret } : null;
}

/** Verify one stored HMAC in constant time. All malformed or unavailable-key cases return false. */
export function npVerifyAgentOpaqueVerifierV1(input: {
  purpose: NpAgentOpaqueVerifierPurposeV1;
  siteId: string;
  publicId: string;
  secret: Uint8Array;
  storedVerifier: string;
  storedHashKeyId: string;
  keyring: NpAgentTokenHashKeyring;
}): boolean {
  try {
    requireContext(input.siteId, input.publicId);
    if (input.secret.byteLength !== 32) return false;
    const match = VERIFIER_PATTERN.exec(input.storedVerifier);
    if (!match || match[1] !== input.storedHashKeyId) return false;
    const key = resolveKey(input.keyring, input.storedHashKeyId);
    const expected = secretBytes(match[2] ?? "");
    if (!key || !expected) return false;
    const actual = verifierDigest(key, input.purpose, input.siteId, input.publicId, input.secret);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
