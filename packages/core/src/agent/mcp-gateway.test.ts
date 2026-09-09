import {
  npAgentInstalledCapabilityDescriptorsV1,
  type NpAgentInstalledCapabilityIdV1,
} from "../agent-contract/installed-capability-contract.js";
import { describe, expect, it, vi } from "vitest";

import { type NpAgentReadCapabilityIdV1 } from "../agent-contract/index.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";
import { createAgentMcpGatewayV1 } from "./mcp-gateway.js";

function authentication(): NpAgentCapabilityAuthenticationV1 {
  return {
    principal: { id: "01900000-0000-7000-8000-000000000001", siteId: "default" },
    scopes: ["site:read", "schema:read", "content:read"],
    authorizationContextFingerprint: "cj1:sha256:authorization",
    authorizationContext: {
      siteId: "default",
      authorityRef: { kind: "service-family" },
    },
  } as unknown as NpAgentCapabilityAuthenticationV1;
}

function entry(id: NpAgentInstalledCapabilityIdV1) {
  return {
    definition: { descriptor: npAgentInstalledCapabilityDescriptorsV1[id] },
    capabilityFingerprint: `cj1:sha256:${id}`,
  };
}

function admission(ids: NpAgentInstalledCapabilityIdV1[]) {
  return {
    project: vi.fn(() =>
      Promise.resolve({
        principal: { siteId: "default" },
        settings: { stdio: "read", mcpHttp: "read", agentHttp: "disabled" },
        registryFingerprint: "cj1:sha256:registry",
        entries: ids.map(entry),
      }),
    ),
    invoke: vi.fn((input: { request: { capabilityId: NpAgentReadCapabilityIdV1 } }) =>
      Promise.resolve({
        output:
          input.request.capabilityId === "site.inspect"
            ? {
                schemaVersion: "np.agent-site-inspect.v1",
                site: { id: "default", name: "Site", defaultLocale: "en", locales: ["en"] },
                features: { remoteMcp: true, agentHttp: false, runtime: "disabled" },
                counts: { collections: 0, blocks: 0, activePlugins: 0 },
                resourceUris: [],
              }
            : { schemaVersion: "np.agent-schema-resource.v1" },
      }),
    ),
  } as unknown as NpAgentCapabilityAdmissionServiceV1;
}

describe("Agent MCP core projection", () => {
  it("resolves every local schema reference from the advertised tool root", async () => {
    const gateway = createAgentMcpGatewayV1({
      admission: admission(
        Object.keys(npAgentInstalledCapabilityDescriptorsV1) as NpAgentInstalledCapabilityIdV1[],
      ),
      cursorKey: { id: "test", key: new Uint8Array(32).fill(7) },
    });
    for (const tool of (await gateway.listTools(authentication())).tools) {
      for (const root of [tool.inputSchema, tool.outputSchema]) {
        const visit = (value: unknown): void => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          const record = value as Record<string, unknown>;
          if (typeof record.$ref === "string" && record.$ref.startsWith("#/")) {
            let target: unknown = root;
            for (const segment of record.$ref.slice(2).split("/")) {
              const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
              expect(target, `${tool.name}: ${record.$ref}`).toHaveProperty(key);
              target = (target as Record<string, unknown>)[key];
            }
          }
          Object.values(record).forEach(visit);
        };
        visit(root);
      }
    }
  });
  it("projects only installed reads with deterministic annotations and resources", async () => {
    const auth = authentication();
    const service = admission(["site.inspect", "schema.get", "content.query"]);
    const gateway = createAgentMcpGatewayV1({
      admission: service,
      cursorKey: { id: "test", key: new Uint8Array(32).fill(7) },
    });
    expect(await gateway.snapshot(auth)).toEqual({
      tools: true,
      resources: true,
      resourceTemplates: true,
      prompts: false,
      tasks: false,
    });
    expect((await gateway.listTools(auth)).tools).toEqual([
      expect.objectContaining({
        name: "inspect_site",
        annotations: {
          title: "Inspect site",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        execution: { taskSupport: "forbidden" },
      }),
      expect.objectContaining({ name: "query_content" }),
    ]);
    expect((await gateway.listResources(auth)).resources.map((item) => item.uri)).toEqual([
      "nexpress://site/default/capabilities",
      "nexpress://site/default/schema",
      "nexpress://site/default/schema/blocks",
      "nexpress://site/default/summary",
    ]);
    expect(await gateway.listResourceTemplates(auth)).toEqual({
      resourceTemplates: [
        expect.objectContaining({
          uriTemplate: "nexpress://site/default/schema/collections/{slug}",
        }),
      ],
    });
  });

  it("reuses admission for calls and resource reads and rejects task augmentation", async () => {
    const auth = authentication();
    const service = admission(["site.inspect"]);
    const gateway = createAgentMcpGatewayV1({
      admission: service,
      cursorKey: { id: "test", key: new Uint8Array(32).fill(9) },
    });
    const result = await gateway.callTool(auth, {
      name: "inspect_site",
      arguments: { input: {}, idempotencyKey: null },
      task: null,
    });
    expect(result).toMatchObject({
      isError: false,
      structuredContent: { site: { id: "default" } },
    });
    // The assertion intentionally inspects the mocked service method without binding it.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(service.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        authentication: auth,
        request: {
          schemaVersion: "np.agent-invocation-request.v1",
          capabilityId: "site.inspect",
          arguments: { input: {}, idempotencyKey: null },
        },
      }),
    );
    await expect(
      gateway.callTool(auth, {
        name: "inspect_site",
        arguments: { input: {}, idempotencyKey: null },
        task: { ttlMs: 59_999 },
      }),
    ).rejects.toMatchObject({ mcpCode: -32602, mcpMessage: "Invalid params" });
    await expect(
      gateway.callTool(auth, {
        name: "inspect_site",
        arguments: { input: {}, idempotencyKey: null },
        task: { ttlMs: 60_000 },
      }),
    ).rejects.toMatchObject({ mcpCode: -32601, mcpMessage: "Method not found" });
    await expect(
      gateway.callTool(auth, {
        name: "__proto__",
        arguments: { input: {}, idempotencyKey: null },
        task: null,
      }),
    ).rejects.toMatchObject({ mcpCode: -32601, mcpMessage: "Method not found" });
    const resource = await gateway.readResource(auth, "nexpress://site/default/summary");
    expect(resource.contents).toEqual([
      expect.objectContaining({
        uri: "nexpress://site/default/summary",
        mimeType: "application/json",
      }),
    ]);
  });
});

it("projects ChangeSet commands and one closed selector tool without inventing MCP tasks", async () => {
  const auth = authentication();
  const service = admission([
    "changeset.create",
    "changeset.get",
    "changeset.list",
    "changeset.validate",
    "changeset.preview",
  ]);
  const invoke = vi.spyOn(service, "invoke");
  const gateway = createAgentMcpGatewayV1({
    admission: service,
    cursorKey: { id: "test", key: new Uint8Array(32).fill(7) },
  });
  const tools = (await gateway.listTools(auth)).tools;
  expect(tools.map((tool) => tool.name)).toEqual([
    "create_changeset",
    "preview_changeset",
    "query_changesets",
    "validate_changeset",
  ]);
  expect(tools.every((tool) => tool.execution.taskSupport === "forbidden")).toBe(true);
  expect(
    tools.find((tool) => tool.name === "create_changeset")?.inputSchema.properties,
  ).toMatchObject({ idempotencyKey: { type: "string" } });
  const input = {
    selector: "list",
    states: [],
    actorKinds: [],
    createdAfter: null,
    createdBefore: null,
    limit: 25,
    cursor: null,
  };
  await gateway.callTool(auth, {
    name: "query_changesets",
    arguments: { input, idempotencyKey: null },
    task: null,
  });
  expect(invoke).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        capabilityId: "changeset.list",
        arguments: {
          input: {
            states: [],
            actorKinds: [],
            createdAfter: null,
            createdBefore: null,
            limit: 25,
            cursor: null,
          },
          idempotencyKey: null,
        },
      }),
    }),
  );
  await expect(
    gateway.callTool(auth, {
      name: "query_changesets",
      arguments: { input: { ...input, selector: "apply" }, idempotencyKey: null },
      task: null,
    }),
  ).rejects.toMatchObject({ mcpCode: -32602 });
  await expect(
    gateway.callTool(auth, {
      name: "preview_changeset",
      arguments: { input: {}, idempotencyKey: "key" },
      task: { ttlMs: null },
    }),
  ).rejects.toMatchObject({ mcpCode: -32601 });
  const readOnly = createAgentMcpGatewayV1({
    admission: admission(["site.inspect"]),
    cursorKey: { id: "test", key: new Uint8Array(32).fill(7) },
  });
  await expect(
    readOnly.callTool(auth, {
      name: "create_changeset",
      arguments: {
        input: { title: "Draft", summary: null, operations: [] },
        idempotencyKey: "key",
      },
      task: null,
    }),
  ).rejects.toMatchObject({ mcpCode: -32601 });
});
