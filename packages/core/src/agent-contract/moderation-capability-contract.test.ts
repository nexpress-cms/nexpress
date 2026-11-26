import { describe, expect, it } from "vitest";
import {
  npAgentModerationCapabilityDescriptorsV1,
  npAgentModerationCapabilityIdsV1,
  npBuildAgentModerationCapabilityDefinitionCanonicalV1,
  npRequireAgentModerationCapabilityInvocationResultV1,
} from "./moderation-capability-contract.js";
import {
  npRequireAgentInstalledCapabilityInputV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  npRequireAgentInstalledCapabilityOutputV1,
} from "./installed-capability-contract.js";
import { npRequireAgentInstalledCapabilityInvocationResultV1 } from "./agent-http-contract.js";
const id = "00000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
describe("optional installed moderation capabilities", () => {
  it("freezes target-derived scopes and declares proposal and exact reversible effects", () => {
    for (const capabilityId of npAgentModerationCapabilityIdsV1) {
      const descriptor = npAgentModerationCapabilityDescriptorsV1[capabilityId];
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(
        npBuildAgentModerationCapabilityDefinitionCanonicalV1(capabilityId).capabilities[0]
          ?.descriptor,
      ).toEqual(descriptor);
      expect(descriptor).toMatchObject({
        scopeDerivation: "moderation-target",
        requiredScopes: ["moderation:execute"],
        idempotency: "required",
        execution: "inline",
        effectProfiles: [
          { kind: "mutation", minimumGatewayExposure: "approved-execute" },
          { id: "domain.read", kind: "read", minimumGatewayExposure: "propose" },
        ],
      });
    }
    expect(npAgentModerationCapabilityDescriptorsV1["moderation.restore"]).toMatchObject({
      risk: "sensitive",
      approval: "human",
      effectProfiles: [{ reversibility: "none", compensatorId: null }, {}],
    });
  });
  it("routes installed inputs with mandatory idempotency and no approved-target substitution", () => {
    const input = {
      mode: "propose",
      proposal: {
        incidentId: null,
        target: { kind: "comment", collection: "posts", id },
        expectedVersionDigest: hash,
        reasonCode: "REPEATED_LINK",
      },
    };
    expect(npRequireAgentInstalledCapabilityInputV1("moderation.quarantine", input)).toEqual(input);
    const request = {
      schemaVersion: "np.agent-invocation-request.v1",
      capabilityId: "moderation.quarantine",
      arguments: { input, idempotencyKey: "caller-stable" },
    };
    expect(npRequireAgentInstalledCapabilityInvocationRequestV1(request)).toEqual(request);
    expect(() =>
      npRequireAgentInstalledCapabilityInvocationRequestV1({
        ...request,
        arguments: { input, idempotencyKey: null },
      }),
    ).toThrow();
  });
  it("keeps approval-required and verified terminal outcomes distinct under the selected capability", () => {
    const approval = {
      state: "approval_required",
      runId: id,
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      approvalResource: `/admin/agents/approvals/${id}`,
      expiresAt: "2026-09-27T00:10:00.000Z",
    };
    expect(npRequireAgentInstalledCapabilityOutputV1("moderation.quarantine", approval)).toEqual(
      approval,
    );
    expect(() =>
      npRequireAgentInstalledCapabilityOutputV1("moderation.quarantine", {
        ...approval,
        approvalResource: "https://example.test/approval",
      }),
    ).toThrow();
    const result = {
      schemaVersion: "np.agent-moderation-invocation-result.v1",
      invocationId: id,
      capabilityId: "moderation.restore",
      output: approval,
    };
    expect(npRequireAgentInstalledCapabilityInvocationResultV1(result)).toEqual(result);
    const terminal = {
      schemaVersion: "np.agent-direct-action.v1",
      actionId: id,
      resultDigest: hash,
      verificationRefs: [id],
      containmentId: id,
      state: "compensated",
    };
    expect(
      npRequireAgentModerationCapabilityInvocationResultV1({ ...result, output: terminal }).output,
    ).toEqual(terminal);
    expect(() =>
      npRequireAgentModerationCapabilityInvocationResultV1({
        ...result,
        capabilityId: "moderation.quarantine",
        output: terminal,
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentInstalledCapabilityOutputV1("moderation.restore", {
        ...approval,
        authority: "approved",
      }),
    ).toThrow();
  });
});
