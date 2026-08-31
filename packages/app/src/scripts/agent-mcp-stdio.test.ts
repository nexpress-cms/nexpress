import { describe, expect, it } from "vitest";

import { NpAgentMcpStdioError } from "@nexpress/mcp/stdio";

import { formatAgentMcpStdioFailureV1 } from "./agent-mcp-stdio.js";

describe("Agent MCP stdio application runner", () => {
  it("formats only the stable code and safe message", () => {
    const credential = `npst1_11111111-1111-4111-8111-111111111111_${"A".repeat(43)}`;
    const error = new NpAgentMcpStdioError("MCP_STDIO_AUTHENTICATION_FAILED", credential, {
      cause: new Error(credential),
    });
    const formatted = formatAgentMcpStdioFailureV1(error);
    expect(formatted).toBe(
      "nexpress-agent-mcp: MCP_STDIO_AUTHENTICATION_FAILED: Local MCP authentication failed.\n",
    );
    expect(formatted).not.toContain(credential);
  });

  it("collapses unknown failures", () => {
    expect(formatAgentMcpStdioFailureV1(new Error("postgres://credential@host/db"))).toBe(
      "nexpress-agent-mcp: MCP_STDIO_START_FAILED: Local MCP failed.\n",
    );
  });
});
