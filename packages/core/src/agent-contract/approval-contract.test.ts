import { describe, expect, it } from "vitest";
import {
  npRequireAgentApprovalChallengeRequestV1,
  npRequireAgentApprovalChallengeOutputV1,
  npRequireAgentApprovalDecisionInputV1,
  npRequireAgentChangeSetRequestApprovalInputV1,
  npRequireAgentApprovalListItemV1,
  npRequireAgentApprovalDetailV1,
  npRequireAgentApprovalPageV1,
  npRequireAgentApprovalQueryV1,
  npAgentApprovalChallengeRequestSchemaV1,
  npAgentApprovalDetailSchemaV1,
  npAgentApprovalChallengeOutputSchemaV1,
  npAgentApprovalDecisionInputSchemaV1,
  npAgentChangeSetRequestApprovalInputSchemaV1,
  type NpAgentApprovalListItemV1,
} from "./approval-contract.js";
import { npAnalyzeAgentJsonSchema } from "./contract.js";
import { npRequireAgentApprovalTargetV1 } from "./canonical-approval.js";
import { npAgentAdminOperationsV1 } from "./admin-operation-registry.js";
const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const now = "2026-09-09T00:00:00.000Z",
  later = "2026-09-09T01:00:00.000Z";
const request = {
  schemaVersion: "np.agent-changeset-request-approval-input.v1",
  expectedDraftVersion: 1,
  planHash: hash,
  intendedOperation: "apply",
  scheduledFor: null,
  idempotencyKey: "request-1",
};
const challengeRequest = {
  schemaVersion: "np.agent-approval-challenge-request.v1",
  purpose: "approve",
  expectedApprovalVersion: 1,
  statementHash: hash,
  idempotencyKey: "challenge-1",
};
const decision = {
  schemaVersion: "np.agent-approval-decision-input.v1",
  expectedApprovalVersion: 2,
  statementHash: hash,
  challengeGeneration: 1,
  challenge: "A".repeat(43),
  idempotencyKey: "decision-1",
  reason: null,
};
function item(): NpAgentApprovalListItemV1 {
  return {
    schemaVersion: "np.agent-approval-list-item.v1",
    approval: {
      id,
      generation: 1,
      state: "pending",
      statementHash: hash,
      requiredHumanCapabilities: ["content.publish"],
      requiredHumanPredicates: [],
      requestedAt: now,
      expiresAt: later,
      decidedAt: null,
    },
    version: 1,
    target: { kind: "changeset", changeSetId: id, planHash: hash, scheduledFor: null },
    intendedOperation: "apply",
    scheduledFor: null,
    statementHash: hash,
    reauthentication: { mode: "none" },
    allowedDecisions: ["approve", "reject", "revoke"],
    risk: "reversible",
    capabilityId: "changeset.apply",
    capabilityContractVersion: 1,
    capabilityFingerprint: hash,
    policyHashes: [],
    requiresLivePreview: false,
    requiredScopes: ["changeset:apply"],
    requester: { kind: "staff", id },
    reviewSummary: {
      operationCount: 1,
      targetCount: 1,
      previewState: null,
      checksRun: null,
      rollbackPlan: "unavailable",
    },
  };
}
describe("approval request, challenge and safe review contracts", () => {
  it("closes decision bodies and binds schedule time to intent", () => {
    expect(npRequireAgentChangeSetRequestApprovalInputV1(request)).toEqual(request);
    expect(
      npRequireAgentChangeSetRequestApprovalInputV1({
        ...request,
        intendedOperation: "schedule",
        scheduledFor: later,
      }).scheduledFor,
    ).toBe(later);
    for (const bad of [
      { ...request, intendedOperation: "schedule" },
      { ...request, scheduledFor: later },
      { ...request, approvalId: id },
      { ...request, expectedDraftVersion: 0 },
    ])
      expect(() => npRequireAgentChangeSetRequestApprovalInputV1(bad)).toThrow();
    expect(npRequireAgentApprovalChallengeRequestV1(challengeRequest)).toEqual(challengeRequest);
    expect(npRequireAgentApprovalDecisionInputV1(decision)).toEqual(decision);
    for (const bad of [
      { ...decision, comment: "legacy" },
      { ...decision, target: { kind: "action" } },
      { ...decision, challenge: "short" },
      { ...decision, challenge: "A".repeat(42) + "B" },
      { ...decision, challengeGeneration: 0 },
      { ...decision, reason: "x".repeat(2001) },
    ])
      expect(() => npRequireAgentApprovalDecisionInputV1(bad)).toThrow();
    const output = {
      schemaVersion: "np.agent-approval-challenge.v1",
      approvalId: id,
      approvalVersion: 2,
      purpose: "approve",
      challengeGeneration: 1,
      challenge: decision.challenge,
      reauthentication: { mode: "recent", maxAgeSeconds: 60, assurance: "staff-primary" },
      expiresAt: later,
    };
    expect(npRequireAgentApprovalChallengeOutputV1(output)).toEqual(output);
    expect(() =>
      npRequireAgentApprovalChallengeOutputV1({
        ...output,
        reauthentication: { ...output.reauthentication, maxAgeSeconds: 301 },
      }),
    ).toThrow();
  });
  it("reuses canonical target closure and safe approval summaries", () => {
    expect(npRequireAgentApprovalListItemV1(item())).toEqual(item());
    expect(npRequireAgentApprovalTargetV1(item().target)).toEqual(item().target);
    expect(() =>
      npRequireAgentApprovalTargetV1({ kind: "changeset", changeSetId: id, planHash: hash }),
    ).toThrow();
    for (const field of [
      "credential",
      "locator",
      "statementBody",
      "statementMac",
      "challenge",
      "reason",
      "fingerprint",
    ])
      expect(() => npRequireAgentApprovalListItemV1({ ...item(), [field]: "hidden" })).toThrow();
    for (const bad of [
      { ...item(), target: { ...item().target, scheduledFor: later } },
      { ...item(), allowedDecisions: ["revoke", "approve"] },
      { ...item(), approval: { ...item().approval, state: "expired" } },
      { ...item(), requester: { kind: "principal", id: null } },
    ])
      expect(() => npRequireAgentApprovalListItemV1(bad)).toThrow();
    expect(
      npRequireAgentApprovalDetailV1({
        schemaVersion: "np.agent-approval-detail.v1",
        rollbackReview: null,
        item: item(),
        review: null,
      }).review,
    ).toBeNull();
    expect(
      npRequireAgentApprovalPageV1({
        schemaVersion: "np.agent-approval-page.v1",
        items: [item()],
        nextCursor: null,
      }).items,
    ).toHaveLength(1);
    expect(() =>
      npRequireAgentApprovalPageV1({
        schemaVersion: "np.agent-approval-page.v1",
        items: [item(), item()],
        nextCursor: null,
      }),
    ).toThrow();
  });
  it("bounds recorded review metadata without claiming execution readiness", () => {
    const summary = item().reviewSummary;
    expect(
      npRequireAgentApprovalListItemV1({
        ...item(),
        reviewSummary: { ...summary, previewState: "expired", checksRun: 3 },
      }).reviewSummary.checksRun,
    ).toBe(3);
    for (const patch of [
      { operationCount: 0 },
      { operationCount: 501 },
      { targetCount: 2 },
      { checksRun: 0 },
      { previewState: "passed" },
      { rollbackPlan: "ready" },
      { rawReport: "hidden" },
    ])
      expect(() =>
        npRequireAgentApprovalListItemV1({ ...item(), reviewSummary: { ...summary, ...patch } }),
      ).toThrow();
  });
  it("fixes queue ordering by expiry, descending risk and ascending id", () => {
    const a = item(),
      b = item();
    b.approval.id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
    const page = (items: NpAgentApprovalListItemV1[]) => ({
      schemaVersion: "np.agent-approval-page.v1",
      items,
      nextCursor: null,
    });
    expect(npRequireAgentApprovalPageV1(page([a, b])).items).toHaveLength(2);
    expect(() => npRequireAgentApprovalPageV1(page([b, a]))).toThrow();
    b.risk = "destructive";
    expect(npRequireAgentApprovalPageV1(page([b, a])).items).toHaveLength(2);
    expect(() => npRequireAgentApprovalPageV1(page([a, b]))).toThrow();
    b.approval.expiresAt = "2026-09-09T02:00:00.000Z";
    expect(npRequireAgentApprovalPageV1(page([a, b])).items).toHaveLength(2);
    expect(() => npRequireAgentApprovalPageV1(page([b, a]))).toThrow();
  });
  it("bounds current filters and rejects malformed or ambiguous queries", () => {
    expect(npRequireAgentApprovalQueryV1({})).toMatchObject({ state: "pending", limit: 25 });
    expect(
      npRequireAgentApprovalQueryV1({
        state: null,
        requesterKind: "staff",
        requesterId: id,
        limit: 100,
      }),
    ).toMatchObject({ state: null, requesterId: id });
    for (const bad of [
      { limit: 101 },
      { limit: "25" },
      { requesterId: id },
      { createdAfter: later, createdBefore: now },
      { sort: "private" },
      { cursor: "../bad" },
    ])
      expect(() => npRequireAgentApprovalQueryV1(bad)).toThrow();
  });
  it("projects all four approval mutation outputs from the same full detail schema", () => {
    expect(npAnalyzeAgentJsonSchema(npAgentApprovalDetailSchemaV1).ok).toBe(true);
    expect(npAgentApprovalDetailSchemaV1.required).toEqual([
      "schemaVersion",
      "item",
      "review",
      "rollbackReview",
    ]);
    const properties = npAgentApprovalDetailSchemaV1.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.item.required).toEqual(expect.arrayContaining(Object.keys(item())));
    expect(properties.item.additionalProperties).toBe(false);
    for (const id of [
      "agents.changesets.request_approval",
      "agents.approvals.approve",
      "agents.approvals.reject",
      "agents.approvals.revoke",
    ] as const)
      expect(npAgentAdminOperationsV1[id].schemas.output.schema).toEqual(
        npAgentApprovalDetailSchemaV1,
      );
  });
  it("projects named schemas and exact relevant Admin preconditions", () => {
    for (const schema of [
      npAgentApprovalChallengeRequestSchemaV1,
      npAgentApprovalDetailSchemaV1,
      npAgentApprovalChallengeOutputSchemaV1,
      npAgentApprovalDecisionInputSchemaV1,
      npAgentChangeSetRequestApprovalInputSchemaV1,
    ])
      expect(npAnalyzeAgentJsonSchema(schema).ok).toBe(true);
    expect(npAgentAdminOperationsV1["agents.approvals.approve"].schemas.input.schema).toEqual(
      npAgentApprovalDecisionInputSchemaV1,
    );
    expect(
      npAgentAdminOperationsV1["agents.approvals.approve"].preconditions.map((p) => p.field),
    ).toEqual(["expectedApprovalVersion", "statementHash"]);
    expect(
      npAgentAdminOperationsV1["agents.changesets.request_approval"].preconditions.map(
        (p) => p.field,
      ),
    ).toEqual(["expectedDraftVersion", "planHash"]);
    expect(
      npAgentAdminOperationsV1["agents.approvals.decision_challenge"].approval
        .reauthenticationFloor,
    ).toBe("none");
  });
});
