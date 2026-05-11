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
 * Phase 11.4 — admin theme switcher endpoints. Tests the
 * registry listing, the active-id read endpoint, and the
 * activation write — including the role gate (admin-only)
 * and the registry-membership validation that protects against
 * persisting an id no theme will resolve to.
 */
describe.skipIf(skipIfNoTestDb())("theme switcher (Phase 11.4)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetThemes, registerThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    resetThemes();
    registerThemes([defaultTheme, magazineTheme]);
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("GET /api/admin/themes lists all registered themes with metadata", async () => {
    const editor = await seedUser({ role: "editor" });
    const { GET } = await import("@/app/api/admin/themes/route");
    const req = buildRequest("/api/admin/themes", { session: editor });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{
        id: string;
        name: string;
        version: string;
        description?: string;
        author?: { name: string };
        isActive: boolean;
      }>;
    }>(res);
    expect(status).toBe(200);
    const ids = (body.docs ?? []).map((d) => d.id).sort();
    expect(ids).toEqual(["default", "magazine"]);
    const def = body.docs?.find((d) => d.id === "default");
    expect(def?.name).toBe("NexPress Default");
    expect(typeof def?.version).toBe("string");
  });

  it("GET /api/admin/themes flags the first registered theme active when no setting exists", async () => {
    const editor = await seedUser({ role: "editor" });
    const { GET } = await import("@/app/api/admin/themes/route");
    const req = buildRequest("/api/admin/themes", { session: editor });
    const res = await GET(req);
    const { body } = await readJson<{
      docs?: Array<{ id: string; isActive: boolean }>;
    }>(res);
    const active = (body.docs ?? []).filter((d) => d.isActive).map((d) => d.id);
    expect(active).toEqual(["default"]);
  });

  it("PUT /api/admin/themes/active activates a theme; subsequent listing reflects it", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/admin/themes/active/route");
    const { GET: getList } = await import("@/app/api/admin/themes/route");
    const putReq = buildRequest("/api/admin/themes/active", {
      session: admin,
      method: "PUT",
      body: { id: "magazine" },
    });
    const putRes = await PUT(putReq);
    const { status: putStatus, body: putBody } = await readJson<{
      activeId?: string;
    }>(putRes);
    expect(putStatus).toBe(200);
    expect(putBody.activeId).toBe("magazine");

    const listReq = buildRequest("/api/admin/themes", { session: admin });
    const listRes = await getList(listReq);
    const { body: listBody } = await readJson<{
      docs?: Array<{ id: string; isActive: boolean }>;
    }>(listRes);
    const active = (listBody.docs ?? [])
      .filter((d) => d.isActive)
      .map((d) => d.id);
    expect(active).toEqual(["magazine"]);
  });

  it("PUT rejects unknown theme ids (registry-membership validation)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/admin/themes/active/route");
    const req = buildRequest("/api/admin/themes/active", {
      session: admin,
      method: "PUT",
      body: { id: "ghost-theme" },
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });

  it("PUT rejects missing/empty id", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/admin/themes/active/route");
    const req = buildRequest("/api/admin/themes/active", {
      session: admin,
      method: "PUT",
      body: {},
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });

  it("PUT forbids editors and viewers (admin-only gate)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { PUT } = await import("@/app/api/admin/themes/active/route");
    const req = buildRequest("/api/admin/themes/active", {
      session: editor,
      method: "PUT",
      body: { id: "magazine" },
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("GET /api/admin/themes/active returns the persisted id (or null when unset)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { GET } = await import("@/app/api/admin/themes/active/route");

    // No setting yet — should be null (the listing fallback to
    // first-registered is a separate concern; the active-id
    // endpoint reflects the persisted truth).
    const req1 = buildRequest("/api/admin/themes/active", { session: admin });
    const res1 = await GET(req1);
    const { body: body1 } = await readJson<{ activeId?: string | null }>(res1);
    expect(body1.activeId).toBeNull();

    // Persist via the helper directly (we already covered the
    // PUT endpoint's plumbing above) and re-read.
    const { setActiveThemeId } = await import("@nexpress/core");
    await setActiveThemeId("magazine", admin.userId);
    const req2 = buildRequest("/api/admin/themes/active", { session: admin });
    const res2 = await GET(req2);
    const { body: body2 } = await readJson<{ activeId?: string | null }>(res2);
    expect(body2.activeId).toBe("magazine");
  });

  it("GET listing requires editor+ (no anonymous read)", async () => {
    const viewer = await seedUser({ role: "viewer" });
    const { GET } = await import("@/app/api/admin/themes/route");
    const req = buildRequest("/api/admin/themes", { session: viewer });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });
});
