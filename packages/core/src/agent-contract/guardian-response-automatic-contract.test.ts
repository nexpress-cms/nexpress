import type { NpAgentJsonObject } from "./types.js";
import { describe, expect, it, vi } from "vitest";
import {
  npRequireAgentGuardianAutomaticResponseInputV1,
  npRequireAgentGuardianAutomaticResponseActionV1,
  npAgentGuardianAutomaticResponseInputSchemaV1,
} from "./guardian-response-contract.js";
import type { NpAgentAutomaticGuardianLimitAuthorizationV1 } from "./automatic-guardian-limit-contract.js";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const digest = `cj1:sha256:${"A".repeat(43)}`;
const input = () => ({
  schemaVersion: "np.agent-guardian-automatic-response-input.v1" as const,
  incidentId: id(1),
  signalId: id(2),
  expectedVersion: 2,
  idempotencyKey: "auto-test-1",
});
function envelope() {
  const authorization: NpAgentAutomaticGuardianLimitAuthorizationV1 = {
    schemaVersion: "np.agent-automatic-guardian-limit-authorization.v1",
    policyId: "reviewed-auth-limit",
    policyVersion: 1,
    deploymentDigest: digest,
    policyDigest: digest,
    siteId: "default",
    principalId: id(3),
    ruleKind: "staff-escalated-auth-rule.v1",
    incidentId: id(1),
    incidentVersion: 2,
    incidentFingerprint: digest,
    incidentUpdatedAt: "2026-10-18T00:02:00.000Z",
    incidentSeverity: "high",
    signalId: id(2),
    detectorId: "guardian.login-failures",
    detectorVersion: 1,
    signalEvidenceDigest: digest,
    sourceEventIds: [10, 11, 12, 13, 14].map(id),
    sourceFactsDigest: digest,
    sourceWindow: { startedAt: "2026-10-18T00:00:00.000Z", endedAt: "2026-10-18T00:01:00.000Z" },
    sourceBaselineSeverity: "medium",
    observedCount: 5,
    countBasis: "at-least",
    staffEscalation: {
      timelineEntryId: id(4),
      transitionVersion: 2,
      fromSeverity: "medium",
      toSeverity: "high",
      createdAt: "2026-10-18T00:02:00.000Z",
      evidenceDigest: digest,
    },
    subject: {
      kind: "opaque_actor_bucket",
      purpose: "network-address",
      projectionVersion: 1,
      projectionFingerprint: digest,
      keyId: "auth-key-v1",
      bucket: "A".repeat(43),
    },
    actionScopes: ["auth.staff"],
    authorizedAt: "2026-10-18T00:03:00.000Z",
    expiresAt: "2026-10-18T00:05:00.000Z",
  };
  return {
    schemaVersion: "np.agent-guardian-automatic-response-action.v1",
    request: input(),
    authorization,
    controlPolicyDigest: digest,
    command: {
      schemaVersion: "np.agent-guardian-response-plan-input.v1",
      expectedVersion: 2,
      expectedTargetVersionDigest: digest,
      operation: { kind: "limit", durationSeconds: 120, actionScopes: ["auth.staff"] },
      idempotencyKey: "auto-test-1",
    },
  };
}
describe("private automatic Guardian response contract", () => {
  it("accepts only exact Incident/Signal generation and stable command identity", () => {
    expect(npRequireAgentGuardianAutomaticResponseInputV1(input())).toEqual(input());
    npRequireAgentProviderSchemaValueV1(npAgentGuardianAutomaticResponseInputSchemaV1(), input());
    expect(npRequireAgentGuardianAutomaticResponseActionV1(envelope())).toEqual(envelope());
  });
  const rejectedInputs: NpAgentJsonObject[] = [
    { subject: "invented" },
    { actionScopes: ["auth.member"] },
    { durationSeconds: 900 },
    { approvalId: null },
    { automatic: true },
    { operation: { kind: "remove" } },
    { expectedVersion: 0 },
    { signalId: "bad" },
  ];
  it.each(rejectedInputs)("rejects caller-owned authority or malformed identity %j", (patch) => {
    expect(() =>
      npRequireAgentGuardianAutomaticResponseInputV1({ ...input(), ...patch }),
    ).toThrow();
    expect(() =>
      npRequireAgentProviderSchemaValueV1(npAgentGuardianAutomaticResponseInputSchemaV1(), {
        ...input(),
        ...patch,
      }),
    ).toThrow();
  });
  it.each(["signal", "incident", "version", "command-key", "duration", "scope", "remove"] as const)(
    "binds frozen envelope %s exactly",
    (field) => {
      const value = envelope();
      if (field === "signal") value.request.signalId = id(8);
      if (field === "incident") value.request.incidentId = id(8);
      if (field === "version") value.request.expectedVersion = 3;
      if (field === "command-key") value.command.idempotencyKey = "different";
      if (field === "duration") value.command.operation.durationSeconds = 121;
      if (field === "scope") value.command.operation.actionScopes = ["auth.member"];
      if (field === "remove")
        Object.assign(value.command, {
          operation: { kind: "remove", sourceActionId: id(8), restrictionId: id(9) },
        });
      expect(() => npRequireAgentGuardianAutomaticResponseActionV1(value)).toThrow();
    },
  );
  it("copies private proof without executing accessors or retaining graph aliases", () => {
    const value = envelope(),
      parsed = npRequireAgentGuardianAutomaticResponseActionV1(value);
    value.authorization.sourceEventIds.length = 0;
    expect(parsed.authorization.sourceEventIds).toHaveLength(5);
    const unsafe = envelope(),
      getter = vi.fn(() => input());
    Object.defineProperty(unsafe, "request", { enumerable: true, get: getter });
    expect(() => npRequireAgentGuardianAutomaticResponseActionV1(unsafe)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const extra = envelope();
    expect(() =>
      npRequireAgentGuardianAutomaticResponseActionV1({ ...extra, qualified: true }),
    ).toThrow();
  });
});
