import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  npAnalyzeAgentActivityQueryV1,
  npAnalyzeAgentActivityRunsPageV1,
  npAnalyzeAgentActivityRunDetailV1,
  npAgentActivityContractV1,
  npAgentActivityReadRoutesV1,
} from "./activity-contract.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
describe("Activity closed contract", () => {
  it("allows canonical bounded filters and rejects kind-specific/foreign inventory", () => {
    expect(
      npAnalyzeAgentActivityQueryV1("runs", {
        limit: 100,
        origin: "gateway",
        capabilityId: "site.inspect",
        from: "2026-09-01T00:00:00.000Z",
      }).ok,
    ).toBe(true);
    for (const q of [
      { limit: 101 },
      { limit: 0 },
      { state: "complete" },
      { cursor: "" },
      { from: "2026-02-30T00:00:00.000Z" },
      { from: "2026-09-02T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      { siteId: "other" },
      { kind: "external" },
      { capabilityId: "plugin.read" },
    ])
      expect(npAnalyzeAgentActivityQueryV1("runs", q).ok).toBe(false);
    expect(
      npAnalyzeAgentActivityQueryV1("principals", { runId: "11111111-1111-4111-8111-111111111111" })
        .ok,
    ).toBe(false);
  });
  it("does not execute hostile query getters", () => {
    let calls = 0;
    expect(
      npAnalyzeAgentActivityQueryV1("runs", {
        get limit() {
          calls++;
          return 1;
        },
      }).ok,
    ).toBe(false);
    expect(calls).toBe(0);
  });
  it("keeps pages closed and never accepts an invented evidence payload", () => {
    expect(
      npAnalyzeAgentActivityRunsPageV1({
        schemaVersion: "np.agent-activity-runs.v1",
        items: [],
        nextCursor: null,
      }).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentActivityRunsPageV1({
        schemaVersion: "np.agent-activity-runs.v1",
        items: [],
        nextCursor: null,
        credential: "secret",
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentActivityRunDetailV1({ schemaVersion: "np.agent-activity-run.v1", rawBody: {} })
        .ok,
    ).toBe(false);
  });
  it("locks filter, state, evidence and wrapper inventory", () => {
    expect(
      createHash("sha256")
        .update(serializeAgentCanonicalJson(npAgentActivityContractV1))
        .digest("hex"),
    ).toBe("9d31c6b1a86bc86320791fd1f12bc1ccccfe00e370a5d81d84e5bafa38c3edf3");
  });
  it("locks only six read routes, leaving mutations in the shared admission registry", () => {
    expect(npAgentActivityReadRoutesV1.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /api/admin/agents/gateway/principals",
      "GET /api/admin/agents/gateway/principals/{id}",
      "GET /api/admin/agents/activity",
      "GET /api/admin/agents/activity/{id}",
      "GET /api/admin/agents/activity/actions",
      "GET /api/admin/agents/activity/actions/{id}",
    ]);
  });
});
