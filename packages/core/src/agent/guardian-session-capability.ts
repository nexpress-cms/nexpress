import { npRequireAgentCapabilityDescriptor } from "../agent-contract/contract.js";
import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npAgentGuardianSessionPlanInputSchemaV1,
  npAgentGuardianSessionTargetSchemaV1,
} from "../agent-contract/guardian-session-contract.js";
import type {
  NpAgentCapabilityDescriptor,
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentJsonObject,
  NpAgentJsonSchema,
} from "../agent-contract/types.js";

export interface NpGuardianSessionCapabilityDefinitionV1 {
  canonical: NpAgentCapabilityRegistryCanonicalV1;
  fingerprint: string;
  descriptor: NpAgentCapabilityDescriptor;
  profile: string;
  verifierId: string;
}

/** Private execution input: exact server-resolved facts, distinct from the Admin plan command. */
export function npGuardianSessionActionInputSchemaV1(): NpAgentJsonSchema {
  const uuid = { type: "string", format: "uuid", maxLength: 36 };
  const digest = { type: "string", pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$", maxLength: 54 };
  const properties: NpAgentJsonObject = {
    schemaVersion: { const: "np.agent-guardian-session-action-input.v1" },
    command: npAgentGuardianSessionPlanInputSchemaV1(),
    family: {
      type: "object",
      additionalProperties: false,
      properties: {
        actorKind: { enum: ["staff", "member"] },
        principalId: uuid,
        sessionFamilyId: uuid,
      },
      required: ["actorKind", "principalId", "sessionFamilyId"],
    },
    target: npAgentGuardianSessionTargetSchemaV1(),
    sourceDigest: digest,
    policyDigest: digest,
  };
  return JSON.parse(
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    }),
  ) as NpAgentJsonSchema;
}

/** Staff-owned definition evidence only. This module never registers a Gateway capability. */
export async function npGuardianSessionCapabilityDefinitionV1(): Promise<NpGuardianSessionCapabilityDefinitionV1> {
  const id = "security.revokeSessions";
  const profile = "sessions.revoke";
  const verifierId = `${profile}.verify`;
  const descriptor = npRequireAgentCapabilityDescriptor({
    schemaVersion: "np.agent-capability.v1",
    id,
    contractVersion: 1,
    source: "core",
    title: "Terminate the exact observed browser session family",
    description:
      "Explicit staff-only atomic termination after a distinct super administrator approves the exact current Incident, session family, deployment impact and policy.",
    requiredScopes: ["security:execute"],
    scopeDerivation: "security-target",
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
    inputSchema: npGuardianSessionActionInputSchemaV1(),
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
