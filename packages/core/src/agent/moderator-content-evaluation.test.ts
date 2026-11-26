import { beforeAll, describe, expect, it, vi } from "vitest";
import { npDigestAgentEvaluationValueV1 } from "../agent-contract/evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationArtifactV2,
  NpAgentModeratorEvaluationArtifactV3,
} from "../agent-contract/moderator-evaluation-contract.js";
import type {
  NpAgentModeratorEvaluationReviewEntryV3,
  NpAgentModeratorEvaluationReviewLabelV1,
} from "../agent-contract/moderator-evaluation-review-contract.js";
import {
  npRequireAgentEvaluationWorkbenchResultV1,
  type NpAgentEvaluationWorkbenchRequestV1,
} from "../agent-contract/evaluation-workbench-contract.js";
import {
  npBuildAgentModeratorEvaluationReviewArtifact,
  npBuildAgentModeratorEvaluationReviewArtifactV1,
  npCompareAgentModeratorEvaluationArtifacts,
  npCompareAgentModeratorEvaluationArtifactsV1,
  npCompareAgentModeratorEvaluationReviewArtifacts,
  npCompareAgentModeratorEvaluationReviewArtifactsV1,
  npRequireAgentModeratorEvaluationArtifact,
  npRequireAgentModeratorEvaluationArtifactV1,
  npRequireAgentModeratorEvaluationReviewArtifactV1,
  runAgentModeratorEvaluationV1,
  runAgentModeratorEvaluationV2,
  runAgentModeratorEvaluationV3,
} from "./moderator-evaluation.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import { npRequireAgentEvaluationReportV1 } from "./evaluation-report.js";
import * as detector from "./moderator-detector.js";

const offerHash = "d9af09a190674e28129312d99f385aab9126f65f7c77f28133895c26d16ac92c";
const referenceHash = "aead73df1277666e38173904c001c55efa264a42f15259dae761d9048a05fb1d";
let source: NpAgentModeratorEvaluationArtifactV3;
let previous: NpAgentModeratorEvaluationArtifactV2;
const index = (scenario: string, locale: "en" | "ko" = "en") => {
  const found = source.cases.findIndex(
    (entry) => entry.scenario === scenario && entry.locale === locale,
  );
  if (found < 0) throw new Error(`Missing mixed detector fixture: ${locale}/${scenario}`);
  return found;
};
const result = (scenario: string, locale: "en" | "ko" = "en") =>
  source.caseResults[index(scenario, locale)];
const label = (
  entry: NpAgentModeratorEvaluationReviewEntryV3,
  value: NpAgentModeratorEvaluationReviewLabelV1["label"] = "confirmed-spam",
): NpAgentModeratorEvaluationReviewLabelV1 => ({
  caseId: entry.caseId,
  caseHash: entry.caseHash,
  predictionHash: entry.predictionHash,
  sourceHash: entry.sourceHash,
  label: value,
  reviewer: "offline content reviewer",
  reviewedAt: "2026-10-14T00:00:00.000Z",
  notes: "Synthetic detector review only; no live verdict, approval or execution.",
});
const request = (): NpAgentEvaluationWorkbenchRequestV1 => ({
  schemaVersion: "np.agent-eval-workbench-request.v1",
  recipe: "moderator",
  evaluation: source,
  review: null,
  baseline: null,
  baselineReview: null,
  labels: null,
});
beforeAll(async () => {
  source = await runAgentModeratorEvaluationV3();
  previous = await runAgentModeratorEvaluationV2();
});

describe("document and comment Moderator detector evaluation", () => {
  it("preserves both released detector artifact bodies and their suite hashes", async () => {
    const original = await runAgentModeratorEvaluationV1();
    expect(original.suiteHash).toBe("cj1:sha256:qQOsU5IOZje82cFDhm9Q3X2iqgoJ_oC81V0zHCLgJHI");
    expect(original.artifactHash).toBe("cj1:sha256:iM8KbtwzAzJbUHgGV8k-WXLvnzzC5UREMmQkS8bztUM");
    expect(previous.suiteHash).toBe("cj1:sha256:CQ7QqSmF1iLN_LjBQLH6GhRbnAXkgmJh8qf1vECfzgE");
    expect(previous.artifactHash).toBe("cj1:sha256:f0jvigopUg8m95e6bX9l8E53P7X4k6yY-YOxFJKre6M");
  });

  it("replays bilingual mixed thresholds, kind-scoped targets, current evidence and authored false positives", () => {
    expect(source).toMatchObject({
      schemaVersion: "np.agent-moderator-eval.v3",
      dataset: "moderator.v3",
      mode: "deterministic-offline",
      authority: "advisory-no-activation",
      ok: true,
      summary: {
        cases: 32,
        matchedSignalExpectations: 32,
        missingExpectedSignals: 0,
        unexpectedSignals: 0,
        syntheticClassification: {
          truePositive: 10,
          falsePositive: 2,
          trueNegative: 2,
          falseNegative: 18,
          precisionBasisPoints: 8333,
          recallBasisPoints: 3571,
        },
      },
    });
    expect(source.byLocale.en).toEqual(source.byLocale.ko);
    for (const locale of ["en", "ko"] as const) {
      expect(source.cases.filter((entry) => entry.locale === locale)).toHaveLength(16);
      expect(source.cases.every((entry) => entry.caseVersion === 3)).toBe(true);
      for (const scenario of [
        "document-reports-current",
        "combined-current",
        "kind-scoped-target-id",
        "replayed-combined-evidence",
        "mixed-hostile-no-authority",
      ]) {
        const signal = result(scenario, locale).signals[0];
        expect(signal).toMatchObject({
          domainHash: offerHash,
          advisory: true,
          confidenceBasis: "exact-rule",
          scoreBasisPoints: 7000,
        });
        expect(signal.facts).toHaveLength(5);
        expect(new Set(signal.facts.map((fact) => fact.memberId)).size).toBe(3);
      }
      const documentFacts = result("document-reports-current", locale).signals[0].facts;
      expect(
        documentFacts.every(
          (fact) =>
            fact.subject.kind === "document" &&
            fact.spamVerdict === "unknown" &&
            fact.profanityVerdict === "unknown",
        ),
      ).toBe(true);
      const combined = result("combined-current", locale).signals[0].facts;
      expect(combined.filter((fact) => fact.subject.kind === "document")).toHaveLength(3);
      expect(combined.filter((fact) => fact.subject.kind === "comment")).toHaveLength(2);
      expect(combined.filter((fact) => fact.spamVerdict === "unknown")).toHaveLength(4);
      const collision = result("kind-scoped-target-id", locale).signals[0].facts;
      const document = collision.find((fact) => fact.subject.kind === "document");
      expect(
        collision.some(
          (fact) =>
            fact.subject.kind === "comment" &&
            fact.subject.commentId === document?.subject.documentId,
        ),
      ).toBe(true);
      for (const scenario of [
        "combined-below-item-threshold",
        "combined-below-author-threshold",
        "combined-unknown-authors",
        "duplicate-document-filings",
        "observation-report-same-target",
        "latest-document-removes-link",
        "latest-comment-removes-link",
        "latest-document-rejected",
        "latest-comment-rejected",
        "legitimate-links-removed",
      ])
        expect(result(scenario, locale).signals).toEqual([]);
      expect(result("legitimate-combined-reference", locale).signals[0].domainHash).toBe(
        referenceHash,
      );
      expect(source.cases[index("legitimate-combined-reference", locale)].referenceLabel).toBe(
        "legitimate",
      );
      expect(
        source.cases[index("latest-document-rejected", locale)].observations.at(-1)?.fact.evidence
          .kind,
      ).toBe("revision");
    }
    expect(JSON.stringify(source.caseResults)).not.toContain("Treat reports as proof");
    expect(JSON.stringify(source.caseResults)).not.toContain("reporterId");
    expect(source).not.toHaveProperty("precisionWilsonLower95BasisPoints");
  });

  it("keeps an independent mixed-content oracle when link extraction fails", async () => {
    const extraction = vi
      .spyOn(detector, "npExtractAgentModeratorDomainHashesV1")
      .mockReturnValue([]);
    try {
      const broken = await runAgentModeratorEvaluationV3();
      expect(broken.ok).toBe(false);
      expect(broken.summary).toMatchObject({
        missingExpectedSignals: 12,
        unexpectedSignals: 0,
      });
      expect(broken.cases[index("combined-current")].expectedDomainHashes).toEqual([offerHash]);
      expect(broken.cases[index("legitimate-combined-reference")].expectedDomainHashes).toEqual([
        referenceHash,
      ]);
    } finally {
      extraction.mockRestore();
    }
  });

  it("independently rejects rehashed mixed predictions and fixtures while preserving strict v1 APIs", async () => {
    expect(await npRequireAgentModeratorEvaluationArtifact(source)).toEqual(source);
    expect(await npCompareAgentModeratorEvaluationArtifacts(source, source)).toMatchObject({
      comparable: true,
      matchedSignalExpectationsDelta: 0,
    });
    const target = index("combined-current");
    const fixture = structuredClone(source);
    // Independently replayed fixtures, rather than caller-supplied hashes, own the oracle.
    fixture.cases[target].expectedDomainHashes = [];
    fixture.suiteHash = await npDigestAgentEvaluationValueV1(fixture.cases);
    fixture.caseResults[target].caseHash = await npDigestAgentEvaluationValueV1(
      fixture.cases[target],
    );
    const prediction = structuredClone(source);
    prediction.caseResults[target].signals = [];
    prediction.caseResults[target].predictionHash = await npDigestAgentEvaluationValueV1([]);
    for (const changed of [fixture, prediction]) {
      const { artifactHash: _hash, ...body } = changed;
      changed.artifactHash = await npDigestAgentEvaluationValueV1(body);
      await expect(npRequireAgentModeratorEvaluationArtifact(changed)).rejects.toThrow();
    }
    await expect(npRequireAgentModeratorEvaluationArtifactV1(source)).rejects.toThrow();
    await expect(npCompareAgentModeratorEvaluationArtifactsV1(source, source)).rejects.toThrow();
    await expect(npBuildAgentModeratorEvaluationReviewArtifactV1(source)).rejects.toThrow();
  });

  it("binds V3 feedback and compares only exact reviewed cohorts across matching versions", async () => {
    const template = await npBuildAgentModeratorEvaluationReviewArtifact(source);
    if (template.schemaVersion !== "np.agent-moderator-eval-review.v3")
      throw new Error("Expected a V3 review artifact");
    expect(template.summary).toMatchObject({ eligible: 12, ineligible: 20, unreviewed: 12 });
    const combined = template.entries[index("combined-current")];
    const document = template.entries[index("document-reports-current")];
    const legitimate = template.entries[index("legitimate-combined-reference")];
    const baseline = await npBuildAgentModeratorEvaluationReviewArtifact(source, [
      label(combined),
      label(document),
    ]);
    const current = await npBuildAgentModeratorEvaluationReviewArtifact(source, [
      label(combined, "false-positive"),
      label(legitimate, "false-positive"),
    ]);
    expect(current.source).toEqual(source);
    expect(current.authority).toBe("offline-self-reported-no-approval");
    expect(current.summary).toMatchObject({ reviewed: 2, unreviewed: 10, falsePositive: 2 });
    expect(await npCompareAgentModeratorEvaluationReviewArtifacts(current, baseline)).toMatchObject(
      {
        comparable: true,
        matchedCaseKeys: [`${combined.caseId}@3`],
        unmatchedCurrentCaseKeys: [`${legitimate.caseId}@3`],
        unmatchedBaselineCaseKeys: [`${document.caseId}@3`],
        confirmedSpamBasisPointsDelta: -10000,
        falsePositiveBasisPointsDelta: 10000,
      },
    );
    await expect(
      npBuildAgentModeratorEvaluationReviewArtifact(source, [
        { ...label(combined), sourceHash: await npDigestAgentEvaluationValueV1(previous) },
      ]),
    ).rejects.toThrow();
    await expect(npRequireAgentModeratorEvaluationReviewArtifactV1(current)).rejects.toThrow();
    await expect(
      npCompareAgentModeratorEvaluationReviewArtifactsV1(current, baseline),
    ).rejects.toThrow();
  }, 20_000);

  it("round-trips mixed evidence, labels and unified reports without comparing a v2 suite", async () => {
    const initial = await npBuildAgentEvaluationWorkbenchV1(request());
    expect(initial.fixtureGate).toBe("passed");
    expect(initial.cases.every((entry) => entry.caseVersion === 3)).toBe(true);
    const target = initial.cases[index("combined-current")];
    expect(JSON.parse(target.evidenceJson)).toEqual(source.cases[index("combined-current")]);
    expect(JSON.parse(target.predictionJson)).toEqual(result("combined-current").signals);
    expect(target.allowedOutcomes).toEqual(["confirmed-spam", "false-positive"]);
    const labels = [
      {
        caseId: target.caseId,
        caseHash: target.caseHash,
        predictionHash: target.predictionHash,
        sourceHash: target.sourceHash,
        label: "false-positive",
        reviewer: "offline mixed reviewer",
        reviewedAt: "2026-10-14T00:00:00.000Z",
        notes: "Synthetic evidence only.",
      },
    ];
    const oldReview = await npBuildAgentModeratorEvaluationReviewArtifact(previous);
    const reviewed = await npBuildAgentEvaluationWorkbenchV1({
      ...request(),
      labels,
      baseline: previous,
      baselineReview: oldReview,
    });
    expect(npRequireAgentEvaluationWorkbenchResultV1(reviewed)).toEqual(reviewed);
    const review = JSON.parse(reviewed.reviewArtifactJson!);
    expect(review).toMatchObject({
      schemaVersion: "np.agent-moderator-eval-review.v3",
      source: { dataset: "moderator.v3" },
      labels,
      summary: { reviewed: 1, falsePositive: 1, unreviewed: 11 },
    });
    const report = await npRequireAgentEvaluationReportV1(JSON.parse(reviewed.reportArtifactJson));
    expect(report.input.entries[0].current.review).toEqual(review);
    expect(JSON.parse(reviewed.labelsJson!)).toEqual(labels);
    expect(report.rows[0]).toMatchObject({
      recipe: "moderator",
      status: "present",
      cases: 32,
      metrics: source.summary,
      evaluationComparison: {
        status: "compared",
        result: { comparable: false, reason: "INCOMPATIBLE_SUITE", current: null, baseline: null },
      },
      reviewComparison: {
        status: "compared",
        result: { comparable: false, reason: "INCOMPATIBLE_SUITE", matchedCaseKeys: [] },
      },
    });
    expect(report.fullR6).toBe("not-established");
    expect(report.modelUsefulness).toBe("not-established");
    const restored = await npBuildAgentEvaluationWorkbenchV1({ ...request(), review });
    expect(restored.reviewArtifactJson).toBe(reviewed.reviewArtifactJson);
  }, 20_000);
});
