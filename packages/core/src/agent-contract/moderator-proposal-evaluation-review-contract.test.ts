import { beforeAll, describe, expect, it } from "vitest";
import { runAgentEvaluationV1 } from "../agent/evaluation.js";
import { npCreateAgentModeratorProposalEvaluationSuiteV1 } from "../agent/moderator-proposal-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  type NpAgentEvaluationArtifactV1,
} from "./evaluation-contract.js";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
  npCompareAgentModeratorProposalEvaluationReviewArtifactsV1,
  type NpAgentModeratorProposalEvaluationReviewEntryV1,
  type NpAgentModeratorProposalEvaluationReviewLabelV1,
} from "./moderator-proposal-evaluation-review-contract.js";

let source: NpAgentEvaluationArtifactV1;
beforeAll(async () => {
  source = await runAgentEvaluationV1({
    suite: await npCreateAgentModeratorProposalEvaluationSuiteV1(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget: {
      maxCalls: 100,
      maxInputTokens: 100_000,
      maxOutputTokens: 100_000,
      maxCostMicros: 0,
      timeoutMs: 5000,
    },
  });
});
function rebuild(value: NpAgentEvaluationArtifactV1) {
  const { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults } = value;
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
}
function label(
  entry: NpAgentModeratorProposalEvaluationReviewEntryV1,
  outcome: NpAgentModeratorProposalEvaluationReviewLabelV1["outcome"] = "accept",
): NpAgentModeratorProposalEvaluationReviewLabelV1 {
  return {
    caseId: entry.caseId,
    caseHash: entry.caseHash,
    predictionHash: entry.predictionHash,
    sourceHash: entry.sourceHash,
    outcome,
    reviewer: "local-reviewer",
    reviewedAt: "2026-10-08T00:00:00.000Z",
    notes: "Synthetic evidence review.",
    editedProposal: null,
  };
}
describe("offline Moderator response review", () => {
  it("includes parsed abstentions, binds every label and independently recomputes reviews", async () => {
    const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source);
    expect(template.summary).toMatchObject({ reviewed: 0, acceptBasisPoints: null });
    const abstention = template.entries.find((e) => e.response?.decision.kind === "complete")!;
    expect(abstention.eligible).toBe(true);
    const reviewed = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
      label(abstention),
    ]);
    expect(reviewed.summary).toMatchObject({ accepted: 1, acceptBasisPoints: 10_000 });
    expect(reviewed.authority).toBe("offline-self-reported-no-approval");
    expect(reviewed.source).toEqual(source);
    expect(await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(reviewed)).toEqual(
      reviewed,
    );
    for (const invalid of [
      [{ ...label(abstention), sourceHash: "wrong" }],
      [{ ...label(abstention), predictionHash: "wrong" }],
      [{ ...label(abstention), caseHash: "wrong" }],
      [label(abstention), label(abstention)],
      [{ ...label(abstention), reviewer: " " }],
      [{ ...label(abstention), unexpected: true }],
    ])
      await expect(
        npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, invalid),
      ).rejects.toThrow();
    for (const invalid of [
      { ...reviewed, summary: { ...reviewed.summary, accepted: 100 } },
      { ...reviewed, labels: [] },
      { ...reviewed, authority: "approved" },
    ])
      await expect(
        npRequireAgentModeratorProposalEvaluationReviewArtifactV1(invalid),
      ).rejects.toThrow();
  });
  it("requires a meaningful grounded edit and permits a reviewer to abstain on a proposal", async () => {
    const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source);
    const proposal = template.entries.find(
      (e) => e.response?.decision.kind === "propose-capability",
    )!;
    await expect(
      npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
        { ...label(proposal, "edit"), editedProposal: proposal.response },
      ]),
    ).rejects.toThrow();
    const metadataOnly = structuredClone(proposal.response!);
    if (metadataOnly.decision.kind !== "propose-capability")
      throw new Error("Expected proposal fixture");
    metadataOnly.decision.rationale = "Reworded offline rationale.";
    await expect(
      npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
        { ...label(proposal, "edit"), editedProposal: metadataOnly },
      ]),
    ).rejects.toThrow();
    const edited = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
      {
        ...label(proposal, "edit"),
        editedProposal: {
          task: "interactive-capability",
          decision: {
            kind: "complete",
            summary: "Evidence remains uncertain; no action proposed.",
          },
        },
      },
    ]);
    expect(edited.summary.edited).toBe(1);
    expect(edited.source).toEqual(source);
    const invented = structuredClone(proposal.response!);
    if (invented.decision.kind !== "propose-capability")
      throw new Error("Expected proposal fixture");
    invented.decision.arguments.proposal.incidentId = "00000000-0000-4000-8000-000000000099";
    await expect(
      npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
        { ...label(proposal, "edit"), editedProposal: invented },
      ]),
    ).rejects.toThrow();
    await expect(
      npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
        { ...label(proposal, "reject"), editedProposal: proposal.response },
      ]),
    ).rejects.toThrow();
  });
  it("prevents accepting unsafe or failed cases while preserving reject and repair judgments", async () => {
    const changed = structuredClone(source);
    const index = changed.caseResults.findIndex(
      (r) => r.prediction?.moderatorResponse?.decision.kind === "propose-capability",
    );
    const response = changed.caseResults[index].prediction!.moderatorResponse!;
    if (response.decision.kind !== "propose-capability")
      throw new Error("Expected proposal fixture");
    response.decision.arguments.proposal.incidentId = "00000000-0000-4000-8000-000000000099";
    const invalidSource = await rebuild(changed);
    const entry = (await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(invalidSource))
      .entries[index];
    expect(entry.eligible).toBe(true);
    expect(invalidSource.ok).toBe(false);
    await expect(
      npBuildAgentModeratorProposalEvaluationReviewArtifactV1(invalidSource, [label(entry)]),
    ).rejects.toThrow();
    const repaired = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(invalidSource, [
      {
        ...label(entry, "edit"),
        editedProposal: source.caseResults[index].prediction!.moderatorResponse!,
      },
    ]);
    expect(repaired.summary.edited).toBe(1);
    expect(repaired.source.ok).toBe(false);
    expect(
      (
        await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(invalidSource, [
          label(entry, "reject"),
        ])
      ).summary.rejected,
    ).toBe(1);
    const failed = structuredClone(source);
    failed.caseResults[index].prediction = null;
    failed.caseResults[index].error = "STRUCTURED_OUTPUT_INVALID";
    const failedSource = await rebuild(failed);
    const failedEntry = (
      await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(failedSource)
    ).entries[index];
    expect(failedEntry.eligible).toBe(false);
    await expect(
      npBuildAgentModeratorProposalEvaluationReviewArtifactV1(failedSource, [
        label(failedEntry, "reject"),
      ]),
    ).rejects.toThrow();
  });
  it("compares only reviewed matching case and prediction cohorts", async () => {
    const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source);
    const [first, second] = template.entries.filter((e) => e.eligible);
    const baseline = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
      label(first),
      label(second),
    ]);
    const current = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(source, [
      label(first, "reject"),
    ]);
    expect(
      await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(current, baseline),
    ).toMatchObject({
      comparable: true,
      matchedCaseKeys: [`${first.caseId}@${first.caseVersion}`],
      unmatchedBaselineCaseKeys: [`${second.caseId}@${second.caseVersion}`],
      acceptBasisPointsDelta: -10_000,
      rejectBasisPointsDelta: 10_000,
    });
    expect(
      await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(template, baseline),
    ).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
    });
    const differentPrediction = structuredClone(source);
    const response = differentPrediction.caseResults[0].prediction!.moderatorResponse!;
    if (response.decision.kind === "propose-capability")
      response.decision.rationale = "Different wording binds a different prediction.";
    else response.decision.summary = "Different wording binds a different prediction.";
    const differentSource = await rebuild(differentPrediction);
    const differentEntry = (
      await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(differentSource)
    ).entries[0];
    const differentReview = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(
      differentSource,
      [label(differentEntry, "reject")],
    );
    expect(
      await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(differentReview, current),
    ).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
      matchedCaseKeys: [],
      unmatchedCurrentCaseKeys: [`${first.caseId}@${first.caseVersion}`],
    });
    const changed = structuredClone(source);
    changed.budget.maxCalls -= 1;
    const other = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(
      await rebuild(changed),
    );
    expect(
      await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(other, baseline),
    ).toMatchObject({
      comparable: false,
      reason: "BUDGET_MISMATCH",
    });
  });
});
