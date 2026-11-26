import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { npRequireAgentModeratorAssessmentEvaluationResponseV1 } from "./moderator-assessment-evaluation-contract.js";
import {
  npAgentModeratorAssessmentSegmentLimitsV2,
  npRequireAgentModeratorAssessmentEvidenceV2,
  npRequireAgentModeratorAssessmentManifestV2,
  type NpAgentModeratorAssessmentEvidenceV2,
  type NpAgentModeratorAssessmentManifestV2,
} from "./moderator-segmented-assessment-contract.js";
import {
  npAddAgentModeratorSegmentTargetsV2,
  npAgentModeratorSegmentTargetProjectionV2,
  npAgentModeratorSegmentTargetsDigestPurposeV2,
  npMatchesAgentModeratorSegmentAnchorV2,
  npMatchesAgentModeratorSegmentDecisionV2,
  npSummarizeAgentModeratorSegmentedAssessmentV2,
} from "./moderator-segmented-assessment-summary.js";
import type { NpAgentJsonObject, NpAgentModerationDecisionV1 } from "./types.js";

type Decision = Extract<NpAgentModerationDecisionV1, { kind: "classification" }>;
type Segment = { evidence: NpAgentModeratorAssessmentEvidenceV2; decision: Decision };
type State = "awaiting-segments" | "invalid-segments" | "assessed";
const states = new Set<State>(["awaiting-segments", "invalid-segments", "assessed"]);
const labels = new Set<Decision["label"]>(["spam", "abuse", "benign", "uncertain"]);

export interface NpAgentModeratorSegmentedEvaluationFactsV2 {
  schemaVersion: "np.agent-moderator-segmented-eval-facts.v2";
  locale: "en" | "ko";
  manifest: NpAgentModeratorAssessmentManifestV2;
  segments: Segment[];
}
export interface NpAgentModeratorSegmentedEvaluationResultV2 {
  state: State;
  coverage: {
    segmentCount: number;
    verifiedSegments: number;
    targetCount: number;
    verifiedTargets: number;
    complete: boolean;
  };
  label: Decision["label"] | null;
  confidenceBasisPoints: number | null;
}

export const npAgentModeratorSegmentedEvaluationMaxBytesV2 = 256 * 1024;
export const npAgentModeratorSegmentedEvaluationInstructionV2 =
  "Check the ordered synthetic V2 segment evidence against its manifest. Report verified segment and target coverage separately from the advisory classification. Missing segments withhold the aggregate. Uncertain or conflicting decisions require an uncertain aggregate.";
export const npAgentModeratorSegmentedEvaluationResultSchemaV2: NpAgentJsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    state: { enum: [...states] },
    coverage: {
      type: "object",
      additionalProperties: false,
      properties: {
        segmentCount: { type: "integer", minimum: 1, maximum: 100 },
        verifiedSegments: { type: "integer", minimum: 0, maximum: 100 },
        targetCount: { type: "integer", minimum: 0, maximum: 10000 },
        verifiedTargets: { type: "integer", minimum: 0, maximum: 1000 },
        complete: { type: "boolean" },
      },
      required: ["segmentCount", "verifiedSegments", "targetCount", "verifiedTargets", "complete"],
    },
    label: { enum: [...labels, null] },
    confidenceBasisPoints: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 10000 }, { type: "null" }],
    },
  },
  required: ["state", "coverage", "label", "confidenceBasisPoints"],
};

const path = "agent.evaluation.moderator-segmented";
function fail(): never {
  throw new Error("Invalid synthetic segmented assessment evaluation.");
}
const rec = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });

export function npRequireAgentModeratorSegmentedEvaluationFactsV2(
  evidence: readonly { id: string; text: string }[],
): NpAgentModeratorSegmentedEvaluationFactsV2 {
  if (
    evidence.length !== 1 ||
    evidence[0].id !== "moderator-segmented-assessment" ||
    new TextEncoder().encode(evidence[0].text).length >
      npAgentModeratorSegmentedEvaluationMaxBytesV2
  )
    fail();
  const row = rec(JSON.parse(evidence[0].text), [
    "schemaVersion",
    "locale",
    "manifest",
    "segments",
  ]);
  if (
    row.schemaVersion !== "np.agent-moderator-segmented-eval-facts.v2" ||
    (row.locale !== "en" && row.locale !== "ko") ||
    !Array.isArray(row.segments) ||
    row.segments.length > npAgentModeratorAssessmentSegmentLimitsV2.segments
  )
    fail();
  return {
    schemaVersion: row.schemaVersion,
    locale: row.locale,
    manifest: npRequireAgentModeratorAssessmentManifestV2(row.manifest),
    segments: row.segments.map((item) => {
      const segment = rec(item, ["evidence", "decision"]);
      return {
        evidence: npRequireAgentModeratorAssessmentEvidenceV2(segment.evidence),
        decision: npRequireAgentModeratorAssessmentEvaluationResponseV1({
          task: "moderation-classification",
          decision: segment.decision,
        }).decision,
      };
    }),
  };
}

export function npRequireAgentModeratorSegmentedEvaluationResultV2(
  value: unknown,
): NpAgentModeratorSegmentedEvaluationResultV2 {
  const row = rec(value, ["state", "coverage", "label", "confidenceBasisPoints"]);
  const state = canonicalBodyEnum<State>(row.state, path, states);
  const label =
    row.label === null ? null : canonicalBodyEnum<Decision["label"]>(row.label, path, labels);
  const confidenceBasisPoints =
    row.confidenceBasisPoints === null
      ? null
      : canonicalBodyInteger(row.confidenceBasisPoints, path, 0, 10000);
  const coverage = rec(row.coverage, [
    "segmentCount",
    "verifiedSegments",
    "targetCount",
    "verifiedTargets",
    "complete",
  ]);
  const { targets, targetsPerSegment, segments } = npAgentModeratorAssessmentSegmentLimitsV2;
  const segmentCount = canonicalBodyInteger(coverage.segmentCount, path, 1, segments);
  const verifiedSegments = canonicalBodyInteger(coverage.verifiedSegments, path, 0, segmentCount);
  const targetCount = canonicalBodyInteger(coverage.targetCount, path, 0, 10000);
  const verifiedTargets = canonicalBodyInteger(
    coverage.verifiedTargets,
    path,
    0,
    Math.min(targetCount, targets, verifiedSegments * targetsPerSegment),
  );
  const complete = coverage.complete;
  if (
    typeof complete !== "boolean" ||
    segmentCount !== Math.max(1, Math.ceil(Math.min(targetCount, targets) / targetsPerSegment)) ||
    (state === "assessed"
      ? verifiedSegments !== segmentCount || label === null || confidenceBasisPoints === null
      : complete || label !== null || confidenceBasisPoints !== null) ||
    (state === "awaiting-segments" && verifiedSegments >= segmentCount) ||
    (complete && verifiedTargets !== targetCount) ||
    (!complete && label !== null && label !== "uncertain") ||
    (label === "uncertain" && confidenceBasisPoints !== 0)
  )
    fail();
  return {
    state,
    coverage: { segmentCount, verifiedSegments, targetCount, verifiedTargets, complete },
    label,
    confidenceBasisPoints,
  };
}

/** Replay only supplied synthetic metadata and classifications through the V2 segment rules. */
export async function npEvaluateAgentModeratorSegmentsV2(
  evidence: readonly { id: string; text: string }[],
): Promise<NpAgentModeratorSegmentedEvaluationResultV2> {
  const { manifest, segments } = npRequireAgentModeratorSegmentedEvaluationFactsV2(evidence);
  const anchor = segments[0]?.evidence;
  const targets = new Set<string>();
  let verifiedSegments = 0;
  const coverage = (complete: boolean) => ({
    segmentCount: manifest.segmentCount,
    verifiedSegments,
    targetCount: manifest.targetCount,
    verifiedTargets: targets.size,
    complete,
  });
  const pending = (
    state: Exclude<State, "assessed">,
  ): NpAgentModeratorSegmentedEvaluationResultV2 => ({
    state,
    coverage: coverage(false),
    label: null,
    confidenceBasisPoints: null,
  });
  if (!anchor) return pending("awaiting-segments");
  if (
    !anchor.incident ||
    serializeAgentCanonicalJson(anchor.manifest) !== serializeAgentCanonicalJson(manifest)
  )
    return pending("invalid-segments");
  for (const { evidence: segment, decision } of segments) {
    if (
      !npMatchesAgentModeratorSegmentAnchorV2(anchor, segment, verifiedSegments) ||
      !npMatchesAgentModeratorSegmentDecisionV2(segment, decision)
    )
      return pending("invalid-segments");
    const projection = npAgentModeratorSegmentTargetProjectionV2(segment);
    if (
      segment.sources.length > projection.expectedCount ||
      (projection.projected !== null &&
        (segment.sources.length !== projection.expectedCount ||
          (await digestAgentCanonicalSha256(
            new TextEncoder().encode(
              `${npAgentModeratorSegmentTargetsDigestPurposeV2}\0${serializeAgentCanonicalJson(projection.projected)}`,
            ),
          )) !== manifest.segmentDigests[verifiedSegments]))
    )
      return pending("invalid-segments");
    if (!npAddAgentModeratorSegmentTargetsV2(targets, segment.sources))
      return pending("invalid-segments");
    verifiedSegments++;
  }
  if (verifiedSegments < manifest.segmentCount) return pending("awaiting-segments");
  const { complete, label, confidenceBasisPoints } = npSummarizeAgentModeratorSegmentedAssessmentV2(
    manifest,
    segments,
  );
  return npRequireAgentModeratorSegmentedEvaluationResultV2({
    state: "assessed",
    coverage: coverage(complete),
    label,
    confidenceBasisPoints,
  });
}
