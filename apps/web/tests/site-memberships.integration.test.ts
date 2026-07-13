import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  getTestDatabaseUrl,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import type { TestUserSession } from "./harness.js";

/**
 * Phase 15.5 — site memberships + super-admin flag. Pin
 * grant / revoke / role resolution semantics.
 */
describe.skipIf(skipIfNoTestDb())("site memberships (Phase 15.5)", () => {
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
  afterAll(async () => {
    await closeTestDb();
  });

  function authUser(session: TestUserSession) {
    return {
      id: session.userId,
      email: session.email,
      name: "Test",
      role: session.role,
      tokenVersion: 0,
    };
  }

  it("grantSiteMembership upserts; getMembership returns the row", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, getMembership } = await import("@nexpress/core");
    await createSite({ id: "membertest", name: "Member Test" });

    await grantSiteMembership("membertest", user.userId, "editor");
    const membership = await getMembership("membertest", user.userId);
    expect(membership?.role).toBe("editor");

    // Re-grant upgrades the role.
    await grantSiteMembership("membertest", user.userId, "admin");
    const upgraded = await getMembership("membertest", user.userId);
    expect(upgraded?.role).toBe("admin");
  });

  it("revokeSiteMembership removes the row", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, revokeSiteMembership, getMembership } =
      await import("@nexpress/core");
    await createSite({ id: "revoke", name: "Revoke" });
    await grantSiteMembership("revoke", user.userId, "editor");
    await revokeSiteMembership("revoke", user.userId);
    expect(await getMembership("revoke", user.userId)).toBeNull();
  });

  it("grantSiteMembership rejects unknown sites and users before writing", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, NpValidationError } = await import("@nexpress/core");
    await expect(grantSiteMembership("missing-site", user.userId, "editor")).rejects.toBeInstanceOf(
      NpValidationError,
    );
    await createSite({ id: "known-site", name: "Known" });
    await expect(
      grantSiteMembership("known-site", "123e4567-e89b-42d3-a456-426614174000", "editor"),
    ).rejects.toBeInstanceOf(NpValidationError);
  });

  it("canOnSite uses an explicit membership role on non-default sites", async () => {
    const user = await seedUser({ role: "viewer" });
    const { canOnSite, createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "scoped", name: "Scoped" });
    await grantSiteMembership("scoped", user.userId, "moderator");
    expect(await canOnSite(authUser(user), "community.moderate", "scoped")).toBe(true);
    expect(await canOnSite(authUser(user), "content.publish", "scoped")).toBe(false);
  });

  it("canOnSite uses the global role only on the reserved default site", async () => {
    const user = await seedUser({ role: "editor" });
    const { canOnSite, createSite } = await import("@nexpress/core");
    await createSite({ id: "foreign", name: "Foreign" });
    expect(await canOnSite(authUser(user), "content.publish", "default")).toBe(true);
    expect(await canOnSite(authUser(user), "content.publish", "foreign")).toBe(false);
  });

  it("canOnSite ignores a stale token role and uses the persisted global role", async () => {
    const user = await seedUser({ role: "viewer" });
    const { canOnSite } = await import("@nexpress/core");
    const staleAdminToken = { ...authUser(user), role: "admin" as const };

    expect(await canOnSite(staleAdminToken, "admin.manage", "default")).toBe(false);
  });

  it("resolveSiteAuthUser projects the exact persisted membership role", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, resolveSiteAuthUser } = await import("@nexpress/core");
    await createSite({ id: "projected", name: "Projected" });

    expect(await resolveSiteAuthUser(authUser(user), "projected")).toBeNull();
    await grantSiteMembership("projected", user.userId, "admin");
    expect(await resolveSiteAuthUser(authUser(user), "projected")).toEqual(
      expect.objectContaining({ id: user.userId, role: "admin" }),
    );
  });

  it("setSuperAdmin grants every capability on every registered site", async () => {
    const user = await seedUser({ role: "viewer" });
    const { canOnSite, createSite, setSuperAdmin, isSuperAdmin } = await import("@nexpress/core");
    await createSite({ id: "anysite", name: "Any" });

    await setSuperAdmin(user.userId, true);
    expect(await isSuperAdmin(authUser(user))).toBe(true);
    expect(await canOnSite(authUser(user), "admin.manage", "anysite")).toBe(true);
    expect(await canOnSite(authUser(user), "content.publish", "default")).toBe(true);
  });

  it("setSuperAdmin can demote", async () => {
    const user = await seedUser({ role: "viewer" });
    const { setSuperAdmin, isSuperAdmin } = await import("@nexpress/core");
    await setSuperAdmin(user.userId, true);
    await setSuperAdmin(user.userId, false);
    expect(await isSuperAdmin(authUser(user))).toBe(false);
  });

  it("keeps moderator and author as parallel capability roles", async () => {
    const moderator = await seedUser({ role: "viewer" });
    const author = await seedUser({ role: "viewer" });
    const { canOnSite, createSite, grantSiteMembership } = await import("@nexpress/core");
    await createSite({ id: "parallel", name: "Parallel" });
    await grantSiteMembership("parallel", moderator.userId, "moderator");
    await grantSiteMembership("parallel", author.userId, "author");
    expect(await canOnSite(authUser(moderator), "community.moderate", "parallel")).toBe(true);
    expect(await canOnSite(authUser(author), "community.moderate", "parallel")).toBe(false);
    expect(await canOnSite(authUser(author), "content.author", "parallel")).toBe(true);
  });

  it("listSiteMemberships returns every grant on a site", async () => {
    const a = await seedUser({ role: "viewer" });
    const b = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, listSiteMemberships } = await import("@nexpress/core");
    await createSite({ id: "listing", name: "Listing" });
    await grantSiteMembership("listing", a.userId, "editor");
    await grantSiteMembership("listing", b.userId, "author");
    const memberships = await listSiteMemberships("listing");
    expect(memberships.length).toBe(2);
    const roles = memberships.map((m) => m.role).sort();
    expect(roles).toEqual(["author", "editor"]);
  });

  it("listMembershipsForUser returns every site a user is a member of", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, listMembershipsForUser } =
      await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    await createSite({ id: "beta", name: "Beta" });
    await grantSiteMembership("alpha", user.userId, "admin");
    await grantSiteMembership("beta", user.userId, "editor");
    const memberships = await listMembershipsForUser(user.userId);
    const ids = memberships.map((m) => m.siteId).sort();
    expect(ids).toEqual(["alpha", "beta"]);
  });

  it("memberships cascade-delete when the user is deleted", async () => {
    const user = await seedUser({ role: "viewer" });
    const { createSite, grantSiteMembership, getMembership } = await import("@nexpress/core");
    const { getDb, npUsers } = await import("@nexpress/core");
    await createSite({ id: "cascade", name: "Cascade" });
    await grantSiteMembership("cascade", user.userId, "editor");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(npUsers).where(eq(npUsers.id, user.userId));
    expect(await getMembership("cascade", user.userId)).toBeNull();
  });

  it("doctor reports membership rows that reference a missing site", async () => {
    const user = await seedUser({ role: "viewer" });
    const { getDb, npSiteMemberships } = await import("@nexpress/core");
    await getDb().insert(npSiteMemberships).values({
      siteId: "orphan-site",
      userId: user.userId,
      role: "editor",
    });
    // eslint-disable-next-line import-x/no-relative-packages
    const { collectDoctorChecks } =
      await import("../../../packages/app/src/scripts/doctor-core.js");
    const checks = await collectDoctorChecks({
      cwd: process.cwd(),
      env: { DATABASE_URL: getTestDatabaseUrl() ?? undefined },
      nodeVersion: process.versions.node,
    });
    expect(checks.find((check) => check.id === "settings.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringMatching(/membership\.siteId.*missing site/u),
      }),
    );
  });
});
