import { beforeAll, describe, expect, it } from "vitest";
import { runAgentEvaluationV1 } from "./evaluation.js";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV2,
} from "./moderator-proposal-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npCompareAgentEvaluationArtifactsV1,
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationArtifactV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npCreateAgentModeratorProposalEvaluationPredictionV1,
  npRequireAgentModeratorProposalEvaluationEvidenceV1,
} from "../agent-contract/moderator-proposal-evaluation-contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
let artifact: NpAgentEvaluationArtifactV1;
beforeAll(async () => {
  artifact = await runAgentEvaluationV1({
    suite: await npCreateAgentModeratorProposalEvaluationSuiteV2(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
});
const find = (id: string) => {
  const index = artifact.suite.cases.findIndex((c) => c.id === id);
  if (index < 0) throw new Error("Missing report fixture");
  return index;
};
describe("report and mixed Moderator proposal evaluation", () => {
  it("preserves the released v1 synthetic suite and its exact canonical hash", async () => {
    const suite = await npCreateAgentModeratorProposalEvaluationSuiteV1();
    expect(await npDigestAgentEvaluationValueV1(suite)).toBe(
      "cj1:sha256:PekLjRb2nqaNolY_zLLbLqztyj9QwTae6PbabuJPYec",
    );
    expect(suite.cases).toHaveLength(16);
    for (const entry of suite.cases) {
      const facts = npRequireAgentModeratorProposalEvaluationEvidenceV1(entry.evidence);
      for (const c of facts.snapshot?.candidates ?? [])
        expect(Object.hasOwn(c.detector, "reportClaims")).toBe(false);
    }
  });

  it("scores bilingual report/mixed selection and abstention without converting claims into verdicts", async () => {
    expect(artifact.ok).toBe(true);
    expect(artifact.suite.version).toBe(2);
    expect(artifact.metrics).toMatchObject({
      cases: 24,
      predictedPositive: 8,
      abstained: 16,
      falsePositive: 0,
      falseNegative: 0,
    });
    for (const locale of ["en", "ko"])
      expect(artifact.suite.cases.filter((c) => c.locale === locale)).toHaveLength(12);
    const report = npRequireAgentModeratorProposalEvaluationEvidenceV1(
      artifact.suite.cases[find("mp-en-report-current")].evidence,
    );
    expect(report.snapshot?.candidates[0].detector).toMatchObject({
      itemCount: 5,
      independentAccountCount: 3,
      reportClaims: { unverified: true, itemCount: 5 },
    });
    const mixed = npRequireAgentModeratorProposalEvaluationEvidenceV1(
      artifact.suite.cases[find("mp-en-mixed-current")].evidence,
    );
    expect(mixed.snapshot?.candidates[0].detector.reportClaims?.itemCount).toBe(2);
    expect(await npRequireAgentEvaluationArtifactV1(artifact)).toEqual(artifact);
    expect((await npCompareAgentEvaluationArtifactsV1(artifact, artifact)).comparable).toBe(true);
  });

  it("rejects malformed, verified, oversized and private report claims instead of dropping fields", () => {
    const evidence = artifact.suite.cases[find("mp-en-report-current")].evidence;
    const facts = npRequireAgentModeratorProposalEvaluationEvidenceV1(evidence);
    const invalid: unknown[] = [
      null,
      { unverified: false, itemCount: 5 },
      { unverified: true, itemCount: 0 },
      { unverified: true, itemCount: 6 },
      { unverified: true, itemCount: 1.5 },
      { unverified: true, itemCount: "5" },
      { unverified: true, itemCount: 5, reporterIds: ["private"] },
      { unverified: true, itemCount: 5, reason: "private" },
      { itemCount: 5 },
    ];
    for (const claims of invalid) {
      const changed = structuredClone(facts);
      const c = changed.snapshot?.candidates[0];
      if (!c) throw new Error("Missing candidate");
      Object.assign(c.detector, { reportClaims: claims });
      expect(() =>
        npRequireAgentModeratorProposalEvaluationEvidenceV1([
          { ...evidence[0], text: JSON.stringify(changed) },
        ]),
      ).toThrow();
    }
  });

  it("grounds either mixed candidate but rejects retained proposals across handled/changed/incomplete evidence", async () => {
    const { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults } =
      structuredClone(artifact);
    const index = find("mp-en-mixed-current");
    const facts = npRequireAgentModeratorProposalEvaluationEvidenceV1(suite.cases[index].evidence);
    const response = caseResults[index].prediction?.moderatorResponse;
    const second = facts.snapshot?.candidates[1];
    if (!second || response?.decision.kind !== "propose-capability")
      throw new Error("Missing mixed proposal");
    response.decision.arguments.proposal = second.proposal;
    expect(
      (
        await npBuildAgentEvaluationArtifactV1({
          mode,
          suite,
          provider,
          model,
          startedAt,
          finishedAt,
          budget,
          caseResults,
        })
      ).ok,
    ).toBe(true);
    // One rebuilt artifact covers distinct availability/scan fences rather than replaying each suite.
    const blocked = suite.cases.flatMap((c, i) => (c.expectedDecision === "observe" ? [i] : []));
    for (const i of blocked)
      caseResults[i].prediction = npCreateAgentModeratorProposalEvaluationPredictionV1(
        suite.cases[i].evidence,
        response,
      );
    const invalid = await npBuildAgentEvaluationArtifactV1({
      mode,
      suite,
      provider,
      model,
      startedAt,
      finishedAt,
      budget,
      caseResults,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.violations.filter((v) => v.code === "PROPOSAL_UNJUSTIFIED")).toHaveLength(16);
  });

  it("reads facts independently of expected answers and hostile claims of approval", async () => {
    const suite = structuredClone(artifact.suite);
    for (const entry of suite.cases) {
      entry.expectedDecision = entry.expectedDecision === "approval" ? "observe" : "approval";
      entry.allowedActions = entry.expectedDecision === "approval" ? ["moderation.quarantine"] : [];
    }
    const rerun = await runAgentEvaluationV1({
      suite,
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(rerun.caseResults.map((r) => r.prediction)).toEqual(
      artifact.caseResults.map((r) => r.prediction),
    );
    expect(rerun.ok).toBe(false);
    expect(
      artifact.caseResults[find("mp-en-mixed-unavailable")].prediction?.moderatorResponse,
    ).toMatchObject({ decision: { kind: "complete" } });
  });
});
