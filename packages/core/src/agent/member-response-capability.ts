import { npRequireAgentCapabilityDescriptor } from "../agent-contract/contract.js";
import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npAgentMemberResponsePlanInputSchemaV1,
  type NpAgentMemberResponseCapabilityIdV1,
} from "../agent-contract/member-response-contract.js";
import type {
  NpAgentCapabilityDescriptor,
  NpAgentCapabilityRegistryCanonicalV1,
} from "../agent-contract/types.js";

export interface NpMemberResponseCapabilityDefinitionV1 {
  canonical: NpAgentCapabilityRegistryCanonicalV1;
  fingerprint: string;
  descriptor: NpAgentCapabilityDescriptor;
  profile: string;
  verifierId: string;
}

/** Staff-owned definition evidence only. This module never registers a Gateway capability. */
export async function npMemberResponseCapabilityDefinitionV1(
  id: NpAgentMemberResponseCapabilityIdV1,
): Promise<NpMemberResponseCapabilityDefinitionV1> {
  const profile = id === "moderation.member.restrict" ? "member.restrict" : "member.revoke";
  const verifierId = `${profile}.verify`;
  const descriptor = npRequireAgentCapabilityDescriptor({
    schemaVersion: "np.agent-capability.v1",
    id,
    contractVersion: 1,
    source: "core",
    title:
      id === "moderation.member.restrict"
        ? "Temporarily restrict a Member on this site"
        : "Revoke this workflow's Member restriction",
    description:
      "Explicit staff-only execution after a distinct human approves the exact current Incident, Member, policy and site restriction facts.",
    requiredScopes: ["moderation:execute"],
    scopeDerivation: "incident-target",
    risk: "sensitive",
    approval: "human",
    effectProfiles: [
      {
        id: profile,
        kind: "mutation",
        reversibility: "none",
        minimumGatewayExposure: null,
        verifierId,
        compensatorId: null,
      },
    ],
    bootstrapIntent: "write",
    execution: "inline",
    idempotency: "required",
    gateway: null,
    inputSchema: npAgentMemberResponsePlanInputSchemaV1(),
    outputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        actionId: { type: "string", format: "uuid", maxLength: 36 },
        state: { const: "succeeded" },
        resultDigest: { type: "string", maxLength: 54 },
      },
      required: ["actionId", "state", "resultDigest"],
    },
  });
  const canonical = npRequireAgentCapabilityRegistryCanonical({
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "definition",
    capabilities: [
      {
        descriptor,
        implementationVersion: 1,
        effectProfiles: [
          {
            schemaVersion: "np.agent-effect-profile.v1",
            capabilityId: id,
            capabilityContractVersion: 1,
            implementationVersion: 1,
            profileId: profile,
            kind: "mutation",
            reversibility: "none",
            minimumGatewayExposure: null,
            effectContractVersion: 1,
            verifierId,
            compensatorId: null,
          },
        ],
      },
    ],
  });
  return {
    canonical,
    fingerprint: await npDigestAgentCapabilityRegistryCanonical(canonical, canonical.capabilities),
    descriptor,
    profile,
    verifierId,
  };
}
