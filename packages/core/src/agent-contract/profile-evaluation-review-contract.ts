import {
  npCreateAgentPublisherSelectionEvaluationPredictionV1,
  npEvaluateAgentPublisherSelectionV1,
} from "./publisher-selection-evaluation-contract.js";
import { canonicalBodyRecord, canonicalBodyUtc } from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npRequireAgentEvaluationArtifactV1,
  npBuildAgentEvaluationArtifactV1,
  npRequireAgentEvaluationPredictionV1,
  npDigestAgentEvaluationValueV1,
  npCompareAgentEvaluationArtifactsV1,
  npAgentEvaluationArtifactMaxBytesV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentEvaluationPredictionV1,
  type NpAgentEvaluationEvidenceV1,
} from "./evaluation-contract.js";
import type {
  NpAgentEvaluationReviewSummaryV1,
  NpAgentEvaluationReviewComparisonV1,
} from "./evaluation-review-contract.js";
import {
  npCreateAgentModeratorAssessmentEvaluationPredictionV1,
  npEvaluateAgentModeratorAssessmentV1,
} from "./moderator-assessment-evaluation-contract.js";

export interface NpAgentProfileEvaluationReviewLabelV1 {
  caseId: string;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  outcome: "accept" | "edit" | "reject";
  reviewer: string;
  reviewedAt: string;
  notes: string;
  /** Full structured prediction, never executable input or authenticated approval. */
  editedProposal: NpAgentEvaluationPredictionV1 | null;
}
export interface NpAgentProfileEvaluationReviewEntryV1 {
  caseId: string;
  caseVersion: number;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  evidence: NpAgentEvaluationEvidenceV1[];
  prediction: NpAgentEvaluationPredictionV1 | null;
  eligible: boolean;
  review: NpAgentProfileEvaluationReviewLabelV1 | null;
}
export interface NpAgentProfileEvaluationReviewArtifactV1 {
  schemaVersion: "np.agent-profile-eval-review.v1";
  authority: "offline-self-reported-no-approval";
  source: NpAgentEvaluationArtifactV1;
  sourceHash: string;
  labels: NpAgentProfileEvaluationReviewLabelV1[];
  entries: NpAgentProfileEvaluationReviewEntryV1[];
  summary: NpAgentEvaluationReviewSummaryV1;
  artifactHash: string;
}
const path = "agent.evaluation.profileReview";
function fail(): never {
  throw new Error("Invalid exact-bound profile evaluation review.");
}
const rec = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const equal = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
function text(value: unknown, maximum: number, nonempty = false): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (nonempty && !value.trim()) ||
    /[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/gu, ""))
  )
    fail();
  return value;
}
function summarize(
  entries: NpAgentProfileEvaluationReviewEntryV1[],
): NpAgentEvaluationReviewSummaryV1 {
  const eligible = entries.filter((e) => e.eligible).length;
  const accepted = entries.filter((e) => e.review?.outcome === "accept").length;
  const edited = entries.filter((e) => e.review?.outcome === "edit").length;
  const rejected = entries.filter((e) => e.review?.outcome === "reject").length;
  const reviewed = accepted + edited + rejected;
  const rate = (value: number) => (reviewed ? Math.round((value * 10000) / reviewed) : null);
  return {
    eligible,
    unreviewed: eligible - reviewed,
    ineligible: entries.length - eligible,
    accepted,
    edited,
    rejected,
    reviewed,
    acceptBasisPoints: rate(accepted),
    editBasisPoints: rate(edited),
    rejectBasisPoints: rate(rejected),
  };
}
function grounded(
  source: NpAgentEvaluationArtifactV1,
  evidence: NpAgentEvaluationEvidenceV1[],
  value: NpAgentEvaluationPredictionV1,
): boolean {
  if (source.suite.cases[0].category === "moderator-assessment") {
    return (
      !!value.moderatorAssessment &&
      !npEvaluateAgentModeratorAssessmentV1(evidence, value.moderatorAssessment).length &&
      equal(
        npCreateAgentModeratorAssessmentEvaluationPredictionV1(evidence, value.moderatorAssessment),
        value,
      )
    );
  }
  if (source.suite.cases[0].category === "publisher-selection")
    return (
      !!value.publisherSelectionResponse &&
      !npEvaluateAgentPublisherSelectionV1(evidence, value.publisherSelectionResponse).length &&
      equal(
        npCreateAgentPublisherSelectionEvaluationPredictionV1(
          evidence,
          value.publisherSelectionResponse,
        ),
        value,
      )
    );
  return false;
}
/** Offline labels bind source/case/prediction exactly; no identity or execution authority is asserted. */
export async function npBuildAgentProfileEvaluationReviewArtifactV1(
  sourceValue: unknown,
  labelsValue: unknown = [],
): Promise<NpAgentProfileEvaluationReviewArtifactV1> {
  const source = await npRequireAgentEvaluationArtifactV1(sourceValue);
  const category = source.suite.cases[0].category;
  if (
    !["moderator-assessment", "publisher-selection"].includes(category) ||
    source.suite.cases.some((c) => c.category !== category)
  )
    fail();
  const sourceHash = await npDigestAgentEvaluationValueV1(source);
  const values = cloneCanonicalRuntimeInput(
    labelsValue,
    path,
    npAgentEvaluationArtifactMaxBytesV1,
    { maximumNodes: 100000 },
  );
  if (!Array.isArray(values) || values.length > source.caseResults.length) fail();
  const entries: NpAgentProfileEvaluationReviewEntryV1[] = await Promise.all(
    source.caseResults.map(async (result, index) => ({
      caseId: result.caseId,
      caseVersion: result.caseVersion,
      caseHash: result.caseHash,
      predictionHash: await npDigestAgentEvaluationValueV1(result.prediction),
      sourceHash,
      evidence: structuredClone(source.suite.cases[index].evidence),
      prediction: structuredClone(result.prediction),
      eligible:
        result.error === null &&
        result.prediction !== null &&
        (category === "moderator-assessment" ||
          result.prediction.publisherSelectionResponse?.decision.kind === "propose-capability"),
      review: null,
    })),
  );
  for (const value of values) {
    const r = rec(value, [
      "caseId",
      "caseHash",
      "predictionHash",
      "sourceHash",
      "outcome",
      "reviewer",
      "reviewedAt",
      "notes",
      "editedProposal",
    ]);
    const entry = entries.find((e) => e.caseId === r.caseId && e.caseHash === r.caseHash);
    if (
      !entry ||
      !entry.eligible ||
      entry.review ||
      entry.predictionHash !== r.predictionHash ||
      sourceHash !== r.sourceHash ||
      !["accept", "edit", "reject"].includes(String(r.outcome))
    )
      fail();
    const outcome = r.outcome as NpAgentProfileEvaluationReviewLabelV1["outcome"];
    let editedProposal: NpAgentEvaluationPredictionV1 | null = null;
    if (outcome === "edit") {
      editedProposal = npRequireAgentEvaluationPredictionV1(
        r.editedProposal,
        source.suite.cases[0].category,
      );
      if (
        equal(editedProposal, entry.prediction) ||
        !grounded(source, entry.evidence, editedProposal)
      )
        fail();
    } else if (r.editedProposal !== null) fail();
    if (outcome === "accept") {
      if (!entry.prediction || !grounded(source, entry.evidence, entry.prediction)) fail();
      const index = entries.indexOf(entry);
      const exact = await npBuildAgentEvaluationArtifactV1({
        mode: source.mode,
        provider: source.provider,
        model: source.model,
        startedAt: source.startedAt,
        finishedAt: source.finishedAt,
        budget: source.budget,
        suite: { ...source.suite, cases: [source.suite.cases[index]] },
        caseResults: [source.caseResults[index]],
      });
      if (!exact.ok) fail();
    }
    entry.review = {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash,
      outcome,
      reviewer: text(r.reviewer, 128, true),
      reviewedAt: canonicalBodyUtc(r.reviewedAt, path),
      notes: text(r.notes, 2000),
      editedProposal,
    };
  }
  const body = {
    schemaVersion: "np.agent-profile-eval-review.v1" as const,
    authority: "offline-self-reported-no-approval" as const,
    source,
    sourceHash,
    labels: entries.flatMap((e) => (e.review ? [structuredClone(e.review)] : [])),
    entries,
    summary: summarize(entries),
  };
  const artifact = { ...body, artifactHash: await npDigestAgentEvaluationValueV1(body) };
  cloneCanonicalRuntimeInput(artifact, path, npAgentEvaluationArtifactMaxBytesV1, {
    maximumNodes: 100000,
  });
  return artifact;
}
export async function npRequireAgentProfileEvaluationReviewArtifactV1(
  value: unknown,
): Promise<NpAgentProfileEvaluationReviewArtifactV1> {
  const r = rec(
    cloneCanonicalRuntimeInput(value, path, npAgentEvaluationArtifactMaxBytesV1, {
      maximumNodes: 100000,
    }),
    [
      "schemaVersion",
      "authority",
      "source",
      "sourceHash",
      "labels",
      "entries",
      "summary",
      "artifactHash",
    ],
  );
  const actual = await npBuildAgentProfileEvaluationReviewArtifactV1(r.source, r.labels);
  if (!equal(actual, r)) fail();
  return actual;
}
/** Identical prediction cohorts only. Changed profiles/datasets remain incomparable. */
export async function npCompareAgentProfileEvaluationReviewArtifactsV1(
  currentValue: unknown,
  baselineValue: unknown,
): Promise<NpAgentEvaluationReviewComparisonV1> {
  const current = await npRequireAgentProfileEvaluationReviewArtifactV1(currentValue);
  const baseline = await npRequireAgentProfileEvaluationReviewArtifactV1(baselineValue);
  const comparison = await npCompareAgentEvaluationArtifactsV1(current.source, baseline.source);
  const key = (e: NpAgentProfileEvaluationReviewEntryV1) => `${e.caseId}@${e.caseVersion}`;
  const matched = current.entries.filter(
    (e) =>
      e.review &&
      baseline.entries.some(
        (b) =>
          b.review &&
          b.caseId === e.caseId &&
          b.caseHash === e.caseHash &&
          b.predictionHash === e.predictionHash,
      ),
  );
  const currentSummary = comparison.comparable ? summarize(matched) : null;
  const baselineSummary = comparison.comparable
    ? summarize(baseline.entries.filter((e) => matched.some((m) => key(m) === key(e))))
    : null;
  const delta = (field: "acceptBasisPoints" | "editBasisPoints" | "rejectBasisPoints") =>
    currentSummary?.[field] != null && baselineSummary?.[field] != null
      ? currentSummary[field] - baselineSummary[field]
      : null;
  return {
    comparable: comparison.comparable,
    reason: comparison.comparable ? null : comparison.reason,
    matchedCaseKeys: comparison.comparable ? matched.map(key) : [],
    unmatchedCurrentCaseKeys: current.entries
      .filter(
        (e) => e.review && (!comparison.comparable || !matched.some((m) => key(m) === key(e))),
      )
      .map(key),
    unmatchedBaselineCaseKeys: baseline.entries
      .filter(
        (e) => e.review && (!comparison.comparable || !matched.some((m) => key(m) === key(e))),
      )
      .map(key),
    current: currentSummary,
    baseline: baselineSummary,
    acceptBasisPointsDelta: delta("acceptBasisPoints"),
    editBasisPointsDelta: delta("editBasisPoints"),
    rejectBasisPointsDelta: delta("rejectBasisPoints"),
  };
}
