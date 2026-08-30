import { describe, expect, it } from "vitest";

import { npAgentReadCapabilityDescriptorsV1 } from "../agent-contract/index.js";
import {
  NpAgentCapabilityRegistryError,
  createAgentReadCapabilityRegistryV1,
} from "./capability-registry.js";

const output = {
  "site.inspect": {
    schemaVersion: "np.agent-site-inspect.v1" as const,
    site: { id: "default", name: "Default", defaultLocale: "en", locales: ["en"] },
    features: { remoteMcp: false, agentHttp: false, runtime: "disabled" as const },
    counts: { collections: 0, blocks: 0, activePlugins: 0 },
    resourceUris: [],
  },
  "schema.get": {
    schemaVersion: "np.agent-schema-resource.v1" as const,
    selector: { selector: "catalog" as const },
    digest: "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema" as const,
      type: "object" as const,
      additionalProperties: false as const,
      properties: {},
      required: [],
    },
  },
  "content.query": {
    schemaVersion: "np.agent-content-query.v1" as const,
    collection: "posts",
    items: [],
    nextCursor: null,
  },
};

const executors = {
  "site.inspect": () => output["site.inspect"],
  "schema.get": () => output["schema.get"],
  "content.query": () => output["content.query"],
};

describe("Agent capability registry", () => {
  it("freezes the exact installed registry and stable per-definition fingerprints", async () => {
    const first = await createAgentReadCapabilityRegistryV1(executors);
    const second = await createAgentReadCapabilityRegistryV1({
      ...executors,
      "site.inspect": () => ({ ...output["site.inspect"], resourceUris: ["ignored"] }),
    });
    expect(first.ids).toEqual(["content.query", "schema.get", "site.inspect"]);
    expect(first.registryFingerprint).toBe(second.registryFingerprint);
    expect(first.get("content.query").capabilityFingerprint).toBe(
      second.get("content.query").capabilityFingerprint,
    );
    expect(first.get("schema.get").canonical.descriptor).toEqual(
      npAgentReadCapabilityDescriptorsV1["schema.get"],
    );
    expect(Object.isFrozen(first.get("schema.get"))).toBe(true);
    expect(Object.isFrozen(first.get("schema.get").definition)).toBe(true);
    expect(Object.isFrozen(first.get("schema.get").definitionCanonical.capabilities)).toBe(true);
    expect(() => {
      (
        first.get("schema.get").definition as { implementationVersion: number }
      ).implementationVersion = 2;
    }).toThrow(TypeError);
  });

  it("fails closed for unavailable capability ids", async () => {
    const registry = await createAgentReadCapabilityRegistryV1(executors);
    expect(() => registry.get("unknown" as never)).toThrow(NpAgentCapabilityRegistryError);
  });

  it("derives draft scope without changing published-read requirements", async () => {
    const registry = await createAgentReadCapabilityRegistryV1(executors, {
      "content.query": () => ({
        additionalScopes: [],
        targetRefs: [],
        riskFloor: "read",
        approvalFloor: "none",
      }),
    });
    const definition = registry.get("content.query").definition;
    const context = {
      siteId: "default",
      principal: {
        kind: "service" as const,
        principalId: "01900000-0000-7000-8000-000000000001",
        siteId: "default",
        authority: {
          kind: "user" as const,
          userId: "01900000-0000-7000-8000-000000000002",
        },
        credentialId: "01900000-0000-7000-8000-000000000003",
        gatewayExposureCeiling: "read" as const,
        scopes: ["content:read" as const, "content:draft" as const, "site:read" as const],
      },
      requestedAt: "2026-08-30T00:00:00.000Z",
    };
    const input = {
      collection: "posts",
      filter: null,
      fields: [],
      audience: "public" as const,
      status: "published" as const,
      sort: [],
      limit: 10,
      cursor: null,
    };
    expect(await definition.deriveRequirements?.(input, context)).toMatchObject({
      additionalScopes: [],
    });
    expect(
      await definition.deriveRequirements?.({ ...input, status: "any" }, context),
    ).toMatchObject({
      additionalScopes: ["content:draft"],
    });
    expect(registry.get("content.query").definitionCanonical).toMatchObject({
      projection: "definition",
      capabilities: [{ descriptor: { id: "content.query" } }],
    });
  });

  it("rejects unknown scopes and incomplete versioned-target requirements", async () => {
    const unknownScope = await createAgentReadCapabilityRegistryV1(executors, {
      "site.inspect": () => ({
        additionalScopes: ["unknown:read" as never],
        targetRefs: [],
        riskFloor: "read",
        approvalFloor: "none",
      }),
    });
    const versionedTarget = await createAgentReadCapabilityRegistryV1(executors, {
      "site.inspect": () => ({
        additionalScopes: [],
        targetRefs: [{ kind: "document", collection: "posts", documentId: "post-1" }],
        riskFloor: "read",
        approvalFloor: "none",
      }),
    });
    const context = {
      siteId: "default",
      principal: {
        kind: "service" as const,
        principalId: "01900000-0000-7000-8000-000000000001",
        siteId: "default",
        authority: {
          kind: "user" as const,
          userId: "01900000-0000-7000-8000-000000000002",
        },
        credentialId: "01900000-0000-7000-8000-000000000003",
        gatewayExposureCeiling: "read" as const,
        scopes: ["site:read" as const],
      },
      requestedAt: "2026-08-30T00:00:00.000Z",
    };
    await expect(
      unknownScope.get("site.inspect").definition.deriveRequirements?.({}, context),
    ).rejects.toThrow(NpAgentCapabilityRegistryError);
    await expect(
      versionedTarget.get("site.inspect").definition.deriveRequirements?.({}, context),
    ).rejects.toThrow(NpAgentCapabilityRegistryError);
  });
});
