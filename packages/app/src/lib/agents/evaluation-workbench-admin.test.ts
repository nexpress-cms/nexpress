import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpAuthError, NpForbiddenError } from "@nexpress/core";
import { npApiErrorDiagnosticsHeader } from "@nexpress/core/api-contract";
import {
  npAgentEvaluationWorkbenchRequestMaxBytesV1,
  npRequireAgentEvaluationWorkbenchResultV1,
} from "@nexpress/core/agent-contract";
import {
  npBuildAgentEvaluationWorkbenchV1,
  runAgentModeratorEvaluationV1,
} from "@nexpress/core/agents";
const mocks = vi.hoisted(() => ({ staff: vi.fn(), ensure: vi.fn(), build: vi.fn() }));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  npBuildAgentEvaluationWorkbenchV1: mocks.build,
}));
vi.mock("./studio-admin", () => ({
  requireAgentStudioAdmin: mocks.staff,
  normalizeAgentStudioError: (error: unknown) => error,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentEvaluationWorkbenchRequest } from "./evaluation-workbench-admin";
let input: unknown;
let output: unknown;
const request = (body: unknown = input, headers: Record<string, string> = {}, query = "") =>
  new NextRequest(`https://site.example/api/admin/agents/evaluations${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  const actual = await vi.importActual<{
    npBuildAgentEvaluationWorkbenchV1: typeof npBuildAgentEvaluationWorkbenchV1;
  }>("@nexpress/core/agents");
  input = {
    schemaVersion: "np.agent-eval-workbench-request.v1",
    recipe: "moderator",
    evaluation: await runAgentModeratorEvaluationV1(),
    review: null,
    baseline: null,
    baselineReview: null,
    labels: null,
  };
  output = await actual.npBuildAgentEvaluationWorkbenchV1(input);
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue({ siteId: "default" });
  mocks.build.mockResolvedValue(output);
});
describe("evaluation workbench staff HTTP boundary", () => {
  it("uses read admission and no-store transport for the existing stateless owner", async () => {
    const response = await handleAgentEvaluationWorkbenchRequest(request());
    expect(response.status).toBe(200);
    expect(mocks.ensure).toHaveBeenCalledWith("read");
    expect(mocks.staff).toHaveBeenCalledOnce();
    expect(mocks.build).toHaveBeenCalledWith(input);
    expect(npRequireAgentEvaluationWorkbenchResultV1(await response.json()).authority).toBe(
      "offline-self-reported-no-approval",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("rejects unauthenticated and forbidden staff before reading uploaded evidence", async () => {
    for (const error of [new NpAuthError(), new NpForbiddenError("agent-studio", "manage")]) {
      mocks.staff.mockRejectedValueOnce(error);
      const response = await handleAgentEvaluationWorkbenchRequest(request("private-upload"));
      expect(response.status).toBe(error.statusCode);
      expect(await response.text()).not.toContain("private-upload");
    }
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("rejects unsupported transport and bounded body overflow before the verifier", async () => {
    const inputs = [
      request(input, { "content-encoding": "gzip" }),
      request(input, {}, "?siteId=other"),
      request("x".repeat(npAgentEvaluationWorkbenchRequestMaxBytesV1)),
    ];
    for (const value of inputs)
      expect((await handleAgentEvaluationWorkbenchRequest(value)).status).toBe(400);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("redacts verifier internals and returns safe retry semantics without a partial artifact", async () => {
    mocks.build.mockRejectedValue(new Error("private-evidence-and-labels"));
    const response = await handleAgentEvaluationWorkbenchRequest(request());
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("private-evidence-and-labels");
    expect(text).not.toContain("reportArtifactJson");
    expect(JSON.parse(response.headers.get(npApiErrorDiagnosticsHeader)!)).toMatchObject({
      recovery: "none",
    });
    expect(npBuildAgentEvaluationWorkbenchV1).toHaveBeenCalledOnce();
  });
});
