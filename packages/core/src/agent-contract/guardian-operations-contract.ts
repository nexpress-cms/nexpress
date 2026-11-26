import {
  npRequireAgentGuardianOperatorCoverageV1,
  type NpAgentGuardianOperatorCoverageV1,
} from "./guardian-operator-coverage-contract.js";
import {
  npRequireAgentGuardianReceiptCoverageV1,
  type NpAgentGuardianReceiptCoverageV1,
} from "./guardian-delivery-contract.js";
import {
  npRequireAgentGuardianContentCoverageV1,
  type NpAgentGuardianContentCoverageV1,
} from "./guardian-content-contract.js";
import {
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npAgentIncidentStates } from "./incident-contract.js";
import { npAgentIncidentTimelineKindsV1 } from "./incident-studio-contract.js";
import {
  npAgentIncidentCategories,
  npAgentIncidentSeverities,
  npAgentGuardianAssessmentCodes,
} from "./types.js";

export const npAgentGuardianOperationsSourceIdsV1 = [
  "requests",
  "security-transitions",
  "content",
  "sentry",
  "runtime",
  "http",
] as const;
export type NpAgentGuardianOperationsSourceIdV1 =
  (typeof npAgentGuardianOperationsSourceIdsV1)[number];
/** Closed implementation inventory. Registration and actual proof coverage are reported separately. */
export const npAgentGuardianOperationsDetectorsV1 = [
  { id: "guardian.login-failures", version: 1, source: "requests" },
  { id: "guardian.rate-limits", version: 1, source: "requests" },
  { id: "guardian.login-after-failures", version: 1, source: "requests" },
  { id: "guardian.authority-escalated", version: 1, source: "security-transitions" },
  { id: "guardian.policy-activated", version: 1, source: "security-transitions" },
  { id: "guardian.credential-changed", version: 1, source: "security-transitions" },
  { id: "guardian.plugin-changed", version: 1, source: "security-transitions" },
  { id: "guardian.content-churn", version: 1, source: "content" },
  { id: "guardian.revision-volume", version: 1, source: "content" },
  { id: "guardian.external-error-created", version: 1, source: "sentry" },
  { id: "guardian.repeated-proposals", version: 1, source: "runtime" },
  { id: "guardian.denied-scopes", version: 1, source: "runtime" },
  { id: "guardian.spend-velocity", version: 1, source: "runtime" },
  { id: "guardian.action-velocity", version: 1, source: "runtime" },
  { id: "guardian.http-responses", version: 1, source: "http" },
] as const;
export type NpAgentGuardianOperationsDetectorIdV1 =
  (typeof npAgentGuardianOperationsDetectorsV1)[number]["id"];
/** Receipt-verified metadata only; no canonical Event, actor, subject, receipt or local key material. */
export interface NpAgentGuardianVerifiedEventV1 {
  schemaVersion: "np.agent-guardian-verified-event.v1";
  eventId: string;
  source: NpAgentGuardianOperationsSourceIdV1;
  observedAt: string;
  sourceDigest: string;
  detectorId: NpAgentGuardianOperationsDetectorIdV1 | null;
}
export interface NpAgentGuardianIncidentExportV1 {
  schemaVersion: "np.agent-guardian-incident-export.v1";
  exportedAt: string;
  completeness: "complete";
  incident: {
    id: string;
    siteId: string;
    versionNumber: number;
    category: (typeof npAgentIncidentCategories)[number];
    severity: (typeof npAgentIncidentSeverities)[number];
    status: (typeof npAgentIncidentStates)[number];
    eventCount: number;
    firstObservedAt: string;
    lastObservedAt: string;
    createdAt: string;
    updatedAt: string;
  };
  signals: {
    id: string;
    detectorId: NpAgentGuardianOperationsDetectorIdV1;
    detectorVersion: 1;
    category: (typeof npAgentIncidentCategories)[number];
    confidenceBasis: "exact-rule" | "statistical" | "external";
    scoreBasisPoints: number | null;
    createdAt: string;
  }[];
  sources: {
    signalId: string;
    source: NpAgentGuardianOperationsSourceIdV1;
    startedAt: string;
    endedAt: string;
    observedCount: number;
    countBasis: "at-least" | "committed-transition" | "authenticated-external-fact";
    sourceDigest: string | null;
    impact: "site" | "deployment";
    affectedSiteCount: number;
  }[];
  outcomes: {
    id: string;
    sequence: number;
    kind: (typeof npAgentIncidentTimelineKindsV1)[number];
    createdAt: string;
    assessment: {
      disposition: "consistent" | "inconclusive" | "unlikely";
      confidenceBasisPoints: number;
      assessmentCodes: (typeof npAgentGuardianAssessmentCodes)[number][];
      evidenceDigests: string[];
    } | null;
  }[];
  /** Integrity checksum of the other fields, never a signature or permission grant. */
  checksum: string;
}
export interface NpAgentGuardianDiagnosticsV1 {
  schemaVersion: "np.agent-guardian-diagnostics.v1";
  siteId: string;
  observedAt: string;
  coverage: "bounded-sample";
  sources: {
    id: NpAgentGuardianOperationsSourceIdV1;
    state: "unregistered" | "disabled" | "unavailable" | "partial" | "verified";
    sampled: number | null;
    verified: number | null;
    proofUnavailable: number | null;
    truncated: boolean;
  }[];
  detectors: {
    id: NpAgentGuardianOperationsDetectorIdV1;
    version: 1;
    source: NpAgentGuardianOperationsSourceIdV1;
  }[];
  signals: { sampled: number; invalid: number; unsupported: number; truncated: boolean };
  openCriticalIncidents: { observedCount: number; truncated: boolean };
  notificationFailures: { observedCount: number; truncated: boolean };
  contentReceipts?: NpAgentGuardianContentCoverageV1 | null;
  runtimeReceipts?: NpAgentGuardianReceiptCoverageV1 | null;
  /** Null means no explicitly composed Operator source. Its facts do not become Guardian proof. */
  operatorCoverage?: NpAgentGuardianOperatorCoverageV1 | null;
}
const p = "guardian.operations";
function fail(): never {
  return failCanonicalBody(
    "invalid-field",
    p,
    "must match exact bounded Guardian operations evidence",
  );
}
const rec = (v: unknown, keys: string[]) =>
  canonicalBodyRecord(v, p, keys, keys, { seen: new WeakSet() });
const en = <const T extends string>(v: unknown, values: readonly T[]) =>
  canonicalBodyEnum<T>(v, p, new Set(values));
const count = (v: unknown, max = 10000) => canonicalBodyInteger(v, p, 0, max);
const positive = (v: unknown) => canonicalBodyInteger(v, p, 1, 2147483647);
const arr = (v: unknown, max: number) => canonicalBodyArray(v, p, max, { seen: new WeakSet() });
const detector = (v: unknown) =>
  en(
    v,
    npAgentGuardianOperationsDetectorsV1.map((d) => d.id),
  );
const source = (v: unknown) => en(v, npAgentGuardianOperationsSourceIdsV1);
const utc = (v: unknown) => canonicalBodyUtc(v, p);
const uuid = (v: unknown) => canonicalBodyUuid(v, p);
const sha = (v: unknown) => canonicalBodySha256Digest(v, p);
function unique(values: string[]) {
  if (new Set(values).size !== values.length) fail();
}
function bool(v: unknown): boolean {
  if (typeof v !== "boolean") fail();
  return v;
}
export function npRequireAgentGuardianVerifiedEventV1(
  value: unknown,
): NpAgentGuardianVerifiedEventV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 4096), [
    "schemaVersion",
    "eventId",
    "source",
    "observedAt",
    "sourceDigest",
    "detectorId",
  ]);
  const id = r.detectorId === null ? null : detector(r.detectorId),
    family = source(r.source);
  if (
    id !== null &&
    !npAgentGuardianOperationsDetectorsV1.some((d) => d.id === id && d.source === family)
  )
    fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-verified-event.v1"]),
    eventId: uuid(r.eventId),
    source: family,
    observedAt: utc(r.observedAt),
    sourceDigest: sha(r.sourceDigest),
    detectorId: id,
  };
}
export function npRequireAgentGuardianIncidentExportV1(
  value: unknown,
): NpAgentGuardianIncidentExportV1 {
  const r = rec(cloneCanonicalRuntimeInput(value, p, 262144), [
    "schemaVersion",
    "exportedAt",
    "completeness",
    "incident",
    "signals",
    "sources",
    "outcomes",
    "checksum",
  ]);
  const i = rec(r.incident, [
    "id",
    "siteId",
    "versionNumber",
    "category",
    "severity",
    "status",
    "eventCount",
    "firstObservedAt",
    "lastObservedAt",
    "createdAt",
    "updatedAt",
  ]);
  const incident = {
    id: uuid(i.id),
    siteId: canonicalBodySiteId(i.siteId, p),
    versionNumber: positive(i.versionNumber),
    category: en(i.category, npAgentIncidentCategories),
    severity: en(i.severity, npAgentIncidentSeverities),
    status: en(i.status, npAgentIncidentStates),
    eventCount: count(i.eventCount),
    firstObservedAt: utc(i.firstObservedAt),
    lastObservedAt: utc(i.lastObservedAt),
    createdAt: utc(i.createdAt),
    updatedAt: utc(i.updatedAt),
  };
  const signals = arr(r.signals, 100).map((v) => {
    const s = rec(v, [
      "id",
      "detectorId",
      "detectorVersion",
      "category",
      "confidenceBasis",
      "scoreBasisPoints",
      "createdAt",
    ]);
    return {
      id: uuid(s.id),
      detectorId: detector(s.detectorId),
      detectorVersion: canonicalBodyInteger(s.detectorVersion, p, 1, 1) as 1,
      category: en(s.category, npAgentIncidentCategories),
      confidenceBasis: en(s.confidenceBasis, ["exact-rule", "statistical", "external"]),
      scoreBasisPoints: s.scoreBasisPoints === null ? null : count(s.scoreBasisPoints),
      createdAt: utc(s.createdAt),
    };
  });
  unique(signals.map((s) => s.id));
  const sources = arr(r.sources, 100).map((v) => {
    const s = rec(v, [
      "signalId",
      "source",
      "startedAt",
      "endedAt",
      "observedCount",
      "countBasis",
      "sourceDigest",
      "impact",
      "affectedSiteCount",
    ]);
    return {
      signalId: uuid(s.signalId),
      source: source(s.source),
      startedAt: utc(s.startedAt),
      endedAt: utc(s.endedAt),
      observedCount: positive(s.observedCount),
      countBasis: en(s.countBasis, [
        "at-least",
        "committed-transition",
        "authenticated-external-fact",
      ]),
      sourceDigest: s.sourceDigest === null ? null : sha(s.sourceDigest),
      impact: en(s.impact, ["site", "deployment"]),
      affectedSiteCount: canonicalBodyInteger(s.affectedSiteCount, p, 1, 10000),
    };
  });
  unique(sources.map((s) => s.signalId));
  if (
    !signals.length ||
    sources.length !== signals.length ||
    incident.firstObservedAt > incident.lastObservedAt ||
    incident.createdAt > incident.updatedAt ||
    sources.some(
      (s) =>
        s.startedAt > s.endedAt ||
        !signals.some(
          (signal) =>
            signal.id === s.signalId &&
            npAgentGuardianOperationsDetectorsV1.some(
              (d) => d.id === signal.detectorId && d.source === s.source,
            ),
        ) ||
        (s.impact === "site" && s.affectedSiteCount !== 1),
    )
  )
    fail();
  const outcomes = arr(r.outcomes, 50).map((v) => {
    const o = rec(v, ["id", "sequence", "kind", "createdAt", "assessment"]);
    let assessment: NpAgentGuardianIncidentExportV1["outcomes"][number]["assessment"] = null;
    if (o.assessment !== null) {
      const a = rec(o.assessment, [
        "disposition",
        "confidenceBasisPoints",
        "assessmentCodes",
        "evidenceDigests",
      ]);
      assessment = {
        disposition: en(a.disposition, ["consistent", "inconclusive", "unlikely"]),
        confidenceBasisPoints: count(a.confidenceBasisPoints),
        assessmentCodes: arr(a.assessmentCodes, 32).map((v) =>
          en(v, npAgentGuardianAssessmentCodes),
        ),
        evidenceDigests: arr(a.evidenceDigests, 100).map(sha),
      };
      unique(assessment.assessmentCodes);
      unique(assessment.evidenceDigests);
    }
    return {
      id: uuid(o.id),
      sequence: positive(o.sequence),
      kind: en(o.kind, npAgentIncidentTimelineKindsV1),
      createdAt: utc(o.createdAt),
      assessment,
    };
  });
  unique(outcomes.map((o) => o.id));
  if (outcomes.some((o, n) => n > 0 && outcomes[n - 1].sequence >= o.sequence)) fail();
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-incident-export.v1"]),
    exportedAt: utc(r.exportedAt),
    completeness: en(r.completeness, ["complete"]),
    incident,
    signals,
    sources,
    outcomes,
    checksum: sha(r.checksum),
  };
}
export function npRequireAgentGuardianDiagnosticsV1(value: unknown): NpAgentGuardianDiagnosticsV1 {
  const keys = [
    "schemaVersion",
    "siteId",
    "observedAt",
    "coverage",
    "sources",
    "detectors",
    "signals",
    "openCriticalIncidents",
    "notificationFailures",
  ];
  const r = canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, p, 32768),
    p,
    [...keys, "contentReceipts", "runtimeReceipts", "operatorCoverage"],
    keys,
    { seen: new WeakSet() },
  );
  const sources = arr(r.sources, npAgentGuardianOperationsSourceIdsV1.length).map((v) => {
    const s = rec(v, ["id", "state", "sampled", "verified", "proofUnavailable", "truncated"]);
    const result = {
      id: source(s.id),
      state: en(s.state, ["unregistered", "disabled", "unavailable", "partial", "verified"]),
      sampled: s.sampled === null ? null : count(s.sampled, 25),
      verified: s.verified === null ? null : count(s.verified, 25),
      proofUnavailable: s.proofUnavailable === null ? null : count(s.proofUnavailable, 25),
      truncated: bool(s.truncated),
    };
    if (
      result.sampled === null
        ? result.verified !== null ||
          result.proofUnavailable !== null ||
          result.state === "verified" ||
          result.state === "partial"
        : result.verified === null ||
          result.proofUnavailable === null ||
          result.verified + result.proofUnavailable !== result.sampled ||
          !["partial", "verified"].includes(result.state)
    )
      fail();
    return result;
  });
  if (sources.length !== npAgentGuardianOperationsSourceIdsV1.length) fail();
  unique(sources.map((s) => s.id));
  const detectors = arr(r.detectors, npAgentGuardianOperationsDetectorsV1.length).map((v) => {
    const d = rec(v, ["id", "version", "source"]);
    const result = {
      id: detector(d.id),
      version: canonicalBodyInteger(d.version, p, 1, 1) as 1,
      source: source(d.source),
    };
    if (
      !npAgentGuardianOperationsDetectorsV1.some(
        (d) => d.id === result.id && d.source === result.source,
      )
    )
      fail();
    return result;
  });
  if (detectors.length !== npAgentGuardianOperationsDetectorsV1.length) fail();
  unique(detectors.map((d) => d.id));
  const s = rec(r.signals, ["sampled", "invalid", "unsupported", "truncated"]);
  const signals = {
    sampled: count(s.sampled, 100),
    invalid: count(s.invalid, 100),
    unsupported: count(s.unsupported, 100),
    truncated: bool(s.truncated),
  };
  if (signals.invalid + signals.unsupported > signals.sampled) fail();
  const bounded = (v: unknown) => {
    const b = rec(v, ["observedCount", "truncated"]);
    return { observedCount: count(b.observedCount, 25), truncated: bool(b.truncated) };
  };
  return {
    schemaVersion: en(r.schemaVersion, ["np.agent-guardian-diagnostics.v1"]),
    siteId: canonicalBodySiteId(r.siteId, p),
    observedAt: utc(r.observedAt),
    coverage: en(r.coverage, ["bounded-sample"]),
    sources,
    detectors,
    signals,
    openCriticalIncidents: bounded(r.openCriticalIncidents),
    notificationFailures: bounded(r.notificationFailures),
    ...(r.operatorCoverage === undefined
      ? {}
      : {
          operatorCoverage:
            r.operatorCoverage === null
              ? null
              : npRequireAgentGuardianOperatorCoverageV1(r.operatorCoverage),
        }),
    ...(r.runtimeReceipts === undefined
      ? {}
      : {
          runtimeReceipts:
            r.runtimeReceipts === null
              ? null
              : npRequireAgentGuardianReceiptCoverageV1(r.runtimeReceipts),
        }),
    ...(r.contentReceipts === undefined
      ? {}
      : {
          contentReceipts:
            r.contentReceipts === null
              ? null
              : npRequireAgentGuardianContentCoverageV1(r.contentReceipts),
        }),
  };
}
