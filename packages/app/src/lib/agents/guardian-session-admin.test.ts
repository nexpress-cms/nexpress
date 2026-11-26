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
import { handleAgentGuardianSessionAdminRequest } from "./guardian-session-admin";
const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const staff = { siteId: "default", actor: { user: { id }, sessionId: id } };
const command = {
  schemaVersion: "np.agent-guardian-session-plan-input.v1",
  expectedVersion: 1,
  expectedTargetVersionDigest: hash,
  idempotencyKey: "guardian-plan-1",
};
const detail = {
  schemaVersion: "np.agent-guardian-session.v1",
  incidentId: id,
  incidentVersion: 1,
  targetVersionDigest: hash,
  canPlan: true,
  target: {
    actorKind: "staff",
    sessionFamilyId: id,
    createdAt: "2026-10-18T00:00:00.000Z",
    impact: "deployment",
    affectedSiteCount: 1,
    impactDigest: hash,
  },
  plans: [],
  truncated: false,
};
function request(body?: unknown, query = "") {
  return new NextRequest(
    `https://site.example/api/admin/agents/incidents/${id}/guardian-session${query}`,
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
  mocks.runtime.mockReturnValue({ guardianSessions: mocks });
  mocks.get.mockResolvedValue(detail);
  mocks.plan.mockResolvedValue({ resourceId: id, replayed: false });
  mocks.execute.mockResolvedValue({ resourceId: id, replayed: false });
});
describe("explicit Guardian session revocation HTTP", () => {
  it("checks current staff before optional installation and keeps absent owner disabled", async () => {
    mocks.staff.mockRejectedValueOnce(new NpForbiddenError("agent-studio", "manage"));
    expect((await handleAgentGuardianSessionAdminRequest(request(), "get", id)).status).toBe(403);
    expect(mocks.runtime).not.toHaveBeenCalled();
    mocks.runtime.mockReturnValue({ guardianSessions: null });
    expect((await handleAgentGuardianSessionAdminRequest(request(), "get", id)).status).toBe(503);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uses read initialization, no-store and exact Incident-bound projection", async () => {
    const response = await handleAgentGuardianSessionAdminRequest(request(), "get", id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(mocks.ensure).toHaveBeenCalledWith("read");
    expect(mocks.get).toHaveBeenCalledWith({ ...staff, incidentId: id });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.plan).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ ...detail, incidentId: "10000000-0000-4000-8000-000000000002" });
    expect((await handleAgentGuardianSessionAdminRequest(request(), "get", id)).status).toBe(500);
  });
  it("forwards exact plan/execute commands using server-selected staff and a bounded acknowledgement", async () => {
    const plan = await handleAgentGuardianSessionAdminRequest(request(command), "plan", id);
    expect(plan.status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledWith({ ...staff, incidentId: id, command });
    expect(await plan.json()).toEqual({ resourceId: id, replayed: false });
    const execute = {
      schemaVersion: "np.agent-guardian-session-execute-input.v1",
      expectedVersion: 1,
      actionId: id,
      approvalId: id,
      proposalHash: hash,
      idempotencyKey: "guardian-execute-1",
    };
    expect(
      (await handleAgentGuardianSessionAdminRequest(request(execute), "execute", id)).status,
    ).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({ ...staff, incidentId: id, command: execute });
    expect(mocks.ensure).toHaveBeenCalledWith("write");
    mocks.execute.mockResolvedValue({
      resourceId: "10000000-0000-4000-8000-000000000002",
      replayed: false,
    });
    expect(
      (await handleAgentGuardianSessionAdminRequest(request(execute), "execute", id)).status,
    ).toBe(500);
  });
  it("rejects queries and client-selected targets or injected authority before calling the mutation owner", async () => {
    expect(
      (await handleAgentGuardianSessionAdminRequest(request(undefined, "?siteId=other"), "get", id))
        .status,
    ).toBe(400);
    for (const patch of [
      { actor: { id } },
      { sessionFamilyId: id },
      { principalId: id },
      { target: { actorKind: "member", sessionFamilyId: id } },
      { requiredHumanPredicates: [] },
      { expectedTargetVersionDigest: "invented" },
    ]) {
      expect(
        (
          await handleAgentGuardianSessionAdminRequest(
            request({ ...command, ...patch }),
            "plan",
            id,
          )
        ).status,
      ).toBe(400);
    }
    expect(mocks.plan).not.toHaveBeenCalled();
  });
});
