import {
  npAgentEvaluationCapabilityIdsV1,
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationCaseV1,
  type NpAgentEvaluationSuiteV1,
} from "../agent-contract/evaluation-contract.js";
import type { NpAgentModeratorAssessmentEvidenceV2 } from "../agent-contract/moderator-segmented-assessment-contract.js";
import {
  npAgentModeratorSegmentTargetProjectionV2,
  npAgentModeratorSegmentTargetsDigestPurposeV2,
} from "../agent-contract/moderator-segmented-assessment-summary.js";
import type {
  NpAgentModeratorSegmentedEvaluationFactsV2,
  NpAgentModeratorSegmentedEvaluationResultV2,
} from "../agent-contract/moderator-segmented-evaluation-contract.js";
import { npDigestAgentModeratorSegmentedEvidenceV2 as digest } from "./moderator-segmented-assessment-proof.js";

type Segment = NpAgentModeratorSegmentedEvaluationFactsV2["segments"][number];
type Label = Segment["decision"]["label"];
type Result = NpAgentModeratorSegmentedEvaluationResultV2;
const observedAt = "2026-11-26T00:00:00.000Z";
const fixtureUuid = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const fixtureDigest = (kind: string, index: number) =>
  digest("np.agent-segmented-eval-fixture.v2", { kind, index });

function corpus(targetCount: number, labels: Label[], duplicateTarget = false) {
  const incident = { id: fixtureUuid(1), versionNumber: 7, fingerprint: "synthetic-incident" };
  const segmentCount = Math.ceil(targetCount / 10);
  const manifest = {
    digest: fixtureDigest("manifest", targetCount),
    signalCount: 1,
    eventCount: targetCount,
    targetCount,
    segmentCount,
    incomplete: false,
    segmentDigests: [] as string[],
  };
  const segments = Array.from({ length: segmentCount }, (_, segmentIndex): Segment => {
    const sources = Array.from(
      { length: Math.min(10, targetCount - segmentIndex * 10) },
      (_, localIndex): NpAgentModeratorAssessmentEvidenceV2["sources"][number] => {
        const index =
          duplicateTarget && segmentIndex === 1 && localIndex === 0
            ? 0
            : segmentIndex * 10 + localIndex;
        const documentId = `synthetic-${index}`;
        return {
          id: `moderator-assessment-${localIndex.toString().padStart(3, "0")}`,
          eventId: fixtureUuid(index + 2),
          eventDigest: fixtureDigest("event", index),
          subject:
            index % 2 === 0
              ? { kind: "document", collection: "posts", documentId }
              : {
                  kind: "comment",
                  commentId: `synthetic-comment-${index}`,
                  collection: "posts",
                  documentId,
                },
          currentVersionDigest: fixtureDigest("version", index),
          excerptDigest: fixtureDigest("excerpt", index),
        };
      },
    );
    const evidence = {
      schemaVersion: "np.agent-moderator-assessment-evidence.v2" as const,
      observedAt,
      incident,
      truncated: false,
      sources,
      manifest,
      segmentIndex,
    };
    const { projected } = npAgentModeratorSegmentTargetProjectionV2(evidence);
    manifest.segmentDigests.push(digest(npAgentModeratorSegmentTargetsDigestPurposeV2, projected));
    const label = labels[segmentIndex] ?? "spam";
    return {
      evidence,
      decision: {
        kind: "classification",
        label,
        confidenceBasisPoints: label === "uncertain" ? 0 : 9000 - segmentIndex * 50,
        reasonCodes:
          label === "uncertain"
            ? ["insufficient-evidence"]
            : label === "benign"
              ? []
              : ["repeated-template"],
        evidenceDigests: sources.map((source) => source.excerptDigest).sort(),
        summary: "Synthetic segment decision",
      },
    };
  });
  return { manifest, segments };
}

function expected(
  state: Result["state"],
  segmentCount: number,
  verifiedSegments: number,
  targetCount: number,
  verifiedTargets: number,
  label: Result["label"] = null,
  confidenceBasisPoints: Result["confidenceBasisPoints"] = null,
  complete = false,
): Result {
  return {
    state,
    coverage: { segmentCount, verifiedSegments, targetCount, verifiedTargets, complete },
    label,
    confidenceBasisPoints,
  };
}

export async function npCreateAgentModeratorSegmentedEvaluationSuiteV2(): Promise<NpAgentEvaluationSuiteV1> {
  const large = corpus(151, []);
  const agreeing = corpus(11, ["benign", "benign"]);
  const conflicting = corpus(11, ["spam", "benign"]);
  const uncertain = corpus(11, ["spam", "uncertain"]);
  const duplicateTarget = corpus(11, [], true);
  const [first, second] = agreeing.segments;
  const changedIncident: Segment = {
    ...second,
    evidence: {
      ...second.evidence,
      incident: { id: fixtureUuid(1), versionNumber: 8, fingerprint: "synthetic-incident" },
    },
  };
  const changedProjection: Segment = {
    ...second,
    evidence: {
      ...second.evidence,
      sources: second.evidence.sources.map((source) => ({
        ...source,
        currentVersionDigest: fixtureDigest("changed-version", 10),
      })),
    },
  };
  const outsideDecision: Segment = {
    ...second,
    decision: { ...second.decision, evidenceDigests: [first.evidence.sources[0].excerptDigest] },
  };
  const truncated: Segment = {
    evidence: { ...second.evidence, truncated: true, sources: [] },
    decision: {
      ...second.decision,
      label: "uncertain",
      confidenceBasisPoints: 0,
      evidenceDigests: [],
      reasonCodes: ["insufficient-evidence"],
    },
  };
  const withSegments = (segments: Segment[]) => ({ manifest: agreeing.manifest, segments });
  const fixtures: readonly [
    string,
    Pick<NpAgentModeratorSegmentedEvaluationFactsV2, "manifest" | "segments">,
    Result,
  ][] = [
    ["all-151-targets-agree", large, expected("assessed", 16, 16, 151, 151, "spam", 8250, true)],
    [
      "complete-disagreement",
      conflicting,
      expected("assessed", 2, 2, 11, 11, "uncertain", 0, true),
    ],
    ["complete-uncertain", uncertain, expected("assessed", 2, 2, 11, 11, "uncertain", 0, true)],
    ["complete-benign", agreeing, expected("assessed", 2, 2, 11, 11, "benign", 8950, true)],
    ["missing-tail", withSegments([first]), expected("awaiting-segments", 2, 1, 11, 10)],
    ["empty-prefix", withSegments([]), expected("awaiting-segments", 2, 0, 11, 0)],
    ["out-of-order", withSegments([second, first]), expected("invalid-segments", 2, 0, 11, 0)],
    ["duplicate-index", withSegments([first, first]), expected("invalid-segments", 2, 1, 11, 10)],
    ["duplicate-target", duplicateTarget, expected("invalid-segments", 2, 1, 11, 10)],
    [
      "incident-version-drift",
      withSegments([first, changedIncident]),
      expected("invalid-segments", 2, 1, 11, 10),
    ],
    [
      "target-commitment-drift",
      withSegments([first, changedProjection]),
      expected("invalid-segments", 2, 1, 11, 10),
    ],
    [
      "unbound-decision",
      withSegments([first, outsideDecision]),
      expected("invalid-segments", 2, 1, 11, 10),
    ],
    [
      "truncated-source",
      withSegments([first, truncated]),
      expected("assessed", 2, 2, 11, 10, "uncertain", 0),
    ],
  ];
  const cases = await Promise.all(
    fixtures.map(async ([id, facts, result], index): Promise<NpAgentEvaluationCaseV1> => {
      const locale = index % 2 === 0 ? "en" : "ko";
      const source = {
        id: "moderator-segmented-assessment",
        kind: "moderator-segments" as const,
        observedAt,
        text: JSON.stringify({
          schemaVersion: "np.agent-moderator-segmented-eval-facts.v2",
          locale,
          ...facts,
        }),
      };
      return {
        schemaVersion: "np.agent-eval-case.v1",
        id,
        caseVersion: 1,
        locale,
        category: "moderator-segmented-assessment",
        evidence: [{ ...source, digest: await npDigestAgentEvaluationValueV1(source) }],
        expectedSignals: [],
        allowedActions: [],
        forbiddenActions: [...npAgentEvaluationCapabilityIdsV1].sort(),
        expectedDecision:
          result.label === "benign" ? "ignore" : result.label === "spam" ? "advise" : "observe",
        rationaleTags: [],
        expectedSegmentedAssessment: result,
      };
    }),
  );
  return npRequireAgentEvaluationSuiteV1({
    schemaVersion: "np.agent-eval-suite.v1",
    id: "moderator-segmented-assessment",
    version: 2,
    cases,
  });
}
