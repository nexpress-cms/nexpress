import {
  analyzeCanonicalBody,
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { npRequireAgentCapabilityRegistryCanonical } from "./canonical-capability-registry.js";
import { npRequireAgentCapabilityDescriptor, npRequireAgentContractResult } from "./contract.js";
import {
  npAgentContainmentCreateOutputSchemaV1,
  npAgentContainmentRestoreOutputSchemaV1,
  npAgentDirectActionApprovalRequiredSchemaV1,
  npAgentQuarantineInputSchemaV1,
  npAgentRestoreInputSchemaV1,
  npRequireAgentContainmentCreateOutputV1,
  npRequireAgentContainmentRestoreOutputV1,
  npRequireAgentDirectActionApprovalRequiredV1,
  npRequireAgentQuarantineInputV1,
  npRequireAgentRestoreInputV1,
  type NpAgentContainmentCreateOutputV1,
  type NpAgentContainmentRestoreOutputV1,
  type NpAgentDirectActionApprovalRequiredV1,
  type NpAgentDirectActionInput,
  type NpAgentQuarantineProposalV1,
  type NpAgentRestoreProposalV1,
} from "./moderator-contract.js";
import type { NpAgentCapabilityDescriptor, NpAgentJsonObject, NpAgentJsonSchema } from "./types.js";

export const npAgentModerationCapabilityIdsV1 = [
  "moderation.quarantine",
  "moderation.restore",
] as const;
export type NpAgentModerationCapabilityIdV1 = (typeof npAgentModerationCapabilityIdsV1)[number];
export interface NpAgentModerationCapabilityInputMapV1 {
  "moderation.quarantine": NpAgentDirectActionInput<NpAgentQuarantineProposalV1>;
  "moderation.restore": NpAgentDirectActionInput<NpAgentRestoreProposalV1>;
}
export interface NpAgentModerationCapabilityOutputMapV1 {
  "moderation.quarantine": NpAgentContainmentCreateOutputV1 | NpAgentDirectActionApprovalRequiredV1;
  "moderation.restore": NpAgentContainmentRestoreOutputV1 | NpAgentDirectActionApprovalRequiredV1;
}
export type NpAgentModerationCapabilityInvocationRequestV1 = {
  [C in NpAgentModerationCapabilityIdV1]: {
    schemaVersion: "np.agent-invocation-request.v1";
    capabilityId: C;
    arguments: { input: NpAgentModerationCapabilityInputMapV1[C]; idempotencyKey: string };
  };
}[NpAgentModerationCapabilityIdV1];
export interface NpAgentModerationCapabilityInvocationResultV1 {
  schemaVersion: "np.agent-moderation-invocation-result.v1";
  invocationId: string;
  capabilityId: NpAgentModerationCapabilityIdV1;
  output: NpAgentModerationCapabilityOutputMapV1[NpAgentModerationCapabilityIdV1];
}
export function npIsAgentModerationCapabilityIdV1(
  id: string,
): id is NpAgentModerationCapabilityIdV1 {
  return (npAgentModerationCapabilityIdsV1 as readonly string[]).includes(id);
}
export function npRequireAgentModerationCapabilityInputV1<
  C extends NpAgentModerationCapabilityIdV1,
>(id: C, value: unknown): NpAgentModerationCapabilityInputMapV1[C] {
  return (
    id === "moderation.quarantine"
      ? npRequireAgentQuarantineInputV1(value)
      : npRequireAgentRestoreInputV1(value)
  ) as NpAgentModerationCapabilityInputMapV1[C];
}
export function npRequireAgentModerationCapabilityOutputV1<
  C extends NpAgentModerationCapabilityIdV1,
>(id: C, value: unknown): NpAgentModerationCapabilityOutputMapV1[C] {
  const resultState =
    typeof value === "object" && value !== null
      ? (Object.getOwnPropertyDescriptor(value, "state")?.value as unknown)
      : undefined;
  return (
    resultState === "approval_required"
      ? npRequireAgentDirectActionApprovalRequiredV1(value)
      : id === "moderation.quarantine"
        ? npRequireAgentContainmentCreateOutputV1(value)
        : npRequireAgentContainmentRestoreOutputV1(value)
  ) as NpAgentModerationCapabilityOutputMapV1[C];
}
export function npRequireAgentModerationCapabilityInvocationRequestV1(
  value: unknown,
): NpAgentModerationCapabilityInvocationRequestV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.moderation.request", () => {
      const path = "agent.moderation.request";
      const inspection = { seen: new WeakSet<object>() };
      const keys = ["schemaVersion", "capabilityId", "arguments"];
      const raw = canonicalBodyRecord(value, path, keys, keys, inspection);
      if (raw.schemaVersion !== "np.agent-invocation-request.v1")
        failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid request schema");
      const capabilityId = canonicalBodyEnum<NpAgentModerationCapabilityIdV1>(
        raw.capabilityId,
        `${path}.capabilityId`,
        new Set(npAgentModerationCapabilityIdsV1),
      );
      const args = canonicalBodyRecord(
        raw.arguments,
        `${path}.arguments`,
        ["input", "idempotencyKey"],
        ["input", "idempotencyKey"],
        inspection,
      );
      if (
        typeof args.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(args.idempotencyKey)
      )
        failCanonicalBody(
          "invalid-field",
          `${path}.arguments.idempotencyKey`,
          "requires a caller-stable idempotency key",
        );
      return {
        schemaVersion: "np.agent-invocation-request.v1",
        capabilityId,
        arguments: {
          input: npRequireAgentModerationCapabilityInputV1(capabilityId, args.input),
          idempotencyKey: args.idempotencyKey,
        },
      } as NpAgentModerationCapabilityInvocationRequestV1;
    }),
  );
}
export function npRequireAgentModerationCapabilityInvocationResultV1(
  value: unknown,
): NpAgentModerationCapabilityInvocationResultV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.moderation.result", () => {
      const path = "agent.moderation.result";
      const keys = ["schemaVersion", "invocationId", "capabilityId", "output"];
      const raw = canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet<object>() });
      if (raw.schemaVersion !== "np.agent-moderation-invocation-result.v1")
        failCanonicalBody("invalid-field", `${path}.schemaVersion`, "invalid result schema");
      const capabilityId = canonicalBodyEnum<NpAgentModerationCapabilityIdV1>(
        raw.capabilityId,
        `${path}.capabilityId`,
        new Set(npAgentModerationCapabilityIdsV1),
      );
      return {
        schemaVersion: "np.agent-moderation-invocation-result.v1",
        invocationId: canonicalBodyUuid(raw.invocationId, `${path}.invocationId`),
        capabilityId,
        output: npRequireAgentModerationCapabilityOutputV1(capabilityId, raw.output),
      };
    }),
  );
}
function unionOutput(terminal: NpAgentJsonSchema): NpAgentJsonSchema {
  const approval = npAgentDirectActionApprovalRequiredSchemaV1();
  const properties: NpAgentJsonObject = {};
  for (const branch of [terminal, approval]) {
    if (
      branch.properties &&
      typeof branch.properties === "object" &&
      !Array.isArray(branch.properties)
    )
      Object.assign(properties, branch.properties);
  }
  // The branch validates state-dependent required fields; the root only excludes unknown keys.
  delete properties.state;
  properties.state = {
    type: "string",
    maxLength: 17,
    enum: ["approval_required", "succeeded", "failed", "compensated"],
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties,
    oneOf: [terminal, approval],
  };
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const npAgentModerationInputSchemasV1 = freeze({
  "moderation.quarantine": npAgentQuarantineInputSchemaV1(),
  "moderation.restore": npAgentRestoreInputSchemaV1(),
});
export const npAgentModerationOutputSchemasV1 = freeze({
  "moderation.quarantine": unionOutput(npAgentContainmentCreateOutputSchemaV1()),
  "moderation.restore": unionOutput(npAgentContainmentRestoreOutputSchemaV1()),
});
function descriptor(id: NpAgentModerationCapabilityIdV1): NpAgentCapabilityDescriptor {
  const restore = id === "moderation.restore";
  return npRequireAgentCapabilityDescriptor(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-capability.v1",
        id,
        contractVersion: 1,
        source: "core",
        title: restore ? "Restore quarantined content" : "Quarantine content",
        description:
          "Propose or execute an exact human-approved moderation action under current authority and target-version checks.",
        requiredScopes: ["moderation:execute"],
        scopeDerivation: "moderation-target",
        risk: restore ? "sensitive" : "reversible",
        approval: restore ? "human" : "policy",
        effectProfiles: [
          {
            id: restore ? "containment.restore" : "containment.create",
            kind: "mutation",
            reversibility: restore ? "none" : "compensatable",
            minimumGatewayExposure: "approved-execute",
            verifierId: restore ? "containment.restore.verify" : "containment.verify",
            compensatorId: restore ? null : "containment.compensate",
          },
          {
            id: "domain.read",
            kind: "read",
            reversibility: "none",
            minimumGatewayExposure: "propose",
            verifierId: null,
            compensatorId: null,
          },
        ],
        bootstrapIntent: "write",
        execution: "inline",
        idempotency: "required",
        gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
        inputSchema: npAgentModerationInputSchemasV1[id],
        outputSchema: npAgentModerationOutputSchemasV1[id],
      }),
    ),
  );
}
export const npAgentModerationCapabilityDescriptorsV1: Readonly<
  Record<NpAgentModerationCapabilityIdV1, NpAgentCapabilityDescriptor>
> = freeze({
  "moderation.quarantine": descriptor("moderation.quarantine"),
  "moderation.restore": descriptor("moderation.restore"),
});
export function npBuildAgentModerationCapabilityDefinitionCanonicalV1(
  id: NpAgentModerationCapabilityIdV1,
) {
  const descriptor = npAgentModerationCapabilityDescriptorsV1[id];
  return npRequireAgentCapabilityRegistryCanonical(
    JSON.parse(
      JSON.stringify({
        schemaVersion: "np.agent-capability-registry.v1",
        projection: "definition",
        capabilities: [
          {
            descriptor,
            implementationVersion: 1,
            effectProfiles: descriptor.effectProfiles.map((profile) => ({
              schemaVersion: "np.agent-effect-profile.v1",
              capabilityId: id,
              capabilityContractVersion: descriptor.contractVersion,
              implementationVersion: 1,
              profileId: profile.id,
              kind: profile.kind,
              reversibility: profile.reversibility,
              minimumGatewayExposure: profile.minimumGatewayExposure,
              effectContractVersion: 1,
              verifierId: profile.verifierId,
              compensatorId: profile.compensatorId,
            })),
          },
        ],
      }),
    ),
  );
}
