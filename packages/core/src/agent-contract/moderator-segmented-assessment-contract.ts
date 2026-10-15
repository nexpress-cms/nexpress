import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npRequireAgentModeratorAssessmentEvidenceV1,
  npRequireAgentModeratorAssessmentV1,
  type NpAgentModeratorAssessmentEvidenceV1,
  type NpAgentModeratorAssessmentV1,
} from "./moderator-assessment-contract.js";

export const npAgentModeratorAssessmentSegmentLimitsV2 = Object.freeze({
  signals: 100,
  events: 10000,
  targets: 1000,
  segments: 100,
  targetsPerSegment: 10,
});
export interface NpAgentModeratorAssessmentManifestV2 {
  digest: string;
  signalCount: number;
  eventCount: number;
  targetCount: number;
  segmentCount: number;
  incomplete: boolean;
  segmentDigests: string[];
}
export interface NpAgentModeratorAssessmentEvidenceV2 extends Omit<
  NpAgentModeratorAssessmentEvidenceV1,
  "schemaVersion"
> {
  schemaVersion: "np.agent-moderator-assessment-evidence.v2";
  manifest: NpAgentModeratorAssessmentManifestV2;
  segmentIndex: number;
}
/** A separately labelled aggregate of exact read-only model calls, never execution authority. */
export interface NpAgentModeratorSegmentedAssessmentV2 {
  schemaVersion: "np.agent-moderator-segmented-assessment.v2";
  incidentId: string;
  incidentVersion: number;
  observedAt: string;
  label: NpAgentModeratorAssessmentV1["label"];
  confidenceBasisPoints: number;
  reasonCodes: NpAgentModeratorAssessmentV1["reasonCodes"];
  summary: string;
  coverage: Omit<NpAgentModeratorAssessmentManifestV2, "digest" | "segmentDigests"> & {
    manifestDigest: string;
    complete: boolean;
  };
  segmentProviderCallIds: string[];
  proofDigest: string;
  provenance: Omit<
    NpAgentModeratorAssessmentV1["provenance"],
    "providerCallId" | "requestDigest" | "responseDigest" | "sourceDigest"
  >;
}
const invalid = (): never =>
  failCanonicalBody(
    "invalid-field",
    "moderator.segmentedAssessment",
    "must be exact bounded segmented assessment evidence",
  );
function record(value: unknown, keys: string[]) {
  return canonicalBodyRecord(value, "moderator.segmentedAssessment", keys, keys, {
    seen: new WeakSet<object>(),
  });
}
export function npRequireAgentModeratorAssessmentManifestV2(
  value: unknown,
): NpAgentModeratorAssessmentManifestV2 {
  const row = record(value, [
    "digest",
    "signalCount",
    "eventCount",
    "targetCount",
    "segmentCount",
    "incomplete",
    "segmentDigests",
  ]);
  if (
    typeof row.incomplete !== "boolean" ||
    !Array.isArray(row.segmentDigests) ||
    row.segmentDigests.length < 1 ||
    row.segmentDigests.length > 100
  )
    invalid();
  const segmentDigests = (row.segmentDigests as unknown[]).map((entry) =>
    canonicalBodySha256Digest(entry, "moderator.segmentDigest"),
  );
  const targetCount = canonicalBodyInteger(row.targetCount, "moderator.targetCount", 0, 10000);
  const segmentCount = canonicalBodyInteger(row.segmentCount, "moderator.segmentCount", 1, 100);
  if (
    segmentCount !== segmentDigests.length ||
    segmentCount !== Math.max(1, Math.ceil(Math.min(targetCount, 1000) / 10)) ||
    (targetCount > 1000 && !row.incomplete)
  )
    invalid();
  return {
    digest: canonicalBodySha256Digest(row.digest, "moderator.manifestDigest"),
    signalCount: canonicalBodyInteger(row.signalCount, "moderator.signalCount", 0, 100),
    eventCount: canonicalBodyInteger(row.eventCount, "moderator.eventCount", 0, 10000),
    targetCount,
    segmentCount,
    incomplete: row.incomplete as boolean,
    segmentDigests,
  };
}
export function npRequireAgentModeratorAssessmentEvidenceV2(
  value: unknown,
): NpAgentModeratorAssessmentEvidenceV2 {
  const row = record(value, [
    "schemaVersion",
    "observedAt",
    "incident",
    "truncated",
    "sources",
    "manifest",
    "segmentIndex",
  ]);
  if (row.schemaVersion !== "np.agent-moderator-assessment-evidence.v2") invalid();
  const base = npRequireAgentModeratorAssessmentEvidenceV1({
    schemaVersion: "np.agent-moderator-assessment-evidence.v1",
    observedAt: row.observedAt,
    incident: row.incident,
    truncated: row.truncated,
    sources: row.sources,
  });
  const manifest = npRequireAgentModeratorAssessmentManifestV2(row.manifest);
  const segmentIndex = canonicalBodyInteger(
    row.segmentIndex,
    "moderator.segmentIndex",
    0,
    manifest.segmentCount - 1,
  );
  return {
    ...base,
    schemaVersion: "np.agent-moderator-assessment-evidence.v2",
    manifest,
    segmentIndex,
  };
}
export function npRequireAgentModeratorSegmentedAssessmentV2(
  value: unknown,
): NpAgentModeratorSegmentedAssessmentV2 {
  const row = record(value, [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "observedAt",
    "label",
    "confidenceBasisPoints",
    "reasonCodes",
    "summary",
    "coverage",
    "segmentProviderCallIds",
    "proofDigest",
    "provenance",
  ]);
  if (
    row.schemaVersion !== "np.agent-moderator-segmented-assessment.v2" ||
    new TextEncoder().encode(serializeAgentCanonicalJson(value)).byteLength > 15000
  )
    invalid();
  const coverage = record(row.coverage, [
    "manifestDigest",
    "signalCount",
    "eventCount",
    "targetCount",
    "segmentCount",
    "incomplete",
    "complete",
  ]);
  if (
    typeof coverage.incomplete !== "boolean" ||
    typeof coverage.complete !== "boolean" ||
    !Array.isArray(row.segmentProviderCallIds) ||
    row.segmentProviderCallIds.length < 1 ||
    row.segmentProviderCallIds.length > 100
  )
    invalid();
  const ids = (row.segmentProviderCallIds as unknown[]).map((entry) =>
    canonicalBodyUuid(entry, "moderator.segmentCall"),
  );
  const provenance = record(row.provenance, [
    "runId",
    "provider",
    "model",
    "recipeFingerprint",
    "instructionDigest",
    "policyDigests",
  ]);
  const manifestDigest = canonicalBodySha256Digest(
    coverage.manifestDigest,
    "moderator.manifestDigest",
  );
  const segmentCount = canonicalBodyInteger(
    coverage.segmentCount,
    "moderator.segmentCount",
    1,
    100,
  );
  const targetCount = canonicalBodyInteger(coverage.targetCount, "moderator.targetCount", 0, 10000);
  if (
    new Set(ids).size !== ids.length ||
    ids.length > segmentCount ||
    segmentCount !== Math.max(1, Math.ceil(Math.min(targetCount, 1000) / 10)) ||
    coverage.complete !== (ids.length === segmentCount && !coverage.incomplete) ||
    (targetCount > 1000 && !coverage.incomplete)
  )
    invalid();
  // Reuse the unchanged V1 scalar/provenance validators without widening its source contract.
  const synthetic = npRequireAgentModeratorAssessmentV1({
    schemaVersion: "np.agent-moderator-assessment.v1",
    incidentId: row.incidentId,
    incidentVersion: row.incidentVersion,
    observedAt: row.observedAt,
    label: row.label,
    confidenceBasisPoints: row.confidenceBasisPoints,
    reasonCodes: row.reasonCodes,
    evidenceDigests: [],
    summary: row.summary,
    evidence: {
      schemaVersion: "np.agent-moderator-assessment-evidence.v1",
      observedAt: row.observedAt,
      incident: {
        id: row.incidentId,
        versionNumber: row.incidentVersion,
        fingerprint: "segmented-assessment",
      },
      truncated: true,
      sources: [],
    },
    provenance: {
      ...provenance,
      providerCallId: ids.at(-1),
      requestDigest: manifestDigest,
      responseDigest: manifestDigest,
      sourceDigest: manifestDigest,
    },
  });
  if (
    (!coverage.complete && row.label !== "uncertain") ||
    (row.label === "uncertain" && !synthetic.reasonCodes.includes("insufficient-evidence"))
  )
    invalid();
  return {
    schemaVersion: "np.agent-moderator-segmented-assessment.v2",
    incidentId: synthetic.incidentId,
    incidentVersion: synthetic.incidentVersion,
    observedAt: synthetic.observedAt,
    label: synthetic.label,
    confidenceBasisPoints: synthetic.confidenceBasisPoints,
    reasonCodes: synthetic.reasonCodes,
    summary: synthetic.summary,
    coverage: {
      manifestDigest,
      signalCount: canonicalBodyInteger(coverage.signalCount, "moderator.signalCount", 0, 100),
      eventCount: canonicalBodyInteger(coverage.eventCount, "moderator.eventCount", 0, 10000),
      targetCount,
      segmentCount,
      incomplete: coverage.incomplete as boolean,
      complete: coverage.complete as boolean,
    },
    segmentProviderCallIds: ids,
    proofDigest: canonicalBodySha256Digest(row.proofDigest, "moderator.proofDigest"),
    provenance: {
      runId: synthetic.provenance.runId,
      provider: synthetic.provenance.provider,
      model: synthetic.provenance.model,
      recipeFingerprint: synthetic.provenance.recipeFingerprint,
      instructionDigest: synthetic.provenance.instructionDigest,
      policyDigests: synthetic.provenance.policyDigests,
    },
  };
}
