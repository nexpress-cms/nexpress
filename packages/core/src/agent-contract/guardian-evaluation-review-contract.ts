import { canonicalBodyRecord, canonicalBodyUtc } from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npRequireAgentGuardianEvaluationArtifactV1,
  npCompareAgentGuardianEvaluationArtifactsV1,
  npDigestAgentGuardianEvaluationValueV1,
  npAgentGuardianEvaluationMaxBytesV1,
  type NpAgentGuardianEvaluationArtifactV1,
} from "./guardian-evaluation-contract.js";

export interface NpAgentGuardianEvaluationReviewLabelV1 {
  caseId: string;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  /** Support for this synthetic prediction only; never an attack verdict or live approval. */
  outcome: "accept" | "reject";
  reviewer: string;
  reviewedAt: string;
  notes: string;
  editedProposal: null;
}
export interface NpAgentGuardianEvaluationReviewEntryV1 {
  caseId: string;
  caseVersion: 1;
  caseHash: string;
  predictionHash: string | null;
  sourceHash: string;
  eligible: boolean;
  review: NpAgentGuardianEvaluationReviewLabelV1 | null;
}
export interface NpAgentGuardianEvaluationReviewSummaryV1 {
  eligible: number;
  ineligible: number;
  reviewed: number;
  unreviewed: number;
  supported: number;
  unsupported: number;
}
export interface NpAgentGuardianEvaluationReviewArtifactV1 {
  schemaVersion: "np.agent-guardian-eval-review.v1";
  authority: "offline-self-reported-no-approval";
  source: NpAgentGuardianEvaluationArtifactV1;
  sourceHash: string;
  labels: NpAgentGuardianEvaluationReviewLabelV1[];
  entries: NpAgentGuardianEvaluationReviewEntryV1[];
  summary: NpAgentGuardianEvaluationReviewSummaryV1;
  artifactHash: string;
}
export interface NpAgentGuardianEvaluationReviewComparisonV1 {
  comparable: boolean;
  reason: string | null;
  matchedCaseKeys: string[];
  unmatchedCurrentCaseKeys: string[];
  unmatchedBaselineCaseKeys: string[];
  current: NpAgentGuardianEvaluationReviewSummaryV1 | null;
  baseline: NpAgentGuardianEvaluationReviewSummaryV1 | null;
}
const path = "guardian.evaluation.review";
function fail(): never {
  throw new Error("Invalid exact-bound Guardian evaluation review.");
}
const rec = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const clone = (value: unknown) =>
  cloneCanonicalRuntimeInput(value, path, npAgentGuardianEvaluationMaxBytesV1 * 2, {
    maximumNodes: 100_000,
  });
const equal = (left: unknown, right: unknown) =>
  serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
function text(value: unknown, maximum: number, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && !value.trim()) ||
    /[\p{Cc}\p{Cs}]/u.test(value.replace(/[\n\r\t]/gu, ""))
  )
    fail();
  return value;
}
function summary(
  entries: NpAgentGuardianEvaluationReviewEntryV1[],
): NpAgentGuardianEvaluationReviewSummaryV1 {
  const eligible = entries.filter((entry) => entry.eligible).length;
  const supported = entries.filter((entry) => entry.review?.outcome === "accept").length;
  const unsupported = entries.filter((entry) => entry.review?.outcome === "reject").length;
  return {
    eligible,
    ineligible: entries.length - eligible,
    reviewed: supported + unsupported,
    unreviewed: eligible - supported - unsupported,
    supported,
    unsupported,
  };
}
/** Exact offline labels only. Source proof, current authority, production replay and model usefulness remain unestablished. */
export async function npBuildAgentGuardianEvaluationReviewArtifactV1(
  sourceValue: unknown,
  labelsValue: unknown = [],
): Promise<NpAgentGuardianEvaluationReviewArtifactV1> {
  const source = await npRequireAgentGuardianEvaluationArtifactV1(sourceValue);
  const sourceHash = await npDigestAgentGuardianEvaluationValueV1(source);
  const labels = clone(labelsValue);
  if (!Array.isArray(labels) || labels.length > source.caseResults.length) fail();
  const entries: NpAgentGuardianEvaluationReviewEntryV1[] = source.caseResults.map((result) => ({
    caseId: result.caseId,
    caseVersion: result.caseVersion,
    caseHash: result.caseHash,
    predictionHash: result.predictionHash,
    sourceHash,
    eligible: result.prediction !== null && result.predictionHash !== null,
    review: null,
  }));
  if (!Array.isArray(labels)) return fail();
  for (const value of labels) {
    const row = rec(value, [
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
    const entry = entries.find(
      (entry) => entry.caseId === row.caseId && entry.caseHash === row.caseHash,
    );
    if (
      !entry ||
      !entry.eligible ||
      !entry.predictionHash ||
      entry.review ||
      row.predictionHash !== entry.predictionHash ||
      row.sourceHash !== sourceHash ||
      (row.outcome !== "accept" && row.outcome !== "reject") ||
      row.editedProposal !== null
    )
      fail();
    if (!entry || !entry.predictionHash || (row.outcome !== "accept" && row.outcome !== "reject"))
      return fail();
    if (row.outcome === "accept" && source.caseResults[entries.indexOf(entry)].violations.length)
      fail();
    entry.review = {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash,
      outcome: row.outcome,
      reviewer: text(row.reviewer, 128, true),
      reviewedAt: canonicalBodyUtc(row.reviewedAt, path),
      notes: text(row.notes, 2000),
      editedProposal: null,
    };
  }
  const body = {
    schemaVersion: "np.agent-guardian-eval-review.v1" as const,
    authority: "offline-self-reported-no-approval" as const,
    source,
    sourceHash,
    labels: entries.flatMap((entry) => (entry.review ? [structuredClone(entry.review)] : [])),
    entries,
    summary: summary(entries),
  };
  const artifact = { ...body, artifactHash: await npDigestAgentGuardianEvaluationValueV1(body) };
  clone(artifact);
  return artifact;
}
export async function npRequireAgentGuardianEvaluationReviewArtifactV1(
  value: unknown,
): Promise<NpAgentGuardianEvaluationReviewArtifactV1> {
  const row = rec(clone(value), [
    "schemaVersion",
    "authority",
    "source",
    "sourceHash",
    "labels",
    "entries",
    "summary",
    "artifactHash",
  ]);
  const actual = await npBuildAgentGuardianEvaluationReviewArtifactV1(row.source, row.labels);
  if (!equal(actual, row)) fail();
  return actual;
}
export async function npCompareAgentGuardianEvaluationReviewArtifactsV1(
  currentValue: unknown,
  baselineValue: unknown,
): Promise<NpAgentGuardianEvaluationReviewComparisonV1> {
  const current = await npRequireAgentGuardianEvaluationReviewArtifactV1(currentValue);
  const baseline = await npRequireAgentGuardianEvaluationReviewArtifactV1(baselineValue);
  const comparison = await npCompareAgentGuardianEvaluationArtifactsV1(
    current.source,
    baseline.source,
  );
  const key = (entry: NpAgentGuardianEvaluationReviewEntryV1) =>
    `${entry.caseId}@${entry.caseVersion}`;
  const matched = comparison.comparable
    ? current.entries.filter(
        (entry) =>
          entry.review &&
          baseline.entries.some(
            (other) =>
              other.review &&
              entry.caseId === other.caseId &&
              entry.caseHash === other.caseHash &&
              entry.predictionHash === other.predictionHash,
          ),
      )
    : [];
  const comparable = comparison.comparable && matched.length > 0;
  return {
    comparable,
    reason: comparison.comparable
      ? comparable
        ? null
        : "NO_MATCHED_REVIEWED_CASES"
      : comparison.reason,
    matchedCaseKeys: matched.map(key),
    unmatchedCurrentCaseKeys: current.entries
      .filter((entry) => entry.review && !matched.some((item) => key(item) === key(entry)))
      .map(key),
    unmatchedBaselineCaseKeys: baseline.entries
      .filter((entry) => entry.review && !matched.some((item) => key(item) === key(entry)))
      .map(key),
    current: comparable ? summary(matched) : null,
    baseline: comparable
      ? summary(
          baseline.entries.filter((entry) => matched.some((item) => key(item) === key(entry))),
        )
      : null,
  };
}
