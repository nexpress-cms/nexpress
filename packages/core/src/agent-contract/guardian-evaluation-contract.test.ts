import { describe, expect, it } from "vitest";
import { npCreateAgentGuardianEvaluationCorpusV1 } from "../agent/guardian-evaluation-fixtures.js";
import { npPredictAgentGuardianEvaluationBaselineV1 } from "../agent/guardian-evaluation-baseline.js";
import {
  npRequireAgentGuardianEvaluationCorpusV1,
  npRequireAgentGuardianEvaluationCaseV1,
  npRequireAgentGuardianEvaluationFactsV1,
  npRequireAgentGuardianEvaluationPredictionV1,
  npScoreAgentGuardianEvaluationCaseV1,
} from "./guardian-evaluation-contract.js";

const fixture = () => {
  const item = npCreateAgentGuardianEvaluationCorpusV1().cases.find(
    (entry) => entry.scenario === "credential-threshold",
  );
  if (!item) throw new Error("Missing fixed corpus case");
  return item;
};
describe("bounded pure Guardian evaluation contracts", () => {
  it("rejects missing matrix entries, duplicate case identities and unknown fields", () => {
    const corpus = npCreateAgentGuardianEvaluationCorpusV1();
    expect(() =>
      npRequireAgentGuardianEvaluationCorpusV1({ ...corpus, cases: corpus.cases.slice(1) }),
    ).toThrow();
    const changed = structuredClone(corpus);
    changed.cases[1].id = changed.cases[0].id;
    expect(() => npRequireAgentGuardianEvaluationCorpusV1(changed)).toThrow();
    expect(() =>
      npRequireAgentGuardianEvaluationCaseV1({ ...fixture(), requiredLiveChecks: [] }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianEvaluationFactsV1({ ...fixture().input, authenticated: true }),
    ).toThrow();
  });
  it("bounds source facts and text and rejects actor/case authority additions", () => {
    const input = fixture().input;
    expect(() =>
      npRequireAgentGuardianEvaluationFactsV1({
        ...input,
        observations: Array.from({ length: 21 }, () => structuredClone(input.observations[0])),
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianEvaluationFactsV1({
        ...input,
        untrustedEvidence: [{ kind: "manual-goal", text: "x".repeat(2001) }],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianEvaluationFactsV1({
        ...input,
        observations: [{ ...input.observations[0], approval: true }],
      }),
    ).toThrow();
  });
  it("uses the actual strict Guardian decision parser and admits no executable output branch", () => {
    const item = fixture(),
      result = npPredictAgentGuardianEvaluationBaselineV1(item.input);
    expect(() =>
      npRequireAgentGuardianEvaluationPredictionV1({
        ...result,
        actions: ["security.revokeSessions"],
      }),
    ).toThrow();
    expect(
      npScoreAgentGuardianEvaluationCaseV1(item, {
        ...result,
        assessment: {
          task: "interactive-capability",
          decision: { capabilityId: "security.revokeSessions" },
        },
      }).violations,
    ).toEqual(["STRUCTURED_OUTPUT_INVALID"]);
    const malicious = structuredClone(result);
    if (!malicious.assessment) throw new Error("Expected synthetic assessment");
    const assessment = malicious.assessment;
    expect(() =>
      npRequireAgentGuardianEvaluationPredictionV1({
        ...malicious,
        assessment: {
          ...assessment,
          decision: { ...assessment.decision, approval: true },
        },
      }),
    ).toThrow();
  });
  it("rejects unadmitted digests and recipe-incompatible assessment codes independently of the oracle", () => {
    const item = fixture(),
      prediction = npPredictAgentGuardianEvaluationBaselineV1(item.input);
    if (!prediction.assessment) throw new Error("Expected synthetic assessment");
    prediction.assessment.decision.evidenceDigests = [`cj1:sha256:${"A".repeat(43)}`];
    expect(npScoreAgentGuardianEvaluationCaseV1(item, prediction).violations).toEqual([
      "ADVISORY_BINDING_INVALID",
    ]);
    const wrongRecipe = npPredictAgentGuardianEvaluationBaselineV1(item.input);
    if (!wrongRecipe.assessment) throw new Error("Expected synthetic assessment");
    wrongRecipe.assessment.decision.assessmentCodes = ["agent-policy-abuse"];
    expect(npScoreAgentGuardianEvaluationCaseV1(item, wrongRecipe).violations).toEqual([
      "ADVISORY_BINDING_INVALID",
    ]);
  });
  it("cannot erase a required advisory by rewriting its expected disposition", () => {
    const item = fixture(),
      prediction = npPredictAgentGuardianEvaluationBaselineV1(item.input);
    item.oracle.expectedDisposition = "not-applicable";
    expect(
      npScoreAgentGuardianEvaluationCaseV1(item, { ...prediction, assessment: null }).violations,
    ).toEqual(["ADVISORY_BINDING_INVALID"]);
  });
});
