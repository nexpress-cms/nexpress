import { describe, expect, it, vi } from "vitest";
import { npDigestAgentEvaluationValueV1 } from "../agent-contract/evaluation-contract.js";
import type { NpAgentModeratorEvaluationReviewLabelV1 } from "../agent-contract/moderator-evaluation-review-contract.js";
import {
  runAgentModeratorEvaluationV1,
  npRequireAgentModeratorEvaluationArtifactV1,
  npCompareAgentModeratorEvaluationArtifactsV1,
  npBuildAgentModeratorEvaluationReviewArtifactV1,
  npRequireAgentModeratorEvaluationReviewArtifactV1,
  npCompareAgentModeratorEvaluationReviewArtifactsV1,
} from "./moderator-evaluation.js";

import * as detector from "./moderator-detector.js";

const reviewLabel = (
  entry: { caseId: string; caseHash: string; predictionHash: string; sourceHash: string },
  label: NpAgentModeratorEvaluationReviewLabelV1["label"] = "confirmed-spam",
): NpAgentModeratorEvaluationReviewLabelV1 => ({
  caseId: entry.caseId,
  caseHash: entry.caseHash,
  predictionHash: entry.predictionHash,
  sourceHash: entry.sourceHash,
  label,
  reviewer: "offline-reviewer",
  reviewedAt: "2026-10-06T00:00:00.000Z",
  notes: "Synthetic fixture review only.",
});
describe("Moderator deterministic offline evaluation", () => {
  it("runs actual bilingual detector thresholds while separating synthetic classification from conformance", async () => {
    const artifact = await runAgentModeratorEvaluationV1();
    expect(artifact.cases).toHaveLength(22);
    expect(artifact.summary).toEqual({
      cases: 22,
      matchedSignalExpectations: 22,
      missingExpectedSignals: 0,
      unexpectedSignals: 0,
      syntheticClassification: {
        truePositive: 6,
        falsePositive: 2,
        trueNegative: 4,
        falseNegative: 10,
        precisionBasisPoints: 7500,
        recallBasisPoints: 3750,
      },
    });
    expect(artifact.byLocale.en).toEqual(artifact.byLocale.ko);
    expect(artifact.byLocale.ko.cases).toBe(11);
    expect(artifact.ok).toBe(true);
    expect(artifact.caseResults.flatMap((r) => r.signals).every((s) => s.advisory)).toBe(true);
    const result = (scenario: string) =>
      artifact.caseResults[artifact.cases.findIndex((c) => c.scenario === scenario)];
    expect(result("duplicate-evidence-below-threshold").signals).toEqual([]);
    expect(result("replayed-threshold-evidence").signals[0].facts).toHaveLength(5);
    expect(result("latest-edit-removes-link").signals).toEqual([]);
    expect(result("adversarial-text-has-no-authority").signals[0]).toMatchObject({
      advisory: true,
      confidenceBasis: "exact-rule",
      scoreBasisPoints: 7000,
    });
    expect(JSON.stringify(artifact.caseResults)).not.toContain("Ignore all rules");
    expect(artifact).not.toHaveProperty("precisionWilsonLower95BasisPoints");
    expect(await npRequireAgentModeratorEvaluationArtifactV1(artifact)).toEqual(artifact);
    expect(await runAgentModeratorEvaluationV1()).toEqual(artifact);
    expect(await npCompareAgentModeratorEvaluationArtifactsV1(artifact, artifact)).toMatchObject({
      comparable: true,
      matchedSignalExpectationsDelta: 0,
    });
  });

  it("fails conformance when extraction loses links instead of changing the oracle with it", async () => {
    const extraction = vi
      .spyOn(detector, "npExtractAgentModeratorDomainHashesV1")
      .mockReturnValue([]);
    try {
      const artifact = await runAgentModeratorEvaluationV1();
      expect(artifact.ok).toBe(false);
      expect(artifact.summary.missingExpectedSignals).toBe(8);
    } finally {
      extraction.mockRestore();
    }
  });

  it("independently rejects rehashed predictions, fixture expectations, summaries and authority", async () => {
    const artifact = await runAgentModeratorEvaluationV1();
    const variants = [
      () => {
        const a = structuredClone(artifact);
        a.caseResults[1].signals = [];
        return a;
      },
      () => {
        const a = structuredClone(artifact);
        a.cases[1].expectedDomainHashes = [];
        return a;
      },
      () => {
        const a = structuredClone(artifact);
        a.cases[1].settings.minItems = 4;
        return a;
      },
      () => {
        const a = structuredClone(artifact);
        a.summary.syntheticClassification.falsePositive = 0;
        return a;
      },
      () => ({ ...artifact, authority: "automatic" }),
    ];
    for (const variant of variants) {
      const changed = variant();
      const { artifactHash: _hash, ...body } = changed;
      changed.artifactHash = await npDigestAgentEvaluationValueV1(body);
      await expect(npRequireAgentModeratorEvaluationArtifactV1(changed)).rejects.toThrow();
    }
    const getter = Object.defineProperty({}, "cases", {
      enumerable: true,
      get: () => {
        throw new Error("GETTER EXECUTED");
      },
    });
    await expect(npRequireAgentModeratorEvaluationArtifactV1(getter)).rejects.not.toThrow(
      "GETTER EXECUTED",
    );
    await expect(
      npRequireAgentModeratorEvaluationArtifactV1({ ...artifact, extra: true }),
    ).rejects.toThrow();
  });

  it("retains unreviewed eligible signals and binds canonical feedback without changing source correctness", async () => {
    const source = await runAgentModeratorEvaluationV1();
    const template = await npBuildAgentModeratorEvaluationReviewArtifactV1(source);
    expect(template.summary).toEqual({
      eligible: 8,
      ineligible: 14,
      reviewed: 0,
      unreviewed: 8,
      confirmedSpam: 0,
      falsePositive: 0,
      confirmedSpamBasisPoints: null,
      falsePositiveBasisPoints: null,
    });
    const positive = template.entries.filter((e) => e.eligible);
    const review = await npBuildAgentModeratorEvaluationReviewArtifactV1(source, [
      reviewLabel(positive[0]),
      reviewLabel(positive[1], "false-positive"),
    ]);
    expect(review.summary).toMatchObject({
      reviewed: 2,
      unreviewed: 6,
      confirmedSpam: 1,
      falsePositive: 1,
      confirmedSpamBasisPoints: 5000,
      falsePositiveBasisPoints: 5000,
    });
    expect(review.source).toEqual(source);
    expect(review.authority).toBe("offline-self-reported-no-approval");
    expect(await npRequireAgentModeratorEvaluationReviewArtifactV1(review)).toEqual(review);
    const tampered = structuredClone(review);
    tampered.summary.unreviewed = 0;
    await expect(npRequireAgentModeratorEvaluationReviewArtifactV1(tampered)).rejects.toThrow();
  });

  it("rejects duplicate, stale, unbound and ineligible labels, unknown labels and hidden fields", async () => {
    const source = await runAgentModeratorEvaluationV1();
    const template = await npBuildAgentModeratorEvaluationReviewArtifactV1(source);
    const label = reviewLabel(template.entries.find((e) => e.eligible)!);
    for (const labels of [
      [label, label],
      [{ ...label, sourceHash: "stale" }],
      [{ ...label, caseHash: "stale" }],
      [{ ...label, predictionHash: "stale" }],
      [reviewLabel(template.entries.find((e) => !e.eligible)!)],
      [{ ...label, label: "approve" }],
      [{ ...label, reviewer: " " }],
      [{ ...label, reviewedAt: "yesterday" }],
      [{ ...label, notes: "x".repeat(2001) }],
      [{ ...label, approvalId: "not-an-approval" }],
    ])
      await expect(
        npBuildAgentModeratorEvaluationReviewArtifactV1(source, labels),
      ).rejects.toThrow();
  });

  it("compares only an identical reviewed cohort and reports unmatched reviewed coverage", async () => {
    const source = await runAgentModeratorEvaluationV1();
    const template = await npBuildAgentModeratorEvaluationReviewArtifactV1(source);
    const [a, b, c] = template.entries.filter((e) => e.eligible);
    const baseline = await npBuildAgentModeratorEvaluationReviewArtifactV1(source, [
      reviewLabel(a),
      reviewLabel(b),
    ]);
    const current = await npBuildAgentModeratorEvaluationReviewArtifactV1(source, [
      reviewLabel(a, "false-positive"),
      reviewLabel(c),
    ]);
    const comparison = await npCompareAgentModeratorEvaluationReviewArtifactsV1(current, baseline);
    expect(comparison).toMatchObject({
      comparable: true,
      matchedCaseKeys: [`${a.caseId}@1`],
      unmatchedCurrentCaseKeys: [`${c.caseId}@1`],
      unmatchedBaselineCaseKeys: [`${b.caseId}@1`],
      confirmedSpamBasisPointsDelta: -10000,
      falsePositiveBasisPointsDelta: 10000,
    });
    expect(comparison.current?.reviewed).toBe(1);
    expect(comparison.baseline?.reviewed).toBe(1);
    expect(
      await npCompareAgentModeratorEvaluationReviewArtifactsV1(template, baseline),
    ).toMatchObject({
      comparable: false,
      reason: "NO_MATCHED_REVIEW_COHORT",
      current: null,
      baseline: null,
    });
  });
});
