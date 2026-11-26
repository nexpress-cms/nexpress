import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpForbiddenError } from "@nexpress/core";
const mocks = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  ensureFor: vi.fn(),
  staff: vi.fn(),
  exportIncident: vi.fn(),
  diagnostics: vi.fn(),
}));
vi.mock("@nexpress/core/agents", async (original) => ({
  ...(await original<object>()),
  getOptionalAgentStudioServerRuntimeV1: mocks.getRuntime,
}));
vi.mock("../init-core", () => ({ ensureFor: mocks.ensureFor }));
vi.mock("./studio-admin", () => ({
  requireAgentStudioAdmin: mocks.staff,
  normalizeAgentStudioError: (error: unknown) =>
    error instanceof Error ? error : new Error("Unknown error"),
}));
import { handleGuardianOperationsAdminRequest } from "./guardian-operations-admin";

const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-10-18T00:00:00.000Z";
const digest = `cj1:sha256:${"A".repeat(43)}`;
function artifact() {
  return {
    schemaVersion: "np.agent-guardian-incident-export.v1",
    exportedAt: at,
    completeness: "complete",
    incident: {
      id,
      siteId: "default",
      versionNumber: 2,
      category: "authentication",
      severity: "medium",
      status: "open",
      eventCount: 5,
      firstObservedAt: at,
      lastObservedAt: at,
      createdAt: at,
      updatedAt: at,
    },
    signals: [
      {
        id,
        detectorId: "guardian.login-failures",
        detectorVersion: 1,
        category: "authentication",
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        createdAt: at,
      },
    ],
    sources: [
      {
        signalId: id,
        source: "requests",
        startedAt: at,
        endedAt: at,
        observedCount: 5,
        countBasis: "at-least",
        sourceDigest: null,
        impact: "site",
        affectedSiteCount: 1,
      },
    ],
    outcomes: [],
    checksum: digest,
  };
}
const request = (query = "?version=2") =>
  new NextRequest(`https://host.test/api/admin/agents/incidents/${id}/guardian-export${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getRuntime.mockReturnValue({ guardianOperations: mocks });
  mocks.staff.mockResolvedValue({ siteId: "default", actor: { sessionId: "trusted-session" } });
  mocks.exportIncident.mockResolvedValue(artifact());
});
describe("Guardian operations HTTP admission", () => {
  it("uses current staff/site authority and exact displayed version for a bounded private attachment", async () => {
    const response = await handleGuardianOperationsAdminRequest(request(), "export", id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="guardian-incident-${id}.json"`,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(artifact());
    expect(mocks.ensureFor.mock.calls).toEqual([["read"]]);
    expect(mocks.exportIncident).toHaveBeenCalledWith({
      siteId: "default",
      actor: { sessionId: "trusted-session" },
      incidentId: id,
      expectedVersion: 2,
    });
  });
  it("rejects ambiguous versions, lost authority, missing installation and unsafe owner projections", async () => {
    for (const query of [
      "",
      "?version=2&version=2",
      "?version=2&siteId=other",
      "?version=0",
      "?version=2.5",
    ])
      expect(
        (await handleGuardianOperationsAdminRequest(request(query), "export", id)).status,
      ).toBe(400);
    expect(mocks.exportIncident).not.toHaveBeenCalled();
    mocks.staff.mockRejectedValueOnce(new NpForbiddenError("guardian", "read"));
    expect((await handleGuardianOperationsAdminRequest(request(), "export", id)).status).toBe(403);
    mocks.getRuntime.mockReturnValueOnce(null);
    expect((await handleGuardianOperationsAdminRequest(request(), "export", id)).status).toBe(503);
    for (const value of [
      { ...artifact(), rawBody: "private-source-marker" },
      { ...artifact(), incident: { ...artifact().incident, siteId: "other" } },
      { ...artifact(), incident: { ...artifact().incident, versionNumber: 1 } },
    ]) {
      mocks.exportIncident.mockResolvedValueOnce(value);
      const response = await handleGuardianOperationsAdminRequest(request(), "export", id);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain("private-source-marker");
    }
  });
});
