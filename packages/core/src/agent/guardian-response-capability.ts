import { npRequireAgentCapabilityDescriptor } from "../agent-contract/contract.js";
import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npAgentGuardianResponsePlanInputSchemaV1,
  npAgentGuardianAutomaticResponseInputSchemaV1,
  type NpAgentGuardianResponseCapabilityIdV1,
} from "../agent-contract/guardian-response-contract.js";
import type {
  NpAgentCapabilityDescriptor,
  NpAgentCapabilityRegistryCanonicalV1,
} from "../agent-contract/types.js";

export interface NpGuardianResponseCapabilityDefinitionV1 {
  canonical: NpAgentCapabilityRegistryCanonicalV1;
  fingerprint: string;
  descriptor: NpAgentCapabilityDescriptor;
  profile: string;
  verifierId: string;
}

/** Staff-owned definition evidence only. This module never registers a Gateway capability. */
export async function npGuardianResponseCapabilityDefinitionV1(
  id: NpAgentGuardianResponseCapabilityIdV1,
): Promise<NpGuardianResponseCapabilityDefinitionV1> {
  return definition(id, false);
}
export const NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1 = "guardian.limit.automatic.v1";
/** Internal policy-owned definition; never advertised as a model or Gateway tool. */
export function npGuardianAutomaticResponseCapabilityDefinitionV1(): Promise<NpGuardianResponseCapabilityDefinitionV1> {
  return definition("security.limitActor", true);
}
async function definition(
  id: NpAgentGuardianResponseCapabilityIdV1,
  automatic: boolean,
): Promise<NpGuardianResponseCapabilityDefinitionV1> {
  const profile = automatic
    ? NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1
    : id === "security.limitActor"
      ? "guardian.limit"
      : "guardian.remove";
  const verifierId = `${profile}.verify`;
  const descriptor = npRequireAgentCapabilityDescriptor({
    schemaVersion: "np.agent-capability.v1",
    id,
    contractVersion: 1,
    source: "core",
    title: automatic
      ? "Apply a qualified staff-reviewed temporary authentication limit"
      : id === "security.limitActor"
        ? "Temporarily limit requests from the observed network"
        : "Remove this workflow's temporary request limit",
    description: automatic
      ? "Private deterministic policy execution from signed request facts and a current verified staff escalation, with exact short expiry and frozen compensation."
      : "Explicit staff-only execution after a distinct human approves the exact current Incident, network projection, policy and request restriction facts.",
    requiredScopes: ["security:execute"],
    scopeDerivation: "security-target",
    risk: automatic ? "reversible" : "sensitive",
    approval: automatic ? "policy" : "human",
    effectProfiles: [
      {
        id: profile,
        kind: "mutation",
        reversibility: id === "security.limitActor" ? "compensatable" : "none",
        minimumGatewayExposure: null,
        verifierId,
        compensatorId: id === "security.limitActor" ? "guardian.limit.remove.v1" : null,
      },
    ],
    bootstrapIntent: "write",
    execution: "inline",
    idempotency: "required",
    gateway: null,
    inputSchema: automatic
      ? npAgentGuardianAutomaticResponseInputSchemaV1()
      : npAgentGuardianResponsePlanInputSchemaV1(),
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
            reversibility: id === "security.limitActor" ? "compensatable" : "none",
            minimumGatewayExposure: null,
            effectContractVersion: 1,
            verifierId,
            compensatorId: id === "security.limitActor" ? "guardian.limit.remove.v1" : null,
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
