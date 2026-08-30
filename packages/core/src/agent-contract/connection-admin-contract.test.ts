import { describe, expect, it } from "vitest";

import {
  npAgentConnectionAdminOperationIdsV1,
  npAnalyzeAgentConnectionAdminInputV1,
  npRequireAgentConnectionAdminInputV1,
} from "./connection-admin-contract.js";

const digest = `cj1:sha256:${"A".repeat(43)}`;

describe("Agent connection Admin input contract", () => {
  it("freezes all eight AP-106 operation ids", () => {
    expect(npAgentConnectionAdminOperationIdsV1).toEqual([
      "agents.connections.create",
      "agents.connections.update",
      "agents.connections.oauth_start",
      "agents.connections.test",
      "agents.connections.rotate",
      "agents.connections.disable",
      "agents.connections.enable",
      "agents.connections.revoke",
    ]);
  });

  it("accepts the exact write-only rotate body without normalizing its credential", () => {
    expect(
      npRequireAgentConnectionAdminInputV1("agents.connections.rotate", {
        configHash: digest,
        credential: "  opaque provider credential  ",
        expectedVersion: 3,
        idempotencyKey: "connection:rotate:3",
        vaultOperationId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
      }),
    ).toEqual({
      configHash: digest,
      credential: "  opaque provider credential  ",
      expectedVersion: 3,
      idempotencyKey: "connection:rotate:3",
      vaultOperationId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
    });
  });

  it("rejects unknown fields and operation/body mismatches", () => {
    expect(
      npAnalyzeAgentConnectionAdminInputV1("agents.connections.enable", {
        configHash: digest,
        expectedVersion: 3,
        idempotencyKey: "connection:enable:3",
        credential: "must-not-be-accepted",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentConnectionAdminInputV1("agents.connections.revoke", {
        expectedVersion: 3,
        idempotencyKey: "connection:revoke:3",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentConnectionAdminInputV1("agents.connections.rotate", {
        configHash: digest,
        credential: "opaque",
        expectedVersion: 3,
        idempotencyKey: "connection:rotate:3",
        vaultOperationId: "contains whitespace",
      }).ok,
    ).toBe(false);
  });
});
