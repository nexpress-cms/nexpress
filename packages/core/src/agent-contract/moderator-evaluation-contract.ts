import type {
  NpAgentModeratorFactV1,
  NpAgentModeratorSettingsV1,
  NpAgentModeratorSignalCandidateV1,
} from "./moderator-contract.js";

/** Synthetic conformance evidence, never automatic-action readiness. */
export const npAgentModeratorEvaluationDatasetV1 = "moderator.v1" as const;
export const npAgentModeratorEvaluationArtifactMaxBytesV1 = 4 * 1024 * 1024;
export interface NpAgentModeratorEvaluationCaseV1 {
  id: string;
  caseVersion: 1;
  locale: "en" | "ko";
  scenario: string;
  siteId: string;
  windowStartedAt: string;
  settings: NpAgentModeratorSettingsV1;
  /** Synthetic prose is retained only in this offline fixture, never in live Signal evidence. */
  observations: { text: string; fact: NpAgentModeratorFactV1 }[];
  expectedDomainHashes: string[];
  /** Authored synthetic intent; independent of the detector's advisory signal expectation. */
  referenceLabel: "spam" | "legitimate";
}
export interface NpAgentModeratorEvaluationCaseResultV1 {
  caseId: string;
  caseVersion: 1;
  caseHash: string;
  predictionHash: string;
  signals: NpAgentModeratorSignalCandidateV1[];
  expectedSignalsMatched: boolean;
}
export interface NpAgentModeratorEvaluationSummaryV1 {
  cases: number;
  matchedSignalExpectations: number;
  missingExpectedSignals: number;
  unexpectedSignals: number;
  /** Case-level comparison with authored synthetic intent; not reviewed production precision. */
  syntheticClassification: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precisionBasisPoints: number | null;
    recallBasisPoints: number | null;
  };
}
export interface NpAgentModeratorEvaluationArtifactV1 {
  schemaVersion: "np.agent-moderator-eval.v1";
  dataset: "moderator.v1";
  mode: "deterministic-offline";
  authority: "advisory-no-activation";
  suiteHash: string;
  cases: NpAgentModeratorEvaluationCaseV1[];
  caseResults: NpAgentModeratorEvaluationCaseResultV1[];
  summary: NpAgentModeratorEvaluationSummaryV1;
  byLocale: { en: NpAgentModeratorEvaluationSummaryV1; ko: NpAgentModeratorEvaluationSummaryV1 };
  /** Only exact deterministic signal expectations. Human labels do not change this field. */
  ok: boolean;
  artifactHash: string;
}
export interface NpAgentModeratorEvaluationComparisonV1 {
  comparable: boolean;
  reason: string | null;
  current: NpAgentModeratorEvaluationSummaryV1 | null;
  baseline: NpAgentModeratorEvaluationSummaryV1 | null;
  matchedSignalExpectationsDelta: number | null;
}

/** Report/mixed synthetic facts; detector and live Fact contracts remain v1. */
export const npAgentModeratorEvaluationDatasetV2 = "moderator.v2" as const;
export interface NpAgentModeratorEvaluationCaseV2 extends Omit<
  NpAgentModeratorEvaluationCaseV1,
  "caseVersion"
> {
  caseVersion: 2;
}
export interface NpAgentModeratorEvaluationCaseResultV2 extends Omit<
  NpAgentModeratorEvaluationCaseResultV1,
  "caseVersion"
> {
  caseVersion: 2;
}
export interface NpAgentModeratorEvaluationArtifactV2 extends Omit<
  NpAgentModeratorEvaluationArtifactV1,
  "schemaVersion" | "dataset" | "cases" | "caseResults"
> {
  schemaVersion: "np.agent-moderator-eval.v2";
  dataset: "moderator.v2";
  cases: NpAgentModeratorEvaluationCaseV2[];
  caseResults: NpAgentModeratorEvaluationCaseResultV2[];
}
/** Document/comment mixed synthetic facts; detector and live Fact contracts remain v1. */
export const npAgentModeratorEvaluationDatasetV3 = "moderator.v3" as const;
export interface NpAgentModeratorEvaluationCaseV3 extends Omit<
  NpAgentModeratorEvaluationCaseV1,
  "caseVersion"
> {
  caseVersion: 3;
}
export interface NpAgentModeratorEvaluationCaseResultV3 extends Omit<
  NpAgentModeratorEvaluationCaseResultV1,
  "caseVersion"
> {
  caseVersion: 3;
}
export interface NpAgentModeratorEvaluationArtifactV3 extends Omit<
  NpAgentModeratorEvaluationArtifactV1,
  "schemaVersion" | "dataset" | "cases" | "caseResults"
> {
  schemaVersion: "np.agent-moderator-eval.v3";
  dataset: "moderator.v3";
  cases: NpAgentModeratorEvaluationCaseV3[];
  caseResults: NpAgentModeratorEvaluationCaseResultV3[];
}
export type NpAgentModeratorEvaluationArtifact =
  | NpAgentModeratorEvaluationArtifactV1
  | NpAgentModeratorEvaluationArtifactV2
  | NpAgentModeratorEvaluationArtifactV3;
