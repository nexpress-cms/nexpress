import { npMemberStatuses, type NpMemberStatus } from "../auth-contract/types.js";
import {
  canonicalBodyRecord,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyAscii,
  canonicalBodySha256Digest,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

/** Report claims and current global account status only; no profile, reporter or sanction data. */
export interface NpAgentIncidentMemberReportEvidenceItemV1 {
  eventId: string;
  signalIds: string[];
  availability: "available" | "unavailable";
  target: { kind: "member"; id: string } | null;
  observed: {
    occurredAt: string;
    retentionExpiresAt: string;
    status: "active";
    claim: "unverified";
  } | null;
  current: {
    state: "unchanged" | "changed";
    status: NpMemberStatus;
    updatedAt: string;
    versionDigest: string;
    report: { status: "unresolved" | "resolved"; resolvedAt: string | null };
  } | null;
  /** Member report review never advertises an account or content response target. */
  responseEligible: false;
}
export interface NpAgentIncidentMemberReportEvidenceV1 {
  schemaVersion: "np.agent-incident-member-report-evidence.v1";
  incidentId: string;
  incidentVersion: number;
  items: NpAgentIncidentMemberReportEvidenceItemV1[];
  nextCursor: string | null;
}
export function npRequireAgentIncidentMemberReportEvidenceV1(
  value: unknown,
): NpAgentIncidentMemberReportEvidenceV1 {
  const path = "incident.memberReportEvidence";
  const bad = (): never =>
    failCanonicalBody("invalid-field", path, "Invalid member report evidence projection");
  const record = (v: unknown, keys: string[]) =>
    canonicalBodyRecord(v, path, keys, keys, { seen: new WeakSet<object>() });
  const raw = record(cloneCanonicalRuntimeInput(value, path, 131072), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "items",
    "nextCursor",
  ]);
  if (
    raw.schemaVersion !== "np.agent-incident-member-report-evidence.v1" ||
    !Array.isArray(raw.items) ||
    raw.items.length > 10
  )
    bad();
  const events = new Set<string>();
  const items = (raw.items as unknown[]).map((value): NpAgentIncidentMemberReportEvidenceItemV1 => {
    const item = record(value, [
      "eventId",
      "signalIds",
      "availability",
      "target",
      "observed",
      "current",
      "responseEligible",
    ]);
    const eventId = canonicalBodyUuid(item.eventId, path);
    if (
      events.has(eventId) ||
      item.responseEligible !== false ||
      !Array.isArray(item.signalIds) ||
      !item.signalIds.length ||
      item.signalIds.length > 100
    )
      bad();
    events.add(eventId);
    const signalIds = (item.signalIds as unknown[]).map((v) => canonicalBodyUuid(v, path));
    if (new Set(signalIds).size !== signalIds.length) bad();
    const availability = canonicalBodyEnum<"available" | "unavailable">(
      item.availability,
      path,
      new Set(["available", "unavailable"] as const),
    );
    if (availability === "unavailable") {
      if (item.target !== null || item.observed !== null || item.current !== null) bad();
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
    const target = record(item.target, ["kind", "id"]);
    const observed = record(item.observed, ["occurredAt", "retentionExpiresAt", "status", "claim"]);
    const current = record(item.current, [
      "state",
      "status",
      "updatedAt",
      "versionDigest",
      "report",
    ]);
    const report = record(current.report, ["status", "resolvedAt"]);
    if (target.kind !== "member" || observed.status !== "active" || observed.claim !== "unverified")
      bad();
    const state = canonicalBodyEnum<"unchanged" | "changed">(
      current.state,
      path,
      new Set(["unchanged", "changed"] as const),
    );
    const status = canonicalBodyEnum<NpMemberStatus>(
      current.status,
      path,
      new Set(npMemberStatuses),
    );
    if (state === "unchanged" && status !== "active") bad();
    const reportStatus = canonicalBodyEnum<"unresolved" | "resolved">(
      report.status,
      path,
      new Set(["unresolved", "resolved"] as const),
    );
    const resolvedAt =
      report.resolvedAt === null ? null : canonicalBodyUtc(report.resolvedAt, path);
    if ((reportStatus === "resolved") !== (resolvedAt !== null)) bad();
    const occurredAt = canonicalBodyUtc(observed.occurredAt, path);
    if (resolvedAt !== null && Date.parse(resolvedAt) < Date.parse(occurredAt)) bad();
    return {
      eventId,
      signalIds,
      availability,
      target: { kind: "member", id: canonicalBodyUuid(target.id, path) },
      observed: {
        occurredAt,
        retentionExpiresAt: canonicalBodyUtc(observed.retentionExpiresAt, path),
        status: "active",
        claim: "unverified",
      },
      current: {
        state,
        status,
        updatedAt: canonicalBodyUtc(current.updatedAt, path),
        versionDigest: canonicalBodySha256Digest(current.versionDigest, path),
        report: { status: reportStatus, resolvedAt },
      },
      responseEligible: false,
    };
  });
  return {
    schemaVersion: "np.agent-incident-member-report-evidence.v1",
    incidentId: canonicalBodyUuid(raw.incidentId, path),
    incidentVersion: canonicalBodyInteger(raw.incidentVersion, path, 1, 2147483647),
    items,
    nextCursor: raw.nextCursor === null ? null : canonicalBodyAscii(raw.nextCursor, path, 2048),
  };
}
