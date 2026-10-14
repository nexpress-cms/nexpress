import {
  npCollectionDocumentStatuses,
  npCollectionDocumentVisibilities,
  type NpCollectionDocumentVisibility,
} from "../collection-contract/types.js";
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
  target: { kind: "comment" | "document"; collection: string; id: string } | null;
  observed: {
    occurredAt: string;
    retentionExpiresAt: string;
    status: "visible" | "pending" | "published";
    /** Present only for document report evidence. */
    visibility?: NpCollectionDocumentVisibility;
    spamVerdict: "pass" | "flag" | "unknown";
    profanityVerdict: "pass" | "flag" | "unknown";
    /** A filed report records a claim, not a classifier verdict. */
    reportFiled?: true;
  } | null;
  current: {
    /** Source match; comment digests also bind their current parent. */
    state: "unchanged" | "changed" | "hidden" | "deleted";
    status: "visible" | "hidden" | "deleted" | (typeof npCollectionDocumentStatuses)[number];
    /** Actual document envelope; never inferred from a comment state. */
    visibility?: NpCollectionDocumentVisibility;
    moderationHidden?: boolean;
    editedAt: string | null;
    versionDigest: string;
    report?: { status: "unresolved" | "resolved"; resolvedAt: string | null };
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
  const record = (v: unknown, keys: string[], optional: string[] = []) =>
    canonicalBodyRecord(v, "incident.evidence", [...keys, ...optional], keys, {
      seen: new WeakSet<object>(),
    });
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
      kind: canonicalBodyEnum(
        t.kind,
        "evidence.target.kind",
        new Set(["comment", "document"] as const),
      ),
      collection,
      id: canonicalBodyAscii(t.id, "evidence.target.id", 128),
    };
    const isDocument = target.kind === "document";
    const o = record(
      x.observed,
      [
        "occurredAt",
        "retentionExpiresAt",
        "status",
        "spamVerdict",
        "profanityVerdict",
        ...(isDocument ? ["visibility"] : []),
      ],
      ["reportFiled"],
    );
    const reportFiled = o.reportFiled !== undefined;
    if (isDocument && !reportFiled) bad();
    if (
      reportFiled
        ? o.reportFiled !== true || o.spamVerdict !== "unknown" || o.profanityVerdict !== "unknown"
        : o.spamVerdict === "unknown" || o.profanityVerdict === "unknown"
    )
      bad();
    const observed: NonNullable<NpAgentIncidentEvidenceItemV1["observed"]> = {
      occurredAt: canonicalBodyUtc(o.occurredAt, "evidence.observed.occurredAt"),
      retentionExpiresAt: canonicalBodyUtc(
        o.retentionExpiresAt,
        "evidence.observed.retentionExpiresAt",
      ),
      status: canonicalBodyEnum(
        o.status,
        "evidence.observed.status",
        isDocument ? new Set(["published"] as const) : new Set(["visible", "pending"] as const),
      ),
      spamVerdict: canonicalBodyEnum(
        o.spamVerdict,
        "evidence.spamVerdict",
        new Set(["pass", "flag", "unknown"] as const),
      ),
      profanityVerdict: canonicalBodyEnum(
        o.profanityVerdict,
        "evidence.profanityVerdict",
        new Set(["pass", "flag", "unknown"] as const),
      ),
      ...(isDocument
        ? {
            visibility: canonicalBodyEnum(
              o.visibility,
              "evidence.observed.visibility",
              new Set(["public"] as const),
            ),
          }
        : {}),
      ...(reportFiled ? { reportFiled: true as const } : {}),
    };
    const c = record(
      x.current,
      [
        "state",
        "status",
        "editedAt",
        "versionDigest",
        ...(isDocument ? ["visibility", "moderationHidden"] : []),
      ],
      ["report"],
    );
    if (isDocument && typeof c.moderationHidden !== "boolean") bad();
    if (reportFiled !== (c.report !== undefined)) bad();
    let report: NonNullable<NpAgentIncidentEvidenceItemV1["current"]>["report"];
    if (reportFiled) {
      const r = record(c.report, ["status", "resolvedAt"]);
      report = {
        status: canonicalBodyEnum(
          r.status,
          "evidence.report.status",
          new Set(["unresolved", "resolved"] as const),
        ),
        resolvedAt:
          r.resolvedAt === null
            ? null
            : canonicalBodyUtc(r.resolvedAt, "evidence.report.resolvedAt"),
      };
      if ((report.status === "unresolved") !== (report.resolvedAt === null)) bad();
      if (report.resolvedAt !== null && report.resolvedAt < observed.occurredAt) bad();
    }
    const current: NonNullable<NpAgentIncidentEvidenceItemV1["current"]> = {
      state: canonicalBodyEnum(
        c.state,
        "evidence.current.state",
        new Set(["unchanged", "changed", "hidden", "deleted"] as const),
      ),
      status: canonicalBodyEnum(
        c.status,
        "evidence.current.status",
        isDocument
          ? new Set(npCollectionDocumentStatuses)
          : new Set(["visible", "pending", "hidden", "deleted"] as const),
      ),
      editedAt:
        c.editedAt === null ? null : canonicalBodyUtc(c.editedAt, "evidence.current.editedAt"),
      versionDigest: canonicalBodySha256Digest(c.versionDigest, "evidence.current.versionDigest"),
      ...(isDocument
        ? {
            visibility: canonicalBodyEnum(
              c.visibility,
              "evidence.current.visibility",
              new Set(npCollectionDocumentVisibilities),
            ),
            moderationHidden: c.moderationHidden as boolean,
          }
        : {}),
      ...(report ? { report } : {}),
    };
    if (isDocument) {
      if (current.state === "deleted" || (current.state === "hidden") !== current.moderationHidden)
        bad();
      if (
        current.state === "unchanged" &&
        (current.visibility !== observed.visibility || current.moderationHidden !== false)
      )
        bad();
      if (
        x.responseEligible &&
        (current.status !== "published" ||
          current.visibility !== "public" ||
          current.moderationHidden !== false)
      )
        bad();
    } else if (
      current.state === "hidden" || current.state === "deleted"
        ? current.status !== current.state
        : !["visible", "pending"].includes(current.status)
    )
      bad();
    if (current.state === "unchanged" && current.status !== observed.status) bad();
    if (x.responseEligible && current.state !== "unchanged") bad();
    if (x.responseEligible && current.report?.status === "resolved") bad();
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
