import { describe, expect, it } from "vitest";
import {
  npRequireAgentMemberResponsePlanInputV1,
  npRequireAgentMemberResponseExecuteInputV1,
  npRequireAgentMemberResponseV1,
  npRequireAgentApprovalMemberResponseActionReviewV1,
  npAgentMemberResponsePlanInputSchemaV1,
  npAgentMemberResponseExecuteInputSchemaV1,
} from "./member-response-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import { npMemberResponseCapabilityDefinitionV1 } from "../agent/member-response-capability.js";
import { npAgentMcpToolDefinitionsV1 } from "./contract.js";
import type { NpAgentJsonObject } from "./types.js";

const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const plan = () => ({
  schemaVersion: "np.agent-member-response-plan-input.v1",
  expectedVersion: 1,
  memberId: id,
  expectedMemberVersionDigest: hash,
  operation: { kind: "restrict", durationSeconds: 3600 },
  idempotencyKey: "member-plan-1",
});
const execute = () => ({
  schemaVersion: "np.agent-member-response-execute-input.v1",
  expectedVersion: 1,
  actionId: id,
  approvalId: id,
  proposalHash: hash,
  idempotencyKey: "member-execute-1",
});
describe("explicit Member site response contracts", () => {
  it("accepts only bounded temporary restrictions or exact source-action revocations", () => {
    expect(npRequireAgentMemberResponsePlanInputV1(plan()).operation).toEqual({
      kind: "restrict",
      durationSeconds: 3600,
    });
    const revoked = { ...plan(), operation: { kind: "revoke", sourceActionId: id, banId: id } };
    expect(npRequireAgentMemberResponsePlanInputV1(revoked).operation).toEqual(revoked.operation);
    const invalidOperations: NpAgentJsonObject[] = [
      { kind: "permanent" },
      { kind: "restrict", durationSeconds: 0 },
      { kind: "restrict", durationSeconds: 2592001 },
      { kind: "restrict", durationSeconds: 60, scope: "global" },
      { kind: "revoke", banId: id },
      { kind: "revoke", sourceActionId: id, banId: id, all: true },
    ];
    for (const operation of invalidOperations) {
      expect(() => npRequireAgentMemberResponsePlanInputV1({ ...plan(), operation })).toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(npAgentMemberResponsePlanInputSchemaV1(), {
          ...plan(),
          operation,
        }),
      ).toThrow();
    }
    npRequireAgentProviderSchemaValueV1(npAgentMemberResponsePlanInputSchemaV1(), plan());
    npRequireAgentProviderSchemaValueV1(npAgentMemberResponsePlanInputSchemaV1(), revoked);
  });
  it("requires stable command identity, exact Incident version and signed proposal binding", () => {
    expect(npRequireAgentMemberResponseExecuteInputV1(execute())).toEqual(execute());
    npRequireAgentProviderSchemaValueV1(npAgentMemberResponseExecuteInputSchemaV1(), execute());
    for (const patch of [
      { expectedVersion: 0 },
      { approvalId: "missing" },
      { proposalHash: "not-a-digest" },
      { idempotencyKey: "unsafe key" },
      { force: true },
    ])
      expect(() =>
        npRequireAgentMemberResponseExecuteInputV1({ ...execute(), ...patch }),
      ).toThrow();
    const original = plan();
    const parsed = npRequireAgentMemberResponsePlanInputV1(original);
    original.operation.durationSeconds = 1;
    expect(parsed.operation).toEqual({ kind: "restrict", durationSeconds: 3600 });
  });
  it("keeps Member approval facts distinct from content containment and checks operation/capability pairing", () => {
    const review = {
      actionId: id,
      proposalHash: hash,
      capabilityId: "moderation.member.restrict",
      incidentId: id,
      memberId: id,
      expectedMemberVersionDigest: hash,
      operation: { kind: "restrict", durationSeconds: 60 },
      policyDigest: hash,
    };
    expect(npRequireAgentApprovalMemberResponseActionReviewV1(review)).toEqual(review);
    for (const patch of [
      { capabilityId: "moderation.member.revoke" },
      { containmentId: id },
      { actorBucket: "bucket" },
      { policyDigest: "invented" },
      { target: { kind: "document", id } },
    ])
      expect(() =>
        npRequireAgentApprovalMemberResponseActionReviewV1({ ...review, ...patch }),
      ).toThrow();
  });
  it("rejects false execution availability and incomplete or unbounded response projections", () => {
    const response = {
      schemaVersion: "np.agent-member-response.v1",
      incidentId: id,
      incidentVersion: 1,
      memberId: id,
      memberVersionDigest: hash,
      maximumDurationSeconds: 3600,
      canRestrict: true,
      revocable: [],
      plans: [],
      truncated: false,
    };
    expect(npRequireAgentMemberResponseV1(response)).toEqual(response);
    const entry = {
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      capabilityId: "moderation.member.restrict",
      operation: { kind: "restrict", durationSeconds: 60 },
      state: "approval_pending",
      approvalExpiresAt: "2026-10-16T01:00:00.000Z",
      canExecute: true,
    };
    expect(() => npRequireAgentMemberResponseV1({ ...response, plans: [entry] })).toThrow();
    expect(() =>
      npRequireAgentMemberResponseV1({
        ...response,
        plans: Array.from({ length: 26 }, () => ({ ...entry, canExecute: false })),
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentMemberResponseV1({
        ...response,
        memberProfile: { email: "private@example.com" },
      }),
    ).toThrow();
  });
  it("builds genuine staff-only human-approval definition evidence without adding Gateway tools", async () => {
    for (const id of ["moderation.member.restrict", "moderation.member.revoke"] as const) {
      const definition = await npMemberResponseCapabilityDefinitionV1(id);
      expect(definition.descriptor).toMatchObject({
        id,
        gateway: null,
        approval: "human",
        requiredScopes: ["moderation:execute"],
        scopeDerivation: "incident-target",
        idempotency: "required",
      });
      expect(definition.fingerprint).toMatch(/^cj1:sha256:/u);
      expect(npAgentMcpToolDefinitionsV1.flatMap((tool) => tool.capabilityIds)).not.toContain(id);
    }
  });
});
