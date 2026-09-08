/** Server-private storage operation contracts. These values never enter client projections. */
import { createHash } from "node:crypto";
import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  canonicalRuntimeText,
} from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentPreviewArtifactManifestCanonical } from "../agent-contract/canonical-preview-artifact.js";
import type { NpAgentPreviewArtifactManifestEntryV1 } from "../agent-contract/types.js";

export interface NpAgentPreviewArtifactAdapterIdentityV1 {
  id: string;
  contractVersion: number;
  fingerprint: string;
}
export interface NpAgentPreviewArtifactUploadRequestV1 extends Omit<
  NpAgentPreviewArtifactManifestEntryV1,
  "createdAt" | "expiresAt"
> {
  schemaVersion: "np.agent-preview-artifact-upload-request.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  storageAdapterId: string;
  storageAdapterContractVersion: number;
  storageAdapterFingerprint: string;
  storageKey: string;
}
export interface NpAgentPreviewArtifactUploadSetV1 {
  schemaVersion: "np.agent-preview-artifact-upload-set.v1";
  siteId: string;
  changeSetId: string;
  previewId: string;
  generation: number;
  planHash: string;
  previewContractFingerprint: string;
  uploads: Array<{ ordinal: number; artifactId: string; uploadRequestDigest: string }>;
}
export type NpAgentPreviewArtifactUploadOperationResolutionV1 =
  | { status: "not_started" | "committed"; resolvedAt: string; safeCode: null }
  | { status: "failed_no_effect"; resolvedAt: string; safeCode: string }
  | { status: "pending" | "unknown"; resolvedAt: null; safeCode: string | null };
export interface NpAgentPreviewArtifactUploadOperationReceiptV1 {
  schemaVersion: "np.agent-preview-artifact-upload-operation-receipt.v1";
  siteId: string;
  previewId: string;
  artifactId: string;
  uploadRequestDigest: string;
  idempotencyKey: string;
  storageAdapterId: string;
  storageAdapterContractVersion: number;
  storageAdapterFingerprint: string;
  status: "not_started" | "committed" | "failed_no_effect";
  safeCode: string | null;
  resolvedAt: string;
}
export interface NpAgentPreviewArtifactDeleteReceiptV1 {
  schemaVersion: "np.agent-artifact-delete-receipt.v1";
  siteId: string;
  previewId: string;
  artifactId: string;
  contentDigest: string;
  storageAdapterId: string;
  storageAdapterContractVersion: number;
  storageAdapterFingerprint: string;
  deleteAttempt: number;
  status: "deleted" | "already_absent";
  deletedAt: string;
}
export interface NpAgentPreviewArtifactStorageAdapterV1 extends NpAgentPreviewArtifactAdapterIdentityV1 {
  put(input: {
    request: NpAgentPreviewArtifactUploadRequestV1;
    idempotencyKey: string;
    bytes: Uint8Array;
    signal: AbortSignal;
  }): Promise<{ operationRef?: string } | void>;
  resolveOperation(input: {
    request: NpAgentPreviewArtifactUploadRequestV1;
    idempotencyKey: string;
    operationRef: string | null;
    signal: AbortSignal;
  }): Promise<NpAgentPreviewArtifactUploadOperationResolutionV1>;
  stat(input: {
    storageKey: string;
    signal: AbortSignal;
  }): Promise<{ state: "absent" } | { state: "present"; mime: string; bytes: number }>;
  read(input: {
    storageKey: string;
    maximumBytes: number;
    signal: AbortSignal;
  }): Promise<{ bytes: Uint8Array; mime: string }>;
  delete(input: {
    storageKey: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<{ status: "deleted" | "already_absent" }>;
}
const requestKeys = [
  "schemaVersion",
  "siteId",
  "changeSetId",
  "previewId",
  "generation",
  "planHash",
  "previewContractFingerprint",
  "artifactId",
  "ordinal",
  "kind",
  "route",
  "locale",
  "viewport",
  "reportPart",
  "reportTotalParts",
  "contentDigest",
  "mime",
  "bytes",
  "storageAdapterId",
  "storageAdapterContractVersion",
  "storageAdapterFingerprint",
  "storageKey",
];
const contextKeys = [
  "schemaVersion",
  "siteId",
  "changeSetId",
  "previewId",
  "generation",
  "planHash",
  "previewContractFingerprint",
  "uploads",
];
function record(value: unknown, keys: readonly string[]) {
  return canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, "agent.preview.private", 256 * 1024),
    "agent.preview.private",
    keys,
    keys,
    { seen: new WeakSet() },
  );
}
const text = (v: unknown, max = 512) => canonicalRuntimeText(v, "agent.preview.private", max);
function prefixed(value: unknown, prefix: string) {
  const result = text(value, 128);
  if (!new RegExp(`^${prefix}:[A-Za-z0-9_-]{43}$`, "u").test(result))
    throw new Error("Invalid preview operation digest.");
  return result;
}
function safe(value: unknown): string {
  const result = text(value, 64);
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(result))
    throw new Error("Invalid preview operation safe code.");
  return result;
}
function schema(value: unknown, expected: string) {
  if (value !== expected) throw new Error("Invalid preview operation schema.");
  return expected;
}
function identity(r: Record<string, unknown>) {
  return {
    siteId: canonicalBodySiteId(r.siteId, "siteId"),
    previewId: canonicalBodyUuid(r.previewId, "previewId"),
    artifactId: canonicalBodyUuid(r.artifactId, "artifactId"),
    storageAdapterId: text(r.storageAdapterId, 128),
    storageAdapterContractVersion: canonicalBodyInteger(
      r.storageAdapterContractVersion,
      "storageAdapterContractVersion",
      1,
      2147483647,
    ),
    storageAdapterFingerprint: canonicalBodySha256Digest(
      r.storageAdapterFingerprint,
      "storageAdapterFingerprint",
    ),
  };
}
function frame(prefix: string, domain: string, bytes: Uint8Array): string {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  return `${prefix}:sha256:${createHash("sha256").update(`${domain}\0`).update(length).update(bytes).digest("base64url")}`;
}
export function npDigestAgentPreviewArtifactContentV1(bytes: Uint8Array): `ac1:sha256:${string}` {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2 * 1024 * 1024)
    throw new Error("Invalid preview artifact bytes.");
  return frame("ac1", "np.agent-artifact-content.v1", bytes) as `ac1:sha256:${string}`;
}
export function npRequireAgentPreviewArtifactUploadRequestV1(
  value: unknown,
): NpAgentPreviewArtifactUploadRequestV1 {
  const r = record(value, requestKeys);
  schema(r.schemaVersion, "np.agent-preview-artifact-upload-request.v1");
  const base = identity(r);
  const changeSetId = canonicalBodyUuid(r.changeSetId, "changeSetId");
  const generation = canonicalBodyInteger(r.generation, "generation", 1, 2147483647);
  const planHash = canonicalBodySha256Digest(r.planHash, "planHash");
  const previewContractFingerprint = canonicalBodySha256Digest(
    r.previewContractFingerprint,
    "previewContractFingerprint",
  );
  const ordinal = canonicalBodyInteger(r.ordinal, "ordinal", 1, 24);
  const reportPart =
    r.reportPart === null ? null : canonicalBodyInteger(r.reportPart, "reportPart", 1, 4);
  const reportTotalParts =
    r.reportTotalParts === null
      ? null
      : canonicalBodyInteger(r.reportTotalParts, "reportTotalParts", 1, 4);
  if (reportPart !== null && (reportTotalParts === null || reportPart > reportTotalParts))
    throw new Error("Invalid preview report parts.");
  // Reuse the canonical artifact metadata analyzer. Count/ordinal/part completeness is checked on the full reserved set.
  const manifest = npRequireAgentPreviewArtifactManifestCanonical({
    schemaVersion: "np.agent-preview-artifact-manifest.v1",
    siteId: base.siteId,
    changeSetId,
    previewId: base.previewId,
    generation,
    planHash,
    previewContractFingerprint,
    artifacts: [
      {
        artifactId: base.artifactId,
        ordinal: 1,
        kind: r.kind,
        route: r.route,
        locale: r.locale,
        viewport: r.viewport,
        reportPart: reportPart === null ? null : 1,
        reportTotalParts: reportTotalParts === null ? null : 1,
        contentDigest: r.contentDigest,
        mime: r.mime,
        bytes: r.bytes,
        createdAt: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-02T00:00:00.000Z",
      },
    ],
  });
  const { createdAt: _createdAt, expiresAt: _expiresAt, ...entry } = manifest.artifacts[0];
  return {
    schemaVersion: "np.agent-preview-artifact-upload-request.v1",
    ...base,
    changeSetId,
    generation,
    planHash,
    previewContractFingerprint,
    ...entry,
    ordinal,
    reportPart,
    reportTotalParts,
    storageKey: text(r.storageKey, 2048),
  };
}
export function npRequireAgentPreviewArtifactUploadSetV1(
  value: unknown,
): NpAgentPreviewArtifactUploadSetV1 {
  const r = record(value, contextKeys);
  schema(r.schemaVersion, "np.agent-preview-artifact-upload-set.v1");
  if (!Array.isArray(r.uploads) || r.uploads.length > 24)
    throw new Error("Invalid preview upload set.");
  let previous = 0;
  const ids = new Set<string>();
  const uploads = r.uploads.map((item) => {
    const row = record(item, ["ordinal", "artifactId", "uploadRequestDigest"]);
    const ordinal = canonicalBodyInteger(row.ordinal, "ordinal", 1, 24);
    const artifactId = canonicalBodyUuid(row.artifactId, "artifactId");
    if (ordinal !== previous + 1 || ids.has(artifactId))
      throw new Error("Invalid preview upload order.");
    previous = ordinal;
    ids.add(artifactId);
    return {
      ordinal,
      artifactId,
      uploadRequestDigest: prefixed(row.uploadRequestDigest, "aur1:sha256"),
    };
  });
  return {
    schemaVersion: "np.agent-preview-artifact-upload-set.v1",
    siteId: canonicalBodySiteId(r.siteId, "siteId"),
    changeSetId: canonicalBodyUuid(r.changeSetId, "changeSetId"),
    previewId: canonicalBodyUuid(r.previewId, "previewId"),
    generation: canonicalBodyInteger(r.generation, "generation", 1, 2147483647),
    planHash: canonicalBodySha256Digest(r.planHash, "planHash"),
    previewContractFingerprint: canonicalBodySha256Digest(
      r.previewContractFingerprint,
      "previewContractFingerprint",
    ),
    uploads,
  };
}
export function npRequireAgentPreviewArtifactUploadResolutionV1(
  value: unknown,
): NpAgentPreviewArtifactUploadOperationResolutionV1 {
  const r = record(value, ["status", "resolvedAt", "safeCode"]);
  const status = r.status;
  if (status === "pending" || status === "unknown") {
    if (r.resolvedAt !== null) throw new Error("Invalid preview operation resolution.");
    return { status, resolvedAt: null, safeCode: r.safeCode === null ? null : safe(r.safeCode) };
  }
  const resolvedAt = canonicalBodyUtc(r.resolvedAt, "resolvedAt");
  if (status === "failed_no_effect") return { status, resolvedAt, safeCode: safe(r.safeCode) };
  if ((status !== "committed" && status !== "not_started") || r.safeCode !== null)
    throw new Error("Invalid preview operation resolution.");
  return { status, resolvedAt, safeCode: null };
}
function resolvedAt(value: string | null): string {
  if (value === null) throw new Error("Nonterminal preview operation receipt.");
  return value;
}
export function npRequireAgentPreviewArtifactUploadReceiptV1(
  value: unknown,
): NpAgentPreviewArtifactUploadOperationReceiptV1 {
  const r = record(value, [
    "schemaVersion",
    "siteId",
    "previewId",
    "artifactId",
    "uploadRequestDigest",
    "idempotencyKey",
    "storageAdapterId",
    "storageAdapterContractVersion",
    "storageAdapterFingerprint",
    "status",
    "safeCode",
    "resolvedAt",
  ]);
  schema(r.schemaVersion, "np.agent-preview-artifact-upload-operation-receipt.v1");
  const resolution = npRequireAgentPreviewArtifactUploadResolutionV1({
    status: r.status,
    safeCode: r.safeCode,
    resolvedAt: r.resolvedAt,
  });
  if (resolution.status === "pending" || resolution.status === "unknown")
    throw new Error("Nonterminal preview operation receipt.");
  const idempotencyKey = text(r.idempotencyKey, 64);
  if (!/^npau1_[A-Za-z0-9_-]{43}$/u.test(idempotencyKey))
    throw new Error("Invalid preview upload identity.");
  return {
    schemaVersion: "np.agent-preview-artifact-upload-operation-receipt.v1",
    ...identity(r),
    uploadRequestDigest: prefixed(r.uploadRequestDigest, "aur1:sha256"),
    idempotencyKey,
    status: resolution.status,
    safeCode: resolution.safeCode,
    resolvedAt: resolvedAt(resolution.resolvedAt),
  };
}
export function npRequireAgentPreviewArtifactDeleteReceiptV1(
  value: unknown,
): NpAgentPreviewArtifactDeleteReceiptV1 {
  const r = record(value, [
    "schemaVersion",
    "siteId",
    "previewId",
    "artifactId",
    "contentDigest",
    "storageAdapterId",
    "storageAdapterContractVersion",
    "storageAdapterFingerprint",
    "deleteAttempt",
    "status",
    "deletedAt",
  ]);
  schema(r.schemaVersion, "np.agent-artifact-delete-receipt.v1");
  if (r.status !== "deleted" && r.status !== "already_absent")
    throw new Error("Invalid preview deletion receipt.");
  return {
    schemaVersion: "np.agent-artifact-delete-receipt.v1",
    ...identity(r),
    contentDigest: prefixed(r.contentDigest, "ac1:sha256"),
    deleteAttempt: canonicalBodyInteger(r.deleteAttempt, "deleteAttempt", 1, 255),
    status: r.status,
    deletedAt: canonicalBodyUtc(r.deletedAt, "deletedAt"),
  };
}
const jsonBytes = (value: object) => new TextEncoder().encode(serializeAgentCanonicalJson(value));
export const npDigestAgentPreviewArtifactUploadRequestV1 = (value: unknown) =>
  frame(
    "aur1",
    "np.agent-artifact-upload-request.v1",
    jsonBytes(npRequireAgentPreviewArtifactUploadRequestV1(value)),
  );
export const npDigestAgentPreviewArtifactUploadSetV1 = (value: unknown) =>
  frame(
    "aus1",
    "np.agent-artifact-upload-set.v1",
    jsonBytes(npRequireAgentPreviewArtifactUploadSetV1(value)),
  );
export const npDigestAgentPreviewArtifactUploadReceiptV1 = (value: unknown) =>
  frame(
    "auo1",
    "np.agent-artifact-upload-operation-receipt.v1",
    jsonBytes(npRequireAgentPreviewArtifactUploadReceiptV1(value)),
  );
export const npDigestAgentPreviewArtifactDeleteReceiptV1 = (value: unknown) =>
  frame(
    "adr1",
    "np.agent-artifact-delete-receipt.v1",
    jsonBytes(npRequireAgentPreviewArtifactDeleteReceiptV1(value)),
  );
export function npAgentPreviewArtifactUploadIdempotencyV1(requestDigest: string): string {
  prefixed(requestDigest, "aur1:sha256");
  return `npau1_${createHash("sha256").update("np.agent-artifact-upload-idempotency.v1\0").update(requestDigest).digest("base64url")}`;
}
