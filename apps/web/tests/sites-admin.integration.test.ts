import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
 * Phase 15.3 — admin sites endpoints. Pin the API contract
 * + admin-only gate. The underlying registry behavior is
 * already covered by `sites-registry.integration.test.ts`;
 * these tests focus on the HTTP surface.
 */
describe.skipIf(skipIfNoTestDb())("admin sites API (Phase 15.3)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
    const { listSites, deleteSite } = await import("@nexpress/core");
    const sites = await listSites();
    for (const site of sites) {
      if (!site.isDefault) await deleteSite(site.id);
    }
  });
  afterEach(async () => {
    const { listSites, deleteSite } = await import("@nexpress/core");
    const sites = await listSites();
    for (const site of sites) {
      if (!site.isDefault) await deleteSite(site.id);
    }
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("GET /api/admin/sites returns the seed default site", async () => {
    const admin = await seedUser({ role: "admin" });
    const { GET } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", { session: admin });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{ id: string; isDefault: boolean }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.docs?.find((s) => s.isDefault)?.id).toBe("default");
  });

  it("POST /api/admin/sites creates a site", async () => {
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", {
      session: admin,
      method: "POST",
      body: { id: "acme", name: "Acme", hostname: "acme.example.com" },
    });
    const res = await POST(req);
    const { status, body } = await readJson<{ id?: string; hostname?: string }>(
      res,
    );
    expect(status).toBe(200);
    expect(body.id).toBe("acme");
    expect(body.hostname).toBe("acme.example.com");
  });

  it("POST forbids non-admin roles", async () => {
    const editor = await seedUser({ role: "editor" });
    const { POST } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", {
      session: editor,
      method: "POST",
      body: { id: "blocked", name: "Blocked" },
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("PATCH /api/admin/sites/[id] updates name + hostname", async () => {
    const admin = await seedUser({ role: "admin" });
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "patch-target", name: "Old" });

    const { PATCH } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest("/api/admin/sites/patch-target", {
      session: admin,
      method: "PATCH",
      body: { name: "New", hostname: "patched.example.com" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "patch-target" }),
    });
    const { status, body } = await readJson<{
      name?: string;
      hostname?: string;
    }>(res);
    expect(status).toBe(200);
    expect(body.name).toBe("New");
    expect(body.hostname).toBe("patched.example.com");
  });

  it("DELETE /api/admin/sites/[id] removes a non-default site", async () => {
    const admin = await seedUser({ role: "admin" });
    const { createSite, getSiteById } = await import("@nexpress/core");
    await createSite({ id: "throwaway", name: "Throwaway" });

    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest("/api/admin/sites/throwaway", {
      session: admin,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "throwaway" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect(await getSiteById("throwaway")).toBeNull();
  });

  it("DELETE refuses to remove the default site", async () => {
    const admin = await seedUser({ role: "admin" });
    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest("/api/admin/sites/default", {
      session: admin,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "default" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });

  it("GET forbids viewers", async () => {
    const viewer = await seedUser({ role: "viewer" });
    const { GET } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", { session: viewer });
    const res = await GET(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });
});
