import {
  npAgentHttpRoutesV1,
  npBuildAgentHttpInvocationSchemasV1,
  npAgentInstalledCapabilityIdsV1,
  npAgentInstalledCapabilityDescriptorsV1,
  npAgentRunStates,
} from "@nexpress/core/agent-contract";

type Schema = Record<string, unknown>;
function object(properties: Schema): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
function nullable(schema: Schema): Schema {
  return { oneOf: [schema, { type: "null" }] };
}
function relocate(value: unknown, root: string): unknown {
  if (Array.isArray(value)) return value.map((v) => relocate(v, root));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      k === "$ref" && typeof v === "string" && v.startsWith("#/")
        ? `${root}${v.slice(1)}`
        : relocate(v, root),
    ]),
  );
}
/** Framework descriptors only. MCP JSON-RPC and plugin operations are not REST tools. */
export function buildAgentHttpOpenApiV1() {
  const invocation = npBuildAgentHttpInvocationSchemasV1();
  const uuid = { type: "string", format: "uuid" };
  const utc = { type: "string", format: "date-time" };
  const integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  const text = { type: "string", maxLength: 1024 };
  const run = object({
    schemaVersion: { const: "np.agent-run.v1" },
    id: uuid,
    siteId: text,
    origin: { enum: ["gateway", "runtime"] },
    agent: nullable(object({ id: uuid, versionId: uuid })),
    principalId: uuid,
    rootRunId: uuid,
    parentRunId: nullable(uuid),
    causalDepth: integer,
    state: { enum: npAgentRunStates },
    goal: { type: "string", maxLength: 2000 },
    runLimits: object({
      schemaVersion: { const: "np.agent-run-limits.v1" },
      ...Object.fromEntries(
        [
          "maxAttempts",
          "maxProviderCalls",
          "maxCapabilityCalls",
          "maxInputTokens",
          "maxOutputTokens",
          "maxCostMicros",
          "maxWallClockSeconds",
        ].map((k) => [k, integer]),
      ),
    }),
    usage: object(
      Object.fromEntries(
        [
          "providerCalls",
          "capabilityCalls",
          "inputTokens",
          "cachedInputTokens",
          "outputTokens",
          "costMicros",
        ].map((k) => [k, integer]),
      ),
    ),
    attempt: { type: "integer", minimum: 1, maximum: 2147483647 },
    errorCode: nullable(text),
    errorMessage: nullable(text),
    queuedAt: utc,
    deadlineAt: utc,
    startedAt: nullable(utc),
    finishedAt: nullable(utc),
  });
  const schemas: Record<string, Schema> = {
    NpAgentHttpInvocationRequest: relocate(
      invocation.request,
      "#/components/schemas/NpAgentHttpInvocationRequest",
    ) as Schema,
    NpAgentHttpInvocationResult: relocate(
      invocation.result,
      "#/components/schemas/NpAgentHttpInvocationResult",
    ) as Schema,
    NpAgentHttpCapabilities: object({
      schemaVersion: { const: "np.agent-http-capabilities.v1" },
      capabilities: {
        type: "array",
        maxItems: npAgentInstalledCapabilityIdsV1.length,
        uniqueItems: true,
        items: {
          oneOf: npAgentInstalledCapabilityIdsV1.map((id) => ({
            const: npAgentInstalledCapabilityDescriptorsV1[id],
          })),
        },
      },
    }),
    NpAgentHttpRun: object({
      schemaVersion: { const: "np.agent-activity-run.v1" },
      run,
      invocationId: nullable(uuid),
      evidence: { enum: ["redacted", "expired"] },
      auditEventIds: { type: "array", maxItems: 100, items: uuid },
    }),
  };
  const paths: Record<string, Schema> = {};
  for (const route of npAgentHttpRoutesV1) {
    const artifact = route.operationId === "agentHttpArtifact";
    const schema =
      route.operationId === "agentHttpCapabilities"
        ? "NpAgentHttpCapabilities"
        : route.operationId === "agentHttpInvoke"
          ? "NpAgentHttpInvocationResult"
          : "NpAgentHttpRun";
    const parameters = [...route.path.matchAll(/\{([^}]+)\}/gu)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: uuid,
    }));
    paths[route.path] = {
      [route.method.toLowerCase()]: {
        operationId: route.operationId,
        tags: ["Agent HTTP"],
        description:
          "Discovery only. Every request requires an agent-http service credential bound to the canonical HTTPS site /api/agent/v1 audience and current effective authority. Cookie, MCP OAuth and other transport credentials are not accepted.",
        security: [{ agentHttpServiceBearer: [] }],
        ...(parameters.length ? { parameters } : {}),
        ...(route.method === "POST"
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/NpAgentHttpInvocationRequest" },
                  },
                },
              },
            }
          : {}),
        responses: {
          "200": {
            description:
              "Authorized client-safe projection; artifacts require an explicitly injected shared facade.",
            content: artifact
              ? Object.fromEntries(
                  ["image/png", "image/webp", "application/json"].map((mime) => [
                    mime,
                    { schema: { type: "string", format: "binary" } },
                  ]),
                )
              : { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
          },
          ...Object.fromEntries(
            [400, 401, 403, 404, 409, 429, 500, 503].map((status) => [
              String(status),
              { description: "Safe bounded API error" },
            ]),
          ),
        },
      },
    };
  }
  return {
    schemas,
    paths,
    securitySchemes: {
      agentHttpServiceBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "agent-http service credential",
        description:
          "Audience is the canonical full https://<site-host>/api/agent/v1 resource. OpenAPI discovery does not grant authority.",
      },
    },
  };
}
