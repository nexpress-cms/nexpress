import type {
  NpAgentModeratorEvaluationArtifactV1,
  NpAgentModeratorEvaluationComparisonV1,
} from "./moderator-evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationReviewArtifactV1,
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

export function npFormatAgentModeratorEvaluationCommandResultV1(
  result:
    NpAgentModeratorEvaluationCommandResultV1 | NpAgentModeratorEvaluationReviewCommandResultV1,
): string {
  if (result.errorCode) return `Moderator evaluation unavailable (${result.errorCode}).`;
  const comparison = result.comparison
    ? result.comparison.comparable
      ? " Comparison is compatible; use --json for matched results."
      : ` Comparison is not comparable (${result.comparison.reason}); no regression conclusion.`
    : "";
  if (result.schemaVersion === "np.agent-moderator-eval-review-command.v1")
    return `Offline Moderator feedback: ${result.artifact?.summary.reviewed} reviewed; ${result.artifact?.summary.unreviewed} unreviewed; ${result.artifact?.summary.ineligible} without a signal. Self-reported labels grant no approval authority.${comparison}`;
  return `Moderator detector evaluation ${result.artifact?.ok ? "passed" : "failed"}: ${result.artifact?.cases.length ?? 0} synthetic cases. Rule correctness is separate from spam judgment; no model evaluation or automatic-quarantine readiness is established.${comparison}`;
}
