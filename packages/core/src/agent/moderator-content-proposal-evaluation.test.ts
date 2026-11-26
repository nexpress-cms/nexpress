import { beforeAll, describe, expect, it } from "vitest";
import { runAgentEvaluationV1 } from "./evaluation.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import { npRequireAgentEvaluationReportV1 } from "./evaluation-report.js";
import {
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV2,
  npCreateAgentModeratorProposalEvaluationSuiteV3,
} from "./moderator-proposal-evaluation-fixtures.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentEvaluationCaseV1,
} from "../agent-contract/evaluation-contract.js";
import {
  npCreateAgentModeratorProposalEvaluationPrediction,
  npCreateAgentModeratorProposalEvaluationPredictionV1,
  npEvaluateAgentModeratorProposal,
  npEvaluateAgentModeratorProposalV1,
  npRequireAgentModeratorProposalEvaluationEvidence,
  npRequireAgentModeratorProposalEvaluationEvidenceV1,
  npRequireAgentModeratorProposalEvaluationEvidenceV2,
  type NpAgentModeratorEvaluationResponseV1,
} from "../agent-contract/moderator-proposal-evaluation-contract.js";
import {
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  type NpAgentModeratorProposalEvaluationReviewEntryV1,
  type NpAgentModeratorProposalEvaluationReviewLabelV1,
} from "../agent-contract/moderator-proposal-evaluation-review-contract.js";
import { npCreateAgentModeratorRecipeDefinitionV1 } from "../agent-contract/moderator-recipe-contract.js";

const budget = {
  maxCalls: 100,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxCostMicros: 0,
  timeoutMs: 5000,
};
const documentId = "mp-en-document-current";
const mixedId = "mp-en-content-mixed-current";
const staleId = "mp-en-content-mixed-stale";
let artifact: NpAgentEvaluationArtifactV1;
let composition: NpAgentEvaluationArtifactV1;
let previous: NpAgentEvaluationArtifactV1;
const index = (id: string) => {
  const found = artifact.suite.cases.findIndex((entry) => entry.id === id);
  if (found < 0) throw new Error(`Missing content proposal fixture: ${id}`);
  return found;
};
const evidence = (id: string) => artifact.suite.cases[index(id)].evidence;
const proposalResponse = (id: string) => {
  const response = structuredClone(artifact.caseResults[index(id)].prediction?.moderatorResponse);
  if (response?.decision.kind !== "propose-capability")
    throw new Error(`Missing content proposal response: ${id}`);
  return { task: response.task, decision: response.decision };
};
function rebuild(source: NpAgentEvaluationArtifactV1) {
  const { mode, suite, provider, model, startedAt, finishedAt, budget, caseResults } = source;
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
const label = (
  entry: NpAgentModeratorProposalEvaluationReviewEntryV1,
  outcome: NpAgentModeratorProposalEvaluationReviewLabelV1["outcome"],
  editedProposal: NpAgentModeratorEvaluationResponseV1 | null = null,
): NpAgentModeratorProposalEvaluationReviewLabelV1 => ({
  caseId: entry.caseId,
  caseHash: entry.caseHash,
  predictionHash: entry.predictionHash,
  sourceHash: entry.sourceHash,
  outcome,
  editedProposal,
  reviewer: "offline content reviewer",
  reviewedAt: "2026-10-14T00:00:00.000Z",
  notes: "Synthetic target selection only; no live verdict, approval or execution.",
});
const request = (evaluation = composition) => ({
  schemaVersion: "np.agent-eval-workbench-request.v1",
  recipe: "moderator-proposal",
  evaluation,
  review: null,
  baseline: null,
  baselineReview: null,
  labels: null,
});
beforeAll(async () => {
  artifact = await runAgentEvaluationV1({
    suite: await npCreateAgentModeratorProposalEvaluationSuiteV3(),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
  // Reuse immutable predictions for three composition cases; the full suite is run once.
  const selected = structuredClone(artifact);
  const ids = [documentId, mixedId, staleId];
  selected.suite.cases = ids.map((id) => selected.suite.cases[index(id)]);
  selected.caseResults = ids.map((id) => selected.caseResults[index(id)]);
  composition = await rebuild(selected);
  const v2 = await npCreateAgentModeratorProposalEvaluationSuiteV2();
  previous = await runAgentEvaluationV1({
    suite: npRequireAgentEvaluationSuiteV1({
      ...v2,
      cases: v2.cases.filter((entry) => entry.id === "mp-en-report-current"),
    }),
    mode: "fake",
    providerId: "fake",
    model: "deterministic-v1",
    budget,
  });
});

describe("document and mixed content Moderator proposal evaluation", () => {
  it("preserves released v1/v2 suites and the actual recipe definition", async () => {
    for (const [create, hash] of [
      [
        npCreateAgentModeratorProposalEvaluationSuiteV1,
        "PekLjRb2nqaNolY_zLLbLqztyj9QwTae6PbabuJPYec",
      ],
      [
        npCreateAgentModeratorProposalEvaluationSuiteV2,
        "9qDu-MfXfpy_FZi9d_Ng9YBGLBPOFvecMuut80aktdI",
      ],
    ] as const)
      expect(await npDigestAgentEvaluationValueV1(await create())).toBe(`cj1:sha256:${hash}`);
    expect(
      await npDigestAgentEvaluationValueV1(await npCreateAgentModeratorRecipeDefinitionV1()),
    ).toBe("cj1:sha256:LmvEsfvkbnOY7h12HLC_HmjVff4VfTitNrX6zr5F2Z8");
  });

  it("scores bilingual documents and both mixed target orders without turning claims into verdicts", () => {
    expect(artifact.ok).toBe(true);
    expect(artifact.suite).toMatchObject({ id: "moderator-proposal-review", version: 3 });
    expect(artifact.metrics).toMatchObject({
      cases: 24,
      predictedPositive: 8,
      abstained: 16,
      falsePositive: 0,
      falseNegative: 0,
    });
    expect(artifact.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costMicros: 0 });
    for (const locale of ["en", "ko"]) {
      const cases = artifact.suite.cases.filter((entry) => entry.locale === locale);
      expect(cases).toHaveLength(12);
      expect(cases.every((entry) => entry.caseVersion === 3)).toBe(true);
      expect(cases.filter((entry) => entry.expectedDecision === "approval")).toHaveLength(4);
      const documents = npRequireAgentModeratorProposalEvaluationEvidenceV2(
        evidence(`mp-${locale}-document-current`),
      ).snapshot?.candidates;
      expect(documents).toHaveLength(1);
      expect(documents?.[0].proposal.target.kind).toBe("document");
      expect(documents?.[0].detector.reportClaims).toEqual({ unverified: true, itemCount: 5 });
      for (const [name, kinds] of [
        ["content-mixed-current", ["document", "comment"]],
        ["content-mixed-hostile", ["comment", "document"]],
      ] as const) {
        const candidates = npRequireAgentModeratorProposalEvaluationEvidenceV2(
          evidence(`mp-${locale}-${name}`),
        ).snapshot?.candidates;
        if (!candidates) throw new Error("Missing content campaign");
        expect(candidates.map((entry) => entry.proposal.target.kind)).toEqual(kinds);
        expect(candidates[0].incidentId).toBe(candidates[1].incidentId);
        expect(candidates[0].signalId).toBe(candidates[1].signalId);
        expect(candidates[0].sourceEventIds).toHaveLength(5);
        expect(candidates[0].sourceEventIds).toEqual(candidates[1].sourceEventIds);
        for (const candidate of candidates)
          expect(candidate.detector).toMatchObject({
            itemCount: 5,
            independentAccountCount: 3,
            reportClaims: { unverified: true, itemCount: 3 },
          });
        expect(proposalResponse(`mp-${locale}-${name}`).decision.arguments.proposal).toEqual(
          candidates[0].proposal,
        );
      }
    }
  });

  it("dispatches exact facts versions and keeps legacy helpers comment-only", () => {
    const current = evidence(documentId);
    expect(npRequireAgentModeratorProposalEvaluationEvidence(current)).toEqual(
      npRequireAgentModeratorProposalEvaluationEvidenceV2(current),
    );
    const old = previous.suite.cases[0].evidence;
    expect(npRequireAgentModeratorProposalEvaluationEvidence(old)).toEqual(
      npRequireAgentModeratorProposalEvaluationEvidenceV1(old),
    );
    expect(() => npRequireAgentModeratorProposalEvaluationEvidenceV2(old)).toThrow();
    expect(() => npRequireAgentModeratorProposalEvaluationEvidenceV1(current)).toThrow();
    expect(() =>
      npEvaluateAgentModeratorProposalV1(current, proposalResponse(documentId)),
    ).toThrow();
    expect(() => npCreateAgentModeratorProposalEvaluationPredictionV1(current)).toThrow();
    // Relabeling document facts cannot use the released comment-only contract.
    const facts = npRequireAgentModeratorProposalEvaluationEvidenceV2(current);
    for (const version of [
      "np.agent-moderator-proposal-eval-facts.v1",
      "np.agent-moderator-proposal-eval-facts.v3",
    ])
      expect(() =>
        npRequireAgentModeratorProposalEvaluationEvidence([
          { ...current[0], text: JSON.stringify({ ...facts, schemaVersion: version }) },
        ]),
      ).toThrow();
  });

  it("refuses document evidence without report provenance and private or verified claims", () => {
    const current = evidence(documentId);
    const facts = npRequireAgentModeratorProposalEvaluationEvidenceV2(current);
    for (const claims of [
      undefined,
      { unverified: false, itemCount: 5 },
      { unverified: true, itemCount: 5, reporterIds: ["private"] },
      { unverified: true, itemCount: 5, reason: "private report details" },
    ]) {
      const changed = structuredClone(facts);
      const candidate = changed.snapshot?.candidates[0];
      if (!candidate) throw new Error("Missing document candidate");
      if (claims === undefined) delete candidate.detector.reportClaims;
      else Object.assign(candidate.detector, { reportClaims: claims });
      expect(() =>
        npRequireAgentModeratorProposalEvaluationEvidenceV2([
          { ...current[0], text: JSON.stringify(changed) },
        ]),
      ).toThrow();
    }
  });

  it("grounds either admitted content target and refuses exact kind, ID, Incident or version substitutions", async () => {
    for (const id of [mixedId, "mp-en-content-mixed-hostile"]) {
      const current = evidence(id);
      const second =
        npRequireAgentModeratorProposalEvaluationEvidenceV2(current).snapshot?.candidates[1];
      if (!second) throw new Error("Missing alternative content target");
      const response = proposalResponse(id);
      response.decision.arguments.proposal = second.proposal;
      expect(npEvaluateAgentModeratorProposal(current, response)).toEqual([]);
    }
    const current = evidence(documentId);
    const valid = proposalResponse(documentId);
    const substitutes = [
      (entry: typeof valid) => (entry.decision.arguments.proposal.target.kind = "comment"),
      (entry: typeof valid) =>
        (entry.decision.arguments.proposal.target.id = "00000000-0000-4000-8000-999999999999"),
      (entry: typeof valid) =>
        (entry.decision.arguments.proposal.incidentId = "00000000-0000-4000-8000-999999999999"),
      (entry: typeof valid) =>
        (entry.decision.arguments.proposal.expectedVersionDigest = `cj1:sha256:${"9".repeat(43)}`),
    ];
    for (const substitute of substitutes) {
      const changed = structuredClone(valid);
      substitute(changed);
      expect(npEvaluateAgentModeratorProposal(current, changed)).toEqual([
        "PROPOSAL_EVIDENCE_INVALID",
      ]);
    }
    const changed = structuredClone(composition);
    const invalid = structuredClone(valid);
    substitutes[0](invalid);
    changed.caseResults[0].prediction = npCreateAgentModeratorProposalEvaluationPrediction(
      changed.suite.cases[0].evidence,
      invalid,
    );
    const rescored = await rebuild(changed);
    expect(rescored.ok).toBe(false);
    expect(rescored.violations).toContainEqual(
      expect.objectContaining({ caseId: documentId, code: "PROPOSAL_EVIDENCE_INVALID" }),
    );
  });

  it("refuses retained proposals for every unavailable, stale, empty, missing and truncated state", () => {
    const names = [
      "document-resolved",
      "document-target-changed",
      "content-mixed-resolved",
      "content-mixed-stale",
      "content-empty",
      "content-missing",
      "content-truncated",
      "content-unavailable",
    ];
    const retained = proposalResponse(mixedId);
    for (const locale of ["en", "ko"])
      for (const name of names) {
        const id = `mp-${locale}-${name}`;
        expect(npEvaluateAgentModeratorProposal(evidence(id), retained), id).toEqual([
          "PROPOSAL_UNJUSTIFIED",
        ]);
        expect(artifact.caseResults[index(id)].prediction?.moderatorResponse, id).toMatchObject({
          decision: { kind: "complete" },
        });
      }
  });

  it("reads facts and hostile notes independently of poisoned expected answers", async () => {
    const ids = ["mp-en-document-hostile", "mp-ko-content-mixed-hostile", staleId];
    const cases: NpAgentEvaluationCaseV1[] = ids.map((id) => {
      const entry = structuredClone(artifact.suite.cases[index(id)]);
      entry.expectedDecision = entry.expectedDecision === "approval" ? "observe" : "approval";
      entry.allowedActions = entry.expectedDecision === "approval" ? ["moderation.quarantine"] : [];
      return entry;
    });
    const poisoned = await runAgentEvaluationV1({
      suite: npRequireAgentEvaluationSuiteV1({ ...artifact.suite, cases }),
      mode: "fake",
      providerId: "fake",
      model: "deterministic-v1",
      budget,
    });
    expect(poisoned.caseResults.map((entry) => entry.prediction)).toEqual(
      ids.map((id) => artifact.caseResults[index(id)].prediction),
    );
    expect(poisoned.ok).toBe(false);
  });

  it("round-trips a grounded document-to-comment edit and compares only the reviewed content cohort", async () => {
    const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(composition);
    const [document, mixed, stale] = template.entries;
    const baseline = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(composition, [
      label(document, "accept"),
      label(stale, "accept"),
    ]);
    const alternative = proposalResponse(mixedId);
    const comment = npRequireAgentModeratorProposalEvaluationEvidenceV2(
      mixed.evidence,
    ).snapshot?.candidates.find((entry) => entry.proposal.target.kind === "comment");
    if (!comment) throw new Error("Missing grounded comment edit");
    alternative.decision.arguments.proposal = comment.proposal;
    const labels = [
      label(document, "reject"),
      label(mixed, "edit", alternative),
      label(stale, "accept"),
    ];
    const result = await npBuildAgentEvaluationWorkbenchV1({
      ...request(),
      review: baseline,
      baseline: structuredClone(composition),
      baselineReview: structuredClone(baseline),
      labels,
    });
    expect(result.authority).toBe("offline-self-reported-no-approval");
    expect(result.fixtureGate).toBe("passed");
    const report = await npRequireAgentEvaluationReportV1(JSON.parse(result.reportArtifactJson));
    const review = report.input.entries[0].current.review;
    expect(JSON.parse(result.reviewArtifactJson!)).toEqual(review);
    expect(JSON.parse(result.labelsJson!)).toEqual(labels);
    expect(review).toMatchObject({
      source: { suite: { version: 3 } },
      summary: { reviewed: 3, accepted: 1, edited: 1, rejected: 1 },
      labels,
    });
    for (const [position, entry] of result.cases.entries())
      expect(JSON.parse(entry.evidenceJson)).toEqual(composition.suite.cases[position].evidence);
    expect(
      report.rows.find((row) => row.recipe === "moderator-proposal")?.reviewComparison.result,
    ).toMatchObject({
      comparable: true,
      matchedCaseKeys: [`${documentId}@3`, `${staleId}@3`],
      unmatchedCurrentCaseKeys: [`${mixedId}@3`],
      unmatchedBaselineCaseKeys: [],
      acceptBasisPointsDelta: -5000,
      rejectBasisPointsDelta: 5000,
    });
    expect(report.fullR6).toBe("not-established");
    const restored = await npBuildAgentEvaluationWorkbenchV1({ ...request(), review });
    expect(restored.reviewArtifactJson).toBe(result.reviewArtifactJson);
    expect(stale.response).toMatchObject({ decision: { kind: "complete" } });

    // Each rejected edit is syntactically valid but changes exact grounding or source bindings.
    const wrongKind = structuredClone(alternative);
    wrongKind.decision.arguments.proposal.target.kind = "document";
    const wrongVersion = structuredClone(alternative);
    wrongVersion.decision.arguments.proposal.expectedVersionDigest = `cj1:sha256:${"9".repeat(43)}`;
    for (const editedProposal of [wrongKind, wrongVersion])
      await expect(
        npBuildAgentModeratorProposalEvaluationReviewArtifactV1(composition, [
          label(mixed, "edit", editedProposal),
        ]),
      ).rejects.toThrow();
    await expect(
      npBuildAgentEvaluationWorkbenchV1({
        ...request(),
        labels: [{ ...label(stale, "accept"), sourceHash: baseline.artifactHash }],
      }),
    ).rejects.toThrow();
  });

  it("keeps a v2 baseline outside the v3 evaluation and review cohort", async () => {
    const template = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(composition);
    const old = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(previous);
    const baseline = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(previous, [
      label(old.entries[0], "accept"),
    ]);
    const result = await npBuildAgentEvaluationWorkbenchV1({
      ...request(),
      baseline: previous,
      baselineReview: baseline,
      labels: [label(template.entries[0], "accept")],
    });
    const report = await npRequireAgentEvaluationReportV1(JSON.parse(result.reportArtifactJson));
    const row = report.rows.find((entry) => entry.recipe === "moderator-proposal");
    expect(row?.evaluationComparison.result).toMatchObject({
      comparable: false,
      reason: "SUITE_MISMATCH",
    });
    expect(row?.reviewComparison.result).toMatchObject({
      comparable: false,
      reason: "SUITE_MISMATCH",
      matchedCaseKeys: [],
      acceptBasisPointsDelta: null,
      editBasisPointsDelta: null,
      rejectBasisPointsDelta: null,
    });
    await expect(
      npBuildAgentEvaluationWorkbenchV1({ ...request(), review: baseline, labels: [] }),
    ).rejects.toThrow();
  });
});
