import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npAgentModeratorAssessmentSegmentLimitsV2,
  type NpAgentModeratorAssessmentEvidenceV2,
  type NpAgentModeratorAssessmentManifestV2,
} from "./moderator-segmented-assessment-contract.js";
import type { NpAgentModerationDecisionV1 } from "./types.js";

type Evidence = NpAgentModeratorAssessmentEvidenceV2;
type SegmentDecision = Extract<NpAgentModerationDecisionV1, { kind: "classification" }>;

export function npMatchesAgentModeratorSegmentAnchorV2(
  anchor: Evidence,
  evidence: Evidence,
  nextIndex: number,
): boolean {
  return (
    evidence.segmentIndex === nextIndex &&
    evidence.observedAt === anchor.observedAt &&
    serializeAgentCanonicalJson(evidence.incident) ===
      serializeAgentCanonicalJson(anchor.incident) &&
    serializeAgentCanonicalJson(evidence.manifest) === serializeAgentCanonicalJson(anchor.manifest)
  );
}

/** Only accepted segments contribute targets to the prefix. */
export function npAddAgentModeratorSegmentTargetsV2(
  targets: Set<string>,
  sources: Evidence["sources"],
): boolean {
  const keys = sources.map((source) => serializeAgentCanonicalJson(source.subject));
  if (new Set(keys).size !== keys.length || keys.some((key) => targets.has(key))) return false;
  for (const key of keys) targets.add(key);
  return true;
}

export const npAgentModeratorSegmentTargetsDigestPurposeV2 =
  "np.agent-moderator-segment-targets.v2";

export function npAgentModeratorSegmentTargetProjectionV2(evidence: Evidence) {
  const { targets, targetsPerSegment } = npAgentModeratorAssessmentSegmentLimitsV2;
  return {
    expectedCount: Math.min(
      targetsPerSegment,
      Math.max(
        0,
        Math.min(evidence.manifest.targetCount, targets) -
          evidence.segmentIndex * targetsPerSegment,
      ),
    ),
    projected:
      evidence.incident && !evidence.truncated
        ? evidence.sources.map(({ id: _id, ...source }) => ({ ...source, truncated: false }))
        : null,
  };
}

export function npMatchesAgentModeratorSegmentDecisionV2(
  evidence: Evidence,
  decision: SegmentDecision,
): boolean {
  const admitted = [...new Set(evidence.sources.map((source) => source.excerptDigest))].sort();
  if (decision.evidenceDigests.some((digest) => !admitted.includes(digest))) return false;
  if (decision.label === "uncertain") return decision.reasonCodes.includes("insufficient-evidence");
  return (
    !evidence.truncated &&
    evidence.incident !== null &&
    admitted.length > 0 &&
    serializeAgentCanonicalJson(decision.evidenceDigests) === serializeAgentCanonicalJson(admitted)
  );
}

/** Summarize an already checked prefix. A caller records an assessment only after the prefix fills the manifest. */
export function npSummarizeAgentModeratorSegmentedAssessmentV2(
  manifest: NpAgentModeratorAssessmentManifestV2,
  completed: readonly { evidence: Evidence; decision: SegmentDecision }[],
) {
  const incomplete =
    manifest.incomplete ||
    completed.some(({ evidence }) => evidence.truncated || evidence.sources.length === 0);
  const complete = completed.length === manifest.segmentCount && !incomplete;
  const first = completed[0]?.decision.label;
  const label =
    complete &&
    first &&
    first !== "uncertain" &&
    completed.every(({ decision }) => decision.label === first)
      ? first
      : "uncertain";
  return {
    incomplete,
    complete,
    label,
    confidenceBasisPoints:
      label === "uncertain"
        ? 0
        : Math.min(...completed.map(({ decision }) => decision.confidenceBasisPoints)),
    reasonCodes:
      label === "uncertain"
        ? ["insufficient-evidence"]
        : [...new Set(completed.flatMap(({ decision }) => decision.reasonCodes))].sort(),
  };
}
