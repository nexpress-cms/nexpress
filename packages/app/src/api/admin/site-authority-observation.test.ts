import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireGlobalAuth: vi.fn(),
  ensureFor: vi.fn(),
  getSiteById: vi.fn(),
  canOnSite: vi.fn(),
  grantSiteMembership: vi.fn(),
  revokeSiteMembership: vi.fn(),
  isSuperAdmin: vi.fn(),
  setSuperAdmin: vi.fn(),
}));

vi.mock("@nexpress/core", async (original) => ({
  ...(await original<object>()),
  getSiteById: mocks.getSiteById,
  grantSiteMembership: mocks.grantSiteMembership,
  revokeSiteMembership: mocks.revokeSiteMembership,
  isSuperAdmin: mocks.isSuperAdmin,
  setSuperAdmin: mocks.setSuperAdmin,
}));
vi.mock("@nexpress/core/sites", async (original) => ({
  ...(await original<object>()),
  canOnSite: mocks.canOnSite,
}));
vi.mock("../../lib/auth-helpers", () => ({
  requireAuth: mocks.requireAuth,
  requireGlobalAuth: mocks.requireGlobalAuth,
}));
vi.mock("../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));

import { POST } from "./sites/[id]/memberships/route";
import { DELETE } from "./sites/[id]/memberships/[userId]/route";
import { PATCH } from "./users/[id]/super-admin/route";

const actorId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";

function request(method: string, body?: unknown) {
  return new NextRequest("https://example.test/api/admin/authority", {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAuth.mockResolvedValue({ id: actorId, role: "admin" });
  mocks.requireGlobalAuth.mockResolvedValue({ id: actorId, role: "admin" });
  mocks.getSiteById.mockResolvedValue({ id: "tenant-b" });
  mocks.canOnSite.mockResolvedValue(true);
  mocks.isSuperAdmin.mockResolvedValue(true);
  mocks.grantSiteMembership.mockResolvedValue({
    siteId: "tenant-b",
    userId: targetId,
    role: "editor",
    createdAt: new Date("2026-10-18T00:00:00.000Z"),
    updatedAt: new Date("2026-10-18T00:00:00.000Z"),
  });
});

describe("authority mutation source identity", () => {
  it("attributes a membership grant to the authenticated staff, separately from its target", async () => {
    const response = await POST(request("POST", { userId: targetId, role: "editor" }), {
      params: Promise.resolve({ id: "tenant-b" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.grantSiteMembership).toHaveBeenCalledWith("tenant-b", targetId, "editor", {
      actor: { kind: "staff", userId: actorId },
    });
    expect(mocks.canOnSite).toHaveBeenCalledWith(
      { id: actorId, role: "admin" },
      "admin.manage",
      "tenant-b",
    );
  });

  it("attributes membership removal to authenticated staff and preserves authorization", async () => {
    const context = { params: Promise.resolve({ id: "tenant-b", userId: targetId }) };
    expect((await DELETE(request("DELETE"), context)).status).toBe(200);
    expect(mocks.revokeSiteMembership).toHaveBeenCalledWith("tenant-b", targetId, {
      actor: { kind: "staff", userId: actorId },
    });
    mocks.canOnSite.mockResolvedValue(false);
    mocks.revokeSiteMembership.mockClear();
    expect((await DELETE(request("DELETE"), context)).status).toBe(403);
    expect(mocks.revokeSiteMembership).not.toHaveBeenCalled();
  });

  it("uses global authenticated staff identity for super-admin changes despite body claims", async () => {
    const response = await PATCH(
      request("PATCH", {
        isSuperAdmin: true,
        actor: { kind: "staff", userId: targetId },
        siteId: "forged-site",
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.requireGlobalAuth).toHaveBeenCalledOnce();
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(mocks.setSuperAdmin).toHaveBeenCalledWith(targetId, true, {
      actor: { kind: "staff", userId: actorId },
    });
  });

  it("retains super-admin permission and self-demotion rejection before source writes", async () => {
    mocks.isSuperAdmin.mockResolvedValue(false);
    expect(
      (
        await PATCH(request("PATCH", { isSuperAdmin: true }), {
          params: Promise.resolve({ id: targetId }),
        })
      ).status,
    ).toBe(403);
    mocks.isSuperAdmin.mockResolvedValue(true);
    expect(
      (
        await PATCH(request("PATCH", { isSuperAdmin: false }), {
          params: Promise.resolve({ id: actorId }),
        })
      ).status,
    ).toBe(400);
    expect(mocks.setSuperAdmin).not.toHaveBeenCalled();
  });
});
