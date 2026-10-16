/** Small shared vocabulary for report artifacts and persisted evaluation sources. */
export const npAgentEvaluationReportRecipesV1 = [
  "moderator",
  "moderator-proposal",
  "operator",
  "publisher",
  "moderator-assessment",
  "publisher-selection",
] as const;
export type NpAgentEvaluationReportRecipeV1 = (typeof npAgentEvaluationReportRecipesV1)[number];
