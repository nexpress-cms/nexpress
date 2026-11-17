import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  npAnalyzeAgentActivityQueryV1,
  npAnalyzeAgentActivityRunResourceV1,
  npAnalyzeAgentActivityRunsPageV1,
  npAnalyzeAgentActivityRunDetailV1,
  npBuildAgentActivityRunSupportBundleV1,
  npRequireAgentActivityRunResourceV1,
  npAgentActivityContractV1,
  npAgentActivityReadRoutesV1,
} from "./activity-contract.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { parseActivityRuntimeOperationsV1 } from "./activity-runtime-operations.js";
describe("Activity closed contract", () => {
  it("allows canonical bounded filters and rejects kind-specific/foreign inventory", () => {
    const agentId = "11111111-1111-4111-8111-111111111111";
    expect(
      npAnalyzeAgentActivityQueryV1("runs", {
        limit: 100,
        origin: "gateway",
        capabilityId: "site.inspect",
        from: "2026-09-01T00:00:00.000Z",
      }).ok,
    ).toBe(true);
    expect(npAnalyzeAgentActivityQueryV1("runs", { agentId, triggerKind: "event" })).toMatchObject({
      ok: true,
      value: { agentId, triggerKind: "event" },
    });
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
      { agentId: "observer" },
      { triggerKind: "webhook" },
      { incidentId: "latest" },
      { template: "default" },
      { q: "private query" },
      { q: "site.%" },
    ])
      expect(npAnalyzeAgentActivityQueryV1("runs", q).ok).toBe(false);
    expect(
      npAnalyzeAgentActivityQueryV1("principals", { runId: "11111111-1111-4111-8111-111111111111" })
        .ok,
    ).toBe(false);
    expect(npAnalyzeAgentActivityQueryV1("actions", { agentId }).ok).toBe(false);
    const changeSetId = "22222222-2222-4222-8222-222222222222";
    expect(
      npAnalyzeAgentActivityQueryV1("runs", { approvalId: agentId, changeSetId }),
    ).toMatchObject({
      ok: true,
      value: { approvalId: agentId, changeSetId },
    });
    expect(npAnalyzeAgentActivityQueryV1("actions", { approvalId: agentId }).ok).toBe(false);
    expect(npAnalyzeAgentActivityQueryV1("runs", { incidentId: agentId })).toMatchObject({
      ok: true,
      value: { incidentId: agentId },
    });
    expect(npAnalyzeAgentActivityQueryV1("actions", { incidentId: agentId }).ok).toBe(false);
    expect(
      npAnalyzeAgentActivityQueryV1("runs", { template: "guardian", q: "site.inspect" }),
    ).toMatchObject({
      ok: true,
      value: { template: "guardian", q: "site.inspect" },
    });
    expect(npAnalyzeAgentActivityQueryV1("actions", { q: "site.inspect" }).ok).toBe(false);
    expect(npAnalyzeAgentActivityQueryV1("runs", { changeSetId: "draft" }).ok).toBe(false);
    expect(npAnalyzeAgentActivityQueryV1("principals", { triggerKind: "manual" }).ok).toBe(false);
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
    ).toBe("8db25a25d46ea7097b24c3a88e7381575ef07e0ddbdb89c12bccf963557d64a6");
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

const expiredRun = {
  schemaVersion: "np.agent-activity-run-expired.v1",
  runId: "11111111-1111-4111-8111-111111111111",
  siteId: "history",
  principalId: "22222222-2222-4222-8222-222222222222",
  agent: {
    id: "33333333-3333-4333-8333-333333333333",
    versionId: "44444444-4444-4444-8444-444444444444",
  },
  state: "succeeded",
  finishedAt: "2026-09-01T00:00:00.000Z",
  releasedAt: "2026-09-18T00:00:00.000Z",
  evidence: "expired",
};

it("requires an exact approval or result reference for a Runtime operation", () => {
  const run = { id: expiredRun.runId, origin: "runtime" as const };
  const approval = {
    operation: "agent.run.cancel",
    state: "approved",
    approvalId: expiredRun.agent.id,
    expiresAt: "2026-09-01T00:00:00.000Z",
  };
  expect(parseActivityRuntimeOperationsV1([approval], run)).toEqual([approval]);
  expect(() =>
    parseActivityRuntimeOperationsV1([approval], { ...run, origin: "gateway" }),
  ).toThrow();
  expect(() =>
    parseActivityRuntimeOperationsV1([{ ...approval, actionId: approval.approvalId }], run),
  ).toThrow();
  expect(() =>
    parseActivityRuntimeOperationsV1(
      [
        {
          operation: "agent.run.retry",
          state: "succeeded",
          actionId: expiredRun.agent.id,
          resultRunId: run.id,
        },
      ],
      run,
    ),
  ).toThrow();
});
describe("expired Run detail resource", () => {
  it("accepts retained facts only and leaves live list items unchanged", () => {
    expect(npAnalyzeAgentActivityRunResourceV1(expiredRun).ok).toBe(true);
    expect(
      npBuildAgentActivityRunSupportBundleV1(npRequireAgentActivityRunResourceV1(expiredRun)),
    ).toEqual({
      schemaVersion: "np.agent-activity-run-support.v1",
      runId: expiredRun.runId,
      siteId: expiredRun.siteId,
      state: expiredRun.state,
      finishedAt: expiredRun.finishedAt,
      releasedAt: expiredRun.releasedAt,
      evidence: expiredRun.evidence,
    });
    expect(npAnalyzeAgentActivityRunDetailV1(expiredRun).ok).toBe(false);
    expect(
      npAnalyzeAgentActivityRunsPageV1({
        schemaVersion: "np.agent-activity-runs.v1",
        items: [expiredRun],
        nextCursor: null,
      }).ok,
    ).toBe(false);
  });
  it.each([
    { state: "running" },
    { evidence: "redacted" },
    { input: { secret: "source" } },
    { usage: { inputTokens: 0 } },
    { runLimitsHash: "private" },
    { goal: "source" },
    { related: { incidentIds: [expiredRun.runId], approvalIds: [], changeSetIds: [] } },
    { releasedAt: "2026-08-01T00:00:00.000Z" },
  ])("rejects unsupported historical facts %j", (extra) => {
    expect(npAnalyzeAgentActivityRunResourceV1({ ...expiredRun, ...extra }).ok).toBe(false);
  });
  it("does not invoke getters while determining the resource variant", () => {
    const getter = vi.fn(() => expiredRun.schemaVersion);
    expect(
      npAnalyzeAgentActivityRunResourceV1({
        get schemaVersion() {
          return getter();
        },
      }).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
});
