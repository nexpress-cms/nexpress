import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  npBuildAgentEvaluationReportV1,
  npRequireAgentEvaluationReportV1,
} from "./evaluation-report.js";
import {
  npFormatAgentEvaluationReportV1,
  npRequireAgentEvaluationReportManifestV1,
  type NpAgentEvaluationReportInputV1,
} from "../agent-contract/evaluation-report-contract.js";
import { runAgentEvaluationV1 } from "./evaluation.js";
import {
  runAgentModeratorEvaluationV1,
  npBuildAgentModeratorEvaluationReviewArtifactV1,
} from "./moderator-evaluation.js";
import { npCreateAgentOperatorPlanEvaluationSuiteV1 } from "./operator-plan-evaluation-fixtures.js";
import { npCreateAgentPublisherEvaluationSuiteV1 } from "./publisher-evaluation-fixtures.js";
import { npCreateAgentOperatorEvaluationSuiteV1 } from "./operator-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import { npBuildAgentOperatorPlanEvaluationReviewArtifactV1 } from "../agent-contract/operator-plan-evaluation-review-contract.js";
import { npBuildAgentEvaluationReviewArtifactV1 } from "../agent-contract/evaluation-review-contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
let operator: NpAgentEvaluationArtifactV1;
let publisher: NpAgentEvaluationArtifactV1;
const input = (
  entries: NpAgentEvaluationReportInputV1["entries"],
): NpAgentEvaluationReportInputV1 => ({
  schemaVersion: "np.agent-eval-report-input.v1",
  entries: JSON.parse(JSON.stringify(entries)),
});
const entry = (
  recipe: "operator" | "publisher" | "moderator",
  evaluation: unknown,
  review: unknown = null,
  baseline: NpAgentEvaluationReportInputV1["entries"][number]["baseline"] = null,
) => ({ recipe, current: { evaluation, review }, baseline });
const rebuild = (
  a: NpAgentEvaluationArtifactV1,
  overrides: Partial<NpAgentEvaluationArtifactV1> = {},
) => {
  const value = { ...a, ...overrides };
  return npBuildAgentEvaluationArtifactV1({
    mode: value.mode,
    suite: value.suite,
    provider: value.provider,
    model: value.model,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    budget: value.budget,
    caseResults: value.caseResults,
  });
};
beforeAll(async () => {
  operator = await runAgentEvaluationV1({
    suite: await npCreateAgentOperatorPlanEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
  publisher = await runAgentEvaluationV1({
    suite: await npCreateAgentPublisherEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
});
// Full artifact replay and review comparisons exercise multiple owners per workflow.
// Scoped timeouts allow hosted CI scheduling; they do not change evaluator limits.
describe("unified offline evaluation evidence", () => {
  it("keeps recipe gates, modes and missing review coverage distinct without readiness", async () => {
    const moderator = await runAgentModeratorEvaluationV1();
    const provider = await rebuild(publisher, {
      mode: "provider",
      provider: "local-stub",
      model: "test-model",
    });
    const failedResults = structuredClone(operator.caseResults);
    failedResults[0].prediction = null;
    failedResults[0].error = "STRUCTURED_OUTPUT_INVALID";
    const failed = await rebuild(operator, { caseResults: failedResults });
    const report = await npBuildAgentEvaluationReportV1(
      input([
        entry("publisher", provider),
        entry("moderator", moderator),
        entry("operator", failed),
      ]),
    );
    expect(report.rows.map((r) => [r.recipe, r.mode, r.fixtureGate])).toEqual([
      ["moderator", "deterministic-offline", "passed"],
      ["operator", "fake", "failed"],
      ["publisher", "provider", "passed"],
    ]);
    expect(report.rows[2].review).toMatchObject({
      status: "missing",
      summary: { reviewed: 0, unreviewed: expect.any(Number), acceptBasisPoints: null },
    });
    expect(report.input.entries[2].current.review).toBeNull();
    expect(report).toMatchObject({
      fullR6: "not-established",
      modelUsefulness: "not-established",
      authority: "offline-evidence-no-approval",
    });
    expect(report).not.toHaveProperty("ok");
    expect(await npRequireAgentEvaluationReportV1(report)).toEqual(report);
    expect(npFormatAgentEvaluationReportV1(report)).toContain("fixture/schema gate=failed");
    const missing = await npBuildAgentEvaluationReportV1(input([]));
    expect(missing.rows).toHaveLength(3);
    expect(
      missing.rows.every(
        (r) => r.status === "missing" && r.cases === null && r.review.summary === null,
      ),
    ).toBe(true);
  }, 20_000);
  it("uses owner comparisons for incompatible baselines, absent reviews and empty matched cohorts", async () => {
    const review = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(operator);
    const changedMode = await rebuild(operator, { mode: "provider", provider: "local-stub" });
    const incompatible = await npBuildAgentEvaluationReportV1(
      input([
        entry("operator", operator, review, {
          evaluation: changedMode,
          review: await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(changedMode),
        }),
      ]),
    );
    expect(incompatible.rows[1].evaluationComparison.result).toEqual({
      comparable: false,
      reason: "MODE_MISMATCH",
    });
    expect(incompatible.rows[1].reviewComparison.result).toMatchObject({
      comparable: false,
      reason: "MODE_MISMATCH",
      acceptBasisPointsDelta: null,
    });
    const empty = await npBuildAgentEvaluationReportV1(
      input([entry("operator", operator, review, { evaluation: operator, review })]),
    );
    expect(empty.rows[1].reviewComparison.result).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
      matchedCaseKeys: [],
      acceptBasisPointsDelta: null,
    });
    for (const [currentReview, baselineReview, status] of [
      [null, review, "missing-current-review"],
      [review, null, "missing-baseline-review"],
    ] as const) {
      const report = await npBuildAgentEvaluationReportV1(
        input([
          entry("operator", operator, currentReview, {
            evaluation: operator,
            review: baselineReview,
          }),
        ]),
      );
      expect(report.rows[1].reviewComparison).toEqual({ status, result: null });
    }
  }, 20_000);
  it("preserves exact-bound offline human feedback and rejects valid reviews for another source", async () => {
    const template = await npBuildAgentEvaluationReviewArtifactV1(publisher);
    const eligible = template.entries.find((e) => e.eligible)!;
    const review = await npBuildAgentEvaluationReviewArtifactV1(publisher, [
      {
        caseId: eligible.caseId,
        caseHash: eligible.caseHash,
        predictionHash: eligible.predictionHash,
        sourceHash: eligible.sourceHash,
        outcome: "accept",
        reviewer: "local-reviewer",
        reviewedAt: "2026-10-07T00:00:00.000Z",
        notes: "Synthetic review",
        editedProposal: null,
      },
    ]);
    const report = await npBuildAgentEvaluationReportV1(
      input([entry("publisher", publisher, review, { evaluation: publisher, review })]),
    );
    expect(report.rows[2].review.summary).toMatchObject({ reviewed: 1, accepted: 1 });
    expect(report.rows[2].reviewComparison.result).toMatchObject({
      comparable: true,
      matchedCaseKeys: [`${eligible.caseId}@${eligible.caseVersion}`],
      acceptBasisPointsDelta: 0,
    });
    const other = await rebuild(publisher, {
      finishedAt: new Date(Date.parse(publisher.finishedAt) + 1000).toISOString(),
    });
    await expect(
      npBuildAgentEvaluationReportV1(input([entry("publisher", other, review)])),
    ).rejects.toThrow();
    const moderator = await runAgentModeratorEvaluationV1();
    const moderatorReview = await npBuildAgentModeratorEvaluationReviewArtifactV1(moderator);
    const modReport = await npBuildAgentEvaluationReportV1(
      input([
        entry("moderator", moderator, moderatorReview, {
          evaluation: moderator,
          review: moderatorReview,
        }),
      ]),
    );
    expect(modReport.rows[0].reviewComparison.result).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
    });
  }, 20_000);
  it("rejects derived-data forgery, wrong recipes, legacy Operator, duplicate input and aggregate excess before getters", async () => {
    const report = await npBuildAgentEvaluationReportV1(input([entry("operator", operator)]));
    for (const forged of [
      { ...report, authority: "approval" },
      { ...report, fullR6: "established" },
      { ...report, ok: true },
      { ...report, rows: [] },
      { ...report, artifactHash: "forged" },
    ])
      await expect(npRequireAgentEvaluationReportV1(forged)).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationReportV1(input([entry("operator", publisher)])),
    ).rejects.toThrow();
    const legacy = await runAgentEvaluationV1({
      suite: await npCreateAgentOperatorEvaluationSuiteV1(),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    await expect(
      npBuildAgentEvaluationReportV1(input([entry("operator", legacy)])),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationReportV1(
        input([entry("operator", operator), entry("operator", operator)]),
      ),
    ).rejects.toThrow();
    await expect(npBuildAgentEvaluationReportV1({ ...input([]), unknown: true })).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationReportV1(input([entry("operator", "x".repeat(4 * 1024 * 1024))])),
    ).rejects.toThrow();
    const getter = vi.fn(() => []);
    await expect(
      npBuildAgentEvaluationReportV1(
        Object.defineProperty({ schemaVersion: "np.agent-eval-report-input.v1" }, "entries", {
          enumerable: true,
          get: getter,
        }),
      ),
    ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("parses only exact bounded local manifest fields without invoking getters", () => {
    const manifest = {
      schemaVersion: "np.agent-eval-report-manifest.v1",
      entries: [
        {
          recipe: "operator",
          evaluation: "data/eval.json",
          review: null,
          baseline: { evaluation: "baseline.json", review: "review.json" },
        },
      ],
    };
    expect(npRequireAgentEvaluationReportManifestV1(manifest)).toEqual(manifest);
    for (const invalid of [
      { ...manifest, ready: true },
      { ...manifest, entries: [...manifest.entries, ...manifest.entries] },
      { ...manifest, entries: [{ ...manifest.entries[0], evaluation: "\u0000" }] },
      { ...manifest, entries: [{ recipe: "operator", evaluation: "a.json" }] },
    ])
      expect(() => npRequireAgentEvaluationReportManifestV1(invalid)).toThrow();
  });
});
