import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 14.3 — navigation PUT round-trip + cached read.
 *
 *   1. PUT /api/navigation persists the items and returns the
 *      stored row. Pinned because navigation had no integration
 *      coverage before — saving was the only mutation that
 *      didn't fire any cache invalidation.
 *   2. The `getCachedNavigation` helper reads what the API
 *      wrote. The cache wrapper falls through to the uncached
 *      read in the test harness (no Next incremental cache),
 *      so this also exercises the fallback path.
 */
describe.skipIf(skipIfNoTestDb())("navigation cache (Phase 14.3)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("PUT /api/navigation persists items and getCachedNavigation reads them back", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/navigation/route");

    const req = buildRequest("/api/navigation", {
      session: admin,
      method: "PUT",
      body: {
        location: "header",
        items: [
          { id: "blog", type: "link", label: "Blog", url: "/blog" },
          { id: "about", type: "link", label: "About", url: "/about" },
        ],
      },
    });
    const res = await PUT(req);
    const { status, body } = await readJson<{
      location?: string;
      items?: Array<{ label: string }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.location).toBe("header");
    expect(body.items?.map((i) => i.label)).toEqual(["Blog", "About"]);

    // The cached helper falls through to the uncached read when
    // Next's incremental cache isn't reachable (test harness),
    // so we get the freshly-persisted row even without a tag bust.
    const { getCachedNavigation } = await import("@nexpress/next");
    const items = await getCachedNavigation("header");
    expect(items.map((i) => i.label)).toEqual(["Blog", "About"]);
  });

  it("rejects non-admin PUTs (admin-only gate)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { PUT } = await import("@/app/api/navigation/route");

    const req = buildRequest("/api/navigation", {
      session: editor,
      method: "PUT",
      body: { location: "header", items: [] },
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("validates the items shape (rejects malformed entries)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/navigation/route");

    const req = buildRequest("/api/navigation", {
      session: admin,
      method: "PUT",
      body: {
        location: "header",
        items: [{ label: "missing id and type" }],
      },
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });
});
