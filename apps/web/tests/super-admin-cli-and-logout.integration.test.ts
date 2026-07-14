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
 * Phase 15.7 — promote-to-super-admin CLI behavior + logout
 * clears the picker cookie. The CLI's main() isn't invoked
 * directly in tests (it loads dotenv + reads argv); instead
 * we exercise the same DB ops the script does and confirm
 * the post-state matches the CLI's expected behavior. The
 * logout test goes through the actual route handler.
 */
describe.skipIf(skipIfNoTestDb())(
  "super-admin CLI + logout cookie clear (Phase 15.7)",
  () => {
    beforeAll(async () => {
      await ensureMigrated();
      registerTestCollections();
      const { ensureFor } = await import("@/lib/init-core");
      await ensureFor("read");
    });
    beforeEach(async () => {
      await truncateAll();
    });
    afterAll(async () => {
      await closeTestDb();
    });

    it("CLI-equivalent promote: writes is_super_admin=true via direct UPDATE", async () => {
      const user = await seedUser({ role: "viewer" });
      // The CLI does this exact sequence:
      //   1. SELECT user by email
      //   2. If isSuperAdmin already matches target → no-op
      //   3. UPDATE is_super_admin = true
      const { isSuperAdmin, npUsers } = await import("@nexpress/core");
      const { getDb } = await import("@nexpress/core/db");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const [row] = await db
        .select({
          id: npUsers.id,
          isSuperAdmin: npUsers.isSuperAdmin,
        })
        .from(npUsers)
        .where(eq(npUsers.email, user.email))
        .limit(1);
      expect(row?.isSuperAdmin).toBe(false);

      await db
        .update(npUsers)
        .set({ isSuperAdmin: true, updatedAt: new Date() })
        .where(eq(npUsers.id, row!.id));

      expect(
        await isSuperAdmin({
          id: user.userId,
          email: user.email,
          name: "Test",
          role: user.role,
          tokenVersion: 0,
        }),
      ).toBe(true);
    });

    it("CLI-equivalent demote: flips is_super_admin back to false", async () => {
      const user = await seedUser({ role: "viewer" });
      const { setSuperAdmin, isSuperAdmin, npUsers } = await import("@nexpress/core");
      const { getDb } = await import("@nexpress/core/db");
      await setSuperAdmin(user.userId, true);
      // CLI demote path: UPDATE is_super_admin = false
      const { eq } = await import("drizzle-orm");
      await getDb()
        .update(npUsers)
        .set({ isSuperAdmin: false, updatedAt: new Date() })
        .where(eq(npUsers.id, user.userId));
      expect(
        await isSuperAdmin({
          id: user.userId,
          email: user.email,
          name: "Test",
          role: user.role,
          tokenVersion: 0,
        }),
      ).toBe(false);
    });

    it("logout clears np-admin-site cookie alongside the session cookies", async () => {
      const user = await seedUser({ role: "admin" });
      const { POST } = await import("@/app/api/auth/logout/route");
      const req = buildRequest("/api/auth/logout", {
        session: user,
        method: "POST",
        // Simulate the picker cookie being present on the
        // request (the user had switched to a non-default
        // site before clicking Logout).
        headers: {
          cookie: `np-session=${user.accessToken}; np-csrf=${user.csrfToken}; np-admin-site=acme`,
        },
      });
      const res = await POST(req);
      const { status } = await readJson(res);
      expect(status).toBe(200);

      // The Set-Cookie header must include a `np-admin-site=`
      // line with an immediate-expiry directive (Max-Age=0
      // or expires in the past). Next.js's cookies.delete()
      // uses Max-Age=0.
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie.toLowerCase()).toContain("np-admin-site=");
      expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/);
    });

    it("logout still clears session cookies (regression guard for the cookie additions)", async () => {
      const user = await seedUser({ role: "admin" });
      const { POST } = await import("@/app/api/auth/logout/route");
      const req = buildRequest("/api/auth/logout", {
        session: user,
        method: "POST",
      });
      const res = await POST(req);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie.toLowerCase()).toContain("np-session=");
      expect(setCookie.toLowerCase()).toContain("np-refresh=");
      expect(setCookie.toLowerCase()).toContain("np-csrf=");
    });
  },
);
