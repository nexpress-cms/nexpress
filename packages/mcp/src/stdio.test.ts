import { EventEmitter } from "node:events";
import { Server as NetServer } from "node:net";
import { PassThrough } from "node:stream";

import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { NP_AGENT_MCP_MAX_FRAME_BYTES_V1 } from "./server.js";
import {
  NpAgentMcpStdioError,
  NP_AGENT_MCP_STDIO_AUDIENCE_V1,
  type NpAgentMcpStdioHostV1,
  runAgentMcpStdioV1,
  startAgentMcpStdioV1,
} from "./stdio.js";

const TOKEN = `npst1_11111111-1111-4111-8111-111111111111_${"A".repeat(43)}`;

function testHost(
  overrides: Partial<NpAgentMcpStdioHostV1<{ principalId: string; siteId: string }>> = {},
): NpAgentMcpStdioHostV1<{ principalId: string; siteId: string }> {
  return {
    ensureFor: vi.fn(() => Promise.resolve()),
    authenticateStdioServiceToken: vi.fn(() =>
      Promise.resolve({
        principalId: "22222222-2222-4222-8222-222222222222",
        siteId: "default",
      }),
    ),
    shutdown: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for stdio output.");
}

describe("Agent MCP stdio", () => {
  it("authenticates before reading frames and negotiates the frozen protocol without a port", async () => {
    const listen = vi.spyOn(NetServer.prototype, "listen");
    const input = new PassThrough();
    const output = new PassThrough();
    const frames: string[] = [];
    let buffered = "";
    output.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      frames.push(...lines.filter(Boolean));
    });
    const host = testHost();
    const session = await startAgentMcpStdioV1({
      host,
      env: {
        NP_AGENT_SERVICE_TOKEN: TOKEN,
        // Caller-selected site input is intentionally ignored. The service
        // credential's persisted row determines the site.
        NP_AGENT_SITE_ID: "attacker-selected-site",
      },
      input,
      output,
    });

    expect(host.ensureFor).toHaveBeenCalledWith("read");
    expect(host.authenticateStdioServiceToken).toHaveBeenCalledWith({
      credential: TOKEN,
      transport: "stdio",
      audience: NP_AGENT_MCP_STDIO_AUDIENCE_V1,
    });
    expect(listen).not.toHaveBeenCalled();
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "nexpress-test", version: "1" },
        },
      })}\n`,
    );
    await waitFor(() => frames.length === 1);
    expect(JSON.parse(frames[0])).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        serverInfo: { name: "nexpress-agent-gateway", version: "1" },
      },
    });
    expect(frames.join("\n")).not.toContain(TOKEN);

    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
    await waitFor(() => frames.length === 2);
    expect(JSON.parse(frames[1])).toEqual({ jsonrpc: "2.0", id: 2, result: {} });

    await session.close();
    await session.close();
    expect(host.shutdown).toHaveBeenCalledTimes(1);
    listen.mockRestore();
  });

  it("rejects a missing credential before bootstrap", async () => {
    const host = testHost();
    await expect(startAgentMcpStdioV1({ host, env: {} })).rejects.toMatchObject({
      code: "MCP_STDIO_CREDENTIAL_REQUIRED",
      message: "NP_AGENT_SERVICE_TOKEN is required for local MCP.",
    });
    expect(host.ensureFor).not.toHaveBeenCalled();
    expect(host.shutdown).not.toHaveBeenCalled();
  });

  it("returns a safe authentication error, shuts down, and never reports credential text", async () => {
    const host = testHost({
      authenticateStdioServiceToken: vi.fn(() =>
        Promise.reject(
          new NpAgentMcpStdioError("MCP_STDIO_START_FAILED", `provider detail ${TOKEN}`, {
            cause: new Error(TOKEN),
          }),
        ),
      ),
    });
    let failure: unknown;
    try {
      await startAgentMcpStdioV1({ host, env: { NP_AGENT_SERVICE_TOKEN: TOKEN } });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "MCP_STDIO_AUTHENTICATION_FAILED",
      message: "Local MCP authentication failed.",
    });
    expect(String(failure)).not.toContain(TOKEN);
    expect((failure as Error).cause).toBeUndefined();
    expect(host.shutdown).toHaveBeenCalledTimes(1);
  });

  it("shares one safe terminal failure across close and closed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const report = vi.fn();
    const host = testHost({
      shutdown: vi.fn(() => Promise.reject(new Error(`shutdown detail ${TOKEN}`))),
    });
    const session = await startAgentMcpStdioV1({
      host,
      env: { NP_AGENT_SERVICE_TOKEN: TOKEN },
      input,
      output,
      report,
    });
    const closeFailure = session.close();
    await expect(closeFailure).rejects.toMatchObject({
      code: "MCP_STDIO_SHUTDOWN_FAILED",
      message: "Local MCP bootstrap shutdown failed.",
    });
    await expect(session.closed).rejects.toBe(await closeFailure.catch((error: unknown) => error));
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({ code: "MCP_STDIO_SHUTDOWN_FAILED" });
    expect(host.shutdown).toHaveBeenCalledTimes(1);
  });

  it("collapses bootstrap and cleanup details when both fail", async () => {
    const host = testHost({
      ensureFor: vi.fn(() => Promise.reject(new Error(`database detail ${TOKEN}`))),
      shutdown: vi.fn(() => Promise.reject(new Error(`shutdown detail ${TOKEN}`))),
    });
    let failure: unknown;
    try {
      await startAgentMcpStdioV1({ host, env: { NP_AGENT_SERVICE_TOKEN: TOKEN } });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "MCP_STDIO_SHUTDOWN_FAILED",
      message: "Local MCP startup cleanup failed.",
    });
    expect(String(failure)).not.toContain(TOKEN);
    expect((failure as Error).cause).toBeUndefined();
    expect(host.shutdown).toHaveBeenCalledTimes(1);
  });

  it("closes and reports only a stable code when an inbound frame exceeds 5 MiB", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const report = vi.fn();
    const host = testHost();
    const session = await startAgentMcpStdioV1({
      host,
      env: { NP_AGENT_SERVICE_TOKEN: TOKEN },
      input,
      output,
      report,
    });
    input.write(Buffer.alloc(NP_AGENT_MCP_MAX_FRAME_BYTES_V1 + 1, 97));
    await session.closed;
    expect(report).toHaveBeenCalledWith({ code: "MCP_STDIO_PROTOCOL_ERROR" });
    expect(host.shutdown).toHaveBeenCalledTimes(1);
  });

  it("closes instead of emitting an outbound frame larger than 5 MiB", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    const report = vi.fn();
    const host = testHost({
      configureServer: (server) => {
        server.registerCapabilities({ tools: {} });
        server.setRequestHandler(ListToolsRequestSchema, () => ({
          tools: [
            {
              name: "oversized",
              description: "x".repeat(NP_AGENT_MCP_MAX_FRAME_BYTES_V1),
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }));
      },
    });
    const session = await startAgentMcpStdioV1({
      host,
      env: { NP_AGENT_SERVICE_TOKEN: TOKEN },
      input,
      output,
      report,
    });
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "nexpress-test", version: "1" },
        },
      })}\n`,
    );
    await waitFor(() => chunks.length === 1);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await session.closed;
    await waitFor(() => report.mock.calls.length > 0);
    expect(chunks).toHaveLength(1);
    expect(report).toHaveBeenCalledWith({ code: "MCP_STDIO_PROTOCOL_ERROR" });
    expect(host.shutdown).toHaveBeenCalledTimes(1);
  });

  it("freezes the bounded serialization before the SDK writes stdout", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const frames: string[] = [];
    let buffered = "";
    output.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      frames.push(...lines.filter(Boolean));
    });
    let serializations = 0;
    const host = testHost({
      configureServer: (server) => {
        server.registerCapabilities({ tools: {} });
        server.setRequestHandler(ListToolsRequestSchema, () => ({
          toJSON() {
            serializations += 1;
            return serializations === 1
              ? { tools: [] }
              : {
                  tools: [
                    {
                      name: "mutated",
                      description: "x".repeat(NP_AGENT_MCP_MAX_FRAME_BYTES_V1),
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                };
          },
        }));
      },
    });
    const session = await startAgentMcpStdioV1({
      host,
      env: { NP_AGENT_SERVICE_TOKEN: TOKEN },
      input,
      output,
    });
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "nexpress-test", version: "1" },
        },
      })}\n`,
    );
    await waitFor(() => frames.length === 1);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await waitFor(() => frames.length === 2);
    expect(JSON.parse(frames[1])).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { tools: [] },
    });
    expect(serializations).toBe(1);
    await session.close();
    expect(host.shutdown).toHaveBeenCalledTimes(1);
  });

  it("runs until EOF and removes dedicated-process signal listeners", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const signals = new EventEmitter();
    const host = testHost();
    const running = runAgentMcpStdioV1({
      host,
      env: { NP_AGENT_SERVICE_TOKEN: TOKEN },
      input,
      output,
      signals,
    });
    await waitFor(() => signals.listenerCount("SIGTERM") === 1);
    input.end();
    await running;
    expect(host.shutdown).toHaveBeenCalledTimes(1);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});
