import { describe, expect, it } from "vitest";
import { npApiErrorContractLimits } from "../api-contract/contract.js";
import { npAgentContractLimits } from "./contract.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npAgentMcpTaskResultCanonicalErrorIncludedKeysV1,
  npAgentMcpTaskResultCanonicalExcludedKeysV1,
  npAgentMcpTaskResultCanonicalIncludedKeysV1,
  npAgentMcpTaskResultCanonicalJsonRpcErrorIncludedKeysV1,
  npAgentMcpTaskResultCanonicalToolResultIncludedKeysV1,
  npAnalyzeAgentMcpStoredTerminalResult,
  npBuildAgentMcpTaskResultCanonicalBytes,
  npDigestAgentMcpTaskResultCanonical,
  npRequireAgentMcpStoredTerminalResult,
} from "./canonical-mcp-task-result.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const taskMetaKey = "io.modelcontextprotocol/related-task";

const toolResult = {
  schemaVersion: "np.agent-mcp-stored-task-result.v1",
  kind: "tool_result",
  result: {
    content: [
      {
        type: "text",
        text: "Operation completed",
        annotations: {
          audience: ["user", "assistant"],
          priority: 1,
          lastModified: "2026-08-23T00:00:00.000Z",
        },
        _meta: { "nexpress/content": "safe" },
      },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
      { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" },
      {
        type: "resource_link",
        name: "run-report",
        title: "Run report",
        uri: "nexpress://docs-site/runs/018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
        description: "Bounded result",
        mimeType: "application/json",
        size: 42,
        icons: [
          {
            src: "https://example.com/icon.png",
            mimeType: "image/png",
            sizes: ["48x48"],
            theme: "light",
          },
        ],
      },
      {
        type: "resource",
        resource: {
          uri: "urn:nexpress:report",
          mimeType: "application/json",
          text: '{"ok":true}',
          _meta: { revision: 1 },
        },
      },
      {
        type: "resource",
        resource: {
          uri: "urn:nexpress:binary-report",
          mimeType: "application/octet-stream",
          blob: "YmluYXJ5",
        },
      },
    ],
    structuredContent: { ok: true, count: 1 },
    isError: false,
    vendorExtension: { stable: true },
    _meta: {
      "nexpress/cache-key": "safe-cache-key",
      [taskMetaKey]: { taskId: "npt1_018f0f30-cd7b-7cc2-8b16-8c052c259bd1" },
    },
  },
} as const;

const jsonrpcError = {
  schemaVersion: "np.agent-mcp-stored-task-result.v1",
  kind: "jsonrpc_error",
  error: {
    code: -32_800,
    message: "Request cancelled",
    data: { code: "CANCELLED", retryable: false },
  },
} as const;

describe("Agent MCP stored terminal-result canonical body", () => {
  it("publishes exact top-level, branch, nested, and excluded key fixtures", () => {
    expect(npAgentMcpTaskResultCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "kind",
      "result",
      "error",
    ]);
    expect(npAgentMcpTaskResultCanonicalToolResultIncludedKeysV1).toEqual([
      "schemaVersion",
      "kind",
      "result",
    ]);
    expect(npAgentMcpTaskResultCanonicalJsonRpcErrorIncludedKeysV1).toEqual([
      "schemaVersion",
      "kind",
      "error",
    ]);
    expect(npAgentMcpTaskResultCanonicalErrorIncludedKeysV1).toEqual(["code", "message", "data"]);
    expect(npAgentMcpTaskResultCanonicalExcludedKeysV1).toEqual([
      "terminalResultDigest",
      "taskId",
      "status",
      "statusMessage",
      "jsonrpc",
      "id",
      "relatedTask",
      "createdAt",
      "lastUpdatedAt",
      "expiresAt",
    ]);
  });

  it("accepts exact CallToolResult content branches and returns one safe normalized copy", () => {
    const parsed = npRequireAgentMcpStoredTerminalResult(toolResult);
    expect(parsed.kind).toBe("tool_result");
    if (parsed.kind !== "tool_result") throw new Error("unexpected branch");
    expect(parsed).toEqual({
      ...toolResult,
      result: {
        ...toolResult.result,
        _meta: { "nexpress/cache-key": "safe-cache-key" },
      },
    });
    expect(parsed).not.toBe(toolResult);
    expect(parsed.result).not.toBe(toolResult.result);
    expect(parsed.result.content).not.toBe(toolResult.result.content);
    expect(parsed.result.structuredContent).not.toBe(toolResult.result.structuredContent);
    expect(parsed.result._meta).not.toHaveProperty(taskMetaKey);
  });

  it("preserves omitted JSON-RPC error data and distinguishes explicit null", async () => {
    const omitted = {
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "jsonrpc_error",
      error: { code: -32_603, message: "Internal error" },
    } as const;
    const explicitNull = { ...omitted, error: { ...omitted.error, data: null } } as const;

    const parsed = npRequireAgentMcpStoredTerminalResult(omitted);
    expect(parsed.kind).toBe("jsonrpc_error");
    if (parsed.kind !== "jsonrpc_error") throw new Error("unexpected branch");
    expect(Object.hasOwn(parsed.error, "data")).toBe(false);
    expect(npAnalyzeAgentMcpStoredTerminalResult(explicitNull).ok).toBe(true);
    expect(await npDigestAgentMcpTaskResultCanonical(omitted)).not.toBe(
      await npDigestAgentMcpTaskResultCanonical(explicitNull),
    );
  });

  it("removes only related-task metadata and makes task identity digest-inert", async () => {
    const withTask = (taskId: string) => ({
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "tool_result",
      result: {
        content: [{ type: "text", text: "done" }],
        _meta: { [taskMetaKey]: { taskId } },
      },
    });
    const withoutTask = {
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "tool_result",
      result: { content: [{ type: "text", text: "done" }] },
    };

    const first = await npDigestAgentMcpTaskResultCanonical(withTask("npt1_first"));
    const second = await npDigestAgentMcpTaskResultCanonical(withTask("npt1_second"));
    expect(first).toBe(second);
    expect(first).toBe(await npDigestAgentMcpTaskResultCanonical(withoutTask));
    const parsed = npRequireAgentMcpStoredTerminalResult(withTask("npt1_first"));
    if (parsed.kind !== "tool_result") throw new Error("unexpected branch");
    expect(parsed.result).not.toHaveProperty("_meta");
  });

  it("fails closed on branch mismatch, envelopes, and malformed MCP content", () => {
    const invalid = [
      { ...toolResult, schemaVersion: "np.agent-mcp-stored-task-result.v2" },
      { ...toolResult, kind: "unknown" },
      { ...toolResult, error: jsonrpcError.error },
      { ...jsonrpcError, result: toolResult.result },
      { ...toolResult, taskId: "npt1_secret" },
      { ...toolResult, result: {} },
      { ...toolResult, result: { content: {} } },
      { ...toolResult, result: { content: [{ type: "unknown" }] } },
      { ...toolResult, result: { content: [{ type: "text" }] } },
      { ...toolResult, result: { content: [{ type: "image", data: "***", mimeType: "x" }] } },
      { ...toolResult, result: { content: [{ type: "audio", data: "AB==", mimeType: "x" }] } },
      {
        ...toolResult,
        result: { content: [{ type: "resource_link", name: "x", uri: "not a URI" }] },
      },
      {
        ...toolResult,
        result: { content: [{ type: "text", text: "x", annotations: { priority: 2 } }] },
      },
      {
        ...toolResult,
        result: {
          content: [{ type: "text", text: "x", annotations: { lastModified: "yesterday" } }],
        },
      },
      { ...toolResult, result: { content: [], structuredContent: [] } },
      { ...toolResult, result: { content: [], isError: "false" } },
      { ...toolResult, result: { content: [], jsonrpc: "2.0" } },
      { ...toolResult, result: { content: [], id: 1 } },
      { ...jsonrpcError, error: { ...jsonrpcError.error, code: 1.5 } },
      { ...jsonrpcError, error: { ...jsonrpcError.error, code: Number.NaN } },
      { ...jsonrpcError, error: { ...jsonrpcError.error, message: " error " } },
      { ...jsonrpcError, error: { ...jsonrpcError.error, message: "error\u0000secret" } },
      { ...jsonrpcError, error: { ...jsonrpcError.error, extra: true } },
      { ...jsonrpcError, error: { ...jsonrpcError.error, data: { "": true } } },
    ];

    for (const value of invalid) {
      expect(npAnalyzeAgentMcpStoredTerminalResult(value).ok).toBe(false);
    }
  });

  it("enforces result, structured-content, and safe-error data limits", () => {
    let tooDeep: unknown = "leaf";
    for (let depth = 0; depth < npAgentContractLimits.invocationDepth + 1; depth += 1) {
      tooDeep = { next: tooDeep };
    }
    const tooManyResultBytes = Array.from({ length: 17 }, () =>
      "x".repeat(npAgentContractLimits.invocationStringCharacters),
    );
    const tooManyStructuredBytes = Array.from({ length: 13 }, () =>
      "x".repeat(npAgentContractLimits.invocationStringCharacters),
    );
    const tooManyProperties = Object.fromEntries(
      Array.from({ length: npAgentContractLimits.invocationObjectProperties + 1 }, (_, index) => [
        `key_${index.toString()}`,
        index,
      ]),
    );
    let errorDataTooDeep: unknown = null;
    for (let depth = 0; depth < npApiErrorContractLimits.detailDepth + 1; depth += 1) {
      errorDataTooDeep = { next: errorDataTooDeep };
    }

    const invalid = [
      { ...toolResult, result: { content: [], extension: tooDeep } },
      { ...toolResult, result: { content: [], extension: tooManyResultBytes } },
      { ...toolResult, result: { content: [], structuredContent: { tooManyStructuredBytes } } },
      { ...toolResult, result: { content: [], extension: tooManyProperties } },
      {
        ...toolResult,
        result: {
          content: [
            {
              type: "text",
              text: "x".repeat(npAgentContractLimits.invocationStringCharacters + 1),
            },
          ],
        },
      },
      { ...jsonrpcError, error: { ...jsonrpcError.error, data: errorDataTooDeep } },
      {
        ...jsonrpcError,
        error: {
          ...jsonrpcError.error,
          data: "x".repeat(npApiErrorContractLimits.detailStringLength + 1),
        },
      },
    ];

    for (const value of invalid) {
      expect(npAnalyzeAgentMcpStoredTerminalResult(value).ok).toBe(false);
    }
  });

  it("accepts each exact 5/4/3 MiB byte boundary and rejects one extra byte", () => {
    const maximumChunk = "x".repeat(npAgentContractLimits.invocationStringCharacters);

    const rawChunks = [...Array<string>(19).fill(maximumChunk), ""];
    const rawResult = {
      content: [],
      _meta: { [taskMetaKey]: { chunks: rawChunks } },
    };
    const rawRemainder =
      npAgentContractLimits.mcpFrameBytes -
      encoder.encode(serializeAgentCanonicalJson(rawResult)).byteLength;
    expect(rawRemainder).toBeGreaterThan(0);
    expect(rawRemainder).toBeLessThanOrEqual(npAgentContractLimits.invocationStringCharacters);
    rawChunks[rawChunks.length - 1] = "x".repeat(rawRemainder);
    expect(encoder.encode(serializeAgentCanonicalJson(rawResult))).toHaveLength(
      npAgentContractLimits.mcpFrameBytes,
    );
    expect(
      npAnalyzeAgentMcpStoredTerminalResult({
        schemaVersion: "np.agent-mcp-stored-task-result.v1",
        kind: "tool_result",
        result: rawResult,
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentMcpStoredTerminalResult({
        schemaVersion: "np.agent-mcp-stored-task-result.v1",
        kind: "tool_result",
        result: {
          ...rawResult,
          _meta: {
            [taskMetaKey]: {
              chunks: [...rawChunks.slice(0, -1), `${rawChunks.at(-1) ?? ""}x`],
            },
          },
        },
      }).ok,
    ).toBe(false);

    const structuredChunks = [...Array<string>(11).fill(maximumChunk), ""];
    const structuredContent = { chunks: structuredChunks };
    const structuredRemainder =
      npAgentContractLimits.inlineMcpStructuredResultBytes -
      encoder.encode(serializeAgentCanonicalJson(structuredContent)).byteLength;
    expect(structuredRemainder).toBeGreaterThan(0);
    expect(structuredRemainder).toBeLessThanOrEqual(
      npAgentContractLimits.invocationStringCharacters,
    );
    structuredChunks[structuredChunks.length - 1] = "x".repeat(structuredRemainder);
    expect(encoder.encode(serializeAgentCanonicalJson(structuredContent))).toHaveLength(
      npAgentContractLimits.inlineMcpStructuredResultBytes,
    );
    expect(
      npAnalyzeAgentMcpStoredTerminalResult({
        schemaVersion: "np.agent-mcp-stored-task-result.v1",
        kind: "tool_result",
        result: { content: [], structuredContent },
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentMcpStoredTerminalResult({
        schemaVersion: "np.agent-mcp-stored-task-result.v1",
        kind: "tool_result",
        result: {
          content: [],
          structuredContent: {
            chunks: [...structuredChunks.slice(0, -1), `${structuredChunks.at(-1) ?? ""}x`],
          },
        },
      }).ok,
    ).toBe(false);

    const bodyChunks = [...Array<string>(15).fill(maximumChunk), ""];
    const bodyAtLimit = {
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "tool_result",
      result: { content: [], extension: { chunks: bodyChunks } },
    } as const;
    const bodyRemainder =
      npAgentContractLimits.invocationBytes -
      npBuildAgentMcpTaskResultCanonicalBytes(bodyAtLimit).canonicalJsonUtf8.byteLength;
    expect(bodyRemainder).toBeGreaterThan(0);
    expect(bodyRemainder).toBeLessThanOrEqual(npAgentContractLimits.invocationStringCharacters);
    bodyChunks[bodyChunks.length - 1] = "x".repeat(bodyRemainder);
    expect(npBuildAgentMcpTaskResultCanonicalBytes(bodyAtLimit).canonicalJsonUtf8).toHaveLength(
      npAgentContractLimits.invocationBytes,
    );
    expect(
      npAnalyzeAgentMcpStoredTerminalResult({
        ...bodyAtLimit,
        result: {
          ...bodyAtLimit.result,
          extension: {
            chunks: [...bodyChunks.slice(0, -1), `${bodyChunks.at(-1) ?? ""}x`],
          },
        },
      }).ok,
    ).toBe(false);
  });

  it("inspects hostile values without invoking accessors or Proxy get traps", () => {
    let reads = 0;
    const proxiedResult = new Proxy(
      { content: [{ type: "text", text: "safe" }] },
      {
        get() {
          reads += 1;
          throw new Error("hostile getter");
        },
      },
    );
    const proxiedOuter = new Proxy(
      {
        schemaVersion: "np.agent-mcp-stored-task-result.v1",
        kind: "tool_result",
        result: proxiedResult,
      },
      {
        get() {
          reads += 1;
          throw new Error("hostile getter");
        },
      },
    );
    expect(npRequireAgentMcpStoredTerminalResult(proxiedOuter)).toEqual({
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "tool_result",
      result: { content: [{ type: "text", text: "safe" }] },
    });
    expect(reads).toBe(0);

    const accessorResult = { content: [] };
    Object.defineProperty(accessorResult, "isError", {
      enumerable: true,
      get() {
        reads += 1;
        return false;
      },
    });
    expect(
      npAnalyzeAgentMcpStoredTerminalResult({
        schemaVersion: "np.agent-mcp-stored-task-result.v1",
        kind: "tool_result",
        result: accessorResult,
      }).ok,
    ).toBe(false);
    expect(reads).toBe(0);

    const hostile = new Proxy(jsonrpcError, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(npAnalyzeAgentMcpStoredTerminalResult(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("rejects cycles, shared references, sparse arrays, and non-I-JSON values", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = { value: true };
    const sparse = Array(1);
    const invalid = [
      { ...toolResult, result: { content: [], extension: cycle } },
      { ...toolResult, result: { content: [], first: shared, second: shared } },
      { ...toolResult, result: { content: sparse } },
      { ...toolResult, result: { content: [], extension: Number.POSITIVE_INFINITY } },
      { ...toolResult, result: { content: [], extension: 1n } },
      { ...toolResult, result: { content: [], extension: "\ud800" } },
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentMcpStoredTerminalResult(value).ok).toBe(false);
    }
  });

  it("emits stable domain-separated golden vectors for tool and error results", async () => {
    const goldenTool = {
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "tool_result",
      result: {
        content: [{ type: "text", text: "done" }],
        structuredContent: { z: 1, a: true },
        isError: false,
      },
    } as const;
    const goldenError = {
      schemaVersion: "np.agent-mcp-stored-task-result.v1",
      kind: "jsonrpc_error",
      error: { code: -32_800, message: "Request cancelled", data: null },
    } as const;
    const vectors = [
      {
        value: goldenTool,
        json: '{"kind":"tool_result","result":{"content":[{"text":"done","type":"text"}],"isError":false,"structuredContent":{"a":true,"z":1}},"schemaVersion":"np.agent-mcp-stored-task-result.v1"}',
        digest: "cj1:sha256:tWZvmBhCAvFFooR8Iiz2hvQ211R-9AniBx3Hc2FHLHo",
      },
      {
        value: goldenError,
        json: '{"error":{"code":-32800,"data":null,"message":"Request cancelled"},"kind":"jsonrpc_error","schemaVersion":"np.agent-mcp-stored-task-result.v1"}',
        digest: "cj1:sha256:uGKwO6chN18JElHpxydxuryoWRLKVEqFDnqrH1K27BI",
      },
    ] as const;

    for (const vector of vectors) {
      const built = npBuildAgentMcpTaskResultCanonicalBytes(vector.value);
      expect(built.purpose).toBe("np.agent-mcp-task-result.v1");
      expect(decoder.decode(built.canonicalJsonUtf8)).toBe(vector.json);
      expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
        `np.agent-canonical-json.v1\0np.agent-mcp-task-result.v1\0${vector.json}`,
      );
      expect(await npDigestAgentMcpTaskResultCanonical(vector.value)).toBe(vector.digest);
    }
  });
});
