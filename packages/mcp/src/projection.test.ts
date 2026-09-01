import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { createAgentMcpServerV1 } from "./server.js";
import type { NpAgentMcpProjectionProviderV1 } from "./projection.js";

function provider(
  overrides: Partial<NpAgentMcpProjectionProviderV1<{ principalId: string }>> = {},
): NpAgentMcpProjectionProviderV1<{ principalId: string }> {
  return {
    snapshot: () => ({
      tools: true,
      resources: true,
      resourceTemplates: true,
      prompts: false,
      tasks: true,
    }),
    listTools: vi.fn(() =>
      Promise.resolve({
        tools: [
          {
            name: "inspect_site",
            description: "Inspect one site.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            outputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
            execution: { taskSupport: "forbidden" },
          },
        ],
      }),
    ),
    callTool: vi.fn(() =>
      Promise.resolve({ content: [{ type: "text", text: "{}" }], structuredContent: {} }),
    ),
    listResources: vi.fn(() => Promise.resolve({ resources: [] })),
    listResourceTemplates: vi.fn(() => Promise.resolve({ resourceTemplates: [] })),
    readResource: vi.fn(() => Promise.resolve({ contents: [] })),
    listPrompts: vi.fn(() => Promise.resolve({ prompts: [] })),
    getPrompt: vi.fn(() => Promise.resolve({ messages: [] })),
    getTask: vi.fn(() =>
      Promise.resolve({
        taskId: "npt1_test",
        status: "working",
        statusMessage: "Operation in progress",
        ttl: 60_000,
        pollInterval: 2_000,
        createdAt: "2026-09-01T00:00:00.000Z",
        lastUpdatedAt: "2026-09-01T00:00:00.000Z",
      }),
    ),
    listTasks: vi.fn(() => Promise.resolve({ tasks: [] })),
    getTaskResult: vi.fn(() =>
      Promise.resolve({ kind: "tool_result" as const, result: { content: [] } }),
    ),
    cancelTask: vi.fn(() =>
      Promise.resolve({
        taskId: "npt1_test",
        status: "cancelled",
        statusMessage: "Operation cancelled",
        ttl: 60_000,
        pollInterval: 2_000,
        createdAt: "2026-09-01T00:00:00.000Z",
        lastUpdatedAt: "2026-09-01T00:00:01.000Z",
      }),
    ),
    ...overrides,
  };
}

async function connected(input: NpAgentMcpProjectionProviderV1<{ principalId: string }>) {
  const server = await createAgentMcpServerV1({
    authentication: { principalId: "principal" },
    projection: input,
  });
  const client = new Client({ name: "projection-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("Agent MCP capability projection", () => {
  it("advertises and validates only the authenticated snapshot", async () => {
    const projection = provider();
    const { client, server } = await connected(projection);
    try {
      expect(client.getServerCapabilities()).toEqual({
        tools: {},
        resources: {},
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      });
      expect((await client.listTools()).tools).toEqual([
        expect.objectContaining({
          name: "inspect_site",
          annotations: expect.objectContaining({ readOnlyHint: true, openWorldHint: false }),
          execution: { taskSupport: "forbidden" },
        }),
      ]);
      expect(await client.callTool({ name: "inspect_site", arguments: {} })).toEqual({
        content: [{ type: "text", text: "{}" }],
        structuredContent: {},
      });
      expect(await client.experimental.tasks.getTask("npt1_test")).toMatchObject({
        taskId: "npt1_test",
        status: "working",
      });
      expect(await client.experimental.tasks.listTasks()).toEqual({ tasks: [] });
      expect(
        await client.experimental.tasks.getTaskResult("npt1_test", CallToolResultSchema),
      ).toEqual({ content: [] });
      expect(await client.experimental.tasks.cancelTask("npt1_test")).toMatchObject({
        taskId: "npt1_test",
        status: "cancelled",
      });
      // The assertion intentionally inspects the mocked provider method without binding it.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(projection.callTool).toHaveBeenCalledWith(
        { principalId: "principal" },
        { name: "inspect_site", arguments: {}, task: null },
      );
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("converts host failures to bounded protocol errors", async () => {
    const { client, server } = await connected(
      provider({
        callTool: () =>
          Promise.reject(
            Object.assign(new Error("private failure"), {
              mcpCode: -32601,
              mcpMessage: "Method not found",
              secret: "must-not-leak",
            }),
          ),
      }),
    );
    try {
      const failure = await client
        .callTool({ name: "hidden", arguments: {} })
        .catch((error) => error);
      expect(failure).toMatchObject({ code: -32601 });
      expect(String(failure)).toContain("Method not found");
      expect(String(failure)).not.toContain("must-not-leak");
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
