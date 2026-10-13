import { beforeAll, describe, expect, it } from "vitest";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import { npRequireAgentEvaluationReportV1 } from "./evaluation-report.js";
import { runAgentEvaluationV1 } from "./evaluation.js";
import { npCreateAgentOperatorPlanEvaluationSuiteV1 } from "./operator-plan-evaluation-fixtures.js";
import { npCreateAgentOperatorEvaluationSuiteV1 } from "./operator-evaluation-fixtures.js";
import { npCreateAgentPublisherEvaluationSuiteV1 } from "./publisher-evaluation-fixtures.js";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV2,
} from "./moderator-proposal-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npBuildAgentEvaluationReviewArtifactV1,
  npRequireAgentEvaluationReviewArtifactV1,
} from "../agent-contract/evaluation-review-contract.js";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
} from "../agent-contract/moderator-proposal-evaluation-review-contract.js";
import { npRequireAgentModeratorProposalEvaluationEvidenceV1 } from "../agent-contract/moderator-proposal-evaluation-contract.js";
import {
  runAgentModeratorEvaluationV1,
  runAgentModeratorEvaluationV2,
  npBuildAgentModeratorEvaluationReviewArtifact,
} from "./moderator-evaluation.js";
import type { NpAgentEvaluationReportRecipeV1 } from "../agent-contract/evaluation-report-contract.js";
import {
  npRequireAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationWorkbenchRequestV1,
} from "../agent-contract/evaluation-workbench-contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
let sources: Record<NpAgentEvaluationReportRecipeV1, unknown>;
let publisher: NpAgentEvaluationArtifactV1;
let reported: NpAgentEvaluationArtifactV1;
const initialWorkbenches = new Map<
  NpAgentEvaluationReportRecipeV1,
  ReturnType<typeof npBuildAgentEvaluationWorkbenchV1>
>();
const input = (recipe: NpAgentEvaluationReportRecipeV1): NpAgentEvaluationWorkbenchRequestV1 => ({
  schemaVersion: "np.agent-eval-workbench-request.v1",
  recipe,
  evaluation: sources[recipe],
  review: null,
  baseline: null,
  baselineReview: null,
  labels: null,
});
const initialWorkbench = (recipe: NpAgentEvaluationReportRecipeV1) => {
  let workbench = initialWorkbenches.get(recipe);
  if (!workbench) {
    workbench = npBuildAgentEvaluationWorkbenchV1(input(recipe));
    initialWorkbenches.set(recipe, workbench);
  }
  return workbench;
};
let emptyPublisherReview: Awaited<ReturnType<typeof npBuildAgentEvaluationReviewArtifactV1>>;
let diagnosis: NpAgentEvaluationArtifactV1;
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
  reported = await evaluate(await npCreateAgentModeratorProposalEvaluationSuiteV2(), [
    "mp-en-report-current",
    "mp-en-mixed-current",
    "mp-en-mixed-stale",
  ]);
  // Invalid-binding and comparison probes share immutable owner artifacts;
  // workbench export and clearing behavior are exercised in the round trip.
  emptyPublisherReview = await npBuildAgentEvaluationReviewArtifactV1(publisher, []);
  diagnosis = await evaluate(await npCreateAgentOperatorEvaluationSuiteV1(), ["ops-001"]);
});

describe("offline evaluation workbench", () => {
  it.each(["publisher", "operator", "moderator-proposal", "moderator"] as const)(
    "exports %s, exact hashes and self-reported labels without live authority",
    async (recipe) => {
      const initial = await initialWorkbench(recipe);
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
      // The report owner independently validates the embedded review and source.
      // Match the separate review export to it instead of replaying the same
      // fixed detector suite again through a second review validator.
      const report = await npRequireAgentEvaluationReportV1(JSON.parse(result.reportArtifactJson));
      expect(report.input.entries[0].current.review).toEqual(artifact);
      expect(report.input.entries[0].current.review).toMatchObject({ labels });
      expect(JSON.parse(result.labelsJson!)).toEqual(labels);
      expect(JSON.parse(result.cases.find((c) => c.caseId === target.caseId)!.labelJson!)).toEqual(
        labels[0],
      );
      expect(report.rows.filter((r) => r.status === "present").map((r) => r.recipe)).toEqual([
        recipe,
      ]);
      expect(report.fullR6).toBe("not-established");
      expect(result.summaryText).toContain("missing-baseline");
      // Shared review reimport is exercised once by the report/mixed round trip
      // below and the production browser journey, not once per recipe format.
      if (recipe === "publisher") {
        // Replacement labels use the same request semantics for every owner.
        const cleared = await npBuildAgentEvaluationWorkbenchV1({
          ...input(recipe),
          review: artifact,
          labels: [],
        });
        expect(JSON.parse(cleared.labelsJson!)).toEqual([]);
      }
    },
    20_000,
  );

  it("round-trips report and mixed evidence, rejects ungrounded/stale labels and explains v1 comparison", async () => {
    const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(reported);
    const reviewed = template.entries.filter((entry) => entry.caseId !== "mp-en-mixed-current");
    expect(reviewed.map((entry) => entry.response?.decision.kind)).toEqual([
      "propose-capability",
      "complete",
    ]);
    const labels = reviewed.map((entry) => ({
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      predictionHash: entry.predictionHash,
      sourceHash: entry.sourceHash,
      outcome: "accept" as const,
      editedProposal: null,
      reviewer: "offline report reviewer",
      reviewedAt: "2026-10-13T00:00:00.000Z",
      notes: "Synthetic selection and abstention, never a live spam verdict or approval.",
    }));
    const baseline = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(
      sources["moderator-proposal"],
    );
    const result = await npBuildAgentEvaluationWorkbenchV1({
      ...input("moderator-proposal"),
      evaluation: reported,
      baseline: structuredClone(baseline.source),
      baselineReview: baseline,
      labels,
    });
    expect(result.authority).toBe("offline-self-reported-no-approval");
    expect(result.fixtureGate).toBe("passed");
    expect(result.sourceHash).toBe(template.sourceHash);
    const review = await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
      JSON.parse(result.reviewArtifactJson!),
    );
    expect(JSON.parse(result.labelsJson!)).toEqual(review.labels);
    expect(review.summary).toMatchObject({ reviewed: 2, accepted: 2, unreviewed: 1 });
    for (const [index, entry] of result.cases.entries()) {
      const evidence = JSON.parse(entry.evidenceJson);
      expect(evidence).toEqual(reported.suite.cases[index].evidence);
      expect(review.entries[index].evidence).toEqual(evidence);
      const facts = npRequireAgentModeratorProposalEvaluationEvidenceV1(evidence);
      expect(facts.snapshot?.candidates[0].detector.reportClaims).toEqual({
        unverified: true,
        itemCount: index === 0 ? 5 : 2,
      });
    }
    expect(
      npRequireAgentModeratorProposalEvaluationEvidenceV1(baseline.entries[0].evidence).snapshot
        ?.candidates[0].detector,
    ).not.toHaveProperty("reportClaims");
    const report = await npRequireAgentEvaluationReportV1(JSON.parse(result.reportArtifactJson));
    const row = report.rows.find((entry) => entry.recipe === "moderator-proposal");
    expect(row?.evaluationComparison.result).toMatchObject({
      comparable: false,
      reason: "SUITE_MISMATCH",
    });
    expect(row?.reviewComparison.result).toMatchObject({
      comparable: false,
      reason: "SUITE_MISMATCH",
      matchedCaseKeys: [],
      acceptBasisPointsDelta: null,
    });
    expect(report.fullR6).toBe("not-established");
    const restored = await npBuildAgentEvaluationWorkbenchV1({
      ...input("moderator-proposal"),
      evaluation: reported,
      review,
    });
    expect(restored.reviewArtifactJson).toBe(result.reviewArtifactJson);
    const ungrounded = structuredClone(reviewed[0].response);
    if (ungrounded?.decision.kind !== "propose-capability")
      throw new Error("Missing report proposal fixture");
    ungrounded.decision.arguments.proposal.target.id = "00000000-0000-4000-8000-999999999999";
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...input("moderator-proposal"),
        evaluation: reported,
        labels: [{ ...labels[0], outcome: "edit", editedProposal: ungrounded }],
      }),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...input("moderator-proposal"),
        evaluation: reported,
        review: baseline,
        labels: [],
      }),
    ).rejects.toThrow();
  });

  it("reviews actual report/mixed detector replay and keeps a v1 baseline outside the matched cohort", async () => {
    const evaluation = await runAgentModeratorEvaluationV2();
    const request = { ...input("moderator"), evaluation };
    const initial = await npBuildAgentEvaluationWorkbenchV1(request);
    expect(initial.fixtureGate).toBe("passed");
    expect(initial.cases.every((entry) => entry.caseVersion === 2)).toBe(true);
    for (const [index, entry] of initial.cases.entries()) {
      expect(JSON.parse(entry.evidenceJson)).toEqual(evaluation.cases[index]);
      expect(JSON.parse(entry.predictionJson)).toEqual(evaluation.caseResults[index].signals);
    }
    const index = evaluation.cases.findIndex(
      (entry, index) =>
        entry.observations.some(
          ({ fact }) =>
            fact.evidence.kind === "event" &&
            fact.evidence.eventKind === "community.content.reported",
        ) && initial.cases[index].eligible,
    );
    if (index < 0) throw new Error("Missing eligible report detector fixture");
    const target = initial.cases[index];
    expect(target.allowedOutcomes).toEqual(["confirmed-spam", "false-positive"]);
    const labels = [
      {
        caseId: target.caseId,
        caseHash: target.caseHash,
        predictionHash: target.predictionHash,
        sourceHash: target.sourceHash,
        label: "false-positive",
        reviewer: "offline detector reviewer",
        reviewedAt: "2026-10-14T00:00:00.000Z",
        notes: "Self-reported synthetic review; reports are unverified claims.",
      },
    ];
    const baseline = await npBuildAgentModeratorEvaluationReviewArtifact(sources.moderator);
    const result = await npBuildAgentEvaluationWorkbenchV1({
      ...request,
      labels,
      baseline: structuredClone(baseline.source),
      baselineReview: baseline,
    });
    const artifact = JSON.parse(result.reviewArtifactJson!);
    const report = await npRequireAgentEvaluationReportV1(JSON.parse(result.reportArtifactJson));
    expect(artifact.schemaVersion).toBe("np.agent-moderator-eval-review.v2");
    expect(artifact.source.dataset).toBe("moderator.v2");
    expect(() =>
      npRequireAgentEvaluationWorkbenchResultV1({
        ...result,
        reviewArtifactJson: JSON.stringify({
          ...artifact,
          schemaVersion: "np.agent-moderator-eval-review.v3",
        }),
      }),
    ).toThrow();
    expect(report.input.entries[0].current.review).toEqual(artifact);
    expect(JSON.parse(result.labelsJson!)).toEqual(labels);
    expect(artifact.summary).toMatchObject({ reviewed: 1, falsePositive: 1 });
    expect(report.rows[0].evaluationComparison.result).toMatchObject({
      comparable: false,
      reason: "INCOMPATIBLE_SUITE",
      matchedSignalExpectationsDelta: null,
    });
    expect(report.rows[0].reviewComparison.result).toMatchObject({
      comparable: false,
      reason: "INCOMPATIBLE_SUITE",
      matchedCaseKeys: [],
      confirmedSpamBasisPointsDelta: null,
      falsePositiveBasisPointsDelta: null,
    });
    expect(report.fullR6).toBe("not-established");
    const restored = await npBuildAgentEvaluationWorkbenchV1({ ...request, review: artifact });
    expect(restored.reviewArtifactJson).toBe(result.reviewArtifactJson);
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...request,
        labels: [{ ...labels[0], sourceHash: baseline.sourceHash }],
      }),
    ).rejects.toThrow();
  }, 20_000);

  it("exports a grounded edit and compares accept versus reject on the exact reviewed cohort", async () => {
    const index = publisher.caseResults.findIndex((result) =>
      result.prediction?.proposal?.draft.operations.some(
        (operation) =>
          operation.kind === "document" &&
          operation.operation === "update" &&
          typeof operation.input.patch.seoDescription === "string",
      ),
    );
    if (index < 0) throw new Error("Missing Publisher edit fixture");
    // One reviewed prediction is sufficient for edit and matched-cohort deltas.
    // Other cases retain the three-case failure/unreviewed coverage fixture.
    const source = await rebuild({
      ...publisher,
      suite: { ...publisher.suite, cases: [publisher.suite.cases[index]] },
      caseResults: [publisher.caseResults[index]],
    });
    const request = { ...input("publisher"), evaluation: source };
    const initial = await npBuildAgentEvaluationWorkbenchV1(request);
    const target = initial.cases[0];
    const proposal = structuredClone(source.caseResults[0].prediction?.proposal);
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
      ...request,
      labels: [{ ...binding, outcome: "edit", editedProposal: proposal }],
    });
    const verified = await npRequireAgentEvaluationReviewArtifactV1(
      JSON.parse(edited.reviewArtifactJson!),
    );
    expect(verified.summary.edited).toBe(1);
    expect(verified.labels[0].editedProposal).toEqual(proposal);
    const accepted = await npBuildAgentEvaluationReviewArtifactV1(source, [
      { ...binding, outcome: "accept", editedProposal: null },
    ]);
    const rejected = await npBuildAgentEvaluationWorkbenchV1({
      ...request,
      baseline: structuredClone(source),
      baselineReview: accepted,
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
    const review = structuredClone(emptyPublisherReview);
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
    const review = structuredClone(emptyPublisherReview);
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
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...input("operator"), evaluation: diagnosis }),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...input("publisher"), baselineReview: review }),
    ).rejects.toThrow();
  });
});
