import { beforeAll, describe, expect, it } from "vitest";
import { runAgentEvaluationV1 } from "./evaluation.js";
import { npCreateAgentModeratorAssessmentEvaluationSuiteV1 } from "./moderator-assessment-evaluation-fixtures.js";
import { npCreateAgentPublisherSelectionEvaluationSuiteV1 } from "./publisher-selection-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationReportV1,
  npRequireAgentEvaluationReportV1,
} from "./evaluation-report.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import {
  npBuildAgentProfileEvaluationReviewArtifactV1,
  npCompareAgentProfileEvaluationReviewArtifactsV1,
} from "../agent-contract/profile-evaluation-review-contract.js";
import { npCreateAgentModeratorAssessmentEvaluationPredictionV1 } from "../agent-contract/moderator-assessment-evaluation-contract.js";
import { npCreateAgentPublisherSelectionEvaluationPredictionV1 } from "../agent-contract/publisher-selection-evaluation-contract.js";
import {
  npCompareAgentEvaluationArtifactsV1,
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationCommandResultV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
} from "../agent-contract/evaluation-contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100000,
  maxOutputTokens: 100000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
let semantic: NpAgentEvaluationArtifactV1;
let publisher: NpAgentEvaluationArtifactV1;
const evaluate = (suite: NpAgentEvaluationArtifactV1["suite"]) =>
  runAgentEvaluationV1({
    suite,
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
beforeAll(async () => {
  [semantic, publisher] = await Promise.all([
    npCreateAgentModeratorAssessmentEvaluationSuiteV1().then(evaluate),
    npCreateAgentPublisherSelectionEvaluationSuiteV1().then(evaluate),
  ]);
});
describe("explicit semantic and Publisher selection evaluation profiles", () => {
  it("runs source-only fake baselines with exact new instructions and independent authored labels", () => {
    expect(semantic.ok).toBe(true);
    expect(semantic.caseResults).toHaveLength(8);
    expect(publisher.ok).toBe(true);
    expect(publisher.caseResults).toHaveLength(11);
    for (const artifact of [semantic, publisher]) {
      expect(artifact.metrics.schemaValidBasisPoints).toBe(10000);
      expect(artifact.usage.costMicros).toBe(0);
      expect(artifact.caseResults.every((result) => result.prediction !== null)).toBe(true);
    }
  });
  it("scores a well-formed wrong semantic label as a failure without exposing the answer to the provider", async () => {
    const entry = semantic.suite.cases[0];
    const requests: unknown[] = [];
    const artifact = await runAgentEvaluationV1({
      suite: { ...semantic.suite, cases: [entry] },
      mode: "provider",
      providerId: "fixture",
      model: "test",
      confirmNetwork: true,
      budget,
      provider: {
        id: "fixture",
        model: "test",
        quote: () => ({ inputTokens: 0, outputTokens: 0, costMicros: 0 }),
        invoke: (request) => {
          requests.push(request);
          const response = npCreateAgentModeratorAssessmentEvaluationPredictionV1(
            request.case.evidence,
          ).moderatorAssessment;
          if (!response) throw new Error("Missing fixture response");
          response.decision.label = "benign";
          return Promise.resolve({
            prediction: response,
            usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
          });
        },
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("case.expectedClassification");
    expect(artifact.ok).toBe(false);
    expect(artifact.violations.some((v) => v.code === "DECISION_MISMATCH")).toBe(true);
  });
  it("rejects forged inner excerpt binding even after the outer evidence hash is recomputed", async () => {
    const suite = structuredClone(semantic.suite);
    const evidence = suite.cases[0].evidence[0];
    const value = JSON.parse(evidence.text) as { excerpts: { text: string }[] };
    value.excerpts[0].text = "Substituted content with the original excerpt hash.";
    evidence.text = JSON.stringify(value);
    evidence.digest = await npDigestAgentEvaluationValueV1({
      id: evidence.id,
      kind: evidence.kind,
      observedAt: evidence.observedAt,
      text: evidence.text,
    });
    await expect(evaluate(npRequireAgentEvaluationSuiteV1(suite))).rejects.toThrow();
  });
  it.each(["moderator-assessment", "publisher-selection"] as const)(
    "rejects empty %s provider output and round-trips profile comparisons",
    async (recipe) => {
      const source = recipe === "moderator-assessment" ? semantic : publisher;
      const create =
        recipe === "moderator-assessment"
          ? npCreateAgentModeratorAssessmentEvaluationPredictionV1
          : npCreateAgentPublisherSelectionEvaluationPredictionV1;
      const evidence = source.suite.cases[0].evidence;
      expect(create(evidence)).toBeDefined();
      for (const prediction of [null, undefined]) {
        expect(() => create(evidence, prediction)).toThrow();
        let calls = 0;
        const artifact = await runAgentEvaluationV1({
          suite: { ...source.suite, cases: [source.suite.cases[0]] },
          mode: "provider",
          providerId: "fixture",
          model: "test",
          confirmNetwork: true,
          budget,
          provider: {
            id: "fixture",
            model: "test",
            quote: () => ({ inputTokens: 0, outputTokens: 0, costMicros: 0 }),
            invoke: () => {
              calls++;
              return Promise.resolve({
                prediction,
                usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
              });
            },
          },
        });
        expect(calls).toBe(1);
        expect(artifact.ok).toBe(false);
        expect(artifact.caseResults[0].prediction).toBeNull();
        expect(artifact.caseResults[0].error).toBe("STRUCTURED_OUTPUT_INVALID");
      }
      const command = {
        schemaVersion: "np.agent-eval-command.v1",
        artifact: source,
        comparison: await npCompareAgentEvaluationArtifactsV1(source, source),
        errorCode: null,
      };
      expect(await npRequireAgentEvaluationCommandResultV1(command)).toEqual(command);
    },
  );
  it("reviews exact case versions independently while retaining a failed suite gate", async () => {
    const first = structuredClone(semantic.suite.cases[0]);
    const other = {
      ...structuredClone(first),
      caseVersion: first.caseVersion + 1,
      expectedClassification: "benign" as const,
    };
    const source = await evaluate({ ...semantic.suite, cases: [first, other] });
    expect(source.ok).toBe(false);
    const empty = await npBuildAgentProfileEvaluationReviewArtifactV1(source);
    const label = (index: number) => ({
      caseId: empty.entries[index].caseId,
      caseHash: empty.entries[index].caseHash,
      predictionHash: empty.entries[index].predictionHash,
      sourceHash: empty.entries[index].sourceHash,
      outcome: "accept",
      reviewer: "version-fixture",
      reviewedAt: "2026-10-15T00:00:00.000Z",
      notes: "Synthetic version isolation check",
      editedProposal: null,
    });
    const review = await npBuildAgentProfileEvaluationReviewArtifactV1(source, [label(0)]);
    expect(review.entries[0].review?.outcome).toBe("accept");
    expect(review.entries[1].review).toBeNull();
    await expect(
      npBuildAgentProfileEvaluationReviewArtifactV1(source, [label(1)]),
    ).rejects.toThrow();
    const report = await npBuildAgentEvaluationReportV1({
      schemaVersion: "np.agent-eval-report-input.v1",
      entries: [
        { recipe: "moderator-assessment", current: { evaluation: source, review }, baseline: null },
      ],
    });
    expect(report.rows.find((row) => row.recipe === "moderator-assessment")?.fixtureGate).toBe(
      "failed",
    );
  });
  describe.each(["moderator-assessment", "publisher-selection"] as const)(
    "%s review composition",
    (recipe) => {
      const prepare = async () => {
        const full = recipe === "moderator-assessment" ? semantic : publisher;
        const index =
          recipe === "moderator-assessment"
            ? 0
            : full.caseResults.findIndex(
                (result) =>
                  result.prediction?.publisherSelectionResponse?.decision.kind ===
                  "propose-capability",
              );
        if (index < 0) throw new Error("Missing proposal fixture");
        // Corpus conformance is covered above. Review and composition share
        // one exact immutable case, rather than reconstructing its artifacts.
        const source = await evaluate({ ...full.suite, cases: [full.suite.cases[index]] });
        const empty = await npBuildAgentProfileEvaluationReviewArtifactV1(source);
        const entry = empty.entries.find((e) => e.eligible);
        if (!entry) throw new Error("Missing reviewable fixture");
        const label = {
          caseId: entry.caseId,
          caseHash: entry.caseHash,
          predictionHash: entry.predictionHash,
          sourceHash: entry.sourceHash,
          outcome: "accept",
          reviewer: "synthetic-review-test",
          reviewedAt: "2026-10-15T00:00:00.000Z",
          notes: "Fixture conformance only, not authenticated human acceptance.",
          editedProposal: null,
        };
        const review = await npBuildAgentProfileEvaluationReviewArtifactV1(source, [label]);
        return { source, empty, entry, label, review };
      };
      let fixture: Awaited<ReturnType<typeof prepare>>;
      beforeAll(async () => {
        fixture = await prepare();
      });

      it("rejects forged review bindings and compares the exact reviewed cohort", async () => {
        const { source, empty, entry, label, review } = fixture;
        expect(empty.summary.reviewed).toBe(0);
        expect(review.summary.reviewed).toBe(1);
        await expect(
          npBuildAgentProfileEvaluationReviewArtifactV1(source, [
            { ...label, predictionHash: `cj1:sha256:${"x".repeat(43)}` },
          ]),
        ).rejects.toThrow();
        const comparison = await npCompareAgentProfileEvaluationReviewArtifactsV1(review, review);
        expect(comparison.matchedCaseKeys).toEqual([`${entry.caseId}@${entry.caseVersion}`]);
      });

      it("round-trips the review, report and Workbench without claiming live authority", async () => {
        const { source, entry, review } = fixture;
        const workbench = await npBuildAgentEvaluationWorkbenchV1({
          schemaVersion: "np.agent-eval-workbench-request.v1",
          recipe,
          evaluation: source,
          review,
          baseline: null,
          baselineReview: null,
          labels: null,
        });
        expect(workbench.recipe).toBe(recipe);
        expect(workbench.authority).toBe("offline-self-reported-no-approval");
        expect(workbench.cases.find((c) => c.caseId === entry.caseId)?.labelJson).toContain(
          "synthetic-review-test",
        );
        // Workbench already builds the report and validates its imported review.
        // Round-trip those exact exports instead of rebuilding the same report
        // separately and replaying its source/review validation once more.
        const exportedReport = JSON.parse(workbench.reportArtifactJson);
        const report = await npRequireAgentEvaluationReportV1(exportedReport);
        expect(report).toEqual(exportedReport);
        expect(report.input.entries).toEqual([
          { recipe, current: { evaluation: source, review }, baseline: null },
        ]);
        expect(JSON.parse(workbench.reviewArtifactJson!)).toEqual(review);
        expect(report.fullR6).toBe("not-established");
        expect(report.modelUsefulness).toBe("not-established");
        expect(report.rows.find((row) => row.recipe === recipe)?.fixtureGate).toBe("passed");
      });
    },
  );
});
