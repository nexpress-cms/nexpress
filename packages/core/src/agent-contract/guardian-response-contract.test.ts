import { describe, expect, it } from "vitest";
import {
  npRequireAgentGuardianResponsePlanInputV1,
  npRequireAgentGuardianResponseExecuteInputV1,
  npRequireAgentGuardianResponseV1,
  npRequireAgentApprovalGuardianResponseActionReviewV1,
  npAgentGuardianResponsePlanInputSchemaV1,
  npAgentGuardianResponseExecuteInputSchemaV1,
} from "./guardian-response-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import type { NpAgentJsonObject } from "./types.js";

const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const plan = () => ({
  schemaVersion: "np.agent-guardian-response-plan-input.v1",
  expectedVersion: 1,
  expectedTargetVersionDigest: hash,
  operation: { kind: "limit", durationSeconds: 3600, actionScopes: ["auth.staff"] },
  idempotencyKey: "member-plan-1",
});
const execute = () => ({
  schemaVersion: "np.agent-guardian-response-execute-input.v1",
  expectedVersion: 1,
  actionId: id,
  approvalId: id,
  proposalHash: hash,
  idempotencyKey: "member-execute-1",
});
describe("explicit Guardian request response contracts", () => {
  it("accepts only bounded temporary restrictions or exact source-action revocations", () => {
    expect(npRequireAgentGuardianResponsePlanInputV1(plan()).operation).toEqual({
      kind: "limit",
      durationSeconds: 3600,
      actionScopes: ["auth.staff"],
    });
    const revoked = {
      ...plan(),
      operation: { kind: "remove", sourceActionId: id, restrictionId: id },
    };
    expect(npRequireAgentGuardianResponsePlanInputV1(revoked).operation).toEqual(revoked.operation);
    expect(() =>
      npRequireAgentGuardianResponsePlanInputV1({
        ...plan(),
        operation: {
          kind: "limit",
          durationSeconds: 60,
          actionScopes: ["auth.staff", "auth.member"],
        },
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianResponsePlanInputV1({
        ...plan(),
        operation: {
          kind: "limit",
          durationSeconds: 60,
          actionScopes: ["auth.staff", "auth.staff"],
        },
      }),
    ).toThrow();
    const invalidOperations: NpAgentJsonObject[] = [
      { kind: "permanent" },
      { kind: "limit", durationSeconds: 0 },
      { kind: "limit", durationSeconds: 3601 },
      { kind: "limit", durationSeconds: 60, actionScopes: ["auth.staff"], scope: "global" },
      { kind: "remove", restrictionId: id },
      { kind: "remove", sourceActionId: id, restrictionId: id, all: true },
    ];
    for (const operation of invalidOperations) {
      expect(() => npRequireAgentGuardianResponsePlanInputV1({ ...plan(), operation })).toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(npAgentGuardianResponsePlanInputSchemaV1(), {
          ...plan(),
          operation,
        }),
      ).toThrow();
    }
    npRequireAgentProviderSchemaValueV1(npAgentGuardianResponsePlanInputSchemaV1(), plan());
    npRequireAgentProviderSchemaValueV1(npAgentGuardianResponsePlanInputSchemaV1(), revoked);
  });
  it("requires stable command identity, exact Incident version and signed proposal binding", () => {
    expect(npRequireAgentGuardianResponseExecuteInputV1(execute())).toEqual(execute());
    npRequireAgentProviderSchemaValueV1(npAgentGuardianResponseExecuteInputSchemaV1(), execute());
    for (const patch of [
      { expectedVersion: 0 },
      { approvalId: "missing" },
      { proposalHash: "not-a-digest" },
      { idempotencyKey: "unsafe key" },
      { force: true },
    ])
      expect(() =>
        npRequireAgentGuardianResponseExecuteInputV1({ ...execute(), ...patch }),
      ).toThrow();
    const original = plan();
    const parsed = npRequireAgentGuardianResponsePlanInputV1(original);
    original.operation.durationSeconds = 1;
    expect(parsed.operation).toEqual({
      kind: "limit",
      durationSeconds: 3600,
      actionScopes: ["auth.staff"],
    });
  });
  it("keeps Guardian approval facts distinct from content containment and checks operation/capability pairing", () => {
    const review = {
      actionId: id,
      proposalHash: hash,
      capabilityId: "security.limitActor",
      incidentId: id,
      expectedTargetVersionDigest: hash,
      operation: { kind: "limit", durationSeconds: 60, actionScopes: ["auth.staff"] },
      policyDigest: hash,
    };
    expect(npRequireAgentApprovalGuardianResponseActionReviewV1(review)).toEqual(review);
    for (const patch of [
      { capabilityId: "security.removeActorLimit" },
      { containmentId: id },
      { actorBucket: "bucket" },
      { policyDigest: "invented" },
      { target: { kind: "document", id } },
    ])
      expect(() =>
        npRequireAgentApprovalGuardianResponseActionReviewV1({ ...review, ...patch }),
      ).toThrow();
  });
  it("rejects false execution availability and incomplete or unbounded response projections", () => {
    const response = {
      schemaVersion: "np.agent-guardian-response.v1",
      incidentId: id,
      incidentVersion: 1,
      targetVersionDigest: hash,
      maximumDurationSeconds: 3600,
      canLimit: true,
      allowedScopes: ["auth.staff"],
      restrictions: [],
      plans: [],
      truncated: false,
    };
    expect(npRequireAgentGuardianResponseV1(response)).toEqual(response);
    const entry = {
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      capabilityId: "security.limitActor",
      operation: { kind: "limit", durationSeconds: 60, actionScopes: ["auth.staff"] },
      state: "approval_pending",
      approvalExpiresAt: "2026-10-16T01:00:00.000Z",
      canExecute: true,
    };
    expect(() => npRequireAgentGuardianResponseV1({ ...response, plans: [entry] })).toThrow();
    const recovering = { ...entry, state: "executing" };
    expect(
      npRequireAgentGuardianResponseV1({ ...response, plans: [recovering] }).plans[0]?.canExecute,
    ).toBe(true);
    expect(() =>
      npRequireAgentGuardianResponseV1({ ...response, plans: [{ ...entry, state: "succeeded" }] }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianResponseV1({ ...response, plans: [recovering, recovering] }),
    ).toThrow();
    const restriction = {
      restrictionId: id,
      sourceActionId: id,
      expiresAt: "2026-10-18T00:00:00.000Z",
      state: "active",
      rowVersion: 1,
      lastErrorCode: null,
      canRemove: true,
    };
    expect(
      npRequireAgentGuardianResponseV1({ ...response, restrictions: [restriction] }).restrictions[0]
        ?.canRemove,
    ).toBe(true);
    expect(() =>
      npRequireAgentGuardianResponseV1({
        ...response,
        restrictions: [{ ...restriction, state: "expired" }],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianResponseV1({
        ...response,
        plans: Array.from({ length: 26 }, () => ({ ...entry, canExecute: false })),
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianResponseV1({
        ...response,
        rawAddress: { email: "private@example.com" },
      }),
    ).toThrow();
  });
});
