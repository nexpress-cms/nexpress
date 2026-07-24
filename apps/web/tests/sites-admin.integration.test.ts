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
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
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

  // Issue #216 — list / create / delete are super-admin only;
  // per-site read+update accept super-admin OR matching
  // membership (with the legacy default-site fallback for
  // single-tenant global admins).
  async function seedSuperAdmin() {
    const user = await seedUser({ role: "admin" });
    const { setSuperAdmin } = await import("@nexpress/core");
    await setSuperAdmin(user.userId, true);
    return user;
  }

  it("GET /api/admin/sites returns the seed default site (super-admin)", async () => {
    const admin = await seedSuperAdmin();
    const { GET } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", { session: admin });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{ id: string; isDefault: boolean }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.docs?.find((s) => s.isDefault)?.id).toBe("default");
  });

  it("POST /api/admin/sites creates a site (super-admin)", async () => {
    const admin = await seedSuperAdmin();
    const { POST } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", {
      session: admin,
      method: "POST",
      body: { id: "acme", name: "Acme", hostname: "acme.example.com" },
    });
    const res = await POST(req);
    const { status, body } = await readJson<{ id?: string; hostname?: string }>(res);
    expect(status).toBe(200);
    expect(body.id).toBe("acme");
    expect(body.hostname).toBe("acme.example.com");
  });

  it("POST rejects unknown fields, invalid hostnames, and mistyped optional values", async () => {
    const admin = await seedSuperAdmin();
    const { POST } = await import("@/app/api/admin/sites/route");
    for (const body of [
      { id: "unknown-field", name: "Unknown", typo: true },
      { id: "bad-host", name: "Bad host", hostname: "https://example.com/path" },
      { id: "bad-description", name: "Bad description", description: 42 },
    ]) {
      const res = await POST(
        buildRequest("/api/admin/sites", { session: admin, method: "POST", body }),
      );
      expect(res.status).toBe(400);
    }
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

  it("Issue #216 — POST forbids global admin without super-admin", async () => {
    // Intentionally NOT a super-admin: a plain global admin
    // shouldn't be able to create a new site.
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/sites/route");
    const req = buildRequest("/api/admin/sites", {
      session: admin,
      method: "POST",
      body: { id: "blocked-by-issue-216", name: "Blocked" },
    });
    const res = await POST(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("PATCH /api/admin/sites/[id] updates name + hostname (super-admin)", async () => {
    const admin = await seedSuperAdmin();
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

  it("Issue #216 — PATCH allows a per-site admin via membership (no super-admin)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "membership-patch", name: "Membership Patch" });
    await grantSiteMembership("membership-patch", editor.userId, "admin");

    const { PATCH } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest("/api/admin/sites/membership-patch", {
      session: editor,
      method: "PATCH",
      body: { name: "Renamed" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "membership-patch" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
  });

  it("Issue #216 — PATCH rejects a global admin without membership on the target site", async () => {
    // Plain global admin (no super-admin flag, no explicit
    // membership on `foreign-patch`) — must be rejected.
    const admin = await seedUser({ role: "admin" });
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "foreign-patch", name: "Foreign" });
    const { PATCH } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest("/api/admin/sites/foreign-patch", {
      session: admin,
      method: "PATCH",
      body: { name: "Should not land" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: "foreign-patch" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("DELETE /api/admin/sites/[id] removes a non-default site (super-admin)", async () => {
    const admin = await seedSuperAdmin();
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

  it("Issue #216 — DELETE rejects per-site admin (super-admin only)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "no-delete-by-member", name: "No delete by member" });
    await grantSiteMembership("no-delete-by-member", editor.userId, "admin");
    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest("/api/admin/sites/no-delete-by-member", {
      session: editor,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "no-delete-by-member" }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("DELETE refuses to remove the default site (super-admin)", async () => {
    const admin = await seedSuperAdmin();
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

  /**
   * Phase 15.9 — usage summary + cascade safety net.
   */
  it("GET /api/admin/sites/[id]/usage returns row counts per site-scoped table", async () => {
    const admin = await seedSuperAdmin();
    const { createSite, npSettings, npSlugHistory } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const created = await createSite({
      id: "usage-target",
      name: "Usage target",
      hostname: "usage.example.com",
    });

    const db = getDb();
    await db.insert(npSettings).values({
      siteId: created.id,
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
      updatedAt: new Date(),
    });
    await db.insert(npSlugHistory).values({
      siteId: created.id,
      collection: "posts",
      documentId: "orphaned-doc",
      oldSlug: "old-slug",
      newSlug: "new-slug",
    });

    const { GET } = await import("@/app/api/admin/sites/[id]/usage/route");
    const req = buildRequest(`/api/admin/sites/${created.id}/usage`, {
      session: admin,
    });
    const res = await GET(req, {
      params: Promise.resolve({ id: created.id }),
    });
    const { status, body } = await readJson<{
      site?: { id: string };
      usage?: {
        settings: number;
        navigation: number;
        slugHistory: number;
        memberships: number;
        stringOverrides: number;
        total: number;
        collections: Record<string, number>;
      };
    }>(res);
    expect(status).toBe(200);
    expect(body.site?.id).toBe(created.id);
    expect(body.usage?.settings).toBe(1);
    expect(body.usage?.slugHistory).toBe(1);
    expect(body.usage?.total).toBeGreaterThanOrEqual(2);
  });

  it("Issue #220 — usage summary includes plugin storage + community tables", async () => {
    const admin = await seedSuperAdmin();
    const {
      createSite,
      npSettings,
      npNotifications,
      npCommunityRealtimeEvents,
      npAuditEvents,
      npPluginStorage,
      hashPassword,
      npMembers,
    } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const created = await createSite({
      id: "usage-220",
      name: "Usage 220",
      hostname: "usage220.example.com",
    });
    const db = getDb();
    // One settings row + one notification + one audit event +
    // one plugin storage row, all on the new site.
    const password = await hashPassword("password-12345");
    const [member] = (await db
      .insert(npMembers)
      .values({
        email: "u220@example.com",
        password,
        handle: "u220",
        displayName: "U",
        emailVerified: true,
        status: "active",
      })
      .returning({ id: npMembers.id })) as Array<{ id: string }>;
    await db.insert(npSettings).values({
      siteId: created.id,
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
      updatedAt: new Date(),
    });
    await db.insert(npNotifications).values({
      memberId: member!.id,
      kind: "system",
      payload: {},
      siteId: created.id,
    });
    await db.insert(npCommunityRealtimeEvents).values({
      channel: "notifications",
      memberId: member!.id,
      siteId: created.id,
    });
    await db.insert(npAuditEvents).values({
      actorKind: "system",
      action: "test.usage",
      payload: {},
      siteId: created.id,
    });
    await db.insert(npPluginStorage).values({
      pluginId: "phase220-test",
      key: "k",
      value: {},
      siteId: created.id,
    });

    const { GET } = await import("@/app/api/admin/sites/[id]/usage/route");
    const req = buildRequest(`/api/admin/sites/${created.id}/usage`, {
      session: admin,
    });
    const res = await GET(req, {
      params: Promise.resolve({ id: created.id }),
    });
    const { status, body } = await readJson<{
      usage?: {
        settings: number;
        notifications: number;
        realtimeEvents: number;
        auditEvents: number;
        pluginStorage: number;
        total: number;
      };
    }>(res);
    expect(status).toBe(200);
    expect(body.usage?.settings).toBe(1);
    expect(body.usage?.notifications).toBe(1);
    expect(body.usage?.realtimeEvents).toBe(1);
    expect(body.usage?.auditEvents).toBe(1);
    expect(body.usage?.pluginStorage).toBe(1);
    expect(body.usage?.total).toBeGreaterThanOrEqual(5);
  });

  it("Issue #220 — DELETE ?cascade=true clears community + plugin storage rows too", async () => {
    const admin = await seedSuperAdmin();
    const {
      createSite,
      npSettings,
      npNotifications,
      npCommunityRealtimeEvents,
      npAuditEvents,
      npPluginStorage,
      hashPassword,
      npMembers,
      getSiteById,
    } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const created = await createSite({
      id: "cascade-220",
      name: "Cascade 220",
      hostname: "cascade220.example.com",
    });
    const db = getDb();
    const password = await hashPassword("password-12345");
    const [member] = (await db
      .insert(npMembers)
      .values({
        email: "c220@example.com",
        password,
        handle: "c220",
        displayName: "C",
        emailVerified: true,
        status: "active",
      })
      .returning({ id: npMembers.id })) as Array<{ id: string }>;
    await db.insert(npSettings).values({
      siteId: created.id,
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
      updatedAt: new Date(),
    });
    await db.insert(npNotifications).values({
      memberId: member!.id,
      kind: "system",
      payload: {},
      siteId: created.id,
    });
    await db.insert(npCommunityRealtimeEvents).values({
      channel: "notifications",
      memberId: member!.id,
      siteId: created.id,
    });
    await db.insert(npAuditEvents).values({
      actorKind: "system",
      action: "test.cascade",
      payload: {},
      siteId: created.id,
    });
    await db.insert(npPluginStorage).values({
      pluginId: "phase220-cascade",
      key: "k",
      value: {},
      siteId: created.id,
    });

    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest(`/api/admin/sites/${created.id}?cascade=true`, {
      session: admin,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: created.id }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect(await getSiteById(created.id)).toBeNull();

    // Confirm orphan rows were cleaned up.
    const { eq, count, sql } = await import("drizzle-orm");
    void sql;
    const [{ value: notifLeft }] = (await db
      .select({ value: count() })
      .from(npNotifications)
      .where(eq(npNotifications.siteId, created.id))) as Array<{ value: number }>;
    const [{ value: auditLeft }] = (await db
      .select({ value: count() })
      .from(npAuditEvents)
      .where(eq(npAuditEvents.siteId, created.id))) as Array<{ value: number }>;
    const [{ value: realtimeLeft }] = (await db
      .select({ value: count() })
      .from(npCommunityRealtimeEvents)
      .where(eq(npCommunityRealtimeEvents.siteId, created.id))) as Array<{ value: number }>;
    const [{ value: pluginLeft }] = (await db
      .select({ value: count() })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.siteId, created.id))) as Array<{ value: number }>;
    expect(notifLeft).toBe(0);
    expect(realtimeLeft).toBe(0);
    expect(auditLeft).toBe(0);
    expect(pluginLeft).toBe(0);
  });

  it("DELETE refuses when site has attached rows and no cascade flag", async () => {
    const admin = await seedSuperAdmin();
    const { createSite, npSettings } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const created = await createSite({
      id: "no-cascade",
      name: "No cascade",
      hostname: "no-cascade.example.com",
    });
    await getDb()
      .insert(npSettings)
      .values({
        siteId: created.id,
        key: "seo",
        value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
        updatedAt: new Date(),
      });

    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest(`/api/admin/sites/${created.id}`, {
      session: admin,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: created.id }),
    });
    const { status, body } = await readJson<{
      error?: {
        message?: string;
        details?: Array<{ field: string; message: string }>;
      };
    }>(res);
    expect(status).toBe(400);
    // The cascade hint lives in `details[0].message`; the
    // top-level `message` is the generic "Invalid input"
    // because `NpValidationError`'s contract is one-line
    // top-level + per-field detail rows.
    const cascadeDetail = body.error?.details?.find((d) => d.field === "cascade");
    expect(cascadeDetail?.message).toMatch(/cascade=true/);

    const { getSiteById } = await import("@nexpress/core");
    expect(await getSiteById(created.id)).not.toBeNull();
  });

  it("DELETE ?cascade=true removes attached rows and the site", async () => {
    const admin = await seedSuperAdmin();
    const { createSite, npSettings, npNavigation, getSiteById } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const created = await createSite({
      id: "cascade-target",
      name: "Cascade target",
      hostname: "cascade.example.com",
    });
    const db = getDb();
    await db.insert(npSettings).values({
      siteId: created.id,
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
      updatedAt: new Date(),
    });
    await db.insert(npNavigation).values({
      siteId: created.id,
      location: "header",
      items: [],
      updatedAt: new Date(),
    });

    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest(`/api/admin/sites/${created.id}?cascade=true`, {
      session: admin,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: created.id }),
    });
    const { status, body } = await readJson<{
      cascade?: boolean;
      deleted?: boolean;
    }>(res);
    expect(status).toBe(200);
    expect(body.cascade).toBe(true);
    expect(body.deleted).toBe(true);
    expect(await getSiteById(created.id)).toBeNull();
  });

  it("DELETE without cascade succeeds when no attached rows exist (backwards-compat)", async () => {
    const admin = await seedSuperAdmin();
    const { createSite, getSiteById } = await import("@nexpress/core");
    const created = await createSite({
      id: "empty-site",
      name: "Empty",
      hostname: "empty.example.com",
    });

    const { DELETE } = await import("@/app/api/admin/sites/[id]/route");
    const req = buildRequest(`/api/admin/sites/${created.id}`, {
      session: admin,
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: created.id }),
    });
    const { status } = await readJson(res);
    expect(status).toBe(200);
    expect(await getSiteById(created.id)).toBeNull();
  });

  it("OpenAPI exposes the exact site and membership contracts", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const response = await GET();
    const spec = (await response.json()) as {
      components?: { schemas?: Record<string, unknown> };
      paths?: Record<string, unknown>;
    };
    expect(spec.components?.schemas).toEqual(
      expect.objectContaining({
        site_record: expect.any(Object),
        site_summary: expect.any(Object),
        site_membership: expect.any(Object),
        site_usage: expect.any(Object),
      }),
    );
    expect(spec.paths).toEqual(
      expect.objectContaining({
        "/api/admin/sites": expect.any(Object),
        "/api/admin/sites/accessible": expect.any(Object),
        "/api/admin/sites/active": expect.any(Object),
        "/api/admin/sites/{id}": expect.any(Object),
        "/api/admin/sites/{id}/memberships": expect.any(Object),
        "/api/admin/sites/{id}/memberships/{userId}": expect.any(Object),
      }),
    );
  });
});
