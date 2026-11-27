import * as sites from "@nexpress/core/sites";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureFor: vi.fn(),
  getSiteById: vi.fn(),
  getCollectionConfig: vi.fn(),
  revalidateCollection: vi.fn(),
}));

vi.mock("../../../lib/init-core", () => ({ ensureFor: mocks.ensureFor }));
vi.mock("@nexpress/core/sites", async (original) => ({
  ...(await original<typeof sites>()),
  getSiteById: mocks.getSiteById,
}));
vi.mock("@nexpress/core/collections", () => ({ getCollectionConfig: mocks.getCollectionConfig }));
vi.mock("../../../lib/revalidate", () => ({ revalidateCollection: mocks.revalidateCollection }));

import { POST } from "./route.js";

function request(
  token?: string,
  body: unknown = { siteId: "tenant-b", collection: "posts", documentSlug: "story" },
) {
  return new NextRequest("http://web.test/api/internal/revalidate-collection", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

describe("worker collection revalidation route", () => {
  beforeEach(() => {
    vi.stubEnv("NP_SCHEDULER_TOKEN", "shared-test-token");
    mocks.getSiteById.mockResolvedValue({ id: "tenant-b" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("requires the configured scheduler bearer before bootstrapping", async () => {
    expect((await POST(request())).status).toBe(401);
    vi.stubEnv("NP_SCHEDULER_TOKEN", "");
    expect((await POST(request("shared-test-token"))).status).toBe(503);
    expect(mocks.ensureFor).not.toHaveBeenCalled();
  });

  it("rejects caller-defined cache targets and unknown sites", async () => {
    const token = "shared-test-token";
    expect(
      (await POST(request(token, { siteId: "tenant-b", collection: "posts", paths: ["/"] })))
        .status,
    ).toBe(400);
    mocks.getSiteById.mockResolvedValueOnce(null);
    expect((await POST(request(token))).status).toBe(404);
    expect(mocks.revalidateCollection).not.toHaveBeenCalled();
  });

  it("acknowledges complete revalidation inside the job's site scope", async () => {
    mocks.revalidateCollection.mockImplementation(async () => {
      expect(await sites.getCurrentSiteId()).toBe("tenant-b");
      return { status: "applied" };
    });
    const response = await sites.withCurrentSite("default", () =>
      POST(request("shared-test-token")),
    );
    expect(response.status).toBe(204);
    expect(mocks.revalidateCollection).toHaveBeenCalledWith("posts", { slug: "story" });
  });

  it("returns a failure when the web process only applied some invalidations", async () => {
    mocks.revalidateCollection.mockResolvedValueOnce({ status: "partial" });
    expect((await POST(request("shared-test-token"))).status).toBe(503);
  });
});
