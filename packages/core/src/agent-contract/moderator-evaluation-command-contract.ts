import type {
  NpAgentModeratorEvaluationArtifactV1,
  NpAgentModeratorEvaluationArtifactV2,
  NpAgentModeratorEvaluationArtifactV3,
  NpAgentModeratorEvaluationComparisonV1,
} from "./moderator-evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationReviewArtifactV1,
  NpAgentModeratorEvaluationReviewArtifactV2,
  NpAgentModeratorEvaluationReviewArtifactV3,
  NpAgentModeratorEvaluationReviewComparisonV1,
} from "./moderator-evaluation-review-contract.js";

export type NpAgentModeratorEvaluationCommandErrorV1 =
  "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | "EVALUATION_UNAVAILABLE";
export interface NpAgentModeratorEvaluationCommandResultV1 {
  schemaVersion: "np.agent-moderator-eval-command.v1";
  artifact: NpAgentModeratorEvaluationArtifactV1 | null;
  comparison: NpAgentModeratorEvaluationComparisonV1 | null;
  errorCode: NpAgentModeratorEvaluationCommandErrorV1 | null;
}
export interface NpAgentModeratorEvaluationReviewCommandResultV1 {
  schemaVersion: "np.agent-moderator-eval-review-command.v1";
  artifact: NpAgentModeratorEvaluationReviewArtifactV1 | null;
  comparison: NpAgentModeratorEvaluationReviewComparisonV1 | null;
  errorCode: NpAgentModeratorEvaluationCommandErrorV1 | null;
}

export interface NpAgentModeratorEvaluationCommandResultV2 {
  schemaVersion: "np.agent-moderator-eval-command.v2";
  artifact: NpAgentModeratorEvaluationArtifactV2 | null;
  comparison: NpAgentModeratorEvaluationComparisonV1 | null;
  errorCode: NpAgentModeratorEvaluationCommandErrorV1 | null;
}
export interface NpAgentModeratorEvaluationReviewCommandResultV2 {
  schemaVersion: "np.agent-moderator-eval-review-command.v2";
  artifact: NpAgentModeratorEvaluationReviewArtifactV2 | null;
  comparison: NpAgentModeratorEvaluationReviewComparisonV1 | null;
  errorCode: NpAgentModeratorEvaluationCommandErrorV1 | null;
}
export interface NpAgentModeratorEvaluationCommandResultV3 {
  schemaVersion: "np.agent-moderator-eval-command.v3";
  artifact: NpAgentModeratorEvaluationArtifactV3 | null;
  comparison: NpAgentModeratorEvaluationComparisonV1 | null;
  errorCode: NpAgentModeratorEvaluationCommandErrorV1 | null;
}
export interface NpAgentModeratorEvaluationReviewCommandResultV3 {
  schemaVersion: "np.agent-moderator-eval-review-command.v3";
  artifact: NpAgentModeratorEvaluationReviewArtifactV3 | null;
  comparison: NpAgentModeratorEvaluationReviewComparisonV1 | null;
  errorCode: NpAgentModeratorEvaluationCommandErrorV1 | null;
}
export type NpAgentModeratorEvaluationCommandResult =
  | NpAgentModeratorEvaluationCommandResultV1
  | NpAgentModeratorEvaluationCommandResultV2
  | NpAgentModeratorEvaluationCommandResultV3;
export type NpAgentModeratorEvaluationReviewCommandResult =
  | NpAgentModeratorEvaluationReviewCommandResultV1
  | NpAgentModeratorEvaluationReviewCommandResultV2
  | NpAgentModeratorEvaluationReviewCommandResultV3;

export function npFormatAgentModeratorEvaluationCommandResultV1(
  result:
    NpAgentModeratorEvaluationCommandResultV1 | NpAgentModeratorEvaluationReviewCommandResultV1,
): string {
  return npFormatAgentModeratorEvaluationCommandResult(result);
}

export function npFormatAgentModeratorEvaluationCommandResult(
  result: NpAgentModeratorEvaluationCommandResult | NpAgentModeratorEvaluationReviewCommandResult,
): string {
  if (result.errorCode) return `Moderator evaluation unavailable (${result.errorCode}).`;
  const comparison = result.comparison
    ? result.comparison.comparable
      ? " Comparison is compatible; use --json for matched results."
      : ` Comparison is not comparable (${result.comparison.reason}); no regression conclusion.`
    : "";
  if (
    result.schemaVersion === "np.agent-moderator-eval-review-command.v1" ||
    result.schemaVersion === "np.agent-moderator-eval-review-command.v2" ||
    result.schemaVersion === "np.agent-moderator-eval-review-command.v3"
  )
    return `Offline Moderator feedback: ${result.artifact?.summary.reviewed} reviewed; ${result.artifact?.summary.unreviewed} unreviewed; ${result.artifact?.summary.ineligible} without a signal. Self-reported labels grant no approval authority.${comparison}`;
  return `Moderator detector evaluation ${result.artifact?.ok ? "passed" : "failed"}: ${result.artifact?.cases.length ?? 0} synthetic cases. Rule correctness is separate from spam judgment; no model evaluation or automatic-quarantine readiness is established.${comparison}`;
}
