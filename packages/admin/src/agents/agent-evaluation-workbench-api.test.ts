import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NpAgentEvaluationWorkbenchRequestV1,
  NpAgentEvaluationWorkbenchResultV1,
} from "@nexpress/core/agent-contract";
import {
  EvaluationWorkbenchRequests,
  evaluationReviewDraft,
  evaluationWorkbenchLabels,
  processAgentEvaluationWorkbench,
} from "./agent-evaluation-workbench-api.js";

const digest = `cj1:sha256:${"A".repeat(43)}`;
const request: NpAgentEvaluationWorkbenchRequestV1 = {
  schemaVersion: "np.agent-eval-workbench-request.v1",
  recipe: "moderator-proposal",
  evaluation: { source: "synthetic" },
  review: null,
  baseline: null,
  baselineReview: null,
  labels: null,
};
function fixture(): NpAgentEvaluationWorkbenchResultV1 {
  return {
    schemaVersion: "np.agent-eval-workbench.v1",
    authority: "offline-self-reported-no-approval",
    recipe: "moderator-proposal",
    sourceHash: digest,
    fixtureGate: "passed",
    mode: "fake",
    cases: [
      {
        caseId: "case-a",
        caseVersion: 1,
        caseHash: digest,
        predictionHash: digest,
        sourceHash: digest,
        eligible: true,
        allowedOutcomes: ["accept", "edit", "reject"],
        evidenceJson: "[]",
        predictionJson: JSON.stringify({
          moderatorResponse: { decision: "complete", result: "No proposal" },
        }),
        scoreJson: "{}",
        labelJson: null,
      },
    ],
    summaryText: "Unknown production precision remains unknown.",
    labelsJson: null,
    reviewArtifactJson: null,
    reportArtifactJson: JSON.stringify({
      schemaVersion: "np.agent-eval-report.v1",
      authority: "offline-evidence-no-approval",
      fullR6: "not-established",
      modelUsefulness: "not-established",
      artifactHash: digest,
    }),
  };
}
const reviewDraft = {
  outcome: "reject" as const,
  reviewer: "local reviewer",
  notes: "Fixture only",
  editedProposal: "null",
};
const reviewedAt = "2026-10-08T00:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());
describe("evaluation workbench client transport", () => {
  it("posts exact imported artifacts without credentials or live authority and validates its response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture()));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const value = await processAgentEvaluationWorkbench(request, signal);
    expect(value.summaryText).toContain("Unknown production precision");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/agents/evaluations");
    expect(options).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    expect(JSON.parse(options.body)).toEqual(request);
  });
  it("preserves the shared auth-loss error and rejects malformed or mismatched responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { status: 403, error: { code: "EVALUATION_FORBIDDEN", message: "Permission required." } },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(processAgentEvaluationWorkbench(request)).rejects.toMatchObject({
      status: 403,
      code: "EVALUATION_FORBIDDEN",
    });
    const wrong = fixture();
    wrong.recipe = "publisher";
    fetchMock
      .mockResolvedValueOnce(Response.json(wrong))
      .mockResolvedValueOnce(Response.json({ private: "invalid body" }));
    for (let index = 0; index < 2; index++)
      await expect(processAgentEvaluationWorkbench(request)).rejects.toMatchObject({
        status: 502,
        code: "STUDIO_CONTRACT_ERROR",
      });
  });
  it("rejects combined imported JSON above the request budget before sending any network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      processAgentEvaluationWorkbench({
        ...request,
        evaluation: { text: "a".repeat(4 * 1024 * 1024) },
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe("exact case-bound review draft processing", () => {
  it("keeps other labels and same-ID different-version labels when replacing or removing one review", () => {
    const result = fixture();
    const entry = result.cases[0];
    const existing = evaluationWorkbenchLabels(result, entry, reviewDraft, reviewedAt)[0];
    if (existing === null || typeof existing !== "object" || Array.isArray(existing))
      throw new Error("Expected label object.");
    const otherVersion = {
      ...existing,
      caseHash: `cj1:sha256:${"B".repeat(43)}`,
      notes: "Other version",
    };
    const anotherCase = { ...existing, caseId: "case-b", notes: "Keep this review" };
    result.labelsJson = JSON.stringify([existing, otherVersion, anotherCase]);
    const labels = evaluationWorkbenchLabels(
      result,
      entry,
      { ...reviewDraft, outcome: "accept", notes: "Updated" },
      reviewedAt,
    );
    expect(labels).toHaveLength(3);
    expect(labels.slice(0, 2)).toEqual([otherVersion, anotherCase]);
    expect(labels[2]).toMatchObject({
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      sourceHash: digest,
      predictionHash: digest,
      outcome: "accept",
      notes: "Updated",
      editedProposal: null,
    });
    expect(evaluationWorkbenchLabels(result, entry, null)).toEqual([otherVersion, anotherCase]);
  });
  it("seeds actual proposal edit JSON and preserves imported reviewer attribution", () => {
    const result = fixture();
    const entry = result.cases[0];
    const response = JSON.parse(entry.predictionJson).moderatorResponse;
    expect(JSON.parse(evaluationReviewDraft(entry).editedProposal)).toEqual(response);
    const labels = evaluationWorkbenchLabels(result, entry, reviewDraft, reviewedAt);
    entry.labelJson = JSON.stringify(labels[0]);
    expect(evaluationReviewDraft(entry)).toMatchObject({
      outcome: "reject",
      reviewer: reviewDraft.reviewer,
      notes: reviewDraft.notes,
    });
    result.recipe = "operator";
    entry.labelJson = null;
    entry.predictionJson = JSON.stringify({ planProposal: { steps: [] } });
    expect(JSON.parse(evaluationReviewDraft(entry).editedProposal)).toEqual({ steps: [] });
  });
  it("uses detector labels rather than proposal outcomes and rejects ineligible or unavailable outcomes", () => {
    const result = fixture();
    result.recipe = "moderator";
    const entry = result.cases[0];
    entry.allowedOutcomes = ["confirmed-spam", "false-positive"];
    const labels = evaluationWorkbenchLabels(
      result,
      entry,
      { ...reviewDraft, outcome: "false-positive" },
      reviewedAt,
    );
    expect(labels[0]).toMatchObject({ label: "false-positive" });
    expect(labels[0]).not.toHaveProperty("editedProposal");
    expect(() => evaluationWorkbenchLabels(result, entry, reviewDraft)).toThrow("allowed outcome");
    entry.eligible = false;
    expect(() =>
      evaluationWorkbenchLabels(result, entry, { ...reviewDraft, outcome: "false-positive" }),
    ).toThrow();
  });
  it("rejects invalid edit JSON and empty reviewer without altering the prior full label set", () => {
    const result = fixture();
    const entry = result.cases[0];
    result.labelsJson = "[]";
    expect(() =>
      evaluationWorkbenchLabels(result, entry, { ...reviewDraft, reviewer: " " }),
    ).toThrow("reviewer");
    expect(() =>
      evaluationWorkbenchLabels(result, entry, {
        ...reviewDraft,
        outcome: "edit",
        editedProposal: "{",
      }),
    ).toThrow();
    expect(result.labelsJson).toBe("[]");
    expect(() => evaluationWorkbenchLabels(result, { ...entry }, reviewDraft)).toThrow(
      "current validated evaluation",
    );
  });
});
describe("workbench request generations", () => {
  it("cancels superseded work and rejects late responses after input changes, access loss or unmount", async () => {
    const owner = new EvaluationWorkbenchRequests();
    const previous = owner.begin();
    const current = owner.begin();
    expect(previous.signal.aborted).toBe(true);
    expect(owner.current(previous)).toBe(false);
    expect(owner.current(current)).toBe(true);
    const lateResponse = Promise.resolve(fixture());
    owner.cancel();
    await lateResponse;
    expect(current.signal.aborted).toBe(true);
    expect(owner.current(current)).toBe(false);
    const restored = owner.begin();
    expect(owner.current(restored)).toBe(true);
    owner.cancel();
    expect(owner.current(restored)).toBe(false);
  });
});
