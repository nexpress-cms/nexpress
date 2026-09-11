import {
  npAgentInstalledCapabilityIdsV1,
  npAgentInstalledCapabilityDescriptorsV1,
} from "./installed-capability-contract.js";
import { npAgentChangeSetRollbackModePoliciesV1 } from "./changeset-capability-schema.js";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  npAgentHttpRoutesV1,
  npBuildAgentHttpInvocationSchemasV1,
  npRequireAgentHttpCapabilitiesV1,
  npAnalyzeAgentReadCapabilityInvocationResultV1,
} from "./agent-http-contract.js";
import {
  npAgentReadCapabilityDescriptorsV1,
  npAgentReadCapabilityIdsV1,
} from "./read-capability-contract.js";

describe("Agent HTTP closed descriptor contract", () => {
  it("freezes four routes and exact descriptor-derived oneOf branches", () => {
    const schemas = npBuildAgentHttpInvocationSchemasV1();
    expect(npAgentHttpRoutesV1.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/agent/v1/capabilities",
      "POST /api/agent/v1/invocations",
      "GET /api/agent/v1/runs/{runId}",
      "GET /api/agent/v1/previews/{previewId}/artifacts/{artifactId}",
    ]);
    for (const schema of [schemas.request, schemas.result]) {
      const branches = schema.oneOf as Array<{ properties: { capabilityId: { const: string } } }>;
      expect(branches.map((b) => b.properties.capabilityId.const)).toEqual(
        npAgentInstalledCapabilityIdsV1,
      );
      for (const [index, id] of npAgentInstalledCapabilityIdsV1.entries()) {
        expect(branches[index]).toMatchObject({
          additionalProperties: false,
          "x-nexpress-capability-id": id,
          "x-nexpress-scopes": npAgentInstalledCapabilityDescriptorsV1[id].requiredScopes,
          "x-nexpress-risk": npAgentInstalledCapabilityDescriptorsV1[id].risk,
          "x-nexpress-approval": npAgentInstalledCapabilityDescriptorsV1[id].approval,
          "x-nexpress-idempotency": npAgentInstalledCapabilityDescriptorsV1[id].idempotency,
        });
      }
    }
    expect(JSON.stringify(schemas.request)).toContain("#/$defs/capability8/$defs/filter");
    expect(
      createHash("sha256")
        .update(JSON.stringify({ routes: npAgentHttpRoutesV1, schemas }))
        .digest("hex"),
    ).toMatchInlineSnapshot(`"13f892f339b95648763c03d9229eafa5b57e72e215047f6adc1bdb579672a302"`);
  });
  it("rejects modified, duplicate and unshipped capability descriptors", () => {
    const capabilities = npAgentReadCapabilityIdsV1.map(
      (id) => npAgentReadCapabilityDescriptorsV1[id],
    );
    expect(
      npRequireAgentHttpCapabilitiesV1({
        schemaVersion: "np.agent-http-capabilities.v1",
        capabilities,
      }).capabilities,
    ).toEqual(capabilities);
    for (const hostile of [
      [capabilities[0], capabilities[0]],
      [{ ...capabilities[0], title: "secret" }],
      [{ ...capabilities[0], id: "plugin.secret" }],
    ])
      expect(() =>
        npRequireAgentHttpCapabilitiesV1({
          schemaVersion: "np.agent-http-capabilities.v1",
          capabilities: hostile,
        }),
      ).toThrow();
  });
  it("does not evaluate hostile capability array accessors", () => {
    let called = false;
    const capabilities: unknown[] = [];
    Object.defineProperty(capabilities, "0", {
      get() {
        called = true;
        return npAgentReadCapabilityDescriptorsV1["site.inspect"];
      },
      enumerable: true,
    });
    expect(() =>
      npRequireAgentHttpCapabilitiesV1({
        schemaVersion: "np.agent-http-capabilities.v1",
        capabilities,
      }),
    ).toThrow();
    expect(called).toBe(false);
  });
  it("closes result keys and validates output against the selected descriptor", () => {
    const value = {
      schemaVersion: "np.agent-read-invocation-result.v1",
      invocationId: "00000000-0000-4000-8000-000000000001",
      actionId: "00000000-0000-4000-8000-000000000002",
      capabilityId: "schema.get",
      output: { schemaVersion: "np.agent-schema-output.v1" },
    };
    const valid = {
      ...value,
      capabilityId: "site.inspect",
      output: {
        schemaVersion: "np.agent-site-inspect.v1",
        site: { id: "default", name: "Default", defaultLocale: "en", locales: ["en"] },
        features: { remoteMcp: false, agentHttp: true, runtime: "disabled" },
        counts: { collections: 0, blocks: 0, activePlugins: 0 },
        resourceUris: [],
      },
    };
    expect(npAnalyzeAgentReadCapabilityInvocationResultV1(valid).ok).toBe(true);
    expect(
      npAnalyzeAgentReadCapabilityInvocationResultV1({
        ...valid,
        output: { ...valid.output, locator: "hidden" },
      }).ok,
    ).toBe(false);
    expect(npAnalyzeAgentReadCapabilityInvocationResultV1(value).ok).toBe(false);
    expect(
      npAnalyzeAgentReadCapabilityInvocationResultV1({ ...value, credential: "private" }).ok,
    ).toBe(false);
  });
  it("projects the same locked rollback mode floors through descriptor-derived HTTP schemas", () => {
    const schemas = npBuildAgentHttpInvocationSchemasV1();
    const index = npAgentInstalledCapabilityIdsV1.indexOf("changeset.rollback");
    const input = (
      schemas.request.$defs as Record<string, { oneOf: Array<Record<string, unknown>> }>
    )[`capability${index}`];
    for (const [position, mode] of ["prepare", "request_approval", "execute_approved"].entries()) {
      const policy =
        npAgentChangeSetRollbackModePoliciesV1[
          mode as keyof typeof npAgentChangeSetRollbackModePoliciesV1
        ];
      expect(input.oneOf[position]).toMatchObject({
        properties: { mode: { const: mode } },
        "x-nexpress-risk": policy.risk,
        "x-nexpress-approval": policy.approval,
        "x-nexpress-effect-profile": policy.effectProfileId,
        "x-nexpress-minimum-gateway-exposure": policy.minimumGatewayExposure,
      });
    }
    expect(input.oneOf[2]).toMatchObject({
      "x-nexpress-risk": "sensitive",
      "x-nexpress-approval": "human",
      "x-nexpress-minimum-gateway-exposure": "approved-execute",
    });
  });
});
