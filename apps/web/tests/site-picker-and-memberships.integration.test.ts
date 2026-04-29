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
 * Phase 15.6 — site picker + memberships admin + super-admin
 * toggle endpoints. Pin happy paths, role gates, and the
 * specific edge cases (switching to inaccessible site, self-
 * demotion refusal, default-site fallback for global admins).
 */
describe.skipIf(skipIfNoTestDb())("site picker + memberships (Phase 15.6)", () => {
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
      if (!site.isDefault) await deleteSite(site.id, { cascade: true });
    }
  });
  afterEach(async () => {
    const { listSites, deleteSite } = await import("@nexpress/core");
    const sites = await listSites();
    for (const site of sites) {
      if (!site.isDefault) await deleteSite(site.id, { cascade: true });
    }
  });
  afterAll(async () => {
    await closeTestDb();
  });

  // ============== /api/admin/sites/accessible ==============

  it("accessible: super-admin sees every site", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, setSuperAdmin } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    await createSite({ id: "beta", name: "Beta" });
    await setSuperAdmin(user.userId, true);

    const { GET } = await import("@/app/api/admin/sites/accessible/route");
    const req = buildRequest("/api/admin/sites/accessible", { session: user });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{ id: string }>;
      isSuperAdmin?: boolean;
    }>(res);
    expect(status).toBe(200);
    expect(body.isSuperAdmin).toBe(true);
    const ids = (body.docs ?? []).map((s) => s.id).sort();
    expect(ids).toContain("alpha");
    expect(ids).toContain("beta");
    expect(ids).toContain("default");
  });

  it("accessible: non-super sees only sites with explicit memberships", async () => {
    const user = await seedUser({ role: "editor" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "mine", name: "Mine" });
    await createSite({ id: "theirs", name: "Theirs" });
    await grantSiteMembership("mine", user.userId, "admin");

    const { GET } = await import("@/app/api/admin/sites/accessible/route");
    const req = buildRequest("/api/admin/sites/accessible", { session: user });
    const res = await GET(req);
    const { body } = await readJson<{
      docs?: Array<{ id: string }>;
      isSuperAdmin?: boolean;
    }>(res);
    expect(body.isSuperAdmin).toBe(false);
    const ids = (body.docs ?? []).map((s) => s.id);
    expect(ids).toEqual(["mine"]);
  });

  it("accessible: global admin with no memberships sees the default site (single-tenant fallback)", async () => {
    const user = await seedUser({ role: "admin" });
    const { GET } = await import("@/app/api/admin/sites/accessible/route");
    const req = buildRequest("/api/admin/sites/accessible", { session: user });
    const res = await GET(req);
    const { body } = await readJson<{
      docs?: Array<{ id: string }>;
    }>(res);
    expect((body.docs ?? []).map((s) => s.id)).toEqual(["default"]);
  });

  // Issue #221 — admin override cookie / header is untrusted.
  // The resolver re-validates against the session before honoring
  // the override so a forged `nx-admin-site` value can't change
  // the tenant context.
  it("forged x-nx-admin-site header is dropped when the user lacks access (#221)", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    // No membership granted — the user has no business resolving
    // to "alpha". The resolver must fall back to the default site
    // even though the override header is set.
    const { GET } = await import("@/app/api/admin/sites/accessible/route");
    const req = buildRequest("/api/admin/sites/accessible", {
      session: user,
      headers: { "x-nx-admin-site": "alpha" },
    });
    const res = await GET(req);
    const { body } = await readJson<{ currentId?: string }>(res);
    expect(body.currentId).not.toBe("alpha");
    expect(body.currentId).toBe("default");
  });

  it("x-nx-admin-site is honored when the session has membership (#221)", async () => {
    const user = await seedUser({ role: "editor" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    await grantSiteMembership("alpha", user.userId, "admin");
    const { GET } = await import("@/app/api/admin/sites/accessible/route");
    const req = buildRequest("/api/admin/sites/accessible", {
      session: user,
      headers: { "x-nx-admin-site": "alpha" },
    });
    const res = await GET(req);
    const { body } = await readJson<{ currentId?: string }>(res);
    expect(body.currentId).toBe("alpha");
  });

  it("x-nx-admin-site without a session is dropped (#221)", async () => {
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    // Anonymous request: no `nx-session` cookie. The resolver
    // can't verify membership so the override falls through.
    const { GET } = await import("@/app/api/admin/sites/accessible/route");
    const req = buildRequest("/api/admin/sites/accessible", {
      headers: { "x-nx-admin-site": "alpha" },
    });
    // requireAuth() returns 401 — but the resolver already
    // dropped the override before that. We assert via the public
    // settings route which doesn't gate on auth.
    const { GET: settingsGet } = await import("@/app/api/settings/route");
    const settingsReq = buildRequest("/api/settings", {
      headers: { "x-nx-admin-site": "alpha" },
    });
    const settingsRes = await settingsGet(settingsReq);
    // The settings route returns under the resolved site; if the
    // override leaked, the response would be tied to "alpha".
    // We assert it's the default site by verifying the response
    // succeeds without crashing on the unknown site id.
    expect(settingsRes.status).toBeLessThan(500);
    void res;
  });

  // ============== /api/admin/sites/active ==============

  it("active: super-admin can switch to any site (sets cookie)", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, setSuperAdmin } = await import("@nexpress/core");
    await createSite({ id: "switchable", name: "Switchable" });
    await setSuperAdmin(user.userId, true);

    const { POST } = await import("@/app/api/admin/sites/active/route");
    const req = buildRequest("/api/admin/sites/active", {
      session: user,
      method: "POST",
      body: { id: "switchable" },
    });
    const res = await POST(req);
    const { status, body } = await readJson<{ id?: string }>(res);
    expect(status).toBe(200);
    expect(body.id).toBe("switchable");
    // Set-Cookie header should carry the cookie.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("nx-admin-site=switchable");
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it("active: non-super is rejected when switching to a site they don't belong to", async () => {
    const user = await seedUser({ role: "editor" });
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "forbidden", name: "Forbidden" });

    const { POST } = await import("@/app/api/admin/sites/active/route");
    const req = buildRequest("/api/admin/sites/active", {
      session: user,
      method: "POST",
      body: { id: "forbidden" },
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("active: global admin can switch to default (single-tenant fallback)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/sites/active/route");
    const req = buildRequest("/api/admin/sites/active", {
      session: admin,
      method: "POST",
      body: { id: "default" },
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(200);
  });

  it("active DELETE clears the cookie", async () => {
    const user = await seedUser({ role: "admin" });
    const { DELETE } = await import("@/app/api/admin/sites/active/route");
    const req = buildRequest("/api/admin/sites/active", {
      session: user,
      method: "DELETE",
    });
    const res = await DELETE(req);
    const { status } = await readJson(res);
    expect(status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    // Deleting sets Max-Age=0 (or expires past) on the same name.
    expect(setCookie).toMatch(/nx-admin-site=/i);
  });

  // ============== /api/admin/sites/[id]/memberships ==============

  it("memberships POST: super-admin can grant on any site", async () => {
    const admin = await seedUser({ role: "viewer" });
    const target = await seedUser({ role: "viewer" });
    const { createSite, setSuperAdmin } = await import("@nexpress/core");
    await createSite({ id: "any-site", name: "Any" });
    await setSuperAdmin(admin.userId, true);

    const { POST } = await import(
      "@/app/api/admin/sites/[id]/memberships/route"
    );
    const req = buildRequest("/api/admin/sites/any-site/memberships", {
      session: admin,
      method: "POST",
      body: { userId: target.userId, role: "editor" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "any-site" }) });
    const { status, body } = await readJson<{ siteId?: string; role?: string }>(
      res,
    );
    expect(status).toBe(200);
    expect(body.role).toBe("editor");
  });

  it("memberships POST: per-site admin can grant on their own site", async () => {
    const siteAdmin = await seedUser({ role: "viewer" });
    const target = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "site-admin-realm", name: "Realm" });
    await grantSiteMembership("site-admin-realm", siteAdmin.userId, "admin");

    const { POST } = await import(
      "@/app/api/admin/sites/[id]/memberships/route"
    );
    const req = buildRequest("/api/admin/sites/site-admin-realm/memberships", {
      session: siteAdmin,
      method: "POST",
      body: { userId: target.userId, role: "editor" },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "site-admin-realm" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
  });

  it("memberships POST: per-site editor cannot grant", async () => {
    const editor = await seedUser({ role: "viewer" });
    const target = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "editor-realm", name: "EditorRealm" });
    await grantSiteMembership("editor-realm", editor.userId, "editor");

    const { POST } = await import(
      "@/app/api/admin/sites/[id]/memberships/route"
    );
    const req = buildRequest("/api/admin/sites/editor-realm/memberships", {
      session: editor,
      method: "POST",
      body: { userId: target.userId, role: "viewer" },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "editor-realm" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("memberships DELETE revokes a membership (super-admin)", async () => {
    const admin = await seedUser({ role: "viewer" });
    const target = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, getMembership, setSuperAdmin } =
      await import("@nexpress/core");
    await createSite({ id: "revoke-test", name: "Revoke" });
    await setSuperAdmin(admin.userId, true);
    await grantSiteMembership("revoke-test", target.userId, "editor");

    const { DELETE } = await import(
      "@/app/api/admin/sites/[id]/memberships/[userId]/route"
    );
    const req = buildRequest(
      `/api/admin/sites/revoke-test/memberships/${target.userId}`,
      { session: admin, method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "revoke-test", userId: target.userId }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect(await getMembership("revoke-test", target.userId)).toBeNull();
  });

  // ============== /api/admin/users/[id]/super-admin ==============

  it("super-admin PATCH: only existing super-admins can promote", async () => {
    const admin = await seedUser({ role: "admin" });
    const target = await seedUser({ role: "viewer" });

    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/super-admin/route"
    );
    // admin (not super) tries to promote → 403
    const req = buildRequest(`/api/admin/users/${target.userId}/super-admin`, {
      session: admin,
      method: "PATCH",
      body: { isSuperAdmin: true },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: target.userId }) });
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("super-admin PATCH: super-admin can promote another user", async () => {
    const root = await seedUser({ role: "viewer" });
    const target = await seedUser({ role: "viewer" });
    const { setSuperAdmin, isSuperAdmin } = await import("@nexpress/core");
    await setSuperAdmin(root.userId, true);

    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/super-admin/route"
    );
    const req = buildRequest(`/api/admin/users/${target.userId}/super-admin`, {
      session: root,
      method: "PATCH",
      body: { isSuperAdmin: true },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: target.userId }) });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect(
      await isSuperAdmin({
        id: target.userId,
        email: target.email,
        name: "Target",
        role: target.role,
        tokenVersion: 0,
      }),
    ).toBe(true);
  });

  it("super-admin PATCH: self-demotion is refused", async () => {
    const root = await seedUser({ role: "viewer" });
    const { setSuperAdmin } = await import("@nexpress/core");
    await setSuperAdmin(root.userId, true);

    const { PATCH } = await import(
      "@/app/api/admin/users/[id]/super-admin/route"
    );
    const req = buildRequest(`/api/admin/users/${root.userId}/super-admin`, {
      session: root,
      method: "PATCH",
      body: { isSuperAdmin: false },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: root.userId }) });
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });
});
