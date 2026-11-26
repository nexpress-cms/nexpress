import { createHmac, timingSafeEqual } from "node:crypto";
import {
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";

export const NP_GUARDIAN_REQUEST_SOURCE_ACTION_V1 = "agent.guardian_request.source";
export const NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1 = "np.agent-guardian-request-source.v1";
const domain = "np.agent-guardian-request-source-proof.v1\0";
export interface NpGuardianRequestSourceReceiptBodyV1 {
  schemaVersion: typeof NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1;
  receiptId: string;
  keyId: string;
  siteId: string;
  eventId: string;
  eventHash: string;
  recordedAt: string;
}
export interface NpGuardianRequestSourceReceiptV1 extends NpGuardianRequestSourceReceiptBodyV1 {
  sourceMac: string;
}
export function npGuardianRequestSourceUnavailableV1(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_REQUEST_SOURCE_UNAVAILABLE",
    409,
    "Authenticated request evidence is unavailable.",
  );
}
export function npGuardianRequestSourceKeyIdV1(value: unknown): string {
  const id = canonicalBodyAscii(value, "guardian.request.source.keyId", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) npGuardianRequestSourceUnavailableV1();
  return id;
}
export function npGuardianRequestSourceKeyBytesV1(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length >= 32 && value.length <= 64;
}
export function npRequireGuardianRequestSourceReceiptV1(
  value: unknown,
): NpGuardianRequestSourceReceiptV1 {
  const path = "guardian.request.source.receipt";
  const keys = [
    "schemaVersion",
    "receiptId",
    "keyId",
    "siteId",
    "eventId",
    "eventHash",
    "recordedAt",
    "sourceMac",
  ];
  const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, path, 4096), path, keys, keys, {
    seen: new WeakSet(),
  });
  if (
    typeof row.sourceMac !== "string" ||
    !/^hmac-sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(row.sourceMac)
  )
    npGuardianRequestSourceUnavailableV1();
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set([NP_GUARDIAN_REQUEST_SOURCE_RECEIPT_SCHEMA_V1]),
    ),
    receiptId: canonicalBodyUuid(row.receiptId, path),
    keyId: npGuardianRequestSourceKeyIdV1(row.keyId),
    siteId: canonicalBodySiteId(row.siteId, path),
    eventId: canonicalBodyUuid(row.eventId, path),
    eventHash: canonicalBodySha256Digest(row.eventHash, path),
    recordedAt: canonicalBodyUtc(row.recordedAt, path),
    sourceMac: row.sourceMac,
  };
}
export function npGuardianRequestSourceMacV1(
  body: NpGuardianRequestSourceReceiptBodyV1,
  bytes: Uint8Array,
): string {
  if (!npGuardianRequestSourceKeyBytesV1(bytes)) npGuardianRequestSourceUnavailableV1();
  return `hmac-sha256:${createHmac("sha256", bytes).update(domain).update(serializeAgentCanonicalJson(body)).digest("base64url")}`;
}
export function npVerifyGuardianRequestSourceMacV1(
  receipt: NpGuardianRequestSourceReceiptV1,
  bytes: Uint8Array,
): boolean {
  const { sourceMac, ...body } = receipt;
  const actual = Buffer.from(sourceMac),
    expected = Buffer.from(npGuardianRequestSourceMacV1(body, bytes));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
