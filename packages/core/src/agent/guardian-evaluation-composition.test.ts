import { beforeAll, describe, expect, it, vi } from "vitest";
import { runAgentGuardianEvaluationV1 } from "./guardian-evaluation.js";
import {
  npBuildAgentEvaluationReportV1,
  npRequireAgentEvaluationReportV1,
} from "./evaluation-report.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import {
  npBuildAgentGuardianEvaluationArtifactV1,
  npDigestAgentGuardianEvaluationValueV1,
  type NpAgentGuardianEvaluationArtifactV1,
} from "../agent-contract/guardian-evaluation-contract.js";
import {
  npBuildAgentGuardianEvaluationReviewArtifactV1,
  npRequireAgentGuardianEvaluationReviewArtifactV1,
  npCompareAgentGuardianEvaluationReviewArtifactsV1,
  type NpAgentGuardianEvaluationReviewEntryV1,
} from "../agent-contract/guardian-evaluation-review-contract.js";
import { npRequireAgentEvaluationWorkbenchResultV1 } from "../agent-contract/evaluation-workbench-contract.js";
import { npRequireAgentEvaluationHistorySaveV1 } from "../agent-contract/evaluation-history-contract.js";
import { npFormatAgentEvaluationReportV1 } from "../agent-contract/evaluation-report-contract.js";
import { npParseAgentEvaluationCommandArgsV1 } from "../agent-contract/evaluation-command-contract.js";

let source: NpAgentGuardianEvaluationArtifactV1;
beforeAll(async () => {
  source = await runAgentGuardianEvaluationV1();
});
const request = () => ({
  schemaVersion: "np.agent-eval-workbench-request.v1",
  recipe: "guardian",
  evaluation: source,
  review: null,
  baseline: null,
  baselineReview: null,
  labels: null,
});
const label = (
  entry: NpAgentGuardianEvaluationReviewEntryV1,
  outcome: "accept" | "reject" = "accept",
) => ({
  caseId: entry.caseId,
  caseHash: entry.caseHash,
  predictionHash: entry.predictionHash,
  sourceHash: entry.sourceHash,
  outcome,
  reviewer: "offline synthetic reviewer",
  reviewedAt: "2026-10-18T00:00:00.000Z",
  notes: "Synthetic prediction support only.",
  editedProposal: null,
});
describe("Guardian evaluation report, review and workbench integration", () => {
  // These compositions repeatedly validate all 64 cases and their review hashes.
  it("keeps legacy report bytes stable when Guardian is absent and separates Guardian limitations when present", async () => {
    const legacy = await npBuildAgentEvaluationReportV1({
      schemaVersion: "np.agent-eval-report-input.v1",
      entries: [],
    });
    expect(legacy.rows.map((row) => row.recipe)).toEqual([
      "moderator",
      "moderator-proposal",
      "operator",
      "publisher",
    ]);
    expect(JSON.stringify(legacy)).not.toContain("Guardian");
    expect(await npRequireAgentEvaluationReportV1(legacy)).toEqual(legacy);
    const report = await npBuildAgentEvaluationReportV1({
      schemaVersion: "np.agent-eval-report-input.v1",
      entries: [
        {
          recipe: "guardian",
          current: { evaluation: source, review: null },
          baseline: { evaluation: structuredClone(source), review: null },
        },
      ],
    });
    const row = report.rows.find((row) => row.recipe === "guardian");
    expect(row).toMatchObject({
      mode: "deterministic-offline",
      fixtureGate: "passed",
      cases: 64,
      metrics: source.summary,
      review: {
        status: "missing",
        summary: { reviewed: 0, unreviewed: 64, supported: 0, unsupported: 0 },
      },
      evaluationComparison: { result: { comparable: true, matchedCasesDelta: 0 } },
    });
    expect(report).toMatchObject({ fullR6: "not-established", modelUsefulness: "not-established" });
    expect(report.limitations.at(-1)).toContain("not production rule replay");
    const text = npFormatAgentEvaluationReportV1(report);
    expect(text).toContain("Guardian synthetic reference");
    expect(text).toContain(`requiredLiveChecksNotRun=${source.summary.liveChecks.notRun}`);
    expect(text).not.toContain("precisionBasisPoints=");
    expect(await npRequireAgentEvaluationReportV1(report)).toEqual(report);
  }, 20_000);

  it("round trips exact source/case/prediction review bindings without rates, edits or approval", async () => {
    const empty = await npBuildAgentGuardianEvaluationReviewArtifactV1(source);
    expect(empty.sourceHash).toBe(await npDigestAgentGuardianEvaluationValueV1(source));
    const labels = [label(empty.entries[0]), label(empty.entries[1], "reject")];
    const review = await npBuildAgentGuardianEvaluationReviewArtifactV1(source, labels);
    expect(review.authority).toBe("offline-self-reported-no-approval");
    expect(review.summary).toEqual({
      eligible: 64,
      ineligible: 0,
      reviewed: 2,
      unreviewed: 62,
      supported: 1,
      unsupported: 1,
    });
    expect(
      await npRequireAgentGuardianEvaluationReviewArtifactV1(JSON.parse(JSON.stringify(review))),
    ).toEqual(review);
    for (const patch of [
      { sourceHash: `cj1:sha256:${"A".repeat(43)}` },
      { caseHash: `cj1:sha256:${"A".repeat(43)}` },
      { predictionHash: `cj1:sha256:${"A".repeat(43)}` },
      { caseId: "foreign-case" },
      { editedProposal: {} },
      { outcome: "edit" },
      { outcome: "approve" },
      { authority: "approved" },
    ])
      await expect(
        npBuildAgentGuardianEvaluationReviewArtifactV1(source, [{ ...labels[0], ...patch }]),
      ).rejects.toThrow();
    await expect(
      npBuildAgentGuardianEvaluationReviewArtifactV1(source, [labels[0], labels[0]]),
    ).rejects.toThrow();
    const forged = structuredClone(review);
    forged.summary.supported = 999;
    await expect(npRequireAgentGuardianEvaluationReviewArtifactV1(forged)).rejects.toThrow();
    expect(await npCompareAgentGuardianEvaluationReviewArtifactsV1(review, review)).toMatchObject({
      comparable: true,
      matchedCaseKeys: expect.any(Array),
      current: { eligible: 2, reviewed: 2, unreviewed: 0, supported: 1, unsupported: 1 },
    });
    expect(await npCompareAgentGuardianEvaluationReviewArtifactsV1(empty, empty)).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEWED_CASES",
      current: null,
      baseline: null,
    });
  }, 20_000);

  it("exports safe workbench and authenticated-history input with unreviewed coverage and all live checks still not run", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    try {
      const initial = await npBuildAgentEvaluationWorkbenchV1(request());
      expect(initial).toMatchObject({
        recipe: "guardian",
        mode: "deterministic-offline",
        authority: "offline-self-reported-no-approval",
        reviewArtifactJson: null,
      });
      expect(initial.cases).toHaveLength(64);
      expect(initial.cases[0].allowedOutcomes).toEqual(["accept", "reject"]);
      expect(JSON.parse(initial.cases[0].scoreJson)).toMatchObject({
        predictionBasis: "synthetic-reference",
        productionRuleReplay: "not-run",
        productionPrecision: "not-established",
        modelUsefulness: "not-established",
        enablement: "not-established",
      });
      const target = initial.cases[0];
      expect(
        npRequireAgentEvaluationHistorySaveV1({
          schemaVersion: "np.agent-evaluation-history-save.v1",
          recipe: "guardian",
          evaluationJson: JSON.stringify(source),
          sourceHash: initial.sourceHash,
          expectedVersion: 0,
          caseId: target.caseId,
          caseVersion: target.caseVersion,
          caseHash: target.caseHash,
          predictionHash: target.predictionHash,
          decision: {
            outcome: "accept",
            notes: "Synthetic support only",
            editedProposalJson: null,
          },
          idempotencyKey: "guardian-review",
        }).recipe,
      ).toBe("guardian");
      const forged = structuredClone(initial);
      forged.cases[0].allowedOutcomes.push("edit");
      expect(() => npRequireAgentEvaluationWorkbenchResultV1(forged)).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  }, 20_000);

  it("round trips reviewed labels through workbench import without network or approval", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    try {
      const coverage = await npBuildAgentGuardianEvaluationReviewArtifactV1(source);
      const labels = [label(coverage.entries[0])];
      const reviewed = await npBuildAgentEvaluationWorkbenchV1({ ...request(), labels });
      expect(JSON.parse(reviewed.labelsJson!)).toEqual(labels);
      expect(npRequireAgentEvaluationWorkbenchResultV1(reviewed)).toEqual(reviewed);
      const imported = await npBuildAgentEvaluationWorkbenchV1({
        ...request(),
        review: JSON.parse(reviewed.reviewArtifactJson!),
        labels: null,
      });
      expect(imported).toEqual(reviewed);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  }, 20_000);

  it("retains failed and missing predictions honestly and rejects accepting failed synthetic conformance", async () => {
    const predictions = source.caseResults.map((entry) => structuredClone(entry.prediction));
    predictions[0] = null;
    const changed = predictions.findIndex(
      (entry, index) => index > 0 && entry && entry.detectorIds.length > 0,
    );
    const changedPrediction = predictions[changed];
    if (!changedPrediction) throw new Error("Expected source prediction");
    changedPrediction.detectorIds = [];
    const failed = await npBuildAgentGuardianEvaluationArtifactV1({
      corpus: source.corpus,
      profiles: source.profiles,
      predictions,
    });
    const review = await npBuildAgentGuardianEvaluationReviewArtifactV1(failed);
    expect(review.entries[0].eligible).toBe(false);
    expect(review.summary).toMatchObject({ eligible: 63, ineligible: 1, unreviewed: 63 });
    const mismatched = failed.caseResults.findIndex(
      (entry, index) => index > 0 && entry.violations.length > 0,
    );
    expect(mismatched).toBeGreaterThan(0);
    await expect(
      npBuildAgentGuardianEvaluationReviewArtifactV1(failed, [label(review.entries[mismatched])]),
    ).rejects.toThrow();
    await expect(
      npBuildAgentGuardianEvaluationReviewArtifactV1(failed, [
        label(review.entries[mismatched], "reject"),
      ]),
    ).resolves.toMatchObject({ summary: { unsupported: 1 } });
    const workbench = await npBuildAgentEvaluationWorkbenchV1({ ...request(), evaluation: failed });
    expect(workbench.fixtureGate).toBe("failed");
    expect(workbench.cases[mismatched].allowedOutcomes).toEqual(["reject"]);
  }, 20_000);

  it("recognizes only the explicit local Guardian dataset and rejects network/model/budget flags before dispatch", () => {
    expect(
      npParseAgentEvaluationCommandArgsV1(["--dataset", "guardian.v1", "--json"]),
    ).toMatchObject({ dataset: "guardian.v1", provider: "fake", confirmNetwork: false });
    for (const flags of [
      ["--provider", "network"],
      ["--model", "deterministic-v1"],
      ["--max-calls", "0"],
      ["--confirm-network"],
    ])
      expect(() =>
        npParseAgentEvaluationCommandArgsV1(["--dataset", "guardian.v1", ...flags]),
      ).toThrow();
  });
});
