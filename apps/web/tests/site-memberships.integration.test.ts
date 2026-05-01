import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
import type { TestUserSession } from "./harness.js";

/**
 * Phase 15.5 — site memberships + super-admin flag. Pin
 * grant / revoke / role resolution semantics.
 */
describe.skipIf(skipIfNoTestDb())(
  "site memberships (Phase 15.5)",
  () => {
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
      const { createSite, grantSiteMembership, getMembership } = await import(
        "@nexpress/core"
      );
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
      const {
        createSite,
        grantSiteMembership,
        revokeSiteMembership,
        getMembership,
      } = await import("@nexpress/core");
      await createSite({ id: "revoke", name: "Revoke" });
      await grantSiteMembership("revoke", user.userId, "editor");
      await revokeSiteMembership("revoke", user.userId);
      expect(await getMembership("revoke", user.userId)).toBeNull();
    });

    it("resolveUserRoleOnSite prefers explicit membership over global role", async () => {
      const user = await seedUser({ role: "viewer" });
      const { createSite, grantSiteMembership, resolveUserRoleOnSite } =
        await import("@nexpress/core");
      await createSite({ id: "scoped", name: "Scoped" });
      await grantSiteMembership("scoped", user.userId, "admin");
      const role = await resolveUserRoleOnSite(authUser(user), "scoped");
      expect(role).toBe("admin");
    });

    it("resolveUserRoleOnSite falls back to global role when no membership exists", async () => {
      const user = await seedUser({ role: "editor" });
      const { resolveUserRoleOnSite } = await import("@nexpress/core");
      const role = await resolveUserRoleOnSite(authUser(user), "default");
      expect(role).toBe("editor");
    });

    it("setSuperAdmin promotes the user; resolveUserRoleOnSite returns 'admin' for any site", async () => {
      const user = await seedUser({ role: "viewer" });
      const { createSite, setSuperAdmin, resolveUserRoleOnSite, isSuperAdmin } =
        await import("@nexpress/core");
      await createSite({ id: "anysite", name: "Any" });

      await setSuperAdmin(user.userId, true);
      expect(await isSuperAdmin(authUser(user))).toBe(true);

      const onSite = await resolveUserRoleOnSite(authUser(user), "anysite");
      expect(onSite).toBe("admin");

      const onDefault = await resolveUserRoleOnSite(authUser(user), "default");
      expect(onDefault).toBe("admin");
    });

    it("setSuperAdmin can demote", async () => {
      const user = await seedUser({ role: "viewer" });
      const { setSuperAdmin, isSuperAdmin } = await import("@nexpress/core");
      await setSuperAdmin(user.userId, true);
      await setSuperAdmin(user.userId, false);
      expect(await isSuperAdmin(authUser(user))).toBe(false);
    });

    it("hasRoleOnSite respects the role rank order from hasRole", async () => {
      const user = await seedUser({ role: "viewer" });
      const { createSite, grantSiteMembership, hasRoleOnSite } = await import(
        "@nexpress/core"
      );
      await createSite({ id: "ranked", name: "Ranked" });
      await grantSiteMembership("ranked", user.userId, "editor");
      // editor >= viewer, author, editor (true)
      expect(await hasRoleOnSite(authUser(user), "viewer", "ranked")).toBe(true);
      expect(await hasRoleOnSite(authUser(user), "editor", "ranked")).toBe(true);
      // editor < admin (false)
      expect(await hasRoleOnSite(authUser(user), "admin", "ranked")).toBe(false);
    });

    it("listSiteMemberships returns every grant on a site", async () => {
      const a = await seedUser({ role: "viewer" });
      const b = await seedUser({ role: "viewer" });
      const { createSite, grantSiteMembership, listSiteMemberships } =
        await import("@nexpress/core");
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
      const {
        createSite,
        grantSiteMembership,
        getMembership,
      } = await import("@nexpress/core");
      const { getDb, nxUsers } = await import("@nexpress/core");
      await createSite({ id: "cascade", name: "Cascade" });
      await grantSiteMembership("cascade", user.userId, "editor");
      const { eq } = await import("drizzle-orm");
      await getDb().delete(nxUsers).where(eq(nxUsers.id, user.userId));
      expect(await getMembership("cascade", user.userId)).toBeNull();
    });
  },
);
