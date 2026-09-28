import {
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyIdentifier,
  canonicalBodyEnum,
  canonicalBodyAscii,
  canonicalBodyUuid,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export interface NpAgentIncidentEvidenceItemV1 {
  eventId: string;
  signalIds: string[];
  availability: "available" | "unavailable";
  target: { kind: "comment"; collection: string; id: string } | null;
  observed: {
    occurredAt: string;
    retentionExpiresAt: string;
    status: "visible" | "pending";
    spamVerdict: "pass" | "flag";
    profanityVerdict: "pass" | "flag";
  } | null;
  current: {
    /** Source comment match only; the digest below binds the current parent as well. */
    state: "unchanged" | "changed" | "hidden" | "deleted";
    status: "visible" | "pending" | "hidden" | "deleted";
    editedAt: string | null;
    versionDigest: string;
  } | null;
  responseEligible: boolean;
}
export interface NpAgentIncidentEvidenceV1 {
  schemaVersion: "np.agent-incident-evidence.v1";
  incidentId: string;
  incidentVersion: number;
  items: NpAgentIncidentEvidenceItemV1[];
  nextCursor: string | null;
}
/** Metadata-only allowlist. No body, author, private identifiers or raw Event envelope. */
export function npRequireAgentIncidentEvidenceV1(value: unknown): NpAgentIncidentEvidenceV1 {
  const bad = (): never =>
    failCanonicalBody("invalid-field", "incident.evidence", "Invalid evidence projection");
  const record = (v: unknown, keys: string[]) =>
    canonicalBodyRecord(v, "incident.evidence", keys, keys, { seen: new WeakSet<object>() });
  const r = record(cloneCanonicalRuntimeInput(value, "incident.evidence", 131072), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "items",
    "nextCursor",
  ]);
  if (!Array.isArray(r.items) || r.items.length > 10) bad();
  const eventIds = new Set<string>();
  const items = (r.items as unknown[]).map((v): NpAgentIncidentEvidenceItemV1 => {
    const x = record(v, [
      "eventId",
      "signalIds",
      "availability",
      "target",
      "observed",
      "current",
      "responseEligible",
    ]);
    const eventId = canonicalBodyUuid(x.eventId, "evidence.eventId");
    if (eventIds.has(eventId)) bad();
    eventIds.add(eventId);
    if (!Array.isArray(x.signalIds) || !x.signalIds.length || x.signalIds.length > 100) bad();
    const signalIds = (x.signalIds as unknown[]).map((id) =>
      canonicalBodyUuid(id, "evidence.signalId"),
    );
    if (new Set(signalIds).size !== signalIds.length) bad();
    const availability = canonicalBodyEnum<NpAgentIncidentEvidenceItemV1["availability"]>(
      x.availability,
      "evidence.availability",
      new Set(["available", "unavailable"] as const),
    );
    if (typeof x.responseEligible !== "boolean") bad();
    if (availability === "unavailable") {
      if (
        x.target !== null ||
        x.observed !== null ||
        x.current !== null ||
        x.responseEligible !== false
      )
        bad();
      return {
        eventId,
        signalIds,
        availability,
        target: null,
        observed: null,
        current: null,
        responseEligible: false,
      };
    }
    const t = record(x.target, ["kind", "collection", "id"]);
    const collection = canonicalBodyIdentifier(t.collection, "evidence.collection", 96);
    const target: NonNullable<NpAgentIncidentEvidenceItemV1["target"]> = {
      kind: canonicalBodyEnum(t.kind, "evidence.target.kind", new Set(["comment"] as const)),
      collection,
      id: canonicalBodyAscii(t.id, "evidence.target.id", 128),
    };
    const o = record(x.observed, [
      "occurredAt",
      "retentionExpiresAt",
      "status",
      "spamVerdict",
      "profanityVerdict",
    ]);
    const observed: NonNullable<NpAgentIncidentEvidenceItemV1["observed"]> = {
      occurredAt: canonicalBodyUtc(o.occurredAt, "evidence.observed.occurredAt"),
      retentionExpiresAt: canonicalBodyUtc(
        o.retentionExpiresAt,
        "evidence.observed.retentionExpiresAt",
      ),
      status: canonicalBodyEnum(
        o.status,
        "evidence.observed.status",
        new Set(["visible", "pending"] as const),
      ),
      spamVerdict: canonicalBodyEnum(
        o.spamVerdict,
        "evidence.spamVerdict",
        new Set(["pass", "flag"] as const),
      ),
      profanityVerdict: canonicalBodyEnum(
        o.profanityVerdict,
        "evidence.profanityVerdict",
        new Set(["pass", "flag"] as const),
      ),
    };
    const c = record(x.current, ["state", "status", "editedAt", "versionDigest"]);
    const current: NonNullable<NpAgentIncidentEvidenceItemV1["current"]> = {
      state: canonicalBodyEnum(
        c.state,
        "evidence.current.state",
        new Set(["unchanged", "changed", "hidden", "deleted"] as const),
      ),
      status: canonicalBodyEnum(
        c.status,
        "evidence.current.status",
        new Set(["visible", "pending", "hidden", "deleted"] as const),
      ),
      editedAt:
        c.editedAt === null ? null : canonicalBodyUtc(c.editedAt, "evidence.current.editedAt"),
      versionDigest: canonicalBodySha256Digest(c.versionDigest, "evidence.current.versionDigest"),
    };
    if (
      current.state === "hidden" || current.state === "deleted"
        ? current.status !== current.state
        : !["visible", "pending"].includes(current.status)
    )
      bad();
    if (current.state === "unchanged" && current.status !== observed.status) bad();
    if (x.responseEligible && current.state !== "unchanged") bad();
    return {
      eventId,
      signalIds,
      availability,
      target,
      observed,
      current,
      responseEligible: x.responseEligible as boolean,
    };
  });
  const nextCursor =
    r.nextCursor === null ? null : canonicalBodyAscii(r.nextCursor, "evidence.nextCursor", 2048);
  if (nextCursor !== null && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(nextCursor)) bad();
  return {
    schemaVersion: canonicalBodyEnum(
      r.schemaVersion,
      "evidence.schemaVersion",
      new Set(["np.agent-incident-evidence.v1"] as const),
    ),
    incidentId: canonicalBodyUuid(r.incidentId, "evidence.incidentId"),
    incidentVersion: canonicalBodyInteger(
      r.incidentVersion,
      "evidence.incidentVersion",
      1,
      2147483647,
    ),
    items,
    nextCursor,
  };
}
