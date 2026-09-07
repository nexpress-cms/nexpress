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
        npAgentReadCapabilityIdsV1,
      );
      for (const [index, id] of npAgentReadCapabilityIdsV1.entries()) {
        expect(branches[index]).toMatchObject({
          additionalProperties: false,
          "x-nexpress-capability-id": id,
          "x-nexpress-scopes": npAgentReadCapabilityDescriptorsV1[id].requiredScopes,
          "x-nexpress-risk": "read",
          "x-nexpress-approval": "none",
          "x-nexpress-idempotency": "none",
        });
      }
    }
    expect(JSON.stringify(schemas.request)).toContain("#/$defs/capability0/$defs/filter");
    expect(
      createHash("sha256")
        .update(JSON.stringify({ routes: npAgentHttpRoutesV1, schemas }))
        .digest("hex"),
    ).toMatchInlineSnapshot(`"f114032cf6862b2d5536b3778c1fd741451d436a51cdbeeebfb3b12e4bdc98fe"`);
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
});
