import { describe, expect, it, vi } from "vitest";

import {
  NpAgentContractError,
  npAgentCapabilityIds,
  npAgentCapabilityScopeDerivations,
  npAgentContractLimits,
  npAgentDisabledGatewaySettingsV1,
  npAgentGatewayExposureAtLeast,
  npAgentGatewayTransports,
  npAgentMcpToolDefinitionsV1,
  npAgentMcpToolNames,
  npAgentScopeStaffCapability,
  npAgentScopes,
  npAnalyzeAgentCapabilityDescriptor,
  npAnalyzeAgentGatewaySettings,
  npAnalyzeAgentJsonSchema,
  npNarrowAgentGatewayExposure,
  npRequireAgentCapabilityDescriptor,
  npRequireAgentGatewaySettings,
  type NpAgentCapabilityDescriptor,
  type NpAgentGatewayExposureMode,
  type NpAgentJsonSchema,
} from "./index.js";

function schema(): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      slug: {
        type: "string",
        maxLength: 128,
      },
    },
    required: ["slug"],
  };
}

function readDescriptor(): NpAgentCapabilityDescriptor {
  return {
    schemaVersion: "np.agent-capability.v1",
    id: "content.query",
    contractVersion: 1,
    source: "core",
    title: "Query content",
    description: "Read one bounded, authorized content projection.",
    requiredScopes: ["content:read"],
    scopeDerivation: "content-query",
    risk: "read",
    approval: "none",
    effectProfiles: [
      {
        id: "domain.read",
        kind: "read",
        reversibility: "none",
        minimumGatewayExposure: "read",
        verifierId: null,
        compensatorId: null,
      },
    ],
    bootstrapIntent: "plugins",
    execution: "inline",
    idempotency: "none",
    gateway: {
      transports: ["agent-http", "mcp-http", "stdio"],
    },
    inputSchema: schema(),
    outputSchema: schema(),
  };
}

function mutationDescriptor(): NpAgentCapabilityDescriptor {
  return {
    schemaVersion: "np.agent-capability.v1",
    id: "changeset.create",
    contractVersion: 1,
    source: "app:nexpress",
    title: "Create ChangeSet",
    description: "Create one bounded draft ChangeSet without applying production effects.",
    requiredScopes: ["changeset:write"],
    scopeDerivation: "changeset-resources",
    risk: "reversible",
    approval: "none",
    effectProfiles: [
      {
        id: "changeset.draft-create",
        kind: "mutation",
        reversibility: "compensatable",
        minimumGatewayExposure: "propose",
        verifierId: "verify.changeset-draft",
        compensatorId: "compensate.changeset-draft",
      },
    ],
    bootstrapIntent: "write",
    execution: "inline",
    idempotency: "required",
    gateway: {
      transports: ["agent-http", "mcp-http", "stdio"],
    },
    inputSchema: schema(),
    outputSchema: schema(),
  };
}

describe("Agent contract foundation", () => {
  it("locks every scope, capability, staff ceiling, and MCP tool inventory", () => {
    expect(npAgentScopes).toHaveLength(23);
    expect(new Set(npAgentScopes).size).toBe(npAgentScopes.length);
    expect(Object.keys(npAgentScopeStaffCapability).sort()).toEqual([...npAgentScopes].sort());

    expect(npAgentCapabilityIds).toHaveLength(npAgentContractLimits.coreCapabilityDescriptors);
    expect(new Set(npAgentCapabilityIds).size).toBe(npAgentCapabilityIds.length);
    expect(Object.keys(npAgentCapabilityScopeDerivations).sort()).toEqual(
      [...npAgentCapabilityIds].sort(),
    );

    expect(npAgentMcpToolNames).toHaveLength(npAgentContractLimits.mcpTools);
    expect(npAgentMcpToolDefinitionsV1.map(({ name }) => name)).toEqual(npAgentMcpToolNames);
    expect(new Set(npAgentMcpToolNames).size).toBe(npAgentMcpToolNames.length);
    for (const definition of npAgentMcpToolDefinitionsV1) {
      expect(definition.capabilityIds.length).toBeGreaterThan(0);
      for (const capabilityId of definition.capabilityIds) {
        expect(npAgentCapabilityIds).toContain(capabilityId);
      }
    }
  });

  it("preserves all 18 tools at the maximum exposure while lower modes only narrow", () => {
    const visibleAt = (mode: NpAgentGatewayExposureMode) =>
      npAgentMcpToolDefinitionsV1
        .filter(({ listedFrom }) =>
          mode === "disabled" ? false : npAgentGatewayExposureAtLeast(mode, listedFrom),
        )
        .map(({ name }) => name);

    expect(visibleAt("disabled")).toEqual([]);
    expect(visibleAt("read")).toHaveLength(6);
    expect(visibleAt("propose")).toHaveLength(17);
    expect(visibleAt("approved-execute")).toEqual(npAgentMcpToolNames);
  });

  it("accepts exact read and mutation descriptors and returns safe copies", () => {
    const read = readDescriptor();
    const parsedRead = npRequireAgentCapabilityDescriptor(read);
    expect(parsedRead).toEqual(read);
    expect(parsedRead).not.toBe(read);
    expect(parsedRead.effectProfiles).not.toBe(read.effectProfiles);
    expect(parsedRead.inputSchema).not.toBe(read.inputSchema);

    expect(npRequireAgentCapabilityDescriptor(mutationDescriptor())).toMatchObject({
      id: "changeset.create",
      source: "app:nexpress",
      idempotency: "required",
      gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
    });
  });

  it("rejects unknown fields, unsorted scopes, and inventory drift", () => {
    expect(
      npAnalyzeAgentCapabilityDescriptor({ ...readDescriptor(), unexpected: true }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field", path: "agent.capability.unexpected" }],
    });

    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...readDescriptor(),
        requiredScopes: ["site:read", "content:read"],
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "order" }] });

    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...readDescriptor(),
        scopeDerivation: "none",
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-field", path: "agent.capability.scopeDerivation" }],
    });

    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...readDescriptor(),
        source: "plugin:secret-extension",
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.capability.source",
          message: "plugin-defined sources are not supported in v1",
        },
      ],
    });
  });

  it("enforces effect, idempotency, and Gateway projection invariants", () => {
    const mutation = mutationDescriptor();
    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...mutation,
        idempotency: "none",
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.capability.idempotency" }] });

    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...mutation,
        effectProfiles: [
          {
            ...mutation.effectProfiles[0],
            minimumGatewayExposure: "read",
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ path: "agent.capability.effectProfiles[0].minimumGatewayExposure" }],
    });

    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...readDescriptor(),
        gateway: null,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.capability.gateway" }] });

    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...readDescriptor(),
        effectProfiles: [
          {
            ...readDescriptor().effectProfiles[0],
            minimumGatewayExposure: null,
          },
        ],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.capability.gateway" }] });
  });

  it("requires bounded local-only JSON Schema references", () => {
    expect(
      npAnalyzeAgentJsonSchema({
        ...schema(),
        properties: { slug: { type: "string" } },
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.schema.properties.slug.maxLength" }] });

    expect(
      npAnalyzeAgentJsonSchema({
        ...schema(),
        properties: { slug: { $ref: "https://example.test/schema.json" } },
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.schema.properties.slug.$ref" }] });

    expect(
      npAnalyzeAgentJsonSchema({
        ...schema(),
        additionalProperties: true,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.schema.additionalProperties" }] });

    expect(
      npAnalyzeAgentJsonSchema({
        ...schema(),
        description: "\ud800",
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unsafe-value" }] });
  });

  it.each([
    { type: ["string", "null"] },
    {
      type: ["string", "null"],
      maxLength: npAgentContractLimits.jsonSchemaMaxStringCharacters + 1,
    },
    { type: ["array", "null"], items: {} },
    { type: ["array", "null"], maxItems: npAgentContractLimits.jsonSchemaMaxItems + 1, items: {} },
    { type: ["object", "null"], properties: {} },
  ])("enforces bounds and closure on nullable schemas: %j", (value) => {
    expect(npAnalyzeAgentJsonSchema({ ...schema(), properties: { value }, required: [] }).ok).toBe(
      false,
    );
  });

  it("accepts bounded closed nullable schemas", () => {
    expect(
      npAnalyzeAgentJsonSchema({
        ...schema(),
        properties: {
          label: { type: ["string", "null"], maxLength: 100 },
          rows: {
            type: ["array", "null"],
            maxItems: 100,
            items: { type: "string", maxLength: 100 },
          },
          details: { type: ["object", "null"], additionalProperties: false, properties: {} },
        },
        required: [],
      }).ok,
    ).toBe(true);
  });

  it("does not execute accessors or hostile reflection traps", () => {
    const getter = vi.fn(() => "Query content");
    const descriptor = readDescriptor();
    Object.defineProperty(descriptor, "title", { enumerable: true, get: getter });
    expect(npAnalyzeAgentCapabilityDescriptor(descriptor)).toMatchObject({
      ok: false,
      issues: [{ code: "shape", path: "agent.capability.title" }],
    });
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("must stay contained");
        },
      },
    );
    expect(npAnalyzeAgentCapabilityDescriptor(hostile)).toEqual({
      ok: false,
      issues: [
        {
          code: "unsafe-value",
          path: "agent.capability",
          message: "could not be inspected safely",
        },
      ],
    });
  });

  it("rejects shared references and safely copies special JSON keys", () => {
    const shared = schema();
    expect(
      npAnalyzeAgentCapabilityDescriptor({
        ...readDescriptor(),
        inputSchema: shared,
        outputSchema: shared,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "shape" }] });

    const specialSchema = JSON.parse(`{
      "$schema":"https://json-schema.org/draft/2020-12/schema",
      "type":"object",
      "additionalProperties":false,
      "properties":{"__proto__":{"type":"string","maxLength":16}}
    }`) as NpAgentJsonSchema;
    const result = npAnalyzeAgentJsonSchema(specialSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const properties = result.value.properties as Record<string, unknown>;
      expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
      expect(Object.hasOwn(properties, "__proto__")).toBe(true);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    }
  });

  it("validates exact Gateway settings and deterministic ceiling intersection", () => {
    expect(npAgentDisabledGatewaySettingsV1).toEqual({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "disabled",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    });
    expect(Object.isFrozen(npAgentDisabledGatewaySettingsV1)).toBe(true);
    expect(
      npRequireAgentGatewaySettings({
        schemaVersion: "np.agent-gateway-settings.v1",
        stdio: "approved-execute",
        mcpHttp: "read",
        agentHttp: "propose",
      }),
    ).toEqual({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "approved-execute",
      mcpHttp: "read",
      agentHttp: "propose",
    });
    expect(npAgentGatewayTransports).toEqual(["stdio", "mcp-http", "agent-http"]);
    expect(npNarrowAgentGatewayExposure()).toBe("disabled");
    expect(npNarrowAgentGatewayExposure("approved-execute", "propose", "approved-execute")).toBe(
      "propose",
    );
    expect(npNarrowAgentGatewayExposure("approved-execute", "disabled", "read")).toBe("disabled");

    expect(
      npAnalyzeAgentGatewaySettings({
        schemaVersion: "np.agent-gateway-settings.v1",
        stdio: "read",
        mcpHttp: "execute",
        agentHttp: "read",
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.gatewaySettings.mcpHttp" }] });
    expect(() => npRequireAgentGatewaySettings({})).toThrow(NpAgentContractError);
  });
});
