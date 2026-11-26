import { describe, expect, it } from "vitest";
import {
  npRequireAgentEvaluationHistorySaveV1,
  npRequireAgentEvaluationHistoryCaseV1,
  npRequireAgentEvaluationHistoryDetailV1,
  type NpAgentEvaluationHistorySaveV1,
} from "./evaluation-history-contract.js";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const id = "00000000-0000-4000-8000-000000000001";
const time = "2026-10-16T00:00:00.000Z";
const command = (): NpAgentEvaluationHistorySaveV1 => ({
  schemaVersion: "np.agent-evaluation-history-save.v1",
  recipe: "publisher",
  evaluationJson: "{}",
  sourceHash: digest,
  expectedVersion: 0,
  caseId: "pub-001",
  caseVersion: 1,
  caseHash: digest,
  predictionHash: digest,
  decision: { outcome: "reject", notes: "Needs stronger evidence.", editedProposalJson: null },
  idempotencyKey: "review:1",
});
const source = {
  id,
  recipe: "publisher",
  sourceHash: digest,
  version: 2,
  caseCount: 1,
  createdAt: time,
};
const revision = {
  id,
  version: 2,
  caseId: "pub-001",
  caseVersion: 1,
  caseHash: digest,
  predictionHash: digest,
  previousRevisionId: null,
  actorFingerprint: digest,
  actorDeleted: false,
  recordedAt: time,
  labelJson: "{}",
  revisionHash: digest,
};
describe("Authenticated evaluation review history transport", () => {
  it("rejects client identity, timestamp and unknown-authority claims instead of promoting offline provenance", () => {
    for (const patch of [
      { reviewer: "admin" },
      { recordedByUserId: id },
      { reviewedAt: time },
      { authority: "authenticated-staff-review-no-approval" },
    ])
      expect(() => npRequireAgentEvaluationHistorySaveV1({ ...command(), ...patch })).toThrow();
    expect(npRequireAgentEvaluationHistorySaveV1(command()).expectedVersion).toBe(0);
  });
  it("bounds durable uploads and edits and requires an explicit complete decision or clear", () => {
    for (const patch of [
      { evaluationJson: "{broken" },
      { evaluationJson: JSON.stringify("a".repeat(3 * 1024 * 1024)) },
      { expectedVersion: -1 },
      { decision: { outcome: "edit", notes: "", editedProposalJson: null } },
      { decision: { outcome: "accept", notes: "", editedProposalJson: "{}" } },
      { decision: { outcome: "reject", notes: "x".repeat(2001), editedProposalJson: null } },
    ])
      expect(() => npRequireAgentEvaluationHistorySaveV1({ ...command(), ...patch })).toThrow();
    expect(
      npRequireAgentEvaluationHistorySaveV1({ ...command(), decision: null }).decision,
    ).toBeNull();
  });
  it("keeps authenticated provenance outside compatible offline artifacts and validates one exact descending case history", () => {
    const page = {
      schemaVersion: "np.agent-evaluation-history-case.v1",
      authority: "authenticated-staff-review-no-approval",
      source,
      caseId: "pub-001",
      caseVersion: 1,
      revisions: [revision],
      nextBefore: null,
    };
    expect(npRequireAgentEvaluationHistoryCaseV1(page).authority).toBe(
      "authenticated-staff-review-no-approval",
    );
    for (const revisions of [
      [revision, { ...revision, version: 2 }],
      [{ ...revision, caseVersion: 2 }],
      [{ ...revision, actorDeleted: "false" }],
    ])
      expect(() => npRequireAgentEvaluationHistoryCaseV1({ ...page, revisions })).toThrow();
    expect(() =>
      npRequireAgentEvaluationHistoryDetailV1({
        schemaVersion: "np.agent-evaluation-history.v1",
        authority: "offline-self-reported-no-approval",
        source,
        evaluationJson: "{}",
      }),
    ).toThrow();
  });
});
