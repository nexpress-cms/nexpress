import { describe, expect, it, vi } from "vitest";
import { runAgentGuardianEvaluationV1 } from "./guardian-evaluation.js";
import { npCreateAgentGuardianEvaluationCorpusV1 } from "./guardian-evaluation-fixtures.js";
import {
  npCompareAgentGuardianEvaluationArtifactsV1,
  npDigestAgentGuardianEvaluationValueV1,
  npFormatAgentGuardianEvaluationArtifactV1,
  npRequireAgentGuardianEvaluationArtifactV1,
} from "../agent-contract/guardian-evaluation-contract.js";

describe("dedicated Guardian deterministic offline foundation", () => {
  it("contains exactly the complete versioned 64-case Korean/English matrix", async () => {
    const corpus = npCreateAgentGuardianEvaluationCorpusV1();
    expect(corpus.cases).toHaveLength(64);
    expect(corpus.cases.filter((item) => item.locale === "en")).toHaveLength(32);
    expect(corpus.cases.filter((item) => item.locale === "ko")).toHaveLength(32);
    expect(corpus.cases.filter((item) => item.variant === "control")).toHaveLength(32);
    expect(new Set(corpus.cases.map((item) => item.scenario)).size).toBe(16);
    expect(
      corpus.cases.every((item) => item.requiredLiveChecks.includes("production-rule-replay")),
    ).toBe(true);
    expect(await npDigestAgentGuardianEvaluationValueV1(corpus)).toMatchInlineSnapshot(
      `"cj1:sha256:i7wCjXqIAcUomTYNReKMERMp2sOpZIlvSNoLujPC40s"`,
    );
  });
  it("runs local synthetic conformance without bootstrap, network or a provider", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No outbound calls"));
    try {
      const artifact = await runAgentGuardianEvaluationV1();
      expect(fetch).not.toHaveBeenCalled();
      expect(artifact).toMatchObject({
        ok: true,
        mode: "deterministic-offline",
        predictionBasis: "synthetic-reference",
        productionRuleReplay: "not-run",
        productionPrecision: "not-established",
        modelUsefulness: "not-established",
        enablement: "not-established",
      });
      expect(artifact.summary.syntheticRules).toEqual({
        matchedCases: 64,
        missingSignals: 0,
        unexpectedSignals: 0,
      });
      expect(artifact.summary.syntheticIntent.falsePositive).toBeGreaterThan(0);
      expect(artifact.summary.syntheticIntent.falseNegative).toBeGreaterThan(0);
      expect(artifact.summary.syntheticIntent.unknown).toBe(2);
      expect(artifact.summary.liveChecks.required).toBe(artifact.summary.liveChecks.notRun);
      expect(
        artifact.caseResults
          .flatMap((result) => result.checks)
          .every((check) => check.status === "not-run"),
      ).toBe(true);
      expect(artifact.summary.advisory.invalidBindings).toBe(0);
      expect(artifact.summary.advisory.schemaValid).toBe(artifact.summary.advisory.applicable);
      expect(artifact.summary.advisory.matchedDisposition).toBe(
        artifact.summary.advisory.applicable,
      );
      expect(artifact.summary.syntheticIntent.abstained).toBe(0);
      expect(npFormatAgentGuardianEvaluationArtifactV1(artifact)).toContain(
        "Production rule replay, production precision, model usefulness and enablement are not established",
      );
      expect(
        await npRequireAgentGuardianEvaluationArtifactV1(JSON.parse(JSON.stringify(artifact))),
      ).toEqual(artifact);
    } finally {
      fetch.mockRestore();
    }
  });
  it("reproduces exact bytes and compatible baseline comparisons", async () => {
    const first = await runAgentGuardianEvaluationV1(),
      second = await runAgentGuardianEvaluationV1();
    expect(second).toEqual(first);
    expect(await npCompareAgentGuardianEvaluationArtifactsV1(first, second)).toEqual({
      comparable: true,
      reason: null,
      matchedCasesDelta: 0,
      advisoryBindingFailuresDelta: 0,
    });
  });
  it("rejects imported score, profile, pass and unsupported-live-check claims", async () => {
    const artifact = await runAgentGuardianEvaluationV1();
    for (const mutate of [
      (value: typeof artifact) => {
        value.summary.syntheticRules.matchedCases = 0;
      },
      (value: typeof artifact) => {
        value.ok = false;
      },
      (value: typeof artifact) => {
        value.profiles[0].instructionDigest = `cj1:sha256:${"A".repeat(43)}`;
      },
    ]) {
      const changed = structuredClone(artifact);
      mutate(changed);
      await expect(npRequireAgentGuardianEvaluationArtifactV1(changed)).rejects.toThrow();
    }
    const forged = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    forged.productionRuleReplay = "passed";
    await expect(npRequireAgentGuardianEvaluationArtifactV1(forged)).rejects.toThrow();
  });
  it("never pools comparisons after the corpus oracle or intent labels change", async () => {
    const first = await runAgentGuardianEvaluationV1();
    const corpus = npCreateAgentGuardianEvaluationCorpusV1();
    corpus.cases[0].referenceIntent =
      corpus.cases[0].referenceIntent === "benign" ? "attack" : "benign";
    const changed = await runAgentGuardianEvaluationV1({ corpus });
    expect(await npCompareAgentGuardianEvaluationArtifactsV1(changed, first)).toMatchObject({
      comparable: false,
      reason: "CORPUS_OR_PROFILE_CHANGED",
      matchedCasesDelta: null,
    });
  });
  it("rejects unrequested provider or execution injection", async () => {
    const invoke = vi.fn();
    await expect(
      Reflect.apply(runAgentGuardianEvaluationV1, undefined, [{ provider: { invoke } }]),
    ).rejects.toThrow("accepts no provider");
    expect(invoke).not.toHaveBeenCalled();
  });
});
