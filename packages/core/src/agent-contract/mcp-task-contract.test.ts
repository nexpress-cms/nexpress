import { describe, expect, it } from "vitest";

import {
  npAgentMcpTaskLimitsV1,
  npAgentMcpTaskStatusMessagesV1,
  npRequireAgentMcpTaskIdV1,
  npRequireAgentMcpTaskTtlV1,
} from "./mcp-task-contract.js";

describe("Agent MCP task contract", () => {
  it("freezes the negotiated TTL, polling, active and operation caps", () => {
    expect(npAgentMcpTaskLimitsV1).toEqual({
      ttlMinMs: 60_000,
      ttlDefaultMs: 3_600_000,
      ttlMaxMs: 86_400_000,
      pollIntervalMinMs: 1_000,
      pollIntervalDefaultMs: 2_000,
      pollIntervalMaxMs: 10_000,
      activePerAuthorizationContext: 32,
      activePerSite: 1_000,
      operationsPerAuthorizationContextPerMinute: 120,
    });
    expect(npAgentMcpTaskStatusMessagesV1).toEqual({
      working: "Operation in progress",
      completed: "Operation completed",
      failed: "Operation failed",
      cancelled: "Operation cancelled",
    });
  });

  it("accepts only prefixed lowercase UUIDv7 ids and bounded integer TTLs", () => {
    expect(npRequireAgentMcpTaskIdV1("npt1_018f0f30-cd7b-7cc2-8b16-8c052c259bd2")).toBe(
      "npt1_018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
    );
    for (const value of [
      "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
      "npt1_018f0f30-cd7b-4cc2-8b16-8c052c259bd2",
      "npt1_018F0F30-CD7B-7CC2-8B16-8C052C259BD2",
    ]) {
      expect(() => npRequireAgentMcpTaskIdV1(value)).toThrow("Invalid Agent MCP task id");
    }
    expect(npRequireAgentMcpTaskTtlV1(60_000)).toBe(60_000);
    expect(npRequireAgentMcpTaskTtlV1(86_400_000)).toBe(86_400_000);
    for (const value of [59_999, 86_400_001, 60_000.5, null]) {
      expect(() => npRequireAgentMcpTaskTtlV1(value)).toThrow("Invalid Agent MCP task TTL");
    }
  });
});
