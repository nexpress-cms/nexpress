import {
  canonicalBodyRecord,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
} from "./canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npAgentEvaluationReportRecipesV1,
  type NpAgentEvaluationReportRecipeV1,
} from "./evaluation-report-contract.js";

export const npAgentEvaluationWorkbenchRequestMaxBytesV1 = 4 * 1024 * 1024;
export const npAgentEvaluationWorkbenchResultMaxBytesV1 = 16 * 1024 * 1024;
export const npAgentEvaluationWorkbenchOutcomesV1 = [
  "accept",
  "edit",
  "reject",
  "confirmed-spam",
  "false-positive",
] as const;
export type NpAgentEvaluationWorkbenchOutcomeV1 =
  (typeof npAgentEvaluationWorkbenchOutcomesV1)[number];
export interface NpAgentEvaluationWorkbenchRequestV1 {
  schemaVersion: "np.agent-eval-workbench-request.v1";
  recipe: NpAgentEvaluationReportRecipeV1;
  evaluation: unknown;
  review: unknown;
  baseline: unknown;
  baselineReview: unknown;
  /** Null preserves imported labels; an array replaces them after owner validation. */
  labels: unknown[] | null;
}
export interface NpAgentEvaluationWorkbenchCaseV1 {
  caseId: string;
  caseVersion: number;
  caseHash: string;
  predictionHash: string | null;
  sourceHash: string;
  eligible: boolean;
  allowedOutcomes: NpAgentEvaluationWorkbenchOutcomeV1[];
  evidenceJson: string;
  predictionJson: string;
  scoreJson: string;
  /** Exact existing owner label, or null for an unreviewed case. */
  labelJson: string | null;
}
export interface NpAgentEvaluationWorkbenchResultV1 {
  schemaVersion: "np.agent-eval-workbench.v1";
  authority: "offline-self-reported-no-approval";
  recipe: NpAgentEvaluationReportRecipeV1;
  sourceHash: string;
  fixtureGate: "passed" | "failed";
  mode: "deterministic-offline" | "fake" | "provider";
  cases: NpAgentEvaluationWorkbenchCaseV1[];
  summaryText: string;
  /** These are serialized existing artifacts, never new approval resources. */
  labelsJson: string | null;
  reviewArtifactJson: string | null;
  reportArtifactJson: string;
}
const path = "agent.evaluation.workbench";
function fail(): never {
  throw new Error("Invalid bounded evaluation workbench data.");
}
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet() });
const text = (value: unknown, maximum: number, minimum = 0): string => {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) fail();
  return value;
};
const json = (value: unknown, maximum = 8_000_000): string => {
  const result = text(value, maximum, 1);
  try {
    JSON.parse(result);
  } catch {
    fail();
  }
  return result;
};
const digest = (value: unknown) => canonicalBodySha256Digest(value, path);
const enumValue = <T extends string>(value: unknown, values: readonly T[]): T =>
  canonicalBodyEnum<T>(value, path, new Set(values));
const recipe = (value: unknown) => enumValue(value, npAgentEvaluationReportRecipesV1);

export function npRequireAgentEvaluationWorkbenchRequestV1(
  value: unknown,
): NpAgentEvaluationWorkbenchRequestV1 {
  const r = record(
    cloneCanonicalRuntimeInput(value, path, npAgentEvaluationWorkbenchRequestMaxBytesV1, {
      maximumNodes: 100_000,
    }),
    ["schemaVersion", "recipe", "evaluation", "review", "baseline", "baselineReview", "labels"],
  );
  if (
    r.schemaVersion !== "np.agent-eval-workbench-request.v1" ||
    r.evaluation === null ||
    (r.baseline === null && r.baselineReview !== null)
  )
    fail();
  if (r.labels !== null && (!Array.isArray(r.labels) || r.labels.length > 100)) fail();
  return {
    schemaVersion: r.schemaVersion,
    recipe: recipe(r.recipe),
    evaluation: r.evaluation,
    review: r.review,
    baseline: r.baseline,
    baselineReview: r.baselineReview,
    labels: r.labels as unknown[] | null,
  };
}

export function npRequireAgentEvaluationWorkbenchResultV1(
  value: unknown,
): NpAgentEvaluationWorkbenchResultV1 {
  const r = record(
    cloneCanonicalRuntimeInput(value, path, npAgentEvaluationWorkbenchResultMaxBytesV1, {
      maximumNodes: 100_000,
      maximumStringCharacters: 8_000_000,
    }),
    [
      "schemaVersion",
      "authority",
      "recipe",
      "sourceHash",
      "fixtureGate",
      "mode",
      "cases",
      "summaryText",
      "labelsJson",
      "reviewArtifactJson",
      "reportArtifactJson",
    ],
  );
  if (
    r.schemaVersion !== "np.agent-eval-workbench.v1" ||
    r.authority !== "offline-self-reported-no-approval" ||
    !Array.isArray(r.cases) ||
    r.cases.length < 1 ||
    r.cases.length > 100
  )
    fail();
  const sourceHash = digest(r.sourceHash);
  const selectedRecipe = recipe(r.recipe);
  const keys = new Set<string>();
  const cases = r.cases.map((value): NpAgentEvaluationWorkbenchCaseV1 => {
    const c = record(value, [
      "caseId",
      "caseVersion",
      "caseHash",
      "predictionHash",
      "sourceHash",
      "eligible",
      "allowedOutcomes",
      "evidenceJson",
      "predictionJson",
      "scoreJson",
      "labelJson",
    ]);
    const caseId = text(c.caseId, 128, 1);
    const caseVersion = canonicalBodyInteger(c.caseVersion, path, 1, 2_147_483_647);
    const key = `${caseId}@${caseVersion}`;
    if (
      keys.has(key) ||
      c.sourceHash !== sourceHash ||
      typeof c.eligible !== "boolean" ||
      !Array.isArray(c.allowedOutcomes)
    )
      fail();
    keys.add(key);
    const allowedOutcomes = c.allowedOutcomes.map((v) =>
      enumValue(v, npAgentEvaluationWorkbenchOutcomesV1),
    );
    if (
      new Set(allowedOutcomes).size !== allowedOutcomes.length ||
      (c.eligible
        ? allowedOutcomes.length === 0 || c.predictionHash === null
        : allowedOutcomes.length > 0) ||
      (selectedRecipe === "moderator"
        ? allowedOutcomes.some((v) => v !== "confirmed-spam" && v !== "false-positive")
        : allowedOutcomes.some((v) => v === "confirmed-spam" || v === "false-positive"))
    )
      fail();
    const labelJson = c.labelJson === null ? null : json(c.labelJson);
    if (labelJson !== null) {
      const label: unknown = JSON.parse(labelJson);
      const l = record(label, [
        "caseId",
        "caseHash",
        "predictionHash",
        "sourceHash",
        "reviewer",
        "reviewedAt",
        "notes",
        ...(selectedRecipe === "moderator" ? ["label"] : ["outcome", "editedProposal"]),
      ]);
      if (
        !c.eligible ||
        l.caseId !== caseId ||
        l.caseHash !== c.caseHash ||
        l.predictionHash !== c.predictionHash ||
        l.sourceHash !== sourceHash ||
        !allowedOutcomes.includes(
          enumValue(
            selectedRecipe === "moderator" ? l.label : l.outcome,
            npAgentEvaluationWorkbenchOutcomesV1,
          ),
        )
      )
        fail();
      if (!text(l.reviewer, 128, 1).trim()) fail();
      text(l.notes, 2000);
      canonicalBodyUtc(l.reviewedAt, path);
    }
    return {
      caseId,
      caseVersion,
      caseHash: digest(c.caseHash),
      predictionHash: c.predictionHash === null ? null : digest(c.predictionHash),
      sourceHash,
      eligible: c.eligible,
      allowedOutcomes,
      evidenceJson: json(c.evidenceJson),
      predictionJson: json(c.predictionJson),
      scoreJson: json(c.scoreJson),
      labelJson,
    };
  });
  if ((r.labelsJson === null) !== (r.reviewArtifactJson === null)) fail();
  if (r.labelsJson !== null) {
    const labelsJson = json(r.labelsJson);
    const labels: unknown = JSON.parse(labelsJson);
    if (
      !Array.isArray(labels) ||
      serializeAgentCanonicalJson(labels) !==
        serializeAgentCanonicalJson(
          cases.flatMap((c) => (c.labelJson === null ? [] : [JSON.parse(c.labelJson) as unknown])),
        )
    )
      fail();
    const artifact: unknown = JSON.parse(json(r.reviewArtifactJson));
    const reviewVersions = {
      moderator: "np.agent-moderator-eval-review.v1",
      "moderator-proposal": "np.agent-moderator-proposal-eval-review.v1",
      operator: "np.agent-operator-plan-eval-review.v1",
      publisher: "np.agent-eval-review.v1",
    };
    if (
      typeof artifact !== "object" ||
      artifact === null ||
      !("schemaVersion" in artifact) ||
      artifact.schemaVersion !== reviewVersions[selectedRecipe] ||
      !("artifactHash" in artifact) ||
      !("sourceHash" in artifact) ||
      artifact.sourceHash !== sourceHash ||
      !("authority" in artifact) ||
      artifact.authority !== "offline-self-reported-no-approval" ||
      !("labels" in artifact) ||
      serializeAgentCanonicalJson(artifact.labels) !== serializeAgentCanonicalJson(labels)
    )
      fail();
    digest(artifact.artifactHash);
  } else if (cases.some((c) => c.labelJson !== null)) fail();
  const reportArtifactJson = json(r.reportArtifactJson);
  const report: unknown = JSON.parse(reportArtifactJson);
  if (
    typeof report !== "object" ||
    report === null ||
    !("schemaVersion" in report) ||
    report.schemaVersion !== "np.agent-eval-report.v1" ||
    !("authority" in report) ||
    report.authority !== "offline-evidence-no-approval" ||
    !("fullR6" in report) ||
    report.fullR6 !== "not-established" ||
    !("modelUsefulness" in report) ||
    report.modelUsefulness !== "not-established" ||
    !("artifactHash" in report)
  )
    fail();
  digest(report.artifactHash);
  return {
    schemaVersion: r.schemaVersion,
    authority: r.authority,
    recipe: selectedRecipe,
    sourceHash,
    fixtureGate: enumValue(r.fixtureGate, ["passed", "failed"] as const),
    mode: enumValue(r.mode, ["deterministic-offline", "fake", "provider"] as const),
    cases,
    summaryText: text(r.summaryText, 100_000, 1),
    labelsJson: r.labelsJson === null ? null : json(r.labelsJson),
    reviewArtifactJson: r.reviewArtifactJson === null ? null : json(r.reviewArtifactJson),
    reportArtifactJson,
  };
}
