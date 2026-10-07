import { canonicalBodyRecord } from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type {
  NpAgentEvaluationArtifactV1,
  NpAgentEvaluationComparisonV1,
  NpAgentEvaluationMetricsV1,
} from "./evaluation-contract.js";
import type {
  NpAgentEvaluationReviewArtifactV1,
  NpAgentEvaluationReviewSummaryV1,
  NpAgentEvaluationReviewComparisonV1,
} from "./evaluation-review-contract.js";
import type {
  NpAgentModeratorEvaluationArtifactV1,
  NpAgentModeratorEvaluationComparisonV1,
  NpAgentModeratorEvaluationSummaryV1,
} from "./moderator-evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationReviewArtifactV1,
  NpAgentModeratorEvaluationReviewSummaryV1,
  NpAgentModeratorEvaluationReviewComparisonV1,
} from "./moderator-evaluation-review-contract.js";
import type {
  NpAgentOperatorPlanEvaluationReviewArtifactV1,
  NpAgentOperatorPlanEvaluationReviewComparisonV1,
} from "./operator-plan-evaluation-review-contract.js";

export const npAgentEvaluationReportMaxBytesV1 = 4 * 1024 * 1024;
export const npAgentEvaluationReportRecipesV1 = ["moderator", "operator", "publisher"] as const;
export type NpAgentEvaluationReportRecipeV1 = (typeof npAgentEvaluationReportRecipesV1)[number];
export interface NpAgentEvaluationReportManifestV1 {
  schemaVersion: "np.agent-eval-report-manifest.v1";
  entries: {
    recipe: NpAgentEvaluationReportRecipeV1;
    evaluation: string;
    review: string | null;
    baseline: { evaluation: string; review: string | null } | null;
  }[];
}
export interface NpAgentEvaluationReportEvidenceV1 {
  evaluation: NpAgentEvaluationArtifactV1 | NpAgentModeratorEvaluationArtifactV1;
  review:
    | NpAgentEvaluationReviewArtifactV1
    | NpAgentOperatorPlanEvaluationReviewArtifactV1
    | NpAgentModeratorEvaluationReviewArtifactV1
    | null;
}
export interface NpAgentEvaluationReportInputV1 {
  schemaVersion: "np.agent-eval-report-input.v1";
  entries: {
    recipe: NpAgentEvaluationReportRecipeV1;
    current: { evaluation: unknown; review: unknown };
    baseline: { evaluation: unknown; review: unknown } | null;
  }[];
}
export interface NpAgentEvaluationReportRowV1 {
  recipe: NpAgentEvaluationReportRecipeV1;
  status: "missing" | "present";
  mode: "deterministic-offline" | "fake" | "provider" | null;
  fixtureGate: "missing" | "passed" | "failed";
  cases: number | null;
  metrics: NpAgentEvaluationMetricsV1 | NpAgentModeratorEvaluationSummaryV1 | null;
  review: {
    status: "missing" | "present";
    summary: NpAgentEvaluationReviewSummaryV1 | NpAgentModeratorEvaluationReviewSummaryV1 | null;
  };
  evaluationComparison: {
    status: "missing-current" | "missing-baseline" | "compared";
    result: NpAgentEvaluationComparisonV1 | NpAgentModeratorEvaluationComparisonV1 | null;
  };
  reviewComparison: {
    status:
      | "missing-current"
      | "missing-baseline"
      | "missing-current-review"
      | "missing-baseline-review"
      | "compared";
    result:
      | NpAgentEvaluationReviewComparisonV1
      | NpAgentOperatorPlanEvaluationReviewComparisonV1
      | NpAgentModeratorEvaluationReviewComparisonV1
      | null;
  };
}
export interface NpAgentEvaluationReportV1 {
  schemaVersion: "np.agent-eval-report.v1";
  authority: "offline-evidence-no-approval";
  input: NpAgentEvaluationReportInputV1;
  rows: NpAgentEvaluationReportRowV1[];
  fullR6: "not-established";
  modelUsefulness: "not-established";
  limitations: string[];
  artifactHash: string;
}
export interface NpAgentEvaluationReportCommandResultV1 {
  schemaVersion: "np.agent-eval-report-command.v1";
  artifact: NpAgentEvaluationReportV1 | null;
  errorCode:
    | "ARGUMENT_INVALID"
    | "ARTIFACT_INVALID"
    | "ARTIFACT_UNAVAILABLE"
    | "EVALUATION_UNAVAILABLE"
    | null;
}
const fail = (): never => {
  throw new Error("Invalid bounded Agent evaluation report manifest.");
};
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, "agent.evaluation.report.manifest", keys, keys, {
    seen: new WeakSet(),
  });
const filePath = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4096 ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    fail();
  return value as string;
};
export function npRequireAgentEvaluationReportManifestV1(
  value: unknown,
): NpAgentEvaluationReportManifestV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "agent.evaluation.report.manifest", 128_000), [
    "schemaVersion",
    "entries",
  ]);
  if (
    r.schemaVersion !== "np.agent-eval-report-manifest.v1" ||
    !Array.isArray(r.entries) ||
    r.entries.length > 3
  )
    fail();
  const seen = new Set<string>();
  const entries = (r.entries as unknown[]).map((value) => {
    const entry = record(value, ["recipe", "evaluation", "review", "baseline"]);
    const recipe = npAgentEvaluationReportRecipesV1.find((recipe) => recipe === entry.recipe);
    if (!recipe || seen.has(recipe)) return fail();
    seen.add(recipe);
    const baseline =
      entry.baseline === null ? null : record(entry.baseline, ["evaluation", "review"]);
    return {
      recipe,
      evaluation: filePath(entry.evaluation),
      review: entry.review === null ? null : filePath(entry.review),
      baseline:
        baseline === null
          ? null
          : {
              evaluation: filePath(baseline.evaluation),
              review: baseline.review === null ? null : filePath(baseline.review),
            },
    };
  });
  return { schemaVersion: "np.agent-eval-report-manifest.v1", entries };
}
/** Format only independently validated reports; no rates are pooled across recipes. */
export function npFormatAgentEvaluationReportV1(report: NpAgentEvaluationReportV1): string {
  const lines = ["R6 offline evaluation evidence report"];
  for (const row of report.rows) {
    lines.push(
      `${row.recipe}: ${row.status}; mode=${row.mode ?? "missing"}; fixture/schema gate=${row.fixtureGate}; cases=${row.cases ?? "unknown"}`,
    );
    const metrics = row.metrics;
    if (metrics)
      lines.push(
        "matchedSignalExpectations" in metrics
          ? `  Synthetic detector: matched=${metrics.matchedSignalExpectations}; missing=${metrics.missingExpectedSignals}; unexpected=${metrics.unexpectedSignals}; falsePositive=${metrics.syntheticClassification.falsePositive}; falseNegative=${metrics.syntheticClassification.falseNegative}`
          : `  Synthetic structured decisions: schemaValidBasisPoints=${metrics.schemaValidBasisPoints}; forbiddenActionProposals=${metrics.forbiddenActionProposals}; precisionBasisPoints=${metrics.precisionBasisPoints}; policyBlocked=${metrics.policyBlocked}`,
      );
    const summary = row.review.summary;
    lines.push(
      summary
        ? `  Review (${row.review.status}): reviewed=${summary.reviewed}; unreviewed=${summary.unreviewed}; ineligible=${summary.ineligible}; eligible=${summary.eligible}`
        : "  Review: missing",
    );
    if (summary)
      lines.push(
        "accepted" in summary
          ? `  Outcomes: accepted=${summary.accepted}; edited=${summary.edited}; rejected=${summary.rejected}`
          : `  Outcomes: confirmedSpam=${summary.confirmedSpam}; falsePositive=${summary.falsePositive}`,
      );
    for (const [label, comparison] of [
      ["Evaluation comparison", row.evaluationComparison],
      ["Review comparison", row.reviewComparison],
    ] as const) {
      const result = comparison.result;
      const details = result
        ? Object.entries(result)
            .filter(([key]) => key.endsWith("Delta") || key.endsWith("CaseKeys"))
            .map(
              ([key, value]) =>
                `${key}=${Array.isArray(value) ? value.length : (value ?? "unknown")}`,
            )
            .join("; ")
        : "";
      lines.push(
        `  ${label}: ${comparison.status}${result ? `; ${result.comparable ? "comparable" : `not comparable (${"reason" in result ? result.reason : "unknown"})`}; ${details}` : ""}`,
      );
    }
  }
  lines.push(
    `Full R6: ${report.fullR6}; model usefulness: ${report.modelUsefulness}.`,
    ...report.limitations,
  );
  return lines.join("\n");
}
