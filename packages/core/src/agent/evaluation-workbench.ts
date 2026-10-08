import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentEvaluationWorkbenchRequestV1,
  npRequireAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationWorkbenchCaseV1,
  type NpAgentEvaluationWorkbenchResultV1,
} from "../agent-contract/evaluation-workbench-contract.js";
import {
  npBuildAgentEvaluationArtifactV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npBuildAgentEvaluationReviewArtifactV1,
  npRequireAgentEvaluationReviewArtifactV1,
} from "../agent-contract/evaluation-review-contract.js";
import {
  npBuildAgentOperatorPlanEvaluationReviewArtifactV1,
  npRequireAgentOperatorPlanEvaluationReviewArtifactV1,
} from "../agent-contract/operator-plan-evaluation-review-contract.js";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
} from "../agent-contract/moderator-proposal-evaluation-review-contract.js";
import {
  npFormatAgentEvaluationReportV1,
  type NpAgentEvaluationReportRecipeV1,
} from "../agent-contract/evaluation-report-contract.js";
import {
  npBuildAgentModeratorEvaluationReviewArtifactV1,
  npRequireAgentModeratorEvaluationReviewArtifactV1,
} from "./moderator-evaluation.js";
import { npBuildAgentEvaluationReportV1 } from "./evaluation-report.js";

const json = (value: unknown) => JSON.stringify(value);
const buildReview = (recipe: NpAgentEvaluationReportRecipeV1, source: unknown, labels: unknown) =>
  recipe === "moderator"
    ? npBuildAgentModeratorEvaluationReviewArtifactV1(source, labels)
    : recipe === "moderator-proposal"
      ? npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, labels)
      : recipe === "operator"
        ? npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, labels)
        : npBuildAgentEvaluationReviewArtifactV1(source, labels);

const requireReview = (recipe: NpAgentEvaluationReportRecipeV1, value: unknown) =>
  recipe === "moderator"
    ? npRequireAgentModeratorEvaluationReviewArtifactV1(value)
    : recipe === "moderator-proposal"
      ? npRequireAgentModeratorProposalEvaluationReviewArtifactV1(value)
      : recipe === "operator"
        ? npRequireAgentOperatorPlanEvaluationReviewArtifactV1(value)
        : npRequireAgentEvaluationReviewArtifactV1(value);

async function caseScore(source: NpAgentEvaluationArtifactV1, index: number) {
  const { mode, provider, model, startedAt, finishedAt, budget } = source;
  const score = await npBuildAgentEvaluationArtifactV1({
    mode,
    provider,
    model,
    startedAt,
    finishedAt,
    budget,
    suite: { ...source.suite, cases: [source.suite.cases[index]] },
    caseResults: [source.caseResults[index]],
  });
  return { ok: score.ok, metrics: score.metrics, violations: score.violations };
}

/** Validates local evidence and self-reported reviews; performs no live operation or approval. */
export async function npBuildAgentEvaluationWorkbenchV1(
  value: unknown,
): Promise<NpAgentEvaluationWorkbenchResultV1> {
  const request = npRequireAgentEvaluationWorkbenchRequestV1(value);
  const reportInput = {
    schemaVersion: "np.agent-eval-report-input.v1",
    entries: [
      {
        recipe: request.recipe,
        current: { evaluation: request.evaluation, review: request.review },
        baseline:
          request.baseline === null
            ? null
            : { evaluation: request.baseline, review: request.baselineReview },
      },
    ],
  };
  // Validate every imported review before replacing labels. A replacement cannot
  // hide a forged source binding or a malformed baseline review.
  let report = await npBuildAgentEvaluationReportV1(reportInput);
  const current = report.input.entries[0].current;
  const importedReview =
    current.review === null ? null : await requireReview(request.recipe, current.review);
  const coverage = await buildReview(
    request.recipe,
    current.evaluation,
    request.labels ?? importedReview?.labels ?? [],
  );
  const source = coverage.source;
  const review = request.labels === null ? importedReview : coverage;
  if (request.labels !== null) {
    report = await npBuildAgentEvaluationReportV1({
      ...reportInput,
      entries: [
        { ...reportInput.entries[0], current: { evaluation: structuredClone(source), review } },
      ],
    });
  }
  const cases: NpAgentEvaluationWorkbenchCaseV1[] = [];
  for (let index = 0; index < source.caseResults.length; index++) {
    const entry = coverage.entries[index];
    const base = {
      caseId: entry.caseId,
      caseVersion: entry.caseVersion,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash: coverage.sourceHash,
      eligible: entry.eligible,
      labelJson: entry.review === null ? null : json(entry.review),
    };
    if (source.schemaVersion === "np.agent-moderator-eval.v1") {
      const result = source.caseResults[index];
      cases.push({
        ...base,
        allowedOutcomes: entry.eligible ? ["confirmed-spam", "false-positive"] : [],
        evidenceJson: json(source.cases[index]),
        predictionJson: json(result.signals),
        scoreJson: json({ expectedSignalsMatched: result.expectedSignalsMatched }),
      });
    } else {
      const result = source.caseResults[index];
      const score = await caseScore(source, index);
      // Publisher's existing review owner also retains the original source's
      // caseId violation guard. Preserve that restriction for repeated IDs.
      const canAccept =
        score.ok &&
        (request.recipe !== "publisher" ||
          !source.violations.some((violation) => violation.caseId === entry.caseId));
      cases.push({
        ...base,
        allowedOutcomes: entry.eligible
          ? canAccept
            ? ["accept", "edit", "reject"]
            : ["edit", "reject"]
          : [],
        evidenceJson: json(source.suite.cases[index].evidence),
        predictionJson: json(result.prediction),
        scoreJson: json({ ...score, error: result.error }),
      });
    }
  }
  // Review builders and report owners hash canonical source values; retain those
  // exact artifacts rather than converting labels to a new approval vocabulary.
  if (review && serializeAgentCanonicalJson(review.source) !== serializeAgentCanonicalJson(source))
    throw new Error("Invalid evaluation workbench review source.");
  return npRequireAgentEvaluationWorkbenchResultV1({
    schemaVersion: "np.agent-eval-workbench.v1",
    authority: "offline-self-reported-no-approval",
    recipe: request.recipe,
    sourceHash: coverage.sourceHash,
    fixtureGate: source.ok ? "passed" : "failed",
    mode: source.mode,
    cases,
    summaryText: npFormatAgentEvaluationReportV1(report),
    labelsJson: review === null ? null : json(review.labels),
    reviewArtifactJson: review === null ? null : json(review),
    reportArtifactJson: json(report),
  });
}
