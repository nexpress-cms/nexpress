import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NpError } from "@nexpress/core";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  staff: vi.fn(),
  ensure: vi.fn(),
  apply: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
  getReview: vi.fn(),
  getPreview: vi.fn(),
  readArtifact: vi.fn(),
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
import { handleAgentChangeSetAdminRequest, readChangeSetQuery } from "./changeset-admin";
const id = "10000000-0000-4000-8000-000000000001";
const request = (query = "") =>
  new NextRequest(`https://site.example/api/admin/agents/changesets${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue({ siteId: "default", actor: { user: { id }, sessionId: id } });
  mocks.runtime.mockReturnValue({
    changesets: {
      apply: mocks.apply,
      schedule: mocks.schedule,
      cancel: mocks.cancel,
      list: mocks.list,
      getReview: mocks.getReview,
      getPreview: mocks.getPreview,
      readPreviewArtifact: mocks.readArtifact,
    },
  });
});
describe("ChangeSet Admin shared HTTP surface", () => {
  it("rejects unbounded, duplicate and unsupported query inputs", () => {
    expect(readChangeSetQuery(request("?limit=25&cursor=opaque"))).toMatchObject({
      limit: 25,
      cursor: "opaque",
    });
    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=01",
      "?limit=1&limit=1",
      "?siteId=other",
      "?cursor=",
      "?states=ready,draft",
      "?states=draft,draft",
      "?actorKinds=unknown",
      "?createdAfter=2026-09-09",
      "?createdAfter=2026-09-10T00:00:00.000Z&createdBefore=2026-09-01T00:00:00.000Z",
    ])
      expect(() => readChangeSetQuery(request(query))).toThrow();
  });
  it("returns a bounded service-authorized page and no-store", async () => {
    mocks.list.mockResolvedValue({
      schemaVersion: "np.agent-changesets.v1",
      items: [],
      nextCursor: null,
    });
    const response = await handleAgentChangeSetAdminRequest(request("?limit=5"), "list");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ kind: "staff", siteId: "default" }),
        limit: 5,
      }),
    );
  });
  it("uses the installed shared list filter contract", () => {
    expect(
      readChangeSetQuery(
        request(
          "?states=draft,ready&actorKinds=external,staff&createdAfter=2026-09-01T00:00:00.000Z",
        ),
      ),
    ).toMatchObject({
      states: ["draft", "ready"],
      actorKinds: ["external", "staff"],
      createdAfter: "2026-09-01T00:00:00.000Z",
      createdBefore: null,
      limit: 25,
    });
  });
  it("uses shared artifact headers and conceals opaque failures", async () => {
    mocks.getPreview.mockResolvedValue({});
    mocks.readArtifact.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
      contentDigest: `ac1:sha256:${"A".repeat(43)}`,
      expiresAt: "2026-09-10T00:00:00.000Z",
    });
    const response = await handleAgentChangeSetAdminRequest(request(), "artifact", {
      id,
      previewId: id,
      artifactId: id,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="np-preview-${id}.png"`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    mocks.readArtifact.mockRejectedValue(new Error("Private locator and storage failure"));
    const failed = await handleAgentChangeSetAdminRequest(request(), "artifact", {
      id,
      previewId: id,
      artifactId: id,
    });
    expect(failed.status).toBe(404);
    expect(await failed.text()).toBe("Not found");
  });
  it("does not turn absent runtime into an empty history", async () => {
    mocks.runtime.mockReturnValue(null);
    expect((await handleAgentChangeSetAdminRequest(request(), "list")).status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("reauthorizes the exact ChangeSet preview before artifact bytes and collapses missing/denied artifacts", async () => {
    const results: string[] = [];
    for (const code of [403, 404]) {
      mocks.getPreview.mockRejectedValue(new NpError("Private detail", "FORBIDDEN", code));
      const response = await handleAgentChangeSetAdminRequest(request(), "artifact", {
        id,
        previewId: id,
        artifactId: id,
      });
      expect(response.status).toBe(404);
      results.push(await response.text());
    }
    expect(results).toEqual(["Not found", "Not found"]);
    expect(mocks.readArtifact).not.toHaveBeenCalled();
  });
});

describe("ChangeSet execution route boundary", () => {
  it.each(["apply", "schedule", "cancel"] as const)(
    "delegates %s to current staff admission and rejects unsafe output",
    async (operation) => {
      const command = { idempotencyKey: "attempt-1" };
      mocks[operation].mockResolvedValue({ rawCredential: "must-not-leak" });
      const response = await handleAgentChangeSetAdminRequest(
        new NextRequest(`https://site.example/api/admin/agents/changesets/${id}/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        operation,
        { id },
      );
      expect(mocks.ensure).toHaveBeenCalledWith("write");
      expect(mocks[operation]).toHaveBeenCalledWith({
        actor: { kind: "staff", siteId: "default", actor: { user: { id }, sessionId: id } },
        id,
        command,
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("must-not-leak");
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );
  it.each(["apply", "schedule", "cancel"] as const)(
    "does not dispatch %s without installed runtime",
    async (operation) => {
      mocks.runtime.mockReturnValue(null);
      const response = await handleAgentChangeSetAdminRequest(
        new NextRequest(`https://site.example/api/admin/agents/changesets/${id}/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
        operation,
        { id },
      );
      expect(response.status).toBe(404);
      expect(mocks[operation]).not.toHaveBeenCalled();
    },
  );
});
