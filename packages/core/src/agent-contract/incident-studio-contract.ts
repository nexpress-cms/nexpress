import { npRequireAgentIncidentV1, type NpAgentIncidentV1 } from "./incident-contract.js";
import { npAgentIncidentCategories, type NpAgentIncidentCategory } from "./types.js";
import {
  canonicalBodyRecord,
  canonicalBodyArray,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodyInteger,
  canonicalBodyAscii,
  canonicalBodyEnum,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export const npAgentIncidentTimelineKindsV1 = [
  "observed",
  "correlated",
  "agent_assessment",
  "human_note",
  "state_transition",
  "action",
  "verification",
  "notification",
] as const;
export interface NpAgentIncidentStudioDetailV1 {
  schemaVersion: "np.agent-incident-studio-detail.v1";
  incident: NpAgentIncidentV1;
  signals: Array<{
    id: string;
    detectorId: string;
    detectorVersion: number;
    category: NpAgentIncidentCategory;
    confidenceBasis: "exact-rule" | "statistical" | "external";
    scoreBasisPoints: number | null;
    createdAt: string;
  }>;
  timeline: Array<{
    id: string;
    sequence: number;
    kind: (typeof npAgentIncidentTimelineKindsV1)[number];
    createdAt: string;
    approvalId: string | null;
    actionId: string | null;
  }>;
  nextTimelineCursor: string | null;
  feedback: Array<{
    id: string;
    signalId: string;
    label: "confirmed-spam" | "false-positive";
    supersedesId: string | null;
    createdAt: string;
  }>;
  feedbackAvailable: boolean;
}
/** Exact allowlist: source bodies, raw timeline details and private containment state cannot cross this wire. */
export function npRequireAgentIncidentStudioDetailV1(
  value: unknown,
): NpAgentIncidentStudioDetailV1 {
  const state = { seen: new WeakSet<object>() };
  const p = "incident.studio";
  const record = (v: unknown, path: string, keys: string[]) =>
    canonicalBodyRecord(v, path, keys, keys, state);
  const nullableId = (v: unknown, path: string) => (v === null ? null : canonicalBodyUuid(v, path));
  const boolean = (v: unknown): boolean => {
    if (typeof v !== "boolean") failCanonicalBody("invalid-field", p, "Expected boolean");
    return v;
  };
  const row = record(cloneCanonicalRuntimeInput(value, p, 262144), p, [
    "schemaVersion",
    "incident",
    "signals",
    "timeline",
    "nextTimelineCursor",
    "feedback",
    "feedbackAvailable",
  ]);
  const incident = npRequireAgentIncidentV1(row.incident);
  const signals = canonicalBodyArray(row.signals, `${p}.signals`, 100, state).map((v, i) => {
    const path = `${p}.signals.${i}`;
    const r = record(v, path, [
      "id",
      "detectorId",
      "detectorVersion",
      "category",
      "confidenceBasis",
      "scoreBasisPoints",
      "createdAt",
    ]);
    return {
      id: canonicalBodyUuid(r.id, path),
      detectorId: canonicalBodyAscii(r.detectorId, path, 128),
      detectorVersion: canonicalBodyInteger(r.detectorVersion, path, 1, 2147483647),
      category: canonicalBodyEnum<NpAgentIncidentCategory>(
        r.category,
        path,
        new Set(npAgentIncidentCategories),
      ),
      confidenceBasis: canonicalBodyEnum<"exact-rule" | "statistical" | "external">(
        r.confidenceBasis,
        path,
        new Set(["exact-rule", "statistical", "external"]),
      ),
      scoreBasisPoints:
        r.scoreBasisPoints === null
          ? null
          : canonicalBodyInteger(r.scoreBasisPoints, path, 0, 10000),
      createdAt: canonicalBodyUtc(r.createdAt, path),
    };
  });
  if (
    signals.length !== incident.signalIds.length ||
    new Set(signals.map((s) => s.id)).size !== signals.length ||
    signals.some((s) => !incident.signalIds.includes(s.id))
  )
    failCanonicalBody("invalid-field", p, "Signal binding is invalid");
  const timeline = canonicalBodyArray(row.timeline, `${p}.timeline`, 50, state).map((v, i) => {
    const path = `${p}.timeline.${i}`;
    const r = record(v, path, ["id", "sequence", "kind", "createdAt", "approvalId", "actionId"]);
    return {
      id: canonicalBodyUuid(r.id, path),
      sequence: canonicalBodyInteger(r.sequence, path, 1, 2147483647),
      kind: canonicalBodyEnum<(typeof npAgentIncidentTimelineKindsV1)[number]>(
        r.kind,
        path,
        new Set(npAgentIncidentTimelineKindsV1),
      ),
      createdAt: canonicalBodyUtc(r.createdAt, path),
      approvalId: nullableId(r.approvalId, path),
      actionId: nullableId(r.actionId, path),
    };
  });
  if (timeline.some((r, i) => i > 0 && r.sequence <= timeline[i - 1].sequence))
    failCanonicalBody("invalid-field", p, "Timeline order is invalid");
  const feedback = canonicalBodyArray(row.feedback, `${p}.feedback`, 100, state).map((v, i) => {
    const path = `${p}.feedback.${i}`;
    const r = record(v, path, ["id", "signalId", "label", "supersedesId", "createdAt"]);
    const signalId = canonicalBodyUuid(r.signalId, path);
    if (!incident.signalIds.includes(signalId))
      failCanonicalBody("invalid-field", path, "Feedback signal is unavailable");
    return {
      id: canonicalBodyUuid(r.id, path),
      signalId,
      label: canonicalBodyEnum<"confirmed-spam" | "false-positive">(
        r.label,
        path,
        new Set(["confirmed-spam", "false-positive"] as const),
      ),
      supersedesId: nullableId(r.supersedesId, path),
      createdAt: canonicalBodyUtc(r.createdAt, path),
    };
  });
  if (
    new Set(timeline.map((entry) => entry.id)).size !== timeline.length ||
    new Set(feedback.map((entry) => entry.id)).size !== feedback.length ||
    new Set(feedback.map((entry) => entry.signalId)).size !== feedback.length
  )
    failCanonicalBody("invalid-field", p, "Duplicate retained entries");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      p,
      new Set(["np.agent-incident-studio-detail.v1"] as const),
    ),
    incident,
    signals,
    timeline,
    feedback,
    nextTimelineCursor:
      row.nextTimelineCursor === null ? null : canonicalBodyAscii(row.nextTimelineCursor, p, 2048),
    feedbackAvailable: boolean(row.feedbackAvailable),
  };
}
