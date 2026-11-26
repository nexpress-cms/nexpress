import {
  npAgentGuardianRuntimeDetectorIdsV1,
  npParseAgentGuardianRuntimeAccountingSummaryV1,
  npAgentGuardianRuntimeRuleBoundsV1,
  type NpAgentGuardianRuntimeAccountingSummaryV1,
} from "./guardian-runtime-contract.js";
import {
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  canonicalRuntimeText,
} from "./canonical-runtime-primitives.js";
import {
  npAgentGuardianAssessmentCodes,
  type NpAgentGuardianAssessmentCode,
  type NpAgentGuardianDecisionV1,
  type NpAgentIncidentCategory,
  type NpAgentIncidentSeverity,
} from "./types.js";
import {
  npAgentGuardianRouteFamiliesV1,
  type NpAgentGuardianRouteFamilyV1,
} from "./guardian-contract.js";
import {
  npAgentGuardianAssessmentRecipeIdsV1,
  npGuardianAssessmentCodesForRecipeV1,
  type NpAgentGuardianAssessmentRecipeIdV1,
} from "./guardian-assessment-recipe-contract.js";

export const npAgentGuardianAssessmentDetectorIdsV1 = [
  "guardian.authority-escalated",
  "guardian.login-after-failures",
  "guardian.login-failures",
  "guardian.policy-activated",
  "guardian.rate-limits",
  ...npAgentGuardianRuntimeDetectorIdsV1,
] as const;
export type NpAgentGuardianAssessmentDetectorIdV1 =
  (typeof npAgentGuardianAssessmentDetectorIdsV1)[number];
/** Leaves room for the bounded model summary and provenance in the existing 16 KiB timeline row. */
export const NP_AGENT_GUARDIAN_ASSESSMENT_EVIDENCE_MAX_BYTES_V1 = 6144;
export interface NpAgentGuardianAssessmentFactV1 {
  detectorId: NpAgentGuardianAssessmentDetectorIdV1;
  detectorVersion: 1;
  category: NpAgentIncidentCategory;
  severity: NpAgentIncidentSeverity;
  window: { startedAt: string; endedAt: string };
  /** Retained observation lower bound, never a total or proof of an attack. */
  observedCount: number;
  audience: "member" | "staff" | null;
  routeFamily: NpAgentGuardianRouteFamilyV1 | null;
  impact: "site" | "deployment";
  /** Actual retained Runtime cohort; absent for pre-existing facts. */
  accounting?: NpAgentGuardianRuntimeAccountingSummaryV1 | null;
}
export interface NpAgentGuardianAssessmentEvidenceV1 {
  schemaVersion: "np.agent-guardian-assessment-evidence.v1";
  recipeId: NpAgentGuardianAssessmentRecipeIdV1;
  observedAt: string;
  incident: { id: string; versionNumber: number; fingerprint: string } | null;
  truncated: boolean;
  sources: {
    id: string;
    signalId: string;
    signalDigest: string;
    digest: string;
    fact: NpAgentGuardianAssessmentFactV1;
  }[];
}
export interface NpAgentGuardianAssessmentV1 {
  schemaVersion: "np.agent-guardian-assessment.v1";
  incidentId: string;
  incidentVersion: number;
  observedAt: string;
  disposition: "consistent" | "inconclusive" | "unlikely";
  confidenceBasisPoints: number;
  assessmentCodes: NpAgentGuardianAssessmentCode[];
  evidenceDigests: string[];
  summary: string;
  evidence: NpAgentGuardianAssessmentEvidenceV1;
  provenance: {
    runId: string;
    providerCallId: string;
    provider: string;
    model: string;
    recipeFingerprint: string;
    instructionDigest: string;
    policyDigests: string[];
    requestDigest: string;
    responseDigest: string;
    sourceDigest: string;
  };
}
const path = "guardian.assessment";
function fail(): never {
  return failCanonicalBody(
    "invalid-field",
    path,
    "must match exact read-only Guardian assessment evidence",
  );
}
const rec = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
function text(value: unknown, maximum: number, allowLineBreaks = false): string {
  const parsed = canonicalRuntimeText(value, path, maximum, { requireTrimmed: true });
  if (/[\p{Cc}\p{Cs}]/u.test(allowLineBreaks ? parsed.replace(/[\n\r\t]/gu, "") : parsed)) fail();
  return parsed;
}
const enumValue = <T extends string>(value: unknown, values: readonly T[]): T =>
  canonicalBodyEnum(value, path, new Set(values));
const positive = (value: unknown) => canonicalBodyInteger(value, path, 1, 2147483647);
function digests(value: unknown, maximum: number): string[] {
  const parsed = canonicalBodyArray(value, path, maximum, { seen: new WeakSet() }).map((value) =>
    canonicalBodySha256Digest(value, path),
  );
  if (parsed.some((value, index) => index > 0 && parsed[index - 1] >= value)) fail();
  return parsed;
}
export function npGuardianAssessmentCategoriesV1(
  id: NpAgentGuardianAssessmentRecipeIdV1,
): NpAgentIncidentCategory[] {
  return id === "guardian.credential-stuffing"
    ? ["authentication", "traffic"]
    : ["agent-abuse", "authorization"];
}
export function npRequireAgentGuardianAssessmentFactV1(
  value: unknown,
): NpAgentGuardianAssessmentFactV1 {
  const keys = [
    "detectorId",
    "detectorVersion",
    "category",
    "severity",
    "window",
    "observedCount",
    "audience",
    "routeFamily",
    "impact",
  ];
  const row = canonicalBodyRecord(value, path, [...keys, "accounting"], keys, {
    seen: new WeakSet(),
  });
  const detectorId = enumValue(row.detectorId, npAgentGuardianAssessmentDetectorIdsV1);
  const category = enumValue(row.category, [
    "authentication",
    "traffic",
    "agent-abuse",
    "authorization",
  ] as const);
  const expectedCategory =
    detectorId === "guardian.rate-limits"
      ? "traffic"
      : detectorId === "guardian.authority-escalated"
        ? "authorization"
        : detectorId === "guardian.policy-activated" ||
            npAgentGuardianRuntimeDetectorIdsV1.some((id) => id === detectorId)
          ? "agent-abuse"
          : "authentication";
  const window = rec(row.window, ["startedAt", "endedAt"]);
  const startedAt = canonicalBodyUtc(window.startedAt, path),
    endedAt = canonicalBodyUtc(window.endedAt, path);
  const audience =
    row.audience === null ? null : enumValue(row.audience, ["member", "staff"] as const);
  const routeFamily =
    row.routeFamily === null ? null : enumValue(row.routeFamily, npAgentGuardianRouteFamiliesV1);
  const observedCount = canonicalBodyInteger(row.observedCount, path, 1, 10000);
  const impact = enumValue(row.impact, ["site", "deployment"] as const);
  const severity = enumValue(row.severity, ["medium", "high"] as const);
  const isRuntime = npAgentGuardianRuntimeDetectorIdsV1.some((id) => id === detectorId);
  const accounting =
    row.accounting === undefined || row.accounting === null
      ? row.accounting
      : npParseAgentGuardianRuntimeAccountingSummaryV1(row.accounting, path, {
          seen: new WeakSet(),
        });
  if (isRuntime ? accounting === undefined : accounting !== undefined) fail();
  const runtimeCount =
    detectorId === "guardian.spend-velocity"
      ? accounting !== null &&
        accounting !== undefined &&
        accounting.knownCostMicros >= npAgentGuardianRuntimeRuleBoundsV1.knownSettledCostMicros &&
        observedCount ===
          accounting.reportedCallCount +
            accounting.estimatedCallCount +
            accounting.unknownCallCount +
            accounting.releasedCallCount &&
        observedCount <= 100
      : accounting === null &&
        observedCount === (detectorId === "guardian.repeated-proposals" ? 2 : 5);

  if (
    row.detectorVersion !== 1 ||
    category !== expectedCategory ||
    startedAt > endedAt ||
    (category === "authentication") !== (audience !== null) ||
    (category === "traffic") !== (routeFamily !== null) ||
    (isRuntime
      ? !runtimeCount || severity !== "medium" || impact !== "site"
      : detectorId === "guardian.login-after-failures"
        ? observedCount !== 6 || severity !== "high" || impact !== "site"
        : detectorId === "guardian.login-failures" || detectorId === "guardian.rate-limits"
          ? observedCount !== 5 || severity !== "medium" || impact !== "site"
          : observedCount !== 1 ||
            severity !== (impact === "deployment" ? "high" : "medium") ||
            (detectorId === "guardian.policy-activated" && impact !== "site"))
  )
    fail();
  return {
    detectorId,
    detectorVersion: 1,
    category,
    severity,
    window: { startedAt, endedAt },
    observedCount,
    audience,
    routeFamily,
    impact,
    ...(accounting === undefined ? {} : { accounting }),
  };
}
export function npRequireAgentGuardianAssessmentEvidenceV1(
  value: unknown,
): NpAgentGuardianAssessmentEvidenceV1 {
  const row = rec(
    cloneCanonicalRuntimeInput(value, path, NP_AGENT_GUARDIAN_ASSESSMENT_EVIDENCE_MAX_BYTES_V1),
    ["schemaVersion", "recipeId", "observedAt", "incident", "truncated", "sources"],
  );
  if (
    row.schemaVersion !== "np.agent-guardian-assessment-evidence.v1" ||
    typeof row.truncated !== "boolean"
  )
    fail();
  const recipeId = enumValue(row.recipeId, npAgentGuardianAssessmentRecipeIdsV1);
  const observedAt = canonicalBodyUtc(row.observedAt, path);
  const target =
    row.incident === null ? null : rec(row.incident, ["id", "versionNumber", "fingerprint"]);
  const incident = target && {
    id: canonicalBodyUuid(target.id, path),
    versionNumber: positive(target.versionNumber),
    fingerprint: text(target.fingerprint, 256),
  };
  const sources = canonicalBodyArray(row.sources, path, 20, { seen: new WeakSet() }).map(
    (value, index) => {
      const source = rec(value, ["id", "signalId", "signalDigest", "digest", "fact"]);
      if (source.id !== `guardian-assessment-${index.toString().padStart(3, "0")}`) fail();
      const fact = npRequireAgentGuardianAssessmentFactV1(source.fact);
      if (
        !npGuardianAssessmentCategoriesV1(recipeId).includes(fact.category) ||
        fact.window.endedAt > observedAt
      )
        fail();
      return {
        id: source.id,
        signalId: canonicalBodyUuid(source.signalId, path),
        signalDigest: canonicalBodySha256Digest(source.signalDigest, path),
        digest: canonicalBodySha256Digest(source.digest, path),
        fact,
      };
    },
  );
  if (
    (!incident && sources.length > 0) ||
    new Set(sources.map((s) => s.signalId)).size !== sources.length ||
    sources.some((s, i) => i > 0 && sources[i - 1].signalId >= s.signalId)
  )
    fail();
  return {
    schemaVersion: "np.agent-guardian-assessment-evidence.v1",
    recipeId,
    observedAt,
    incident,
    truncated: row.truncated,
    sources,
  };
}
export function npRequireAgentGuardianAssessmentDecisionV1(
  value: unknown,
): Extract<NpAgentGuardianDecisionV1, { kind: "assessment" }> {
  const row = rec(cloneCanonicalRuntimeInput(value, path, 16384), [
    "kind",
    "disposition",
    "confidenceBasisPoints",
    "assessmentCodes",
    "evidenceDigests",
    "summary",
  ]);
  if (row.kind !== "assessment") fail();
  const assessmentCodes = canonicalBodyArray(row.assessmentCodes, path, 20, {
    seen: new WeakSet(),
  }).map((v) => enumValue(v, npAgentGuardianAssessmentCodes));
  if (assessmentCodes.some((v, i) => i > 0 && assessmentCodes[i - 1] >= v)) fail();
  return {
    kind: "assessment",
    disposition: enumValue(row.disposition, ["consistent", "inconclusive", "unlikely"] as const),
    confidenceBasisPoints: canonicalBodyInteger(row.confidenceBasisPoints, path, 0, 10000),
    assessmentCodes,
    evidenceDigests: digests(row.evidenceDigests, 20),
    summary: text(row.summary, 2000, true),
  };
}
export function npRequireAgentGuardianAssessmentV1(value: unknown): NpAgentGuardianAssessmentV1 {
  const row = rec(cloneCanonicalRuntimeInput(value, path, 16384), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "observedAt",
    "disposition",
    "confidenceBasisPoints",
    "assessmentCodes",
    "evidenceDigests",
    "summary",
    "evidence",
    "provenance",
  ]);
  if (row.schemaVersion !== "np.agent-guardian-assessment.v1") fail();
  const decision = npRequireAgentGuardianAssessmentDecisionV1({
    kind: "assessment",
    disposition: row.disposition,
    confidenceBasisPoints: row.confidenceBasisPoints,
    assessmentCodes: row.assessmentCodes,
    evidenceDigests: row.evidenceDigests,
    summary: row.summary,
  });
  const evidence = npRequireAgentGuardianAssessmentEvidenceV1(row.evidence);
  if (
    decision.assessmentCodes.some(
      (code) =>
        !npGuardianAssessmentCodesForRecipeV1(evidence.recipeId).some(
          (allowed) => allowed === code,
        ),
    )
  )
    fail();
  const p = rec(row.provenance, [
    "runId",
    "providerCallId",
    "provider",
    "model",
    "recipeFingerprint",
    "instructionDigest",
    "policyDigests",
    "requestDigest",
    "responseDigest",
    "sourceDigest",
  ]);
  if (
    !evidence.incident ||
    row.incidentId !== evidence.incident.id ||
    row.incidentVersion !== evidence.incident.versionNumber ||
    row.observedAt !== evidence.observedAt
  )
    fail();
  const admitted = evidence.sources.map((s) => s.digest).sort();
  if (
    decision.evidenceDigests.some((d) => !admitted.includes(d)) ||
    (decision.disposition !== "inconclusive" &&
      (evidence.truncated ||
        !admitted.length ||
        admitted.join() !== decision.evidenceDigests.join())) ||
    (decision.disposition === "inconclusive" && !decision.assessmentCodes.includes("inconclusive"))
  )
    fail();
  const { kind: _kind, ...assessment } = decision;
  return {
    schemaVersion: "np.agent-guardian-assessment.v1",
    incidentId: canonicalBodyUuid(row.incidentId, path),
    incidentVersion: positive(row.incidentVersion),
    observedAt: canonicalBodyUtc(row.observedAt, path),
    ...assessment,
    evidence,
    provenance: {
      runId: canonicalBodyUuid(p.runId, path),
      providerCallId: canonicalBodyUuid(p.providerCallId, path),
      provider: text(p.provider, 128),
      model: text(p.model, 256),
      recipeFingerprint: canonicalBodySha256Digest(p.recipeFingerprint, path),
      instructionDigest: canonicalBodySha256Digest(p.instructionDigest, path),
      policyDigests: digests(p.policyDigests, 64),
      requestDigest: canonicalBodySha256Digest(p.requestDigest, path),
      responseDigest: canonicalBodySha256Digest(p.responseDigest, path),
      sourceDigest: canonicalBodySha256Digest(p.sourceDigest, path),
    },
  };
}
