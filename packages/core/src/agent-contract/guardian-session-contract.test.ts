import type { NpAgentJsonObject } from "./types.js";
import { describe, expect, it } from "vitest";
import {
  npRequireAgentGuardianSessionPlanInputV1,
  npRequireAgentGuardianSessionExecuteInputV1,
  npRequireAgentGuardianSessionV1,
  npAgentGuardianSessionPlanInputSchemaV1,
  npAgentGuardianSessionExecuteInputSchemaV1,
} from "./guardian-session-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
const id = "00000000-0000-4000-8000-000000000001",
  hash = `cj1:sha256:${"A".repeat(43)}`;
const plan = {
  schemaVersion: "np.agent-guardian-session-plan-input.v1",
  expectedVersion: 1,
  expectedTargetVersionDigest: hash,
  idempotencyKey: "stable-plan",
};
const execute = {
  schemaVersion: "np.agent-guardian-session-execute-input.v1",
  expectedVersion: 1,
  actionId: id,
  approvalId: id,
  proposalHash: hash,
  idempotencyKey: "stable-execute",
};
describe("Guardian exact session response contracts", () => {
  it("accepts only server reference preconditions and rejects browser target/impact/credential authority", () => {
    expect(npRequireAgentGuardianSessionPlanInputV1(plan)).toEqual(plan);
    npRequireAgentProviderSchemaValueV1(npAgentGuardianSessionPlanInputSchemaV1(), plan);
    expect(npRequireAgentGuardianSessionExecuteInputV1(execute)).toEqual(execute);
    npRequireAgentProviderSchemaValueV1(npAgentGuardianSessionExecuteInputSchemaV1(), execute);
    const extras: NpAgentJsonObject[] = [
      { sessionFamilyId: id },
      { principalId: id },
      { impact: "site" },
      { isSuperAdmin: true },
      { accessToken: "private" },
    ];
    for (const extra of extras) {
      expect(() => npRequireAgentGuardianSessionPlanInputV1({ ...plan, ...extra })).toThrow();
      expect(() =>
        npRequireAgentProviderSchemaValueV1(npAgentGuardianSessionPlanInputSchemaV1(), {
          ...plan,
          ...extra,
        }),
      ).toThrow();
    }
  });
  it("rejects duplicate and impossible executable retained plans", () => {
    const entry = {
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      state: "succeeded",
      approvalExpiresAt: "2026-10-18T01:00:00.000Z",
      canExecute: false,
    };
    const response = {
      schemaVersion: "np.agent-guardian-session.v1",
      incidentId: id,
      incidentVersion: 1,
      targetVersionDigest: hash,
      target: {
        actorKind: "staff",
        sessionFamilyId: id,
        createdAt: "2026-10-18T00:00:00.000Z",
        impact: "deployment",
        affectedSiteCount: 1,
        impactDigest: hash,
      },
      canPlan: false,
      plans: [entry],
      truncated: false,
    };
    expect(npRequireAgentGuardianSessionV1(response)).toEqual(response);
    expect(() => npRequireAgentGuardianSessionV1({ ...response, plans: [entry, entry] })).toThrow();
    expect(() =>
      npRequireAgentGuardianSessionV1({ ...response, plans: [{ ...entry, canExecute: true }] }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianSessionV1({
        ...response,
        target: { ...response.target, impact: "site" },
      }),
    ).toThrow();
  });
});
