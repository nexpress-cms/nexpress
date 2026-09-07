import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyRecord,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { npRequireAgentCapabilityDescriptor, npRequireAgentContractResult } from "./contract.js";
import {
  npAgentReadCapabilityDescriptorsV1,
  npAgentReadCapabilityIdsV1,
  npRequireAgentReadCapabilityOutputV1,
  type NpAgentReadCapabilityIdV1,
  type NpAgentReadCapabilityOutputMapV1,
} from "./read-capability-contract.js";
import type {
  NpAgentCapabilityDescriptor,
  NpAgentContractResult,
  NpAgentJsonSchema,
} from "./types.js";

/** Closed, same-origin discovery surface. Discovery never grants authority. */
export const npAgentHttpRoutesV1 = Object.freeze([
  { method: "GET", path: "/api/agent/v1/capabilities", operationId: "agentHttpCapabilities" },
  { method: "POST", path: "/api/agent/v1/invocations", operationId: "agentHttpInvoke" },
  { method: "GET", path: "/api/agent/v1/runs/{runId}", operationId: "agentHttpRun" },
  {
    method: "GET",
    path: "/api/agent/v1/previews/{previewId}/artifacts/{artifactId}",
    operationId: "agentHttpArtifact",
  },
] as const);
export const npAgentHttpLimitsV1 = Object.freeze({
  requestBytes: 5 * 1024 * 1024,
  responseBytes: 4 * 1024 * 1024,
  artifactBytes: 2 * 1024 * 1024,
});
export interface NpAgentReadCapabilityInvocationResultV1<
  C extends NpAgentReadCapabilityIdV1 = NpAgentReadCapabilityIdV1,
> {
  schemaVersion: "np.agent-read-invocation-result.v1";
  invocationId: string;
  actionId: string;
  capabilityId: C;
  output: NpAgentReadCapabilityOutputMapV1[C];
}
export interface NpAgentHttpCapabilitiesV1 {
  schemaVersion: "np.agent-http-capabilities.v1";
  capabilities: NpAgentCapabilityDescriptor[];
}
export function npRequireAgentHttpCapabilitiesV1(value: unknown): NpAgentHttpCapabilitiesV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.http.capabilities", () => {
      const r = canonicalBodyRecord(
        value,
        "agent.http.capabilities",
        ["schemaVersion", "capabilities"],
        ["schemaVersion", "capabilities"],
        { seen: new WeakSet() },
      );
      if (r.schemaVersion !== "np.agent-http-capabilities.v1")
        failCanonicalBody(
          "shape",
          "agent.http.capabilities",
          "must be a bounded capability inventory",
        );
      const capabilities = canonicalBodyArray(
        r.capabilities,
        "agent.http.capabilities.items",
        npAgentReadCapabilityIdsV1.length,
        { seen: new WeakSet() },
      ).map(npRequireAgentCapabilityDescriptor);
      let previous = "";
      for (const d of capabilities) {
        if (
          !npAgentReadCapabilityIdsV1.includes(d.id as NpAgentReadCapabilityIdV1) ||
          d.id <= previous ||
          JSON.stringify(d) !==
            JSON.stringify(npAgentReadCapabilityDescriptorsV1[d.id as NpAgentReadCapabilityIdV1])
        )
          failCanonicalBody(
            "invalid-field",
            "agent.http.capabilities",
            "must contain exact sorted framework descriptors",
          );
        previous = d.id;
      }
      return { schemaVersion: "np.agent-http-capabilities.v1", capabilities };
    }),
    "Invalid Agent HTTP capability projection",
  );
}
export function npAnalyzeAgentReadCapabilityInvocationResultV1(
  value: unknown,
): NpAgentContractResult<NpAgentReadCapabilityInvocationResultV1> {
  return analyzeCanonicalBody("agent.http.result", () => {
    const p = "agent.http.result";
    const r = canonicalBodyRecord(
      value,
      p,
      ["schemaVersion", "invocationId", "actionId", "capabilityId", "output"],
      ["schemaVersion", "invocationId", "actionId", "capabilityId", "output"],
      { seen: new WeakSet() },
    );
    if (r.schemaVersion !== "np.agent-read-invocation-result.v1")
      failCanonicalBody(
        "invalid-field",
        `${p}.schemaVersion`,
        "must be np.agent-read-invocation-result.v1",
      );
    const capabilityId = canonicalBodyEnum<NpAgentReadCapabilityIdV1>(
      r.capabilityId,
      `${p}.capabilityId`,
      new Set(npAgentReadCapabilityIdsV1),
    );
    return {
      schemaVersion: "np.agent-read-invocation-result.v1",
      invocationId: canonicalBodyUuid(r.invocationId, `${p}.invocationId`),
      actionId: canonicalBodyUuid(r.actionId, `${p}.actionId`),
      capabilityId,
      output: npRequireAgentReadCapabilityOutputV1(capabilityId, r.output),
    };
  });
}
export function npRequireAgentReadCapabilityInvocationResultV1(
  value: unknown,
): NpAgentReadCapabilityInvocationResultV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentReadCapabilityInvocationResultV1(value),
    "Invalid Agent invocation result",
  );
}

function object(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}
/** Relocate descriptor-local refs while preserving the original schema verbatim otherwise. */
function embed(schema: NpAgentJsonSchema, prefix: string): unknown {
  if (Array.isArray(schema)) return schema.map((v) => embed(v as NpAgentJsonSchema, prefix));
  if (schema === null || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [
      k,
      k === "$ref" && typeof v === "string" && v.startsWith("#/")
        ? `${prefix}${v.slice(1)}`
        : embed(v as NpAgentJsonSchema, prefix),
    ]),
  );
}
export function npBuildAgentHttpInvocationSchemasV1(): {
  request: Record<string, unknown>;
  result: Record<string, unknown>;
} {
  const requestDefs: Record<string, unknown> = {};
  const resultDefs: Record<string, unknown> = {};
  const request = npAgentReadCapabilityIdsV1.map((id, index) => {
    const d = npAgentReadCapabilityDescriptorsV1[id];
    const name = `capability${index}`;
    requestDefs[name] = embed(d.inputSchema, `#/$defs/${name}`);
    resultDefs[name] = embed(d.outputSchema, `#/$defs/${name}`);
    return {
      ...object({
        schemaVersion: { const: "np.agent-invocation-request.v1" },
        capabilityId: { const: id },
        arguments: object({ input: { $ref: `#/$defs/${name}` }, idempotencyKey: { type: "null" } }),
      }),
      ...npAgentHttpCapabilityMetadataV1(d),
    };
  });
  const result = npAgentReadCapabilityIdsV1.map((id, index) => ({
    ...object({
      schemaVersion: { const: "np.agent-read-invocation-result.v1" },
      invocationId: { type: "string", format: "uuid" },
      actionId: { type: "string", format: "uuid" },
      capabilityId: { const: id },
      output: { $ref: `#/$defs/capability${index}` },
    }),
    ...npAgentHttpCapabilityMetadataV1(npAgentReadCapabilityDescriptorsV1[id]),
  }));
  return {
    request: { oneOf: request, $defs: requestDefs },
    result: { oneOf: result, $defs: resultDefs },
  };
}
export function npAgentHttpCapabilityMetadataV1(d: NpAgentCapabilityDescriptor) {
  return {
    "x-nexpress-capability-id": d.id,
    "x-nexpress-scopes": d.requiredScopes,
    "x-nexpress-scope-derivation": d.scopeDerivation,
    "x-nexpress-risk": d.risk,
    "x-nexpress-approval": d.approval,
    "x-nexpress-idempotency": d.idempotency,
  };
}
