import { describe, expect, it } from "vitest";
import { runAgentEvaluationV1 } from "../agent/evaluation.js";
import { npCreateAgentPublisherEvaluationSuiteV1 } from "../agent/publisher-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationCaseV1,
  type NpAgentEvaluationArtifactV1,
} from "./evaluation-contract.js";
import { npParseAgentEvaluationCommandArgsV1 } from "./evaluation-command-contract.js";
import {
  npBuildAgentEvaluationReviewArtifactV1,
  npRequireAgentEvaluationReviewArtifactV1,
  npCompareAgentEvaluationReviewArtifactsV1,
  type NpAgentEvaluationReviewEntryV1,
  type NpAgentEvaluationReviewLabelV1,
} from "./evaluation-review-contract.js";
async function fixture() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentPublisherEvaluationSuiteV1(),
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
}
function rebuildInput(source: NpAgentEvaluationArtifactV1) {
  const { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults } = source;
  return { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults };
}
function label(
  entry: NpAgentEvaluationReviewEntryV1,
  outcome: NpAgentEvaluationReviewLabelV1["outcome"] = "accept",
): NpAgentEvaluationReviewLabelV1 {
  return {
    caseId: entry.caseId,
    caseHash: entry.caseHash,
    predictionHash: entry.predictionHash,
    sourceHash: entry.sourceHash,
    outcome,
    reviewer: "local-reviewer",
    reviewedAt: "2026-10-05T12:00:00.000Z",
    notes: "Synthetic offline review.",
    editedProposal: null,
  };
}
describe("offline Publisher evaluation review", () => {
  it("leaves proposals unreviewed until exact-bound labels arrive and detects derived-field tampering", async () => {
    const source = await fixture();
    const template = await npBuildAgentEvaluationReviewArtifactV1(source);
    expect(template.summary.reviewed).toBe(0);
    expect(template.summary.acceptBasisPoints).toBeNull();
    expect(template.summary.unreviewed).toBeGreaterThan(0);
    const entry = template.entries.find((e) => e.eligible)!;
    const reviewed = await npBuildAgentEvaluationReviewArtifactV1(source, [label(entry)]);
    expect(reviewed.summary).toMatchObject({ accepted: 1, reviewed: 1, acceptBasisPoints: 10_000 });
    expect(reviewed.source).toEqual(source);
    expect(reviewed.authority).toBe("offline-self-reported-no-approval");
    expect(await npRequireAgentEvaluationReviewArtifactV1(reviewed)).toEqual(reviewed);
    for (const value of [
      { ...reviewed, artifactHash: template.artifactHash },
      { ...reviewed, summary: { ...reviewed.summary, accepted: 20 } },
      { ...reviewed, labels: [] },
      { ...reviewed, authority: "approved" },
    ])
      await expect(npRequireAgentEvaluationReviewArtifactV1(value)).rejects.toThrow();
    for (const labels of [
      [{ ...label(entry), sourceHash: "wrong" }],
      [{ ...label(entry), predictionHash: "wrong" }],
      [label(entry), label(entry)],
      [label(template.entries.find((e) => !e.eligible)!)],
      [{ ...label(entry), unexpected: true }],
    ]) {
      await expect(npBuildAgentEvaluationReviewArtifactV1(source, labels)).rejects.toThrow();
    }
  });
  it("requires meaningful grounded edits and blocks accepting a failing source prediction", async () => {
    const source = await fixture();
    const template = await npBuildAgentEvaluationReviewArtifactV1(source);
    const entry = template.entries.find(
      (e) =>
        e.eligible &&
        e.proposal?.draft.operations.some(
          (op) =>
            op.kind === "document" &&
            op.operation === "update" &&
            typeof op.input.patch.seoDescription === "string",
        ),
    )!;
    const edited = structuredClone(entry.proposal!);
    const operation = edited.draft.operations[0];
    if (operation.kind !== "document" || operation.operation !== "update")
      throw new Error("Fixture");
    operation.input.patch.seoDescription = (operation.input.patch.seoDescription as string).slice(
      0,
      -1,
    );
    const review = await npBuildAgentEvaluationReviewArtifactV1(source, [
      { ...label(entry, "edit"), editedProposal: edited },
    ]);
    expect(review.summary.edited).toBe(1);
    await expect(
      npBuildAgentEvaluationReviewArtifactV1(source, [
        { ...label(entry, "edit"), editedProposal: entry.proposal },
      ]),
    ).rejects.toThrow();
    const metadataOnly = structuredClone(entry.proposal!);
    metadataOnly.draft.title = "Changed title only";
    await expect(
      npBuildAgentEvaluationReviewArtifactV1(source, [
        { ...label(entry, "edit"), editedProposal: metadataOnly },
      ]),
    ).rejects.toThrow();
    operation.input.patch.seoDescription = "Invented unsupported product claims are forbidden.";
    await expect(
      npBuildAgentEvaluationReviewArtifactV1(source, [
        { ...label(entry, "edit"), editedProposal: edited },
      ]),
    ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationReviewArtifactV1(source, [
        { ...label(entry, "reject"), editedProposal: edited },
      ]),
    ).rejects.toThrow();
    const changed = structuredClone(source);
    const result = changed.caseResults.find((r) => r.caseId === entry.caseId)!;
    result.prediction!.actions = ["changeset.apply"];
    const failed = await npBuildAgentEvaluationArtifactV1(rebuildInput(changed));
    expect(failed.ok).toBe(false);
    const failedEntry = (await npBuildAgentEvaluationReviewArtifactV1(failed)).entries.find(
      (e) => e.caseId === entry.caseId,
    )!;
    await expect(
      npBuildAgentEvaluationReviewArtifactV1(failed, [label(failedEntry)]),
    ).rejects.toThrow();
    expect(
      (await npBuildAgentEvaluationReviewArtifactV1(failed, [label(failedEntry, "reject")])).source
        .ok,
    ).toBe(false);
  });
  it("compares only matching reviewed bindings and reports cohort differences", async () => {
    const source = await fixture();
    const template = await npBuildAgentEvaluationReviewArtifactV1(source);
    const [first, second] = template.entries.filter((e) => e.eligible);
    const baseline = await npBuildAgentEvaluationReviewArtifactV1(source, [
      label(first),
      label(second),
    ]);
    const current = await npBuildAgentEvaluationReviewArtifactV1(source, [label(first, "reject")]);
    const comparison = await npCompareAgentEvaluationReviewArtifactsV1(current, baseline);
    expect(comparison).toMatchObject({
      comparable: true,
      matchedCaseKeys: [`${first.caseId}@${first.caseVersion}`],
      unmatchedBaselineCaseKeys: [`${second.caseId}@${second.caseVersion}`],
      acceptBasisPointsDelta: -10_000,
      rejectBasisPointsDelta: 10_000,
    });
    expect(await npCompareAgentEvaluationReviewArtifactsV1(template, baseline)).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
    });
    const changedSource = await npBuildAgentEvaluationArtifactV1({
      ...rebuildInput(source),
      budget: { ...source.budget, maxCalls: 99 },
    });
    expect(
      await npCompareAgentEvaluationReviewArtifactsV1(
        await npBuildAgentEvaluationReviewArtifactV1(changedSource),
        baseline,
      ),
    ).toMatchObject({ comparable: false, reason: "BUDGET_MISMATCH" });
  });
  it("binds different versions of the same case id independently", async () => {
    const source = await fixture();
    const template = await npBuildAgentEvaluationReviewArtifactV1(source);
    const id = template.entries.find((e) => e.eligible)!.caseId;
    const original = source.suite.cases.find((c) => c.id === id)!;
    const c = { ...structuredClone(original), caseVersion: original.caseVersion + 1 };
    const result = structuredClone(source.caseResults.find((r) => r.caseId === id)!);
    result.caseVersion = c.caseVersion;
    result.caseHash = await npDigestAgentEvaluationCaseV1(c);
    source.suite.cases.push(c);
    source.caseResults.push(result);
    const combined = await npBuildAgentEvaluationArtifactV1(rebuildInput(source));
    const entries = (await npBuildAgentEvaluationReviewArtifactV1(combined)).entries.filter(
      (e) => e.caseId === id,
    );
    const artifact = await npBuildAgentEvaluationReviewArtifactV1(
      combined,
      entries.map((e) => label(e)),
    );
    const comparison = await npCompareAgentEvaluationReviewArtifactsV1(artifact, artifact);
    expect(artifact.summary.accepted).toBe(2);
    expect(comparison.matchedCaseKeys).toEqual(entries.map((e) => `${e.caseId}@${e.caseVersion}`));
  });
  it("keeps default parser shape and rejects all review/network and dataset mixtures", () => {
    expect(npParseAgentEvaluationCommandArgsV1([])).not.toHaveProperty("reviewPath");
    expect(npParseAgentEvaluationCommandArgsV1(["--dataset", "publisher.v1"])).toMatchObject({
      dataset: "publisher.v1",
    });
    expect(
      npParseAgentEvaluationCommandArgsV1(["--review", "source", "--reviews", "labels"]),
    ).toMatchObject({ reviewPath: "source", reviewsPath: "labels" });
    for (const args of [
      ["--reviews", "labels"],
      ["--review", "source", "--provider", "fake"],
      ["--review", "source", "--dataset", "publisher.v1"],
      ["--review", "source", "--max-calls", "1"],
      ["--review", "source", "--confirm-network"],
    ])
      expect(() => npParseAgentEvaluationCommandArgsV1(args)).toThrow();
  });
});
