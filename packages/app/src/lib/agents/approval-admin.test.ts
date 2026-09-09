import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpError } from "@nexpress/core";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  staff: vi.fn(),
  ensure: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  issueChallenge: vi.fn(),
  decide: vi.fn(),
  requestApproval: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.runtime,
}));
vi.mock("./studio-admin", () => ({
  requireAgentOauthStaff: mocks.staff,
  normalizeAgentStudioError: (error: unknown) => error,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensure }));
import { handleAgentApprovalAdminRequest, readAgentApprovalQuery } from "./approval-admin";
const id = "10000000-0000-4000-8000-000000000001";
const hash = `cj1:sha256:${"a".repeat(43)}`;
const staff = { siteId: "default", actor: { user: { id }, sessionId: id } };
const challenge = {
  schemaVersion: "np.agent-approval-challenge.v1",
  approvalId: id,
  approvalVersion: 2,
  purpose: "reject",
  challengeGeneration: 1,
  challenge: "A".repeat(43),
  reauthentication: { mode: "none" },
  expiresAt: "2026-09-10T00:00:00.000Z",
};
const detail = () => ({
  schemaVersion: "np.agent-approval-detail.v1",
  item: {
    schemaVersion: "np.agent-approval-list-item.v1",
    approval: {
      id,
      generation: 1,
      state: "pending",
      statementHash: hash,
      requiredHumanCapabilities: ["content.author"],
      requiredHumanPredicates: [],
      requestedAt: "2026-09-09T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
      decidedAt: null,
    },
    version: 1,
    target: { kind: "changeset", changeSetId: id, planHash: hash, scheduledFor: null },
    intendedOperation: "apply",
    scheduledFor: null,
    statementHash: hash,
    reauthentication: { mode: "none" },
    allowedDecisions: ["approve", "reject", "revoke"],
    risk: "reversible",
    capabilityId: "changeset.apply",
    capabilityContractVersion: 1,
    capabilityFingerprint: hash,
    policyHashes: [],
    requiresLivePreview: false,
    reviewSummary: {
      operationCount: 1,
      targetCount: 1,
      previewState: null,
      checksRun: null,
      rollbackPlan: "unavailable",
    },
    requiredScopes: ["changeset:apply"],
    requester: { kind: "staff", id },
  },
  review: null,
});
const request = (query = "", value?: unknown) =>
  new NextRequest(
    `https://site.example/api/admin/agents/approvals${query}`,
    value === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue(staff);
  mocks.runtime.mockReturnValue({
    approvals: mocks,
    changesets: { requestApproval: mocks.requestApproval },
  });
});
describe("Approval shared Admin routes", () => {
  it("decodes only the existing closed bounded query contract", () => {
    expect(readAgentApprovalQuery(request())).toMatchObject({
      state: "pending",
      limit: 25,
      cursor: null,
    });
    expect(
      readAgentApprovalQuery(
        request("?state=all&risk=sensitive&requesterKind=staff&requesterId=" + id),
      ),
    ).toMatchObject({ state: null, risk: "sensitive", requesterKind: "staff", requesterId: id });
    for (const query of [
      "?state=bogus",
      "?limit=0",
      "?limit=101",
      "?limit=01",
      "?state=pending&state=approved",
      "?siteId=other",
      "?requesterId=" + id,
      "?cursor=",
      "?createdAfter=2026-09-09",
      "?expiresAfter=2026-09-10T00:00:00.000Z&expiresBefore=2026-09-09T00:00:00.000Z",
    ])
      expect(() => readAgentApprovalQuery(request(query))).toThrow();
  });
  it("distinguishes missing runtime and authorized empty pages", async () => {
    mocks.runtime.mockReturnValue(null);
    expect((await handleAgentApprovalAdminRequest(request(), "list")).status).toBe(404);
    mocks.runtime.mockReturnValue({ approvals: mocks });
    mocks.list.mockResolvedValue({
      schemaVersion: "np.agent-approval-page.v1",
      items: [],
      nextCursor: null,
    });
    const response = await handleAgentApprovalAdminRequest(request(), "list");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.list).toHaveBeenCalledWith({
      ...staff,
      query: expect.objectContaining({ state: "pending" }),
    });
  });
  it("returns only validated safe detail and rejects malformed identifiers", async () => {
    mocks.get.mockResolvedValue(detail());
    expect((await handleAgentApprovalAdminRequest(request(), "get", id)).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith({ ...staff, id });
    expect((await handleAgentApprovalAdminRequest(request(), "get", "bad")).status).toBe(404);
    mocks.get.mockResolvedValue({ ...detail(), statementBody: { private: true } });
    const response = await handleAgentApprovalAdminRequest(request(), "get", id);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
  });
  it("passes exact challenge and decisions to the current staff session", async () => {
    const command = {
      schemaVersion: "np.agent-approval-challenge-request.v1",
      purpose: "reject",
      expectedApprovalVersion: 1,
      statementHash: hash,
      idempotencyKey: "challenge-1",
    };
    mocks.issueChallenge.mockResolvedValue(challenge);
    const response = await handleAgentApprovalAdminRequest(request("", command), "challenge", id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.issueChallenge).toHaveBeenCalledWith({ ...staff, id, command });
    const decision = {
      schemaVersion: "np.agent-approval-decision-input.v1",
      expectedApprovalVersion: 2,
      statementHash: hash,
      challengeGeneration: 1,
      challenge: challenge.challenge,
      idempotencyKey: "decision-1",
      reason: null,
    };
    mocks.decide.mockResolvedValue(detail());
    expect(
      (await handleAgentApprovalAdminRequest(request("", decision), "reject", id)).status,
    ).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith({
      ...staff,
      id,
      decision: "reject",
      command: decision,
    });
    expect(
      (
        await handleAgentApprovalAdminRequest(
          request("", { ...decision, targetKind: "action" }),
          "reject",
          id,
        )
      ).status,
    ).toBe(400);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });
  it("rejects non-JSON, encoded and malformed UTF-8 bodies without admission", async () => {
    for (const [headers, body] of [
      [{ "content-type": "text/plain" }, "{}"],
      [{ "content-type": "application/json", "content-encoding": "gzip" }, "{}"],
      [{ "content-type": "application/json" }, new Uint8Array([0xff])],
    ] as Array<[Record<string, string>, string | Uint8Array]>) {
      const request = new NextRequest("https://site.example/api/admin/agents/approvals", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : new Uint8Array(body),
      });
      expect((await handleAgentApprovalAdminRequest(request, "approve", id)).status).toBe(400);
    }
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("uses ChangeSet request admission without scheduling or applying", async () => {
    const command = {
      schemaVersion: "np.agent-changeset-request-approval-input.v1",
      expectedDraftVersion: 1,
      planHash: hash,
      intendedOperation: "apply",
      scheduledFor: null,
      idempotencyKey: "request-1",
    };
    mocks.requestApproval.mockResolvedValue(detail());
    expect(
      (await handleAgentApprovalAdminRequest(request("", command), "request", id)).status,
    ).toBe(200);
    expect(mocks.requestApproval).toHaveBeenCalledWith({
      actor: { kind: "staff", ...staff },
      id,
      command,
    });
  });
  it("preserves safe admission conflicts and rejects oversized bodies before mutation", async () => {
    mocks.get.mockRejectedValue(new NpError("Current facts changed.", "CONFLICT", 409));
    expect((await handleAgentApprovalAdminRequest(request(), "get", id)).status).toBe(409);
    expect(
      (
        await handleAgentApprovalAdminRequest(
          request("", { data: "a".repeat(17000) }),
          "approve",
          id,
        )
      ).status,
    ).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
