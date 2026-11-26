import { describe, expect, it } from "vitest";
import {
  npAgentOperatorPlanEvaluationProposalMeaningfulValueV1,
  npEvaluateAgentOperatorPlanProposalV1,
} from "./operator-plan-evaluation-contract.js";
import { runAgentEvaluationV1 } from "../agent/evaluation.js";
import { npCreateAgentOperatorPlanEvaluationSuiteV1 } from "../agent/operator-plan-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationCaseV1,
  type NpAgentEvaluationArtifactV1,
} from "./evaluation-contract.js";
import {
  npBuildAgentOperatorPlanEvaluationReviewArtifactV1,
  npRequireAgentOperatorPlanEvaluationReviewArtifactV1,
  npCompareAgentOperatorPlanEvaluationReviewArtifactsV1,
  type NpAgentOperatorPlanEvaluationReviewEntryV1,
  type NpAgentOperatorPlanEvaluationReviewLabelV1,
} from "./operator-plan-evaluation-review-contract.js";
async function fixture() {
  return runAgentEvaluationV1({
    suite: await npCreateAgentOperatorPlanEvaluationSuiteV1(),
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
  entry: NpAgentOperatorPlanEvaluationReviewEntryV1,
  outcome: NpAgentOperatorPlanEvaluationReviewLabelV1["outcome"] = "accept",
): NpAgentOperatorPlanEvaluationReviewLabelV1 {
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
describe("offline Operator plan evaluation review", () => {
  it("leaves proposals unreviewed until exact-bound labels arrive and detects derived-field tampering", async () => {
    const source = await fixture();
    const template = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source);
    expect(template.summary.reviewed).toBe(0);
    expect(template.summary.acceptBasisPoints).toBeNull();
    expect(template.summary.unreviewed).toBeGreaterThan(0);
    const entry = template.entries.find((e) => e.eligible)!;
    const missing = structuredClone(source);
    missing.caseResults[0].prediction!.planProposal = null;
    const missingSource = await npBuildAgentEvaluationArtifactV1(rebuildInput(missing));
    const missingTemplate = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(missingSource);
    expect(missingTemplate.entries[0].eligible).toBe(false);
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(missingSource, [
        label(missingTemplate.entries[0], "reject"),
      ]),
    ).rejects.toThrow();
    const reviewed = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
      label(entry),
    ]);
    expect(reviewed.summary).toMatchObject({ accepted: 1, reviewed: 1, acceptBasisPoints: 10_000 });
    expect(reviewed.source).toEqual(source);
    expect(reviewed.authority).toBe("offline-self-reported-no-approval");
    expect(await npRequireAgentOperatorPlanEvaluationReviewArtifactV1(reviewed)).toEqual(reviewed);
    for (const value of [
      { ...reviewed, artifactHash: template.artifactHash },
      { ...reviewed, summary: { ...reviewed.summary, accepted: 20 } },
      { ...reviewed, labels: [] },
      { ...reviewed, authority: "approved" },
    ])
      await expect(npRequireAgentOperatorPlanEvaluationReviewArtifactV1(value)).rejects.toThrow();
    for (const labels of [
      [{ ...label(entry), sourceHash: "wrong" }],
      [{ ...label(entry), predictionHash: "wrong" }],
      [label(entry), label(entry)],
      [{ ...label(entry), unexpected: true }],
      [{ ...label(entry), caseHash: "wrong" }],
      [{ ...label(entry), reviewer: "  " }],
      [{ ...label(entry), reviewedAt: "2026-10-05" }],
      [{ ...label(entry), notes: "x".repeat(2001) }],
    ]) {
      await expect(
        npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, labels),
      ).rejects.toThrow();
    }
  });
  it("reviews diagnosis-only proposals and requires substantive grounded repairs", async () => {
    const source = await fixture();
    const template = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source);
    const entry = template.entries.find((e) => e.eligible && e.proposal?.plan === null)!;
    expect(
      (await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [label(entry)])).summary
        .accepted,
    ).toBe(1);
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
        { ...label(entry, "edit"), editedProposal: entry.proposal },
      ]),
    ).rejects.toThrow();

    const changed = structuredClone(source);
    const result = changed.caseResults.find((r) => r.caseId === entry.caseId)!;
    result.prediction!.planProposal!.diagnosis.kind =
      entry.proposal!.diagnosis.kind === "normal" ? "unknown" : "normal";
    const failed = await npBuildAgentEvaluationArtifactV1(rebuildInput(changed));
    expect(failed.ok).toBe(false);
    const failedEntry = (
      await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failed)
    ).entries.find((e) => e.caseId === entry.caseId)!;
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failed, [label(failedEntry)]),
    ).rejects.toThrow();
    const repaired = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failed, [
      { ...label(failedEntry, "edit"), editedProposal: entry.proposal },
    ]);
    expect(repaired.summary.edited).toBe(1);
    expect(repaired.source.ok).toBe(false);
    // Repairing a false claim or wrong evidence reference is meaningful even
    // when the diagnosis kind and requested operation do not change.
    for (const corrupt of ["summary", "evidence"] as const) {
      const changed = structuredClone(source);
      const proposal = changed.caseResults.find((r) => r.caseId === entry.caseId)!.prediction!
        .planProposal!;
      if (corrupt === "summary") proposal.diagnosis.summary = "Workers are dead.";
      else proposal.evidenceIds = ["invented-snapshot"];
      const invalid = await npBuildAgentEvaluationArtifactV1(rebuildInput(changed));
      const invalidEntry = (
        await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(invalid)
      ).entries.find((e) => e.caseId === entry.caseId)!;
      const fixed = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(invalid, [
        { ...label(invalidEntry, "edit"), editedProposal: entry.proposal },
      ]);
      expect(fixed.summary.edited).toBe(1);
      expect(fixed.source.ok).toBe(false);
    }
    expect(
      (
        await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failed, [
          label(failedEntry, "reject"),
        ])
      ).summary.rejected,
    ).toBe(1);
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
        { ...label(entry, "edit"), editedProposal: failedEntry.proposal },
      ]),
    ).rejects.toThrow();
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
        { ...label(entry, "reject"), editedProposal: entry.proposal },
      ]),
    ).rejects.toThrow();

    const planEntry = template.entries.find((e) => e.proposal?.plan)!;
    const metadataOnly = structuredClone(planEntry.proposal!);
    metadataOnly.diagnosis.summary = metadataOnly.diagnosis.summary.replace(
      / (?:A single snapshot does not establish progress or worker failure\.|단일 관측은 진행률이나 작업자 장애를 증명하지 않습니다\.)$/,
      "",
    );
    expect(metadataOnly.diagnosis.summary).not.toBe(planEntry.proposal!.diagnosis.summary);
    expect(npEvaluateAgentOperatorPlanProposalV1(planEntry.evidence, metadataOnly)).toEqual([]);
    expect(npAgentOperatorPlanEvaluationProposalMeaningfulValueV1(metadataOnly)).toEqual(
      npAgentOperatorPlanEvaluationProposalMeaningfulValueV1(planEntry.proposal),
    );
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
        { ...label(planEntry, "edit"), editedProposal: metadataOnly },
      ]),
    ).rejects.toThrow();
    const forbidden = structuredClone(source);
    forbidden.caseResults.find((r) => r.caseId === planEntry.caseId)!.prediction!.actions = [
      "ops.execute",
    ];
    const unsafeSource = await npBuildAgentEvaluationArtifactV1(rebuildInput(forbidden));
    const unsafeEntry = (
      await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(unsafeSource)
    ).entries.find((e) => e.caseId === planEntry.caseId)!;
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(unsafeSource, [label(unsafeEntry)]),
    ).rejects.toThrow();
  });
  it("compares only matching reviewed bindings and reports cohort differences", async () => {
    const source = await fixture();
    const template = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source);
    const [first, second] = template.entries.filter((e) => e.eligible);
    const baseline = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
      label(first),
      label(second),
    ]);
    const current = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source, [
      label(first, "reject"),
    ]);
    const comparison = await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(
      current,
      baseline,
    );
    expect(comparison).toMatchObject({
      comparable: true,
      matchedCaseKeys: [`${first.caseId}@${first.caseVersion}`],
      unmatchedBaselineCaseKeys: [`${second.caseId}@${second.caseVersion}`],
      acceptBasisPointsDelta: -10_000,
      rejectBasisPointsDelta: 10_000,
    });
    expect(
      await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(template, baseline),
    ).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
    });
    const changedPrediction = structuredClone(source);
    changedPrediction.caseResults.find(
      (r) => r.caseId === first.caseId,
    )!.prediction!.planProposal!.diagnosis.summary = "Changed prediction.";
    const otherSource = await npBuildAgentEvaluationArtifactV1(rebuildInput(changedPrediction));
    const otherTemplate = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(otherSource);
    const otherEntry = otherTemplate.entries.find((e) => e.caseId === first.caseId)!;
    const otherReview = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(otherSource, [
      label(otherEntry, "reject"),
    ]);
    expect(
      await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(otherReview, current),
    ).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
      matchedCaseKeys: [],
      unmatchedCurrentCaseKeys: [`${first.caseId}@${first.caseVersion}`],
    });
    const changedSource = await npBuildAgentEvaluationArtifactV1({
      ...rebuildInput(source),
      budget: { ...source.budget, maxCalls: 99 },
    });
    expect(
      await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(
        await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(changedSource),
        baseline,
      ),
    ).toMatchObject({ comparable: false, reason: "BUDGET_MISMATCH" });
  });
  it("binds different versions of the same case id independently", async () => {
    const source = await fixture();
    const template = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(source);
    const id = template.entries.find((e) => e.eligible)!.caseId;
    const original = source.suite.cases.find((c) => c.id === id)!;
    const c = { ...structuredClone(original), caseVersion: original.caseVersion + 1 };
    const result = structuredClone(source.caseResults.find((r) => r.caseId === id)!);
    result.caseVersion = c.caseVersion;
    result.caseHash = await npDigestAgentEvaluationCaseV1(c);
    source.suite.cases.push(c);
    source.caseResults.push(result);
    const combined = await npBuildAgentEvaluationArtifactV1(rebuildInput(source));
    const entries = (
      await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(combined)
    ).entries.filter((e) => e.caseId === id);
    const artifact = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(
      combined,
      entries.map((e) => label(e)),
    );
    const comparison = await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(
      artifact,
      artifact,
    );
    expect(artifact.summary.accepted).toBe(2);
    expect(comparison.matchedCaseKeys).toEqual(entries.map((e) => `${e.caseId}@${e.caseVersion}`));
    result.prediction!.actions = ["ops.execute"];
    const failedVersion = await npBuildAgentEvaluationArtifactV1(rebuildInput(source));
    const versions = (
      await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failedVersion)
    ).entries.filter((e) => e.caseId === id);
    expect(
      (
        await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failedVersion, [
          label(versions[0]),
        ])
      ).summary.accepted,
    ).toBe(1);
    await expect(
      npBuildAgentOperatorPlanEvaluationReviewArtifactV1(failedVersion, [label(versions[1])]),
    ).rejects.toThrow();
  });
});
