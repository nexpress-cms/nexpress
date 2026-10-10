import {
  npRequireAgentIncidentSeverityChangeV1,
  npAgentIncidentSeverityOrderV1,
  type NpAgentIncidentSeverityChangeV1,
  type NpAgentIncidentEscalationSeverityV1,
} from "./incident-severity-contract.js";
import {
  npRequireAgentIncidentAssignmentEntryV1,
  type NpAgentIncidentAssignmentEntryV1,
} from "./incident-assignment-contract.js";
import {
  npRequireAgentIncidentResponseV1,
  type NpAgentIncidentResponseV1,
} from "./incident-response-contract.js";
import {
  npRequireAgentIncidentDecisionV1,
  npAgentIncidentTransitionsV1,
  type NpAgentIncidentDecisionV1,
  type NpAgentIncidentWorkflowV1,
} from "./incident-workflow-contract.js";
import { npRequireAgentIncidentV1, type NpAgentIncidentV1 } from "./incident-contract.js";
import {
  npRequireAgentIncidentNotificationRecoveryV1,
  type NpAgentIncidentNotificationRecoveryV1,
} from "./incident-notification-recovery-contract.js";
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
    decision: NpAgentIncidentDecisionV1 | null;
    severityChange?: NpAgentIncidentSeverityChangeV1;
    assignment?: NpAgentIncidentAssignmentEntryV1 | null;
    containmentFailure?: { outcome: "rolled_back"; reasonCode: "CONTAINMENT_VERIFICATION_FAILED" };
    notificationRecovery?: NpAgentIncidentNotificationRecoveryV1 | null;
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
  workflow: NpAgentIncidentWorkflowV1 | null;
  response?: NpAgentIncidentResponseV1 | null;
}
/** Exact allowlist: source bodies, raw timeline details and private containment state cannot cross this wire. */
export function npRequireAgentIncidentStudioDetailV1(
  value: unknown,
): NpAgentIncidentStudioDetailV1 {
  const state = { seen: new WeakSet<object>() };
  const p = "incident.studio";
  const record = (v: unknown, path: string, keys: string[]) =>
    canonicalBodyRecord(
      v,
      path,
      keys,
      keys.filter(
        (k) =>
          k !== "response" &&
          k !== "assignment" &&
          k !== "containmentFailure" &&
          k !== "notificationRecovery" &&
          k !== "severityChange" &&
          k !== "availableSeverities",
      ),
      state,
    );
  const nullableId = (v: unknown, path: string) => (v === null ? null : canonicalBodyUuid(v, path));
  const boolean = (v: unknown): boolean => {
    if (typeof v !== "boolean") failCanonicalBody("invalid-field", p, "Expected boolean");
    return v;
  };
  const row = record(cloneCanonicalRuntimeInput(value, p, 1048576), p, [
    "schemaVersion",
    "incident",
    "signals",
    "timeline",
    "nextTimelineCursor",
    "feedback",
    "feedbackAvailable",
    "workflow",
    "response",
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
    const r = record(v, path, [
      "id",
      "sequence",
      "kind",
      "createdAt",
      "approvalId",
      "actionId",
      "decision",
      "assignment",
      "containmentFailure",
      "notificationRecovery",
      "severityChange",
    ]);
    if (r.assignment != null && (r.kind !== "human_note" || r.decision !== null))
      failCanonicalBody("invalid-field", path, "Invalid assignment timeline binding");
    let containmentFailure:
      { outcome: "rolled_back"; reasonCode: "CONTAINMENT_VERIFICATION_FAILED" } | undefined;
    if (r.containmentFailure !== undefined) {
      const failure = record(r.containmentFailure, path, ["outcome", "reasonCode"]);
      if (
        failure.outcome !== "rolled_back" ||
        failure.reasonCode !== "CONTAINMENT_VERIFICATION_FAILED" ||
        r.kind !== "action" ||
        (r.actionId === null && r.approvalId === null) ||
        r.decision !== null
      )
        failCanonicalBody("invalid-field", path, "Invalid containment failure binding");
      containmentFailure = {
        outcome: "rolled_back",
        reasonCode: "CONTAINMENT_VERIFICATION_FAILED",
      };
    }
    const notificationRecovery =
      r.notificationRecovery === undefined
        ? undefined
        : r.notificationRecovery === null
          ? null
          : npRequireAgentIncidentNotificationRecoveryV1(r.notificationRecovery);
    if (r.notificationRecovery !== undefined && !containmentFailure)
      failCanonicalBody("invalid-field", path, "Invalid notification recovery binding");
    const severityChange =
      r.severityChange === undefined
        ? undefined
        : npRequireAgentIncidentSeverityChangeV1(r.severityChange);
    if (
      severityChange &&
      (r.kind !== "human_note" ||
        r.decision !== null ||
        r.assignment != null ||
        r.containmentFailure !== undefined)
    )
      failCanonicalBody("invalid-field", path, "Invalid severity timeline binding");
    return {
      ...(severityChange ? { severityChange } : {}),
      ...(containmentFailure ? { containmentFailure } : {}),
      ...(notificationRecovery === undefined ? {} : { notificationRecovery }),
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
      decision: r.decision === null ? null : npRequireAgentIncidentDecisionV1(r.decision),
      ...(r.assignment === undefined
        ? {}
        : {
            assignment:
              r.assignment === null ? null : npRequireAgentIncidentAssignmentEntryV1(r.assignment),
          }),
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
  let workflow: NpAgentIncidentWorkflowV1 | null = null;
  if (row.workflow !== null) {
    const w = record(row.workflow, `${p}.workflow`, [
      "availableTransitions",
      "availableSeverities",
      "containment",
    ]);
    const availableTransitions = canonicalBodyArray(w.availableTransitions, p, 3, state).map((v) =>
      canonicalBodyEnum<NpAgentIncidentWorkflowV1["availableTransitions"][number]>(
        v,
        p,
        new Set(npAgentIncidentTransitionsV1),
      ),
    );
    if (
      new Set(availableTransitions).size !== availableTransitions.length ||
      (["resolved", "dismissed"].includes(incident.status) && availableTransitions.length > 0) ||
      (incident.status !== "open" && availableTransitions.includes("investigating"))
    )
      failCanonicalBody("invalid-field", p, "Invalid available transitions");
    const c = record(w.containment, `${p}.containment`, [
      "reviewHash",
      "total",
      "active",
      "restored",
      "unresolved",
      "pendingActions",
    ]);
    const reviewHash = canonicalBodyAscii(c.reviewHash, p, 60);
    if (!/^cj1:sha256:[A-Za-z0-9_-]{43}$/u.test(reviewHash))
      failCanonicalBody("invalid-field", p, "Invalid review hash");
    const total = canonicalBodyInteger(c.total, p, 0, 100),
      active = canonicalBodyInteger(c.active, p, 0, 100),
      restored = canonicalBodyInteger(c.restored, p, 0, 100),
      unresolved = canonicalBodyInteger(c.unresolved, p, 0, 100),
      pendingActions = canonicalBodyInteger(c.pendingActions, p, 0, 100);
    if (
      total !== active + restored + unresolved ||
      (pendingActions > 0 && availableTransitions.some((t) => t !== "investigating"))
    )
      failCanonicalBody("invalid-field", p, "Invalid containment summary");
    const availableSeverities =
      w.availableSeverities === undefined
        ? undefined
        : canonicalBodyArray(w.availableSeverities, p, 4, state).map((v) =>
            canonicalBodyEnum<NpAgentIncidentEscalationSeverityV1>(
              v,
              p,
              new Set(["low", "medium", "high", "critical"]),
            ),
          );
    if (
      availableSeverities &&
      (new Set(availableSeverities).size !== availableSeverities.length ||
        availableSeverities.some(
          (severity) =>
            npAgentIncidentSeverityOrderV1.indexOf(severity) <=
            npAgentIncidentSeverityOrderV1.indexOf(incident.severity),
        ) ||
        (["resolved", "dismissed"].includes(incident.status) && availableSeverities.length > 0))
    )
      failCanonicalBody("invalid-field", p, "Invalid available severities");
    workflow = {
      ...(availableSeverities === undefined ? {} : { availableSeverities }),
      availableTransitions,
      containment: { reviewHash, total, active, restored, unresolved, pendingActions },
    };
  }
  if (timeline.some((t) => t.decision !== null && t.kind !== "state_transition"))
    failCanonicalBody("invalid-field", p, "Invalid decision kind");
  return {
    workflow,
    response: row.response == null ? null : npRequireAgentIncidentResponseV1(row.response),
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
