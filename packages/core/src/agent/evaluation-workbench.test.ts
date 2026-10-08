import { beforeAll, describe, expect, it } from "vitest";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import { npRequireAgentEvaluationReportV1 } from "./evaluation-report.js";
import { runAgentEvaluationV1 } from "./evaluation.js";
import { npCreateAgentOperatorPlanEvaluationSuiteV1 } from "./operator-plan-evaluation-fixtures.js";
import { npCreateAgentOperatorEvaluationSuiteV1 } from "./operator-evaluation-fixtures.js";
import { npCreateAgentPublisherEvaluationSuiteV1 } from "./publisher-evaluation-fixtures.js";
import { npCreateAgentModeratorProposalEvaluationSuiteV1 } from "./moderator-proposal-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import { npRequireAgentEvaluationReviewArtifactV1 } from "../agent-contract/evaluation-review-contract.js";
import { npRequireAgentOperatorPlanEvaluationReviewArtifactV1 } from "../agent-contract/operator-plan-evaluation-review-contract.js";
import { npRequireAgentModeratorProposalEvaluationReviewArtifactV1 } from "../agent-contract/moderator-proposal-evaluation-review-contract.js";
import {
  runAgentModeratorEvaluationV1,
  npRequireAgentModeratorEvaluationReviewArtifactV1,
} from "./moderator-evaluation.js";
import type { NpAgentEvaluationReportRecipeV1 } from "../agent-contract/evaluation-report-contract.js";
import type { NpAgentEvaluationWorkbenchRequestV1 } from "../agent-contract/evaluation-workbench-contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
let sources: Record<NpAgentEvaluationReportRecipeV1, unknown>;
let publisher: NpAgentEvaluationArtifactV1;
const input = (recipe: NpAgentEvaluationReportRecipeV1): NpAgentEvaluationWorkbenchRequestV1 => ({
  schemaVersion: "np.agent-eval-workbench-request.v1",
  recipe,
  evaluation: sources[recipe],
  review: null,
  baseline: null,
  baselineReview: null,
  labels: null,
});
const rebuild = (source: NpAgentEvaluationArtifactV1) => {
  const { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults } = source;
  return npBuildAgentEvaluationArtifactV1({
    mode,
    suite,
    provider,
    model,
    startedAt,
    finishedAt,
    budget,
    caseResults,
  });
};
beforeAll(async () => {
  const evaluate = async (
    suite: Awaited<ReturnType<typeof npCreateAgentPublisherEvaluationSuiteV1>>,
    caseIds: string[],
  ) => {
    // Recipe owners already exercise their full datasets. Workbench composition
    // needs representative abstention/proposal cases, not repeated full replay.
    const cases = suite.cases.filter((entry) => caseIds.includes(entry.id));
    if (cases.length !== caseIds.length) throw new Error("Missing workbench fixture case");
    return runAgentEvaluationV1({
      suite: npRequireAgentEvaluationSuiteV1({ ...suite, cases }),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
  };
  publisher = await evaluate(await npCreateAgentPublisherEvaluationSuiteV1(), [
    "pub-001",
    "pub-002",
    "pub-003",
  ]);
  sources = {
    publisher,
    operator: await evaluate(await npCreateAgentOperatorPlanEvaluationSuiteV1(), [
      "opn-001",
      "opn-009",
      "opn-010",
    ]),
    "moderator-proposal": await evaluate(await npCreateAgentModeratorProposalEvaluationSuiteV1(), [
      "mp-en-one-current",
      "mp-en-empty",
      "mp-ko-one-current",
    ]),
    moderator: await runAgentModeratorEvaluationV1(),
  };
});

describe("offline evaluation workbench", () => {
  it("round-trips all four owners, exact hashes and self-reported labels without live authority", async () => {
    for (const recipe of ["publisher", "operator", "moderator-proposal", "moderator"] as const) {
      const initial = await npBuildAgentEvaluationWorkbenchV1(input(recipe));
      expect(initial.authority).toBe("offline-self-reported-no-approval");
      expect(initial.sourceHash).toBe(await npDigestAgentEvaluationValueV1(sources[recipe]));
      expect(initial.reviewArtifactJson).toBeNull();
      expect(initial.labelsJson).toBeNull();
      expect(initial.cases.every((c) => c.labelJson === null)).toBe(true);
      const target = initial.cases.find((c) => c.eligible)!;
      const binding = {
        caseId: target.caseId,
        caseHash: target.caseHash,
        predictionHash: target.predictionHash,
        sourceHash: target.sourceHash,
        reviewer: "offline reviewer",
        reviewedAt: "2026-10-08T01:00:00.000Z",
        notes: "Self-reported fixture review only",
      };
      const labels = [
        recipe === "moderator"
          ? { ...binding, label: "confirmed-spam" }
          : { ...binding, outcome: "accept", editedProposal: null },
      ];
      const result = await npBuildAgentEvaluationWorkbenchV1({ ...input(recipe), labels });
      const artifact = JSON.parse(result.reviewArtifactJson!);
      const verified =
        recipe === "moderator"
          ? await npRequireAgentModeratorEvaluationReviewArtifactV1(artifact)
          : recipe === "moderator-proposal"
            ? await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(artifact)
            : recipe === "operator"
              ? await npRequireAgentOperatorPlanEvaluationReviewArtifactV1(artifact)
              : await npRequireAgentEvaluationReviewArtifactV1(artifact);
      expect(JSON.parse(result.labelsJson!)).toEqual(verified.labels);
      expect(JSON.parse(result.cases.find((c) => c.caseId === target.caseId)!.labelJson!)).toEqual(
        verified.labels[0],
      );
      const report = await npRequireAgentEvaluationReportV1(JSON.parse(result.reportArtifactJson));
      expect(report.rows.filter((r) => r.status === "present").map((r) => r.recipe)).toEqual([
        recipe,
      ]);
      expect(report.fullR6).toBe("not-established");
      expect(result.summaryText).toContain("missing-baseline");
      const restored = await npBuildAgentEvaluationWorkbenchV1({
        ...input(recipe),
        review: artifact,
      });
      expect(restored.reviewArtifactJson).toBe(result.reviewArtifactJson);
      const cleared = await npBuildAgentEvaluationWorkbenchV1({
        ...input(recipe),
        review: artifact,
        labels: [],
      });
      expect(JSON.parse(cleared.labelsJson!)).toEqual([]);
    }
  }, 20_000);

  it("exports a grounded edit and compares accept versus reject on the exact reviewed cohort", async () => {
    const initial = await npBuildAgentEvaluationWorkbenchV1(input("publisher"));
    const index = publisher.caseResults.findIndex((result) =>
      result.prediction?.proposal?.draft.operations.some(
        (operation) =>
          operation.kind === "document" &&
          operation.operation === "update" &&
          typeof operation.input.patch.seoDescription === "string",
      ),
    );
    const target = initial.cases[index];
    const proposal = structuredClone(publisher.caseResults[index].prediction?.proposal);
    if (!proposal) throw new Error("Missing Publisher edit fixture");
    const operation = proposal.draft.operations[0];
    if (
      operation.kind !== "document" ||
      operation.operation !== "update" ||
      typeof operation.input.patch.seoDescription !== "string"
    )
      throw new Error("Missing Publisher patch fixture");
    operation.input.patch.seoDescription = operation.input.patch.seoDescription.slice(0, -1);
    const binding = {
      caseId: target.caseId,
      caseHash: target.caseHash,
      predictionHash: target.predictionHash,
      sourceHash: target.sourceHash,
      reviewer: "offline reviewer",
      reviewedAt: "2026-10-08T01:00:00.000Z",
      notes: "Grounded edit",
    };
    const edited = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      labels: [{ ...binding, outcome: "edit", editedProposal: proposal }],
    });
    const verified = await npRequireAgentEvaluationReviewArtifactV1(
      JSON.parse(edited.reviewArtifactJson!),
    );
    expect(verified.summary.edited).toBe(1);
    expect(verified.labels[0].editedProposal).toEqual(proposal);
    const accepted = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      labels: [{ ...binding, outcome: "accept", editedProposal: null }],
    });
    const rejected = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      baseline: structuredClone(publisher),
      baselineReview: JSON.parse(accepted.reviewArtifactJson!),
      labels: [{ ...binding, outcome: "reject", editedProposal: null }],
    });
    expect(rejected.summaryText).toContain("matchedCaseKeys=1");
    expect(rejected.summaryText).toContain("acceptBasisPointsDelta=-10000");
    expect(rejected.summaryText).toContain("rejectBasisPointsDelta=10000");
    expect(JSON.parse(rejected.reviewArtifactJson!).source.ok).toBe(true);
  }, 10_000);

  it("shows failed and invalid predictions without acceptance or fabricated evidence", async () => {
    const changed = structuredClone(publisher);
    const scoredFailure = changed.caseResults.findIndex(
      (r, index) => index > 0 && r.prediction?.proposal != null,
    );
    const prediction = changed.caseResults[scoredFailure].prediction;
    if (!prediction) throw new Error("Missing Publisher fixture prediction");
    prediction.actions = [];
    changed.caseResults[0].prediction = null;
    changed.caseResults[0].error = "STRUCTURED_OUTPUT_INVALID";
    const evidence = await rebuild(changed);
    const result = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      evaluation: evidence,
    });
    expect(result.fixtureGate).toBe("failed");
    expect(result.cases[scoredFailure].eligible).toBe(true);
    expect(result.cases[scoredFailure].allowedOutcomes).toEqual(["edit", "reject"]);
    expect(result.cases[0]).toMatchObject({
      eligible: false,
      allowedOutcomes: [],
      predictionJson: "null",
      labelJson: null,
    });
    expect(JSON.parse(result.cases[0].evidenceJson)).toEqual(evidence.suite.cases[0].evidence);
    expect(JSON.parse(result.cases[0].scoreJson)).toMatchObject({
      ok: false,
      error: "STRUCTURED_OUTPUT_INVALID",
    });
    expect(result.cases[0].caseHash).toBe(evidence.caseResults[0].caseHash);
    expect(result.cases[0].predictionHash).toBe(await npDigestAgentEvaluationValueV1(null));
    const malformed: unknown = {
      ...evidence,
      caseResults: [
        { ...evidence.caseResults[0], prediction: { decision: "propose" } },
        ...evidence.caseResults.slice(1),
      ],
    };
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...input("publisher"), evaluation: malformed }),
    ).rejects.toThrow();
  });

  it("validates imported review and baseline bindings even when replacing all labels", async () => {
    const workbench = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      labels: [],
    });
    const review = JSON.parse(workbench.reviewArtifactJson!);
    const changed = structuredClone(publisher);
    changed.mode = "provider";
    changed.provider = "offline-stub";
    changed.model = "different-offline-model";
    const baseline = await rebuild(changed);
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...input("publisher"),
        evaluation: baseline,
        review,
        labels: [],
      }),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...input("publisher"),
        baseline,
        baselineReview: structuredClone(review),
        labels: [],
      }),
    ).rejects.toThrow();
    review.summary.unreviewed = 0;
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...input("publisher"), review, labels: [] }),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...input("publisher"),
        evaluation: { ...publisher, ok: false },
      }),
    ).rejects.toThrow();
  });

  it("keeps compared evidence, missing review reasons and review coverage explicit", async () => {
    const workbench = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      labels: [],
    });
    const review = JSON.parse(workbench.reviewArtifactJson!);
    const result = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      review,
      baseline: structuredClone(publisher),
      baselineReview: structuredClone(review),
    });
    expect(result.summaryText).toContain("Evaluation comparison: compared; comparable");
    expect(result.summaryText).toContain(
      "Review comparison: compared; not comparable (NO_MATCHED_REVIEW_COHORT)",
    );
    expect(result.summaryText).toContain("unmatchedCurrentCaseKeys=0");
    const missing = await npBuildAgentEvaluationWorkbenchV1({
      ...input("publisher"),
      review,
      baseline: structuredClone(publisher),
    });
    expect(missing.summaryText).toContain("missing-baseline-review");
    const diagnosis = await runAgentEvaluationV1({
      suite: await npCreateAgentOperatorEvaluationSuiteV1(),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...input("operator"), evaluation: diagnosis }),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...input("publisher"), baselineReview: review }),
    ).rejects.toThrow();
  });
});
