import type { NpAgentModeratorFeedbackLabelV1 } from "./moderator-contract.js";
import type { NpAgentModeratorEvaluationArtifactV1 } from "./moderator-evaluation-contract.js";

export interface NpAgentModeratorEvaluationReviewLabelV1 {
  caseId: string;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  label: NpAgentModeratorFeedbackLabelV1;
  /** Self-reported local attribution, never an authenticated Incident feedback write. */
  reviewer: string;
  reviewedAt: string;
  notes: string;
}
export interface NpAgentModeratorEvaluationReviewEntryV1 {
  caseId: string;
  caseVersion: 1;
  caseHash: string;
  predictionHash: string;
  sourceHash: string;
  eligible: boolean;
  review: NpAgentModeratorEvaluationReviewLabelV1 | null;
}
export interface NpAgentModeratorEvaluationReviewSummaryV1 {
  eligible: number;
  ineligible: number;
  reviewed: number;
  unreviewed: number;
  confirmedSpam: number;
  falsePositive: number;
  confirmedSpamBasisPoints: number | null;
  falsePositiveBasisPoints: number | null;
}
export interface NpAgentModeratorEvaluationReviewArtifactV1 {
  schemaVersion: "np.agent-moderator-eval-review.v1";
  authority: "offline-self-reported-no-approval";
  source: NpAgentModeratorEvaluationArtifactV1;
  sourceHash: string;
  labels: NpAgentModeratorEvaluationReviewLabelV1[];
  entries: NpAgentModeratorEvaluationReviewEntryV1[];
  summary: NpAgentModeratorEvaluationReviewSummaryV1;
  artifactHash: string;
}
export interface NpAgentModeratorEvaluationReviewComparisonV1 {
  comparable: boolean;
  reason: string | null;
  matchedCaseKeys: string[];
  unmatchedCurrentCaseKeys: string[];
  unmatchedBaselineCaseKeys: string[];
  current: NpAgentModeratorEvaluationReviewSummaryV1 | null;
  baseline: NpAgentModeratorEvaluationReviewSummaryV1 | null;
  confirmedSpamBasisPointsDelta: number | null;
  falsePositiveBasisPointsDelta: number | null;
}
