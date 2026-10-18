import {
  npRequireAgentGuardianHttpEvidenceV1,
  npAgentGuardianHttpDetectorIdsV1,
  type NpAgentGuardianHttpEvidenceV1,
} from "./guardian-http-contract.js";
import {
  npRequireAgentGuardianRuntimeEvidenceV1,
  npAgentGuardianRuntimeDetectorIdsV1,
  type NpAgentGuardianRuntimeEvidenceV1,
} from "./guardian-runtime-contract.js";
import {
  npRequireAgentIncidentSeverityChangeV1,
  npAgentIncidentSeverityOrderV1,
  type NpAgentIncidentSeverityChangeV1,
  type NpAgentIncidentEscalationSeverityV1,
} from "./incident-severity-contract.js";
import {
  npRequireAgentIncidentRuleSeverityChangeV1,
  type NpAgentIncidentRuleSeverityChangeV1,
} from "./incident-rule-severity-contract.js";
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
import {
  npRequireAgentIncidentV1,
  npRequireAgentIncidentListOutputV1,
  type NpAgentIncidentV1,
  type NpAgentIncidentListOutputV1,
} from "./incident-contract.js";
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
import {
  npRequireAgentModeratorAssessmentV1,
  type NpAgentModeratorAssessmentV1,
} from "./moderator-assessment-contract.js";
import {
  npRequireAgentGuardianAssessmentV1,
  type NpAgentGuardianAssessmentV1,
} from "./guardian-assessment-contract.js";
import {
  npAgentGuardianContentDetectorIdsV1,
  npRequireAgentGuardianContentEvidenceV1,
  type NpAgentGuardianContentEvidenceV1,
} from "./guardian-content-contract.js";
import {
  NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1,
  npRequireAgentGuardianExternalEvidenceV1,
  type NpAgentGuardianExternalEvidenceV1,
} from "./guardian-external-contract.js";
import {
  npRequireAgentGuardianSessionEvidenceV1,
  type NpAgentGuardianSessionEvidenceV1,
} from "./guardian-session-contract.js";

import {
  npRequireAgentModeratorSegmentedAssessmentV2,
  type NpAgentModeratorSegmentedAssessmentV2,
} from "./moderator-segmented-assessment-contract.js";
import {
  npRequireAgentGuardianEvidenceV1,
  NP_AGENT_GUARDIAN_THRESHOLD_V1,
  type NpAgentGuardianEvidenceV1,
} from "./guardian-contract.js";
import {
  npAgentGuardianSecurityDetectorIdsV1,
  npRequireAgentGuardianSecurityEvidenceV1,
  type NpAgentGuardianSecurityEvidenceV1,
} from "./guardian-security-contract.js";

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
export interface NpAgentIncidentStudioListOutputV1 extends NpAgentIncidentListOutputV1 {
  /** Opt-in staff summary. Null means the owning evidence could not be verified. */
  summaries?: {
    incidentId: string;
    versionNumber: number;
    containment: { active: number; nearestExpiryAt: string | null } | null;
    assessmentAvailable: boolean | null;
  }[];
}
export function npRequireAgentIncidentStudioListOutputV1(
  value: unknown,
): NpAgentIncidentStudioListOutputV1 {
  const path = "incident.studio.list";
  const row = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, path, 1048576),
    path,
    ["schemaVersion", "items", "nextCursor", "summaries"],
    ["schemaVersion", "items", "nextCursor"],
    { seen: new WeakSet() },
  );
  const base = npRequireAgentIncidentListOutputV1({
    schemaVersion: row.schemaVersion,
    items: row.items,
    nextCursor: row.nextCursor,
  });
  if (row.summaries === undefined) return base;
  if (!Array.isArray(row.summaries) || row.summaries.length > base.items.length)
    failCanonicalBody("invalid-field", path, "Invalid Incident summaries");
  const seen = new Set<string>();
  const summaries = row.summaries.map((value) => {
    const summary = canonicalBodyRecord(
      value,
      path,
      ["incidentId", "versionNumber", "containment", "assessmentAvailable"],
      ["incidentId", "versionNumber", "containment", "assessmentAvailable"],
      { seen: new WeakSet() },
    );
    const incidentId = canonicalBodyUuid(summary.incidentId, path);
    const versionNumber = canonicalBodyInteger(summary.versionNumber, path, 1, 2147483647);
    if (
      !base.items.some((item) => item.id === incidentId && item.versionNumber === versionNumber) ||
      seen.has(incidentId) ||
      (summary.assessmentAvailable !== null && typeof summary.assessmentAvailable !== "boolean")
    )
      failCanonicalBody("invalid-field", path, "Unbound Incident summary");
    seen.add(incidentId);
    let containment: { active: number; nearestExpiryAt: string | null } | null = null;
    if (summary.containment !== null) {
      const body = canonicalBodyRecord(
        summary.containment,
        path,
        ["active", "nearestExpiryAt"],
        ["active", "nearestExpiryAt"],
        { seen: new WeakSet() },
      );
      containment = {
        active: canonicalBodyInteger(body.active, path, 0, 100),
        nearestExpiryAt:
          body.nearestExpiryAt === null ? null : canonicalBodyUtc(body.nearestExpiryAt, path),
      };
      if (containment.active === 0 && containment.nearestExpiryAt !== null)
        failCanonicalBody("invalid-field", path, "Invalid containment expiry");
    }
    return {
      incidentId,
      versionNumber,
      containment,
      assessmentAvailable: summary.assessmentAvailable,
    };
  });
  return { ...base, summaries };
}
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
    ruleSeverityChange?: NpAgentIncidentRuleSeverityChangeV1;
    assignment?: NpAgentIncidentAssignmentEntryV1 | null;
    containmentFailure?: { outcome: "rolled_back"; reasonCode: "CONTAINMENT_VERIFICATION_FAILED" };
    notificationRecovery?: NpAgentIncidentNotificationRecoveryV1 | null;
    assessment?: NpAgentModeratorAssessmentV1;
    segmentedAssessment?: NpAgentModeratorSegmentedAssessmentV2;
    guardianAssessment?: NpAgentGuardianAssessmentV1;
  }>;
  nextTimelineCursor: string | null;
  /** False when a stored entry on this page could not be verified or projected. */
  timelinePageComplete?: boolean;
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
  guardianEvidence?: NpAgentGuardianEvidenceV1[] | null;
  guardianSecurityEvidence?: NpAgentGuardianSecurityEvidenceV1[] | null;
  guardianSessionEvidence?: NpAgentGuardianSessionEvidenceV1[] | null;
  guardianContentEvidence?: NpAgentGuardianContentEvidenceV1[] | null;
  guardianExternalEvidence?: NpAgentGuardianExternalEvidenceV1[] | null;
  guardianRuntimeEvidence?: NpAgentGuardianRuntimeEvidenceV1[] | null;
  guardianHttpEvidence?: NpAgentGuardianHttpEvidenceV1[] | null;
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
          k !== "timelinePageComplete" &&
          k !== "guardianEvidence" &&
          k !== "guardianSecurityEvidence" &&
          k !== "guardianSessionEvidence" &&
          k !== "guardianContentEvidence" &&
          k !== "guardianExternalEvidence" &&
          k !== "guardianRuntimeEvidence" &&
          k !== "guardianHttpEvidence" &&
          k !== "assignment" &&
          k !== "containmentFailure" &&
          k !== "notificationRecovery" &&
          k !== "severityChange" &&
          k !== "ruleSeverityChange" &&
          k !== "assessment" &&
          k !== "guardianAssessment" &&
          k !== "segmentedAssessment" &&
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
    "timelinePageComplete",
    "feedback",
    "feedbackAvailable",
    "workflow",
    "response",
    "guardianEvidence",
    "guardianSecurityEvidence",
    "guardianSessionEvidence",
    "guardianContentEvidence",
    "guardianExternalEvidence",
    "guardianRuntimeEvidence",
    "guardianHttpEvidence",
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
      "ruleSeverityChange",
      "assessment",
      "segmentedAssessment",
      "guardianAssessment",
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
    const ruleSeverityChange =
      r.ruleSeverityChange === undefined
        ? undefined
        : npRequireAgentIncidentRuleSeverityChangeV1(r.ruleSeverityChange);
    if (
      ruleSeverityChange &&
      (r.kind !== "correlated" ||
        r.decision !== null ||
        r.assignment != null ||
        r.containmentFailure !== undefined ||
        r.approvalId !== null ||
        r.actionId !== null ||
        severityChange ||
        !signals.some(
          (s) =>
            s.id === ruleSeverityChange.signalId &&
            s.detectorId === ruleSeverityChange.detectorId &&
            s.detectorVersion === ruleSeverityChange.detectorVersion &&
            s.confidenceBasis === "exact-rule",
        ))
    )
      failCanonicalBody("invalid-field", path, "Invalid rule severity timeline binding");
    const assessment =
      r.assessment === undefined ? undefined : npRequireAgentModeratorAssessmentV1(r.assessment);
    const segmentedAssessment =
      r.segmentedAssessment === undefined
        ? undefined
        : npRequireAgentModeratorSegmentedAssessmentV2(r.segmentedAssessment);
    const guardianAssessment =
      r.guardianAssessment === undefined
        ? undefined
        : npRequireAgentGuardianAssessmentV1(r.guardianAssessment);
    if ([assessment, segmentedAssessment, guardianAssessment].filter(Boolean).length > 1)
      failCanonicalBody(
        "invalid-field",
        path,
        "Only one assessment profile may occupy a timeline entry",
      );
    const assessmentEntry = assessment ?? segmentedAssessment ?? guardianAssessment;
    if (
      assessmentEntry &&
      (r.kind !== "agent_assessment" ||
        r.decision !== null ||
        r.assignment != null ||
        r.containmentFailure !== undefined ||
        severityChange ||
        ruleSeverityChange ||
        r.approvalId !== null ||
        r.actionId !== null ||
        assessmentEntry.incidentId !== incident.id)
    )
      failCanonicalBody("invalid-field", path, "Invalid assessment timeline binding");
    if (
      guardianAssessment &&
      (guardianAssessment.incidentVersion >= incident.versionNumber ||
        guardianAssessment.evidence.sources.some(
          (source) => source.fact.category !== incident.category,
        ))
    )
      failCanonicalBody(
        "invalid-field",
        path,
        "Invalid Guardian assessment generation or category",
      );
    if (
      severityChange &&
      (r.kind !== "human_note" ||
        r.decision !== null ||
        r.assignment != null ||
        r.containmentFailure !== undefined)
    )
      failCanonicalBody("invalid-field", path, "Invalid severity timeline binding");
    return {
      ...(assessment ? { assessment } : {}),
      ...(segmentedAssessment ? { segmentedAssessment } : {}),
      ...(guardianAssessment ? { guardianAssessment } : {}),
      ...(severityChange ? { severityChange } : {}),
      ...(ruleSeverityChange ? { ruleSeverityChange } : {}),
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
  let guardianEvidence: NpAgentGuardianEvidenceV1[] | null | undefined;
  if (row.guardianEvidence !== undefined) {
    if (
      !["authentication", "traffic"].includes(incident.category) ||
      !signals.length ||
      signals.some(
        (signal) =>
          !["guardian.login-failures", "guardian.rate-limits"].includes(signal.detectorId),
      )
    )
      failCanonicalBody("invalid-field", p, "Invalid Guardian Incident binding");
    guardianEvidence =
      row.guardianEvidence === null
        ? null
        : canonicalBodyArray(row.guardianEvidence, `${p}.guardianEvidence`, 100, state).map(
            npRequireAgentGuardianEvidenceV1,
          );
    if (
      guardianEvidence &&
      (guardianEvidence.length !== signals.length ||
        incident.eventCount !== guardianEvidence.length * NP_AGENT_GUARDIAN_THRESHOLD_V1 ||
        new Set(guardianEvidence.map((entry) => entry.signalId)).size !== signals.length ||
        guardianEvidence.some(
          (entry) =>
            !signals.some(
              (signal) =>
                signal.id === entry.signalId &&
                signal.detectorId === entry.detectorId &&
                signal.detectorVersion === 1 &&
                signal.confidenceBasis === "exact-rule" &&
                signal.scoreBasisPoints === null &&
                signal.category === incident.category &&
                signal.category ===
                  (entry.detectorId === "guardian.login-failures" ? "authentication" : "traffic"),
            ),
        ))
    )
      failCanonicalBody("invalid-field", p, "Invalid Guardian evidence binding");
    if (
      guardianEvidence?.some(
        (entry) =>
          entry.window.startedAt < incident.firstObservedAt ||
          entry.window.endedAt > incident.lastObservedAt,
      )
    )
      failCanonicalBody(
        "invalid-field",
        p,
        "Guardian evidence is outside the Incident observation window",
      );
  }
  const guardianFields = [
    "guardianEvidence",
    "guardianSecurityEvidence",
    "guardianSessionEvidence",
    "guardianContentEvidence",
    "guardianExternalEvidence",
    "guardianRuntimeEvidence",
    "guardianHttpEvidence",
  ];
  if (guardianFields.filter((key) => row[key] !== undefined).length > 1)
    failCanonicalBody("invalid-field", p, "Only one Guardian source family may occupy an Incident");
  function boundGuardianEvidence<
    T extends { signalId: string; detectorId: string; detectorVersion: number },
  >(
    key: string,
    detectorIds: readonly string[],
    parse: (value: unknown) => T,
    category: (detectorId: string) => NpAgentIncidentCategory,
    range: (entry: T) => { startedAt: string; endedAt: string },
    confidence: "exact-rule" | "external",
  ): T[] | null | undefined {
    if (row[key] === undefined) return undefined;
    if (
      !signals.length ||
      signals.some(
        (signal) =>
          !detectorIds.includes(signal.detectorId) ||
          signal.detectorVersion !== 1 ||
          signal.confidenceBasis !== confidence ||
          signal.scoreBasisPoints !== null ||
          signal.category !== category(signal.detectorId) ||
          signal.category !== incident.category,
      )
    )
      failCanonicalBody("invalid-field", p, "Invalid Guardian source Incident binding");
    if (row[key] === null) return null;
    const entries = canonicalBodyArray(row[key], `${p}.${key}`, 100, state).map((entry) =>
      parse(entry),
    );
    if (
      entries.length !== signals.length ||
      new Set(entries.map((entry) => entry.signalId)).size !== signals.length ||
      entries.some((entry) => {
        const observed = range(entry);
        return (
          observed.startedAt < incident.firstObservedAt ||
          observed.endedAt > incident.lastObservedAt ||
          !signals.some(
            (signal) =>
              signal.id === entry.signalId &&
              signal.detectorId === entry.detectorId &&
              signal.detectorVersion === entry.detectorVersion,
          )
        );
      })
    )
      failCanonicalBody("invalid-field", p, "Invalid Guardian source evidence binding");
    return entries;
  }
  const guardianSecurityEvidence = boundGuardianEvidence(
    "guardianSecurityEvidence",
    npAgentGuardianSecurityDetectorIdsV1,
    npRequireAgentGuardianSecurityEvidenceV1,
    (id) =>
      id === "guardian.policy-activated"
        ? "agent-abuse"
        : id === "guardian.credential-changed"
          ? "authentication"
          : id === "guardian.plugin-changed"
            ? "integrity"
            : "authorization",
    (entry) => ({ startedAt: entry.observedAt, endedAt: entry.observedAt }),
    "exact-rule",
  );
  const guardianContentEvidence = boundGuardianEvidence(
    "guardianContentEvidence",
    npAgentGuardianContentDetectorIdsV1,
    npRequireAgentGuardianContentEvidenceV1,
    () => "integrity",
    (entry) => entry.window,
    "exact-rule",
  );
  const guardianSessionEvidence = boundGuardianEvidence(
    "guardianSessionEvidence",
    ["guardian.login-after-failures"],
    npRequireAgentGuardianSessionEvidenceV1,
    () => "authentication",
    (entry) => entry.window,
    "exact-rule",
  );
  if (
    guardianContentEvidence?.some(
      (entry) =>
        incident.primarySubject?.kind !== "document" ||
        incident.primarySubject.collection !== entry.document.collection ||
        incident.primarySubject.documentId !== entry.document.documentId,
    )
  )
    failCanonicalBody("invalid-field", p, "Invalid Guardian content document binding");
  const guardianExternalEvidence = boundGuardianEvidence(
    "guardianExternalEvidence",
    [NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1],
    npRequireAgentGuardianExternalEvidenceV1,
    () => "availability",
    (entry) => ({ startedAt: entry.observedAt, endedAt: entry.observedAt }),
    "external",
  );
  const guardianHttpEvidence = boundGuardianEvidence(
    "guardianHttpEvidence",
    npAgentGuardianHttpDetectorIdsV1,
    npRequireAgentGuardianHttpEvidenceV1,
    () => "traffic",
    (entry) => entry.window,
    "exact-rule",
  );
  const guardianRuntimeEvidence = boundGuardianEvidence(
    "guardianRuntimeEvidence",
    npAgentGuardianRuntimeDetectorIdsV1,
    npRequireAgentGuardianRuntimeEvidenceV1,
    () => "agent-abuse",
    (entry) => entry.window,
    "exact-rule",
  );
  return {
    ...(guardianSecurityEvidence === undefined ? {} : { guardianSecurityEvidence }),
    ...(guardianRuntimeEvidence === undefined ? {} : { guardianRuntimeEvidence }),
    ...(guardianHttpEvidence === undefined ? {} : { guardianHttpEvidence }),
    ...(guardianSessionEvidence === undefined ? {} : { guardianSessionEvidence }),
    ...(guardianContentEvidence === undefined ? {} : { guardianContentEvidence }),
    ...(guardianExternalEvidence === undefined ? {} : { guardianExternalEvidence }),
    ...(guardianEvidence === undefined ? {} : { guardianEvidence }),
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
    ...(row.timelinePageComplete === undefined
      ? {}
      : { timelinePageComplete: boolean(row.timelinePageComplete) }),
    feedback,
    nextTimelineCursor:
      row.nextTimelineCursor === null ? null : canonicalBodyAscii(row.nextTimelineCursor, p, 2048),
    feedbackAvailable: boolean(row.feedbackAvailable),
  };
}
