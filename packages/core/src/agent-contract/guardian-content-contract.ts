import {
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodySha256Digest,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  parseAgentActorProjection,
} from "./canonical-runtime-primitives.js";
import type { NpAgentActorProjection } from "./types.js";

/** Bounded lower counts of source delivery states, never proof coverage or a loss estimate. */
export interface NpAgentGuardianContentCoverageV1 {
  pending: number;
  blocked: number;
  held: number;
  sampled: number;
  truncated: boolean;
}
export function npRequireAgentGuardianContentCoverageV1(
  value: unknown,
): NpAgentGuardianContentCoverageV1 {
  const p = "guardian.content.coverage",
    keys = ["pending", "blocked", "held", "sampled", "truncated"];
  const r = canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet() });
  if (typeof r.truncated !== "boolean")
    failCanonicalBody("invalid-field", p, "Invalid coverage bound");
  return {
    pending: canonicalBodyInteger(r.pending, p, 0, 25),
    blocked: canonicalBodyInteger(r.blocked, p, 0, 25),
    held: canonicalBodyInteger(r.held, p, 0, 25),
    sampled: canonicalBodyInteger(r.sampled, p, 0, 25),
    truncated: r.truncated,
  };
}

export interface NpAgentGuardianContentRevisionV1 {
  id: string;
  version: number;
  status: "draft" | "published" | "autosave";
  createdAt: string;
}
/** Private immutable source facts. Content, snapshots and field values are excluded. */
export interface NpAgentGuardianContentActivityV1 {
  schemaVersion: "np.agent-guardian-content-activity.v1";
  writeId: string;
  siteId: string;
  collection: string;
  documentId: string;
  occurredAt: string;
  actor: Extract<NpAgentActorProjection, { kind: "staff" | "member" | "system" }>;
  fact:
    | {
        kind: "document-save";
        operation: "create" | "update";
        status: "draft" | "scheduled" | "published" | "archived" | "pending";
        revision: (NpAgentGuardianContentRevisionV1 & { status: "draft" | "published" }) | null;
      }
    | {
        kind: "revision-autosave";
        revision: NpAgentGuardianContentRevisionV1 & { status: "autosave" };
      };
}
export interface NpAgentGuardianContentEventPayloadV1 {
  kind: "content.activity.observed";
  receiptId: string;
  activity: NpAgentGuardianContentActivityV1;
}
export const npAgentGuardianContentDetectorIdsV1 = [
  "guardian.content-churn",
  "guardian.revision-volume",
] as const;
export interface NpAgentGuardianContentEvidenceV1 {
  schemaVersion: "np.agent-guardian-content-evidence.v1";
  signalId: string;
  detectorId: (typeof npAgentGuardianContentDetectorIdsV1)[number];
  detectorVersion: 1;
  document: { collection: string; documentId: string };
  window: { startedAt: string; endedAt: string };
  basis: "committed-saves" | "persisted-revisions";
  observedCount: number;
  distinctAccountCount: number;
  countBasis: "at-least";
  sourceDigest: string;
}
export function npRequireAgentGuardianContentEvidenceV1(
  value: unknown,
): NpAgentGuardianContentEvidenceV1 {
  const path = "guardian.content.evidence";
  const state = { seen: new WeakSet<object>() };
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "detectorVersion",
    "document",
    "window",
    "basis",
    "observedCount",
    "distinctAccountCount",
    "countBasis",
    "sourceDigest",
  ];
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 4096),
    path,
    keys,
    keys,
    state,
  );
  const document = canonicalBodyRecord(
    row.document,
    path,
    ["collection", "documentId"],
    ["collection", "documentId"],
    state,
  );
  const window = canonicalBodyRecord(
    row.window,
    path,
    ["startedAt", "endedAt"],
    ["startedAt", "endedAt"],
    state,
  );
  const detectorId = canonicalBodyEnum<NpAgentGuardianContentEvidenceV1["detectorId"]>(
    row.detectorId,
    path,
    new Set(npAgentGuardianContentDetectorIdsV1),
  );
  const basis = canonicalBodyEnum<NpAgentGuardianContentEvidenceV1["basis"]>(
    row.basis,
    path,
    new Set(["committed-saves", "persisted-revisions"]),
  );
  const observedCount = canonicalBodyInteger(row.observedCount, path, 1, 100);
  const distinctAccountCount = canonicalBodyInteger(
    row.distinctAccountCount,
    path,
    0,
    observedCount,
  );
  const startedAt = canonicalBodyUtc(window.startedAt, path);
  const endedAt = canonicalBodyUtc(window.endedAt, path);
  if (
    startedAt > endedAt ||
    Date.parse(startedAt) % 600_000 !== 0 ||
    Date.parse(endedAt) >= Date.parse(startedAt) + 600_000 ||
    (detectorId === "guardian.content-churn"
      ? basis !== "committed-saves" || observedCount !== 5 || distinctAccountCount < 3
      : basis !== "persisted-revisions" || observedCount !== 20)
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "content observation must match its exact bounded rule",
    );
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-content-evidence.v1"]),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId,
    detectorVersion: canonicalBodyInteger(row.detectorVersion, path, 1, 1) as 1,
    document: {
      collection: canonicalBodyIdentifier(document.collection, path, 64),
      documentId: canonicalBodyUuid(document.documentId, path),
    },
    window: { startedAt, endedAt },
    basis,
    observedCount,
    distinctAccountCount,
    countBasis: canonicalBodyEnum(row.countBasis, path, new Set(["at-least"])),
    sourceDigest: canonicalBodySha256Digest(row.sourceDigest, path),
  };
}
function revision(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianContentRevisionV1 {
  const keys = ["id", "version", "status", "createdAt"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    id: canonicalBodyUuid(row.id, path),
    version: canonicalBodyInteger(row.version, path, 1, 2_147_483_647),
    status: canonicalBodyEnum(row.status, path, new Set(["draft", "published", "autosave"])),
    createdAt: canonicalBodyUtc(row.createdAt, path),
  };
}
export function npParseAgentGuardianContentActivityV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianContentActivityV1 {
  const keys = [
    "schemaVersion",
    "writeId",
    "siteId",
    "collection",
    "documentId",
    "occurredAt",
    "actor",
    "fact",
  ];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  const actor = parseAgentActorProjection(row.actor, path, state);
  if (actor.kind !== "staff" && actor.kind !== "member" && actor.kind !== "system")
    failCanonicalBody(
      "invalid-field",
      path,
      "content activity needs its authenticated source actor",
    );
  const factKind =
    typeof row.fact === "object" && row.fact !== null
      ? (Object.getOwnPropertyDescriptor(row.fact, "kind")?.value as unknown)
      : undefined;
  const factKeys =
    factKind === "document-save"
      ? ["kind", "operation", "status", "revision"]
      : ["kind", "revision"];
  const raw = canonicalBodyRecord(row.fact, path, factKeys, factKeys, state);
  let fact: NpAgentGuardianContentActivityV1["fact"];
  if (factKind === "document-save") {
    const savedRevision = raw.revision === null ? null : revision(raw.revision, path, state);
    if (savedRevision?.status === "autosave")
      failCanonicalBody(
        "invalid-field",
        path,
        "a saved document cannot invent an autosave revision",
      );
    fact = {
      kind: factKind,
      operation: canonicalBodyEnum(raw.operation, path, new Set(["create", "update"])),
      status: canonicalBodyEnum(
        raw.status,
        path,
        new Set(["draft", "scheduled", "published", "archived", "pending"]),
      ),
      revision: savedRevision === null ? null : { ...savedRevision, status: savedRevision.status },
    };
  } else {
    if (factKind !== "revision-autosave")
      failCanonicalBody("invalid-field", path, "unknown content activity");
    const autosave = revision(raw.revision, path, state);
    if (autosave.status !== "autosave")
      failCanonicalBody("invalid-field", path, "an autosave requires an actual autosave revision");
    fact = { kind: factKind, revision: { ...autosave, status: autosave.status } };
  }
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-content-activity.v1"]),
    ),
    writeId: canonicalBodyUuid(row.writeId, path),
    siteId: canonicalBodySiteId(row.siteId, path),
    collection: canonicalBodyIdentifier(row.collection, path, 64),
    documentId: canonicalBodyUuid(row.documentId, path),
    occurredAt: canonicalBodyUtc(row.occurredAt, path),
    actor,
    fact,
  };
}
export function npRequireAgentGuardianContentActivityV1(
  value: unknown,
): NpAgentGuardianContentActivityV1 {
  return npParseAgentGuardianContentActivityV1(
    cloneCanonicalRuntimeInput(value, "guardian.content.activity", 8192),
    "guardian.content.activity",
    { seen: new WeakSet<object>() },
  );
}
export function npParseAgentGuardianContentEventPayloadV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianContentEventPayloadV1 {
  const keys = ["kind", "receiptId", "activity"];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    kind: canonicalBodyEnum(row.kind, path, new Set(["content.activity.observed"])),
    receiptId: canonicalBodyUuid(row.receiptId, path),
    activity: npParseAgentGuardianContentActivityV1(row.activity, path, state),
  };
}
