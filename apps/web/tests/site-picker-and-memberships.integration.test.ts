import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  type TestUserSession,
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
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });

  // Helper: hydrate the test session into an NxAuthUser so core
  // predicates that take `user` (canActorUseSite, etc.) can run.
  // Reads `name` + `tokenVersion` from the row the harness wrote
  // since `seedUser` only returns the JWT-facing slice.
  async function asActorForUser(session: {
    userId: string;
    email: string;
    role: TestUserSession["role"];
  }) {
    const { getTestDb } = await import("./harness.js");
    const { nxUsers } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const db = await getTestDb();
    const [row] = await db
      .select({ name: nxUsers.name, tokenVersion: nxUsers.tokenVersion })
      .from(nxUsers)
      .where(eq(nxUsers.id, session.userId));
    if (!row) throw new Error("seed user missing");
    return {
      id: session.userId,
      email: session.email,
      name: row.name,
      role: session.role,
      tokenVersion: row.tokenVersion,
    };
  }
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
  // The bootstrap resolver re-validates against the session
  // before honoring the override so a forged `nx-admin-site`
  // value can't change the tenant context.
  //
  // Note: the resolver itself reads `next/headers()` /
  // `next/cookies()`, which only work inside a real Next.js
  // request scope — vitest's direct route-handler invocation
  // doesn't set that scope up, so we can't pin the full
  // resolver behavior end-to-end here. The actual decision
  // function (`canActorUseSite`) lives behind a clean predicate
  // contract; we unit-test it directly so the rule itself is
  // pinned (super-admin / membership / default-site fallback /
  // anonymous-rejection) without relying on the request scope.
  it("Issue #221 — canActorUseSite: super-admin is allowed on any site", async () => {
    const user = await seedUser({ role: "viewer" });
    const { setSuperAdmin, createSite } = await import("@nexpress/core");
    await setSuperAdmin(user.userId, true);
    await createSite({ id: "alpha", name: "Alpha" });
    const actor = await asActorForUser(user);
    const { canActorUseSite } = await import("@nexpress/next");
    expect(await canActorUseSite(actor, "alpha")).toBe(true);
    expect(await canActorUseSite(actor, "default")).toBe(true);
    expect(await canActorUseSite(actor, "non-existent-site")).toBe(true);
  });

  it("Issue #221 — canActorUseSite: explicit membership grants access to that site only", async () => {
    const user = await seedUser({ role: "editor" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    await createSite({ id: "beta", name: "Beta" });
    await grantSiteMembership("alpha", user.userId, "admin");
    const actor = await asActorForUser(user);
    const { canActorUseSite } = await import("@nexpress/next");
    expect(await canActorUseSite(actor, "alpha")).toBe(true);
    expect(await canActorUseSite(actor, "beta")).toBe(false);
  });

  it("Issue #221 — canActorUseSite: global admin keeps default-site fallback", async () => {
    const user = await seedUser({ role: "admin" });
    const actor = await asActorForUser(user);
    const { canActorUseSite } = await import("@nexpress/next");
    expect(await canActorUseSite(actor, "default")).toBe(true);
  });

  it("Issue #221 — canActorUseSite: plain admin without membership is rejected on a non-default site", async () => {
    const user = await seedUser({ role: "admin" });
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    const actor = await asActorForUser(user);
    const { canActorUseSite } = await import("@nexpress/next");
    expect(await canActorUseSite(actor, "alpha")).toBe(false);
  });

  it("Issue #221 — canActorUseSite: viewer with no flags is rejected everywhere", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    const actor = await asActorForUser(user);
    const { canActorUseSite } = await import("@nexpress/next");
    expect(await canActorUseSite(actor, "alpha")).toBe(false);
    expect(await canActorUseSite(actor, "default")).toBe(false);
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
