import { canonicalBodyRecord } from "../agent-contract/canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentEvaluationArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npDigestAgentEvaluationValueV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npBuildAgentEvaluationReviewArtifactV1,
  npRequireAgentEvaluationReviewArtifactV1,
  npCompareAgentEvaluationReviewArtifactsV1,
} from "../agent-contract/evaluation-review-contract.js";
import {
  npBuildAgentOperatorPlanEvaluationReviewArtifactV1,
  npRequireAgentOperatorPlanEvaluationReviewArtifactV1,
  npCompareAgentOperatorPlanEvaluationReviewArtifactsV1,
} from "../agent-contract/operator-plan-evaluation-review-contract.js";
import {
  npAgentEvaluationReportMaxBytesV1,
  npAgentEvaluationReportRecipesV1,
  type NpAgentEvaluationReportRecipeV1,
  type NpAgentEvaluationReportEvidenceV1,
  type NpAgentEvaluationReportInputV1,
  type NpAgentEvaluationReportRowV1,
  type NpAgentEvaluationReportV1,
} from "../agent-contract/evaluation-report-contract.js";
import {
  npBuildAgentModeratorEvaluationReviewArtifactV1,
  npRequireAgentModeratorEvaluationArtifactV1,
  npRequireAgentModeratorEvaluationReviewArtifactV1,
  npCompareAgentModeratorEvaluationArtifactsV1,
  npCompareAgentModeratorEvaluationReviewArtifactsV1,
} from "./moderator-evaluation.js";

const path = "agent.evaluation.report";
const fail = (): never => {
  throw new Error("Invalid bounded Agent evaluation report.");
};
const clone = (value: unknown) =>
  cloneCanonicalRuntimeInput(value, path, npAgentEvaluationReportMaxBytesV1, {
    maximumNodes: 100_000,
  });
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const equal = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
async function evidence(
  recipe: NpAgentEvaluationReportRecipeV1,
  value: unknown,
): Promise<NpAgentEvaluationReportEvidenceV1> {
  const r = record(value, ["evaluation", "review"]);
  const evaluation =
    recipe === "moderator"
      ? await npRequireAgentModeratorEvaluationArtifactV1(r.evaluation)
      : await npRequireAgentEvaluationArtifactV1(r.evaluation);
  if (
    evaluation.schemaVersion === "np.agent-eval.v1" &&
    evaluation.suite.cases.some(
      (c) => c.category !== (recipe === "operator" ? "ops-plan" : "publisher"),
    )
  )
    fail();
  const review =
    r.review === null
      ? null
      : recipe === "moderator"
        ? await npRequireAgentModeratorEvaluationReviewArtifactV1(r.review)
        : recipe === "operator"
          ? await npRequireAgentOperatorPlanEvaluationReviewArtifactV1(r.review)
          : await npRequireAgentEvaluationReviewArtifactV1(r.review);
  if (review && !equal(review.source, evaluation)) fail();
  return { evaluation, review };
}
type ValidatedInput = Omit<NpAgentEvaluationReportInputV1, "entries"> & {
  entries: {
    recipe: NpAgentEvaluationReportRecipeV1;
    current: NpAgentEvaluationReportEvidenceV1;
    baseline: NpAgentEvaluationReportEvidenceV1 | null;
  }[];
};
async function input(value: unknown): Promise<ValidatedInput> {
  const r = record(clone(value), ["schemaVersion", "entries"]);
  if (
    r.schemaVersion !== "np.agent-eval-report-input.v1" ||
    !Array.isArray(r.entries) ||
    r.entries.length > 3
  )
    fail();
  const seen = new Set<string>();
  const entries: ValidatedInput["entries"] = [];
  for (const raw of r.entries as unknown[]) {
    const entry = record(raw, ["recipe", "current", "baseline"]);
    const recipe = npAgentEvaluationReportRecipesV1.find((recipe) => recipe === entry.recipe);
    if (!recipe || seen.has(recipe)) return fail();
    seen.add(recipe);
    entries.push({
      recipe,
      current: await evidence(recipe, entry.current),
      baseline: entry.baseline === null ? null : await evidence(recipe, entry.baseline),
    });
  }
  entries.sort(
    (a, b) =>
      npAgentEvaluationReportRecipesV1.indexOf(a.recipe) -
      npAgentEvaluationReportRecipesV1.indexOf(b.recipe),
  );
  return { schemaVersion: "np.agent-eval-report-input.v1", entries };
}
async function row(
  recipe: NpAgentEvaluationReportRecipeV1,
  entry: ValidatedInput["entries"][number] | undefined,
): Promise<NpAgentEvaluationReportRowV1> {
  if (!entry)
    return {
      recipe,
      status: "missing",
      mode: null,
      fixtureGate: "missing",
      cases: null,
      metrics: null,
      review: { status: "missing", summary: null },
      evaluationComparison: { status: "missing-current", result: null },
      reviewComparison: { status: "missing-current", result: null },
    };
  const { current, baseline } = entry;
  const evaluationComparison: NpAgentEvaluationReportRowV1["evaluationComparison"] = baseline
    ? {
        status: "compared",
        result:
          recipe === "moderator"
            ? await npCompareAgentModeratorEvaluationArtifactsV1(
                current.evaluation,
                baseline.evaluation,
              )
            : await npCompareAgentEvaluationArtifactsV1(current.evaluation, baseline.evaluation),
      }
    : { status: "missing-baseline", result: null };
  const reviewComparison: NpAgentEvaluationReportRowV1["reviewComparison"] = !baseline
    ? { status: "missing-baseline", result: null }
    : !current.review
      ? { status: "missing-current-review", result: null }
      : !baseline.review
        ? { status: "missing-baseline-review", result: null }
        : {
            status: "compared",
            result:
              recipe === "moderator"
                ? await npCompareAgentModeratorEvaluationReviewArtifactsV1(
                    current.review,
                    baseline.review,
                  )
                : recipe === "operator"
                  ? await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(
                      current.review,
                      baseline.review,
                    )
                  : await npCompareAgentEvaluationReviewArtifactsV1(
                      current.review,
                      baseline.review,
                    ),
          };
  const coverage =
    current.review ??
    (recipe === "moderator"
      ? await npBuildAgentModeratorEvaluationReviewArtifactV1(current.evaluation)
      : recipe === "operator"
        ? await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(current.evaluation)
        : await npBuildAgentEvaluationReviewArtifactV1(current.evaluation));
  return {
    recipe,
    status: "present",
    mode: current.evaluation.mode,
    fixtureGate: current.evaluation.ok ? "passed" : "failed",
    cases: current.evaluation.caseResults.length,
    metrics: structuredClone(
      current.evaluation.schemaVersion === "np.agent-eval.v1"
        ? current.evaluation.metrics
        : current.evaluation.summary,
    ),
    review: {
      status: current.review ? "present" : "missing",
      summary: structuredClone(coverage.summary),
    },
    evaluationComparison,
    reviewComparison,
  };
}
/** Offline validation and projection only; never invokes a provider or grants authority. */
export async function npBuildAgentEvaluationReportV1(
  value: unknown,
): Promise<NpAgentEvaluationReportV1> {
  const source = await input(value);
  const rows: NpAgentEvaluationReportRowV1[] = [];
  for (const recipe of npAgentEvaluationReportRecipesV1)
    rows.push(
      await row(
        recipe,
        source.entries.find((e) => e.recipe === recipe),
      ),
    );
  const body = {
    schemaVersion: "np.agent-eval-report.v1" as const,
    authority: "offline-evidence-no-approval" as const,
    input: source,
    rows,
    fullR6: "not-established" as const,
    modelUsefulness: "not-established" as const,
    limitations: [
      "Fixture/schema gates cover bounded synthetic checks; provider mode does not establish real-model usefulness.",
      "Offline reviews are self-reported, retain unreviewed coverage, and grant no live approval or activation.",
      "Missing review files display eligibility and unreviewed counts derived from an empty review; no review artifact or labels are fabricated.",
      "Recipe metrics are not pooled. Review deltas use only the owner's matched reviewed cohort.",
      "Production shadow, operational acceptance, and the full R6 acceptance gate remain separate.",
      "Moderator artifacts require the installed deterministic implementation; historical changed predictions are unsupported.",
    ],
  };
  const artifact = { ...body, artifactHash: await npDigestAgentEvaluationValueV1(body) };
  clone(artifact);
  return artifact;
}
export async function npRequireAgentEvaluationReportV1(
  value: unknown,
): Promise<NpAgentEvaluationReportV1> {
  const r = record(clone(value), [
    "schemaVersion",
    "authority",
    "input",
    "rows",
    "fullR6",
    "modelUsefulness",
    "limitations",
    "artifactHash",
  ]);
  const actual = await npBuildAgentEvaluationReportV1(r.input);
  if (!equal(actual, r)) fail();
  return actual;
}
