import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpAuthError, NpForbiddenError } from "@nexpress/core";
const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  ensure: vi.fn(),
  runtime: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("./studio-admin", () => ({
  requireAgentStudioAdmin: mocks.staff,
  normalizeAgentStudioError: (e: unknown) => e,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentEvaluationHistoryRequest } from "./evaluation-history-admin";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const command = {
  schemaVersion: "np.agent-evaluation-history-save.v1",
  recipe: "publisher",
  evaluationJson: "{}",
  sourceHash: digest,
  expectedVersion: 0,
  caseId: "pub-001",
  caseVersion: 1,
  caseHash: digest,
  predictionHash: digest,
  decision: { outcome: "reject", notes: "Private evaluation note.", editedProposalJson: null },
  idempotencyKey: "history:1",
};
const request = (method = "POST", query = "", body: unknown = command) =>
  new NextRequest(`https://site.example/api/admin/agents/evaluations/history${query}`, {
    method,
    ...(method === "POST"
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue({ siteId: "default", actor: {} });
  mocks.runtime.mockReturnValue({ evaluationHistory: { save: mocks.save, list: mocks.list } });
  mocks.save.mockResolvedValue({
    resourceId: "00000000-0000-4000-8000-000000000001",
    replayed: false,
  });
  mocks.list.mockResolvedValue({
    schemaVersion: "np.agent-evaluation-history-sources.v1",
    sources: [],
    nextCursor: null,
  });
});
describe("evaluation history admission", () => {
  it("keeps absent service disabled after current staff admission", async () => {
    mocks.runtime.mockReturnValue(null);
    expect((await handleAgentEvaluationHistoryRequest(request("GET"))).status).toBe(503);
    expect(mocks.staff).toHaveBeenCalledOnce();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("uses write bootstrap and host admission for an exact explicit authenticated save", async () => {
    const response = await handleAgentEvaluationHistoryRequest(request());
    expect(response.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith("write");
    expect(mocks.save).toHaveBeenCalledWith({ siteId: "default", actor: {}, command });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("rejects auth loss before exposing any stored evidence", async () => {
    for (const e of [new NpAuthError(), new NpForbiddenError("evaluation-history", "read")]) {
      mocks.staff.mockRejectedValueOnce(e);
      expect((await handleAgentEvaluationHistoryRequest(request("GET"))).status).toBe(e.statusCode);
    }
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("rejects foreign authority claims, duplicate/unbounded queries and payload reviewer spoofing", async () => {
    for (const req of [
      request("GET", "?siteId=other"),
      request("GET", "?cursor=a&cursor=b"),
      request("GET", "?sourceId=a&caseId=x"),
      request("POST", "", { ...command, reviewer: "forged-admin" }),
    ])
      expect((await handleAgentEvaluationHistoryRequest(req)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
