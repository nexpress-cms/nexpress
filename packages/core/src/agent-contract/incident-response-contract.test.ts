import { describe, expect, it } from "vitest";
import {
  npRequireAgentIncidentResponsePlanInputV1,
  npRequireAgentIncidentResponseExecuteInputV1,
  npRequireAgentIncidentResponseV1,
} from "./incident-response-contract.js";

const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const choice = {
  capabilityId: "moderation.quarantine",
  target: { kind: "comment", collection: "posts", id: "opaque-comment-id" },
  expectedVersionDigest: hash,
  containmentId: null,
};
const plan = {
  schemaVersion: "np.agent-incident-response-plan-input.v1",
  expectedVersion: 1,
  capabilityId: choice.capabilityId,
  proposal: {
    incidentId: id,
    target: choice.target,
    expectedVersionDigest: hash,
    reasonCode: "HUMAN_REVIEW",
  },
  idempotencyKey: "prepare-1",
};
const execute = {
  schemaVersion: "np.agent-incident-response-execute-input.v1",
  expectedVersion: 1,
  actionId: id,
  approvalId: id,
  proposalHash: hash,
  idempotencyKey: "execute-1",
};
describe("Incident response wire contracts", () => {
  it("preserves domain target identifiers and exact discriminated plans and execution identity", () => {
    const restore = {
      ...plan,
      capabilityId: "moderation.restore",
      proposal: {
        containmentKind: "content_quarantine",
        containmentId: id,
        expectedVersionDigest: hash,
      },
    };
    for (const command of [plan, restore])
      expect(npRequireAgentIncidentResponsePlanInputV1(command)).toEqual(command);
    expect(npRequireAgentIncidentResponseExecuteInputV1(execute)).toEqual(execute);
    for (const invalid of [
      { ...plan, capabilityId: "moderation.restore" },
      { ...restore, capabilityId: "moderation.quarantine" },
      { ...plan, proposal: { ...plan.proposal, originalBody: "private" } },
      { ...plan, expectedVersion: 0 },
      { ...plan, idempotencyKey: "x".repeat(129) },
      { ...plan, siteId: "other" },
    ])
      expect(() => npRequireAgentIncidentResponsePlanInputV1(invalid)).toThrow();
    for (const invalid of [
      { ...execute, proposalHash: "altered" },
      { ...execute, planHash: hash },
      { ...execute, approvalId: "invalid" },
      { ...execute, expectedVersion: 1.5 },
    ])
      expect(() => npRequireAgentIncidentResponseExecuteInputV1(invalid)).toThrow();
  });
  it("rejects private, ambiguous or inconsistent response projections before presenting approval or execution", () => {
    const approved = {
      ...choice,
      target: { ...choice.target },
      actionId: id,
      proposalHash: hash,
      state: "approved",
      approvalId: id,
      approvalResource: `/admin/agents/approvals/${id}`,
      expiresAt: "2026-09-28T12:00:00.000Z",
      policyHashes: [hash],
      reversibility: "compensatable",
      canExecute: true,
    };
    const response = { choices: [choice], plans: [approved], truncated: false };
    expect(npRequireAgentIncidentResponseV1(response)).toEqual(response);
    expect(npRequireAgentIncidentResponseV1({ choices: [], plans: [], truncated: true })).toEqual({
      choices: [],
      plans: [],
      truncated: true,
    });
    for (const change of [
      { approvalResource: "https://example.com/private" },
      { canExecute: true, state: "approval_pending" },
      { reversibility: "none" },
      { containmentId: id },
      { policyHashes: [hash, hash] },
      { rawEvidence: "private" },
    ])
      expect(() =>
        npRequireAgentIncidentResponseV1({ ...response, plans: [{ ...approved, ...change }] }),
      ).toThrow();
    for (const invalid of [
      { ...response, choices: [choice, choice] },
      { ...response, plans: [approved, approved] },
      { ...response, choices: [{ ...choice, capabilityId: "moderation.restore" }] },
      { ...response, choices: Array.from({ length: 101 }, () => choice) },
      { ...response, plans: Array.from({ length: 51 }, () => approved) },
      { ...response, rawEvidence: "private" },
    ])
      expect(() => npRequireAgentIncidentResponseV1(invalid)).toThrow();
  });
});
