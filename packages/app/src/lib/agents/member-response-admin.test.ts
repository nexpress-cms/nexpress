import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpForbiddenError } from "@nexpress/core";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  staff: vi.fn(),
  ensure: vi.fn(),
  get: vi.fn(),
  plan: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("./studio-admin", () => ({
  requireAgentStudioAdmin: mocks.staff,
  normalizeAgentStudioError: (error: unknown) => error,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentMemberResponseAdminRequest } from "./member-response-admin";
const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const staff = { siteId: "default", actor: { user: { id }, sessionId: id } };
const command = {
  schemaVersion: "np.agent-member-response-plan-input.v1",
  expectedVersion: 1,
  memberId: id,
  expectedMemberVersionDigest: hash,
  operation: { kind: "restrict", durationSeconds: 60 },
  idempotencyKey: "member-plan-1",
};
const detail = {
  schemaVersion: "np.agent-member-response.v1",
  incidentId: id,
  incidentVersion: 1,
  memberId: id,
  memberVersionDigest: hash,
  maximumDurationSeconds: 3600,
  canRestrict: true,
  revocable: [],
  plans: [],
  truncated: false,
};
function request(body?: unknown, query = "") {
  return new NextRequest(
    `https://site.example/api/admin/agents/incidents/${id}/member-response${query}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(staff);
  mocks.runtime.mockReturnValue({ memberResponses: mocks });
  mocks.get.mockResolvedValue(detail);
  mocks.plan.mockResolvedValue({ resourceId: id, replayed: false });
  mocks.execute.mockResolvedValue({ resourceId: id, replayed: false });
});
describe("explicit Member response HTTP", () => {
  it("checks current staff before optional installation and keeps absent owner disabled", async () => {
    mocks.staff.mockRejectedValueOnce(new NpForbiddenError("agent-studio", "manage"));
    expect((await handleAgentMemberResponseAdminRequest(request(), "get", id)).status).toBe(403);
    expect(mocks.runtime).not.toHaveBeenCalled();
    mocks.runtime.mockReturnValue({ memberResponses: null });
    expect((await handleAgentMemberResponseAdminRequest(request(), "get", id)).status).toBe(503);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uses read initialization, no-store and exact Incident-bound projection", async () => {
    const response = await handleAgentMemberResponseAdminRequest(request(), "get", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(mocks.ensure).toHaveBeenCalledWith("read");
    expect(mocks.get).toHaveBeenCalledWith({ ...staff, incidentId: id });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.plan).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ ...detail, incidentId: "10000000-0000-4000-8000-000000000002" });
    expect((await handleAgentMemberResponseAdminRequest(request(), "get", id)).status).toBe(500);
  });
  it("forwards exact plan/execute commands using server-selected staff and a bounded acknowledgement", async () => {
    const plan = await handleAgentMemberResponseAdminRequest(request(command), "plan", id);
    expect(plan.status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledWith({ ...staff, incidentId: id, command });
    expect(await plan.json()).toEqual({ resourceId: id, replayed: false });
    const execute = {
      schemaVersion: "np.agent-member-response-execute-input.v1",
      expectedVersion: 1,
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      idempotencyKey: "member-execute-1",
    };
    expect(
      (await handleAgentMemberResponseAdminRequest(request(execute), "execute", id)).status,
    ).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({ ...staff, incidentId: id, command: execute });
    expect(mocks.ensure).toHaveBeenCalledWith("write");
    mocks.execute.mockResolvedValue({
      resourceId: "10000000-0000-4000-8000-000000000002",
      replayed: false,
    });
    expect(
      (await handleAgentMemberResponseAdminRequest(request(execute), "execute", id)).status,
    ).toBe(500);
  });
  it("rejects queries, permanent/global requests and injected actor authority before calling the mutation owner", async () => {
    expect(
      (await handleAgentMemberResponseAdminRequest(request(undefined, "?siteId=other"), "get", id))
        .status,
    ).toBe(400);
    for (const patch of [
      { actor: { id } },
      { operation: { kind: "permanent" } },
      { operation: { kind: "restrict", durationSeconds: 60, scope: "global" } },
      { memberId: "invented" },
    ]) {
      expect(
        (await handleAgentMemberResponseAdminRequest(request({ ...command, ...patch }), "plan", id))
          .status,
      ).toBe(400);
    }
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
