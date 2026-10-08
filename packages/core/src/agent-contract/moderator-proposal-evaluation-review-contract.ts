import type { NpAgentEvaluationReviewSummaryV1 } from "./evaluation-review-contract.js";
import { canonicalBodyRecord, canonicalBodyUtc } from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npAgentEvaluationArtifactMaxBytesV1,
  npBuildAgentEvaluationArtifactV1,
  npRequireAgentEvaluationArtifactV1,
  npDigestAgentEvaluationValueV1,
  npCompareAgentEvaluationArtifactsV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentEvaluationEvidenceV1,
} from "./evaluation-contract.js";
import {
  npRequireAgentModeratorEvaluationResponseV1,
  npEvaluateAgentModeratorProposalV1,
  npAgentModeratorEvaluationResponseMeaningfulValueV1,
  type NpAgentModeratorEvaluationResponseV1,
} from "./moderator-proposal-evaluation-contract.js";

export interface NpAgentModeratorProposalEvaluationReviewLabelV1 {
  caseId: string;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  outcome: "accept" | "edit" | "reject";
  /** Self-reported offline attribution; never an authenticated approval. */
  reviewer: string;
  reviewedAt: string;
  notes: string;
  editedProposal: NpAgentModeratorEvaluationResponseV1 | null;
}
export interface NpAgentModeratorProposalEvaluationReviewEntryV1 {
  caseId: string;
  caseVersion: number;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  evidence: NpAgentEvaluationEvidenceV1[];
  response: NpAgentModeratorEvaluationResponseV1 | null;
  eligible: boolean;
  review: NpAgentModeratorProposalEvaluationReviewLabelV1 | null;
}
export interface NpAgentModeratorProposalEvaluationReviewArtifactV1 {
  schemaVersion: "np.agent-moderator-proposal-eval-review.v1";
  authority: "offline-self-reported-no-approval";
  source: NpAgentEvaluationArtifactV1;
  sourceHash: string;
  labels: NpAgentModeratorProposalEvaluationReviewLabelV1[];
  entries: NpAgentModeratorProposalEvaluationReviewEntryV1[];
  summary: NpAgentEvaluationReviewSummaryV1;
  artifactHash: string;
}
const path = "agent.evaluation.moderator-proposal.review";
const fail = (): never => {
  throw new Error("Invalid bounded Moderator proposal evaluation review.");
};
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const caseKey = (entry: NpAgentModeratorProposalEvaluationReviewEntryV1) =>
  `${entry.caseId}@${entry.caseVersion}`;
const equal = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const boundedText = (value: unknown, maximum: number, minimum = 0): string => {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
  )
    fail();
  return value as string;
};
function summary(
  entries: NpAgentModeratorProposalEvaluationReviewEntryV1[],
): NpAgentEvaluationReviewSummaryV1 {
  const eligible = entries.filter((e) => e.eligible).length;
  const count = (outcome: NpAgentModeratorProposalEvaluationReviewLabelV1["outcome"]) =>
    entries.filter((e) => e.review?.outcome === outcome).length;
  const accepted = count("accept"),
    edited = count("edit"),
    rejected = count("reject");
  const reviewed = accepted + edited + rejected;
  const rate = (count: number) => (reviewed ? Math.round((count * 10_000) / reviewed) : null);
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

/** Creates local evaluation evidence only. Does not change source.ok or grant live authority. */
export async function npBuildAgentModeratorProposalEvaluationReviewArtifactV1(
  sourceValue: unknown,
  labelsValue: unknown = [],
): Promise<NpAgentModeratorProposalEvaluationReviewArtifactV1> {
  const source = await npRequireAgentEvaluationArtifactV1(sourceValue);
  if (source.suite.cases.some((c) => c.category !== "moderator-proposal")) fail();
  const sourceHash = await npDigestAgentEvaluationValueV1(source);
  const labelsInput = cloneCanonicalRuntimeInput(
    labelsValue,
    path,
    npAgentEvaluationArtifactMaxBytesV1,
    { maximumNodes: 100_000 },
  );
  if (!Array.isArray(labelsInput) || labelsInput.length > source.caseResults.length) fail();
  const entries: NpAgentModeratorProposalEvaluationReviewEntryV1[] = await Promise.all(
    source.caseResults.map(async (result, i) => ({
      caseId: result.caseId,
      caseVersion: result.caseVersion,
      caseHash: result.caseHash,
      predictionHash: await npDigestAgentEvaluationValueV1(result.prediction),
      sourceHash,
      evidence: structuredClone(source.suite.cases[i].evidence),
      response: result.prediction?.moderatorResponse
        ? structuredClone(result.prediction.moderatorResponse)
        : null,
      eligible: result.error === null && result.prediction?.moderatorResponse != null,
      review: null,
    })),
  );
  for (const input of labelsInput as unknown[]) {
    const r = record(input, [
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
      r.caseHash !== entry.caseHash ||
      r.predictionHash !== entry.predictionHash ||
      r.sourceHash !== sourceHash
    )
      fail();
    const target = entry as NpAgentModeratorProposalEvaluationReviewEntryV1;
    if (r.outcome !== "accept" && r.outcome !== "edit" && r.outcome !== "reject") fail();
    const outcome = r.outcome as NpAgentModeratorProposalEvaluationReviewLabelV1["outcome"];
    let editedProposal: NpAgentModeratorEvaluationResponseV1 | null = null;
    if (outcome === "edit") {
      editedProposal = npRequireAgentModeratorEvaluationResponseV1(r.editedProposal);
      if (
        equal(
          npAgentModeratorEvaluationResponseMeaningfulValueV1(editedProposal),
          npAgentModeratorEvaluationResponseMeaningfulValueV1(target.response),
        ) ||
        npEvaluateAgentModeratorProposalV1(target.evidence, editedProposal).length
      )
        fail();
    } else if (r.editedProposal !== null) fail();
    if (outcome === "accept") {
      // Violations retain the legacy caseId shape. Re-score the exact bound case
      // so another version of the same ID cannot block this review.
      const index = entries.indexOf(target);
      const { mode, provider, model, startedAt, finishedAt, budget } = source;
      const checked = await npBuildAgentEvaluationArtifactV1({
        mode,
        provider,
        model,
        startedAt,
        finishedAt,
        budget,
        suite: { ...source.suite, cases: [source.suite.cases[index]] },
        caseResults: [source.caseResults[index]],
      });
      if (!checked.ok) fail();
    }
    target.review = {
      caseId: target.caseId,
      caseHash: target.caseHash,
      predictionHash: target.predictionHash,
      sourceHash,
      outcome,
      reviewer: boundedText(r.reviewer, 128, 1),
      reviewedAt: canonicalBodyUtc(r.reviewedAt, path),
      notes: boundedText(r.notes, 2000),
      editedProposal,
    };
    if (!target.review.reviewer.trim()) fail();
  }
  const body = {
    schemaVersion: "np.agent-moderator-proposal-eval-review.v1" as const,
    authority: "offline-self-reported-no-approval" as const,
    source,
    sourceHash,
    labels: entries.flatMap((e) => (e.review ? [structuredClone(e.review)] : [])),
    entries,
    summary: summary(entries),
  };
  const artifact = { ...body, artifactHash: await npDigestAgentEvaluationValueV1(body) };
  if (
    new TextEncoder().encode(JSON.stringify(artifact)).length > npAgentEvaluationArtifactMaxBytesV1
  )
    fail();
  cloneCanonicalRuntimeInput(artifact, path, npAgentEvaluationArtifactMaxBytesV1, {
    maximumNodes: 100_000,
  });
  return artifact;
}
export async function npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
  value: unknown,
): Promise<NpAgentModeratorProposalEvaluationReviewArtifactV1> {
  const r = record(
    cloneCanonicalRuntimeInput(value, path, npAgentEvaluationArtifactMaxBytesV1, {
      maximumNodes: 100_000,
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
  const actual = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(r.source, r.labels);
  if (!equal(r, actual)) fail();
  return actual;
}
export interface NpAgentModeratorProposalEvaluationReviewComparisonV1 {
  comparable: boolean;
  reason: string | null;
  matchedCaseKeys: string[];
  unmatchedCurrentCaseKeys: string[];
  unmatchedBaselineCaseKeys: string[];
  current: NpAgentEvaluationReviewSummaryV1 | null;
  baseline: NpAgentEvaluationReviewSummaryV1 | null;
  acceptBasisPointsDelta: number | null;
  editBasisPointsDelta: number | null;
  rejectBasisPointsDelta: number | null;
}
/** Compare labels only on the intersection of reviewed, identical case/prediction bindings. */
export async function npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(
  currentValue: unknown,
  baselineValue: unknown,
): Promise<NpAgentModeratorProposalEvaluationReviewComparisonV1> {
  const current = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(currentValue),
    baseline = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(baselineValue);
  const sourceComparison = await npCompareAgentEvaluationArtifactsV1(
    current.source,
    baseline.source,
  );
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
  const ids = sourceComparison.comparable ? matched.map(caseKey) : [];
  const a = ids.length ? summary(current.entries.filter((e) => ids.includes(caseKey(e)))) : null;
  const b = ids.length ? summary(baseline.entries.filter((e) => ids.includes(caseKey(e)))) : null;
  const delta = (x: number | null | undefined, y: number | null | undefined) =>
    x == null || y == null ? null : x - y;
  return {
    comparable: sourceComparison.comparable && ids.length > 0,
    reason: !sourceComparison.comparable
      ? sourceComparison.reason
      : ids.length
        ? null
        : "NO_MATCHED_REVIEW_COHORT",
    matchedCaseKeys: ids,
    unmatchedCurrentCaseKeys: current.entries
      .filter((e) => e.review && !ids.includes(caseKey(e)))
      .map(caseKey),
    unmatchedBaselineCaseKeys: baseline.entries
      .filter((e) => e.review && !ids.includes(caseKey(e)))
      .map(caseKey),
    current: a,
    baseline: b,
    acceptBasisPointsDelta: delta(a?.acceptBasisPoints, b?.acceptBasisPoints),
    editBasisPointsDelta: delta(a?.editBasisPoints, b?.editBasisPoints),
    rejectBasisPointsDelta: delta(a?.rejectBasisPoints, b?.rejectBasisPoints),
  };
}
