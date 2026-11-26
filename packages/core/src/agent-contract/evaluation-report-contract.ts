import type { NpAgentProfileEvaluationReviewArtifactV1 } from "./profile-evaluation-review-contract.js";
import type {
  NpAgentGuardianEvaluationArtifactV1,
  NpAgentGuardianEvaluationSummaryV1,
} from "./guardian-evaluation-contract.js";
import type {
  NpAgentGuardianEvaluationReviewArtifactV1,
  NpAgentGuardianEvaluationReviewSummaryV1,
  NpAgentGuardianEvaluationReviewComparisonV1,
} from "./guardian-evaluation-review-contract.js";
import type { npCompareAgentGuardianEvaluationArtifactsV1 } from "./guardian-evaluation-contract.js";
import {
  npAgentEvaluationReportRecipesV1,
  type NpAgentEvaluationReportRecipeV1,
} from "./evaluation-report-recipe-contract.js";
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
  NpAgentModeratorEvaluationArtifact,
  NpAgentModeratorEvaluationComparisonV1,
  NpAgentModeratorEvaluationSummaryV1,
} from "./moderator-evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationReviewArtifact,
  NpAgentModeratorEvaluationReviewSummaryV1,
  NpAgentModeratorEvaluationReviewComparisonV1,
} from "./moderator-evaluation-review-contract.js";
import type {
  NpAgentOperatorPlanEvaluationReviewArtifactV1,
  NpAgentOperatorPlanEvaluationReviewComparisonV1,
} from "./operator-plan-evaluation-review-contract.js";

import type {
  NpAgentModeratorProposalEvaluationReviewArtifactV1,
  NpAgentModeratorProposalEvaluationReviewComparisonV1,
} from "./moderator-proposal-evaluation-review-contract.js";

export const npAgentEvaluationReportMaxBytesV1 = 4 * 1024 * 1024;
export const npAgentEvaluationReportMaxEntriesV2 = 16;
export { npAgentEvaluationReportRecipesV1, type NpAgentEvaluationReportRecipeV1 };
export interface NpAgentEvaluationReportManifestV1 {
  schemaVersion: "np.agent-eval-report-manifest.v1";
  entries: {
    recipe: NpAgentEvaluationReportRecipeV1;
    evaluation: string;
    review: string | null;
    baseline: { evaluation: string; review: string | null } | null;
  }[];
}
export interface NpAgentEvaluationReportManifestV2 extends Omit<
  NpAgentEvaluationReportManifestV1,
  "schemaVersion"
> {
  schemaVersion: "np.agent-eval-report-manifest.v2";
}
export interface NpAgentEvaluationReportEvidenceV1 {
  evaluation:
    | NpAgentEvaluationArtifactV1
    | NpAgentModeratorEvaluationArtifact
    | NpAgentGuardianEvaluationArtifactV1;
  review:
    | NpAgentEvaluationReviewArtifactV1
    | NpAgentProfileEvaluationReviewArtifactV1
    | NpAgentOperatorPlanEvaluationReviewArtifactV1
    | NpAgentModeratorProposalEvaluationReviewArtifactV1
    | NpAgentModeratorEvaluationReviewArtifact
    | NpAgentGuardianEvaluationReviewArtifactV1
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
export interface NpAgentEvaluationReportInputV2 extends Omit<
  NpAgentEvaluationReportInputV1,
  "schemaVersion"
> {
  schemaVersion: "np.agent-eval-report-input.v2";
}
export interface NpAgentEvaluationReportRowV1 {
  recipe: NpAgentEvaluationReportRecipeV1;
  status: "missing" | "present";
  mode: "deterministic-offline" | "fake" | "provider" | null;
  fixtureGate: "missing" | "passed" | "failed";
  cases: number | null;
  metrics:
    | NpAgentEvaluationMetricsV1
    | NpAgentModeratorEvaluationSummaryV1
    | NpAgentGuardianEvaluationSummaryV1
    | null;
  review: {
    status: "missing" | "present";
    summary:
      | NpAgentEvaluationReviewSummaryV1
      | NpAgentModeratorEvaluationReviewSummaryV1
      | NpAgentGuardianEvaluationReviewSummaryV1
      | null;
  };
  evaluationComparison: {
    status: "missing-current" | "missing-baseline" | "compared";
    result:
      | NpAgentEvaluationComparisonV1
      | NpAgentModeratorEvaluationComparisonV1
      | Awaited<ReturnType<typeof npCompareAgentGuardianEvaluationArtifactsV1>>
      | null;
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
      | NpAgentModeratorProposalEvaluationReviewComparisonV1
      | NpAgentModeratorEvaluationReviewComparisonV1
      | NpAgentGuardianEvaluationReviewComparisonV1
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
export interface NpAgentEvaluationReportDatasetV2 {
  id: string;
  version: number;
}
export interface NpAgentEvaluationReportRowV2 extends NpAgentEvaluationReportRowV1 {
  dataset: NpAgentEvaluationReportDatasetV2 | null;
}
export interface NpAgentEvaluationReportV2 extends Omit<
  NpAgentEvaluationReportV1,
  "schemaVersion" | "input" | "rows"
> {
  schemaVersion: "np.agent-eval-report.v2";
  input: NpAgentEvaluationReportInputV2;
  rows: NpAgentEvaluationReportRowV2[];
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
export interface NpAgentEvaluationReportCommandResult extends Omit<
  NpAgentEvaluationReportCommandResultV1,
  "artifact"
> {
  artifact: NpAgentEvaluationReportV1 | NpAgentEvaluationReportV2 | null;
}

const ownValue = (value: unknown, key: string): unknown =>
  value && typeof value === "object"
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;

/** Reads dataset identity for grouping. The owning evaluator validates the complete artifact. */
export function npReadAgentEvaluationReportDatasetV2(
  evaluation: unknown,
): NpAgentEvaluationReportDatasetV2 | null {
  const schema = ownValue(evaluation, "schemaVersion");
  if (schema === "np.agent-eval.v1" || schema === "np.agent-guardian-eval.v1") {
    const suite = ownValue(evaluation, schema === "np.agent-eval.v1" ? "suite" : "corpus");
    const id = ownValue(suite, "id");
    const version = ownValue(suite, "version");
    return typeof id === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/u.test(id) &&
      typeof version === "number" &&
      Number.isSafeInteger(version) &&
      version >= 1
      ? { id, version }
      : null;
  }
  const detector =
    typeof schema === "string" && /^np\.agent-moderator-eval\.v([123])$/u.exec(schema);
  if (!detector) return null;
  const id = `moderator.v${detector[1]}`;
  return ownValue(evaluation, "dataset") === id ? { id, version: Number(detector[1]) } : null;
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
  const manifest = npRequireAgentEvaluationReportManifest(value);
  if (manifest.schemaVersion !== "np.agent-eval-report-manifest.v1") return fail();
  return manifest;
}
export function npRequireAgentEvaluationReportManifest(
  value: unknown,
): NpAgentEvaluationReportManifestV1 | NpAgentEvaluationReportManifestV2 {
  const r = record(cloneCanonicalRuntimeInput(value, "agent.evaluation.report.manifest", 128_000), [
    "schemaVersion",
    "entries",
  ]);
  const schemaVersion = r.schemaVersion;
  const v1 = schemaVersion === "np.agent-eval-report-manifest.v1";
  if (
    (!v1 && schemaVersion !== "np.agent-eval-report-manifest.v2") ||
    !Array.isArray(r.entries) ||
    r.entries.length >
      (v1 ? npAgentEvaluationReportRecipesV1.length : npAgentEvaluationReportMaxEntriesV2)
  )
    return fail();
  const seen = new Set<string>();
  const entries = (r.entries as unknown[]).map((value) => {
    const entry = record(value, ["recipe", "evaluation", "review", "baseline"]);
    const recipe = npAgentEvaluationReportRecipesV1.find((recipe) => recipe === entry.recipe);
    if (!recipe || (v1 && seen.has(recipe))) return fail();
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
  return { schemaVersion, entries };
}
export function npFormatAgentEvaluationReportV1(report: NpAgentEvaluationReportV1): string {
  return npFormatAgentEvaluationReport(report);
}
/** Format only independently validated reports; rates stay scoped to each row. */
export function npFormatAgentEvaluationReport(
  report: NpAgentEvaluationReportV1 | NpAgentEvaluationReportV2,
): string {
  const lines = [
    report.rows.some((row) => row.recipe === "guardian")
      ? "Offline evaluation evidence report (legacy R6 and separate Guardian evidence)"
      : "R6 offline evaluation evidence report",
  ];
  for (const row of report.rows) {
    const dataset = "dataset" in row ? row.dataset : null;
    const label = dataset
      ? `${row.recipe} [${dataset.id}, version ${dataset.version}]`
      : row.recipe;
    lines.push(
      `${label}: ${row.status}; mode=${row.mode ?? "missing"}; fixture/schema gate=${row.fixtureGate}; cases=${row.cases ?? "unknown"}`,
    );
    const metrics = row.metrics;
    if (metrics)
      lines.push(
        "syntheticRules" in metrics
          ? `  Guardian synthetic reference: matched=${metrics.syntheticRules.matchedCases}; missing=${metrics.syntheticRules.missingSignals}; unexpected=${metrics.syntheticRules.unexpectedSignals}; syntheticIntentFalsePositive=${metrics.syntheticIntent.falsePositive}; syntheticIntentFalseNegative=${metrics.syntheticIntent.falseNegative}; requiredLiveChecksNotRun=${metrics.liveChecks.notRun}`
          : "matchedSignalExpectations" in metrics
            ? `  Synthetic detector: matched=${metrics.matchedSignalExpectations}; missing=${metrics.missingExpectedSignals}; unexpected=${metrics.unexpectedSignals}; falsePositive=${metrics.syntheticClassification.falsePositive}; falseNegative=${metrics.syntheticClassification.falseNegative}`
            : row.recipe === "moderator-proposal"
              ? `  Synthetic proposal/abstention conformance: schemaValidBasisPoints=${metrics.schemaValidBasisPoints}; forbiddenActionProposals=${metrics.forbiddenActionProposals}; fixtureDecisionPrecisionBasisPoints=${metrics.precisionBasisPoints}; policyBlocked=${metrics.policyBlocked}`
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
        "supported" in summary
          ? `  Self-reported synthetic prediction review: supported=${summary.supported}; unsupported=${summary.unsupported}`
          : "accepted" in summary
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
