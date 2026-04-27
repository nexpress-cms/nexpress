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
 * Phase D — UI string admin overrides. Pin:
 *   - t() honors overrides ahead of plugin/theme bundles
 *   - per-site isolation (default vs. acme)
 *   - write+invalidate flow refreshes the cache
 *   - explicit null override (audit-marker) resolves the
 *     same as no row (falls through to bundle)
 *   - DELETE drops the row entirely
 *   - API role gates (editor read, admin write)
 */
describe.skipIf(skipIfNoTestDb())(
  "UI string overrides (Phase D)",
  () => {
    beforeAll(async () => {
      await ensureMigrated();
      registerTestCollections();
      const { ensureCoreServices } = await import("@/lib/init-core");
      ensureCoreServices();
    });
    beforeEach(async () => {
      await truncateAll();
      const {
        listSites,
        deleteSite,
        resetStrings,
        resetStringOverrideCache,
        resetCurrentSiteResolver,
        setI18nConfig,
      } = await import("@nexpress/core");
      const sites = await listSites();
      for (const site of sites) {
        if (!site.isDefault) await deleteSite(site.id, { cascade: true });
      }
      resetStrings();
      resetStringOverrideCache();
      resetCurrentSiteResolver();
      setI18nConfig({ locales: ["en", "ko"], defaultLocale: "en" });
    });
    afterEach(async () => {
      const {
        resetStringOverrideCache,
        resetCurrentSiteResolver,
        resetStrings,
      } = await import("@nexpress/core");
      resetStrings();
      resetStringOverrideCache();
      resetCurrentSiteResolver();
    });
    afterAll(async () => {
      await closeTestDb();
    });

    it("t() returns the bundle value when no override exists", async () => {
      const { addStrings, t } = await import("@nexpress/core");
      addStrings("en", { greeting: "Hello" });
      addStrings("ko", { greeting: "안녕" });
      expect(await t("greeting", "en")).toBe("Hello");
      expect(await t("greeting", "ko")).toBe("안녕");
    });

    it("t() returns the override when an admin sets one", async () => {
      const {
        addStrings,
        setStringOverride,
        t,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { greeting: "Hello" });

      await withCurrentSite("default", async () => {
        await setStringOverride("en", "greeting", "Howdy");
        expect(await t("greeting", "en")).toBe("Howdy");
      });
    });

    it("overrides are per-site (default vs. another tenant)", async () => {
      const {
        addStrings,
        createSite,
        setStringOverride,
        t,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { brand: "NexPress" });
      await createSite({ id: "acme", name: "Acme" });

      await withCurrentSite("default", async () => {
        await setStringOverride("en", "brand", "DefaultBrand");
      });
      await withCurrentSite("acme", async () => {
        await setStringOverride("en", "brand", "AcmeBrand");
      });

      const def = await withCurrentSite("default", () => t("brand", "en"));
      expect(def).toBe("DefaultBrand");
      const acme = await withCurrentSite("acme", () => t("brand", "en"));
      expect(acme).toBe("AcmeBrand");
    });

    it("setStringOverride busts the in-memory cache so the next read sees the new value", async () => {
      const {
        addStrings,
        setStringOverride,
        t,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { msg: "Original" });

      await withCurrentSite("default", async () => {
        // Warm cache with no override.
        expect(await t("msg", "en")).toBe("Original");
        await setStringOverride("en", "msg", "Patched");
        // Same process, same site — must reflect immediately.
        expect(await t("msg", "en")).toBe("Patched");
      });
    });

    it("explicit null override resolves the same as no override (audit marker)", async () => {
      const {
        addStrings,
        setStringOverride,
        t,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { brand: "NexPress" });

      await withCurrentSite("default", async () => {
        await setStringOverride("en", "brand", "Patched");
        expect(await t("brand", "en")).toBe("Patched");
        // Null marks "explicitly cleared" — t() falls back to
        // the bundle but the row stays for audit trail.
        await setStringOverride("en", "brand", null);
        expect(await t("brand", "en")).toBe("NexPress");
      });
    });

    it("deleteStringOverride removes the row entirely", async () => {
      const {
        deleteStringOverride,
        listStringOverridesForSite,
        setStringOverride,
        withCurrentSite,
      } = await import("@nexpress/core");

      await withCurrentSite("default", async () => {
        await setStringOverride("en", "x", "y");
      });
      let rows = await listStringOverridesForSite("default");
      expect(rows.length).toBe(1);
      await withCurrentSite("default", async () => {
        await deleteStringOverride("en", "x");
      });
      rows = await listStringOverridesForSite("default");
      expect(rows.length).toBe(0);
    });

    it("override on the requested locale wins; default-locale override is the cross-locale fallback", async () => {
      const {
        addStrings,
        setStringOverride,
        t,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { byKey: "english base" });
      addStrings("ko", { byKey: "korean base" });

      await withCurrentSite("default", async () => {
        // Override only the english one. Korean lookup should
        // use the Korean BUNDLE, not the english override
        // (overrides at the requested locale win, but if
        // there's no requested-locale override the framework
        // tries default-locale's override before falling
        // through to bundles).
        await setStringOverride("en", "byKey", "english override");
        expect(await t("byKey", "en")).toBe("english override");
        expect(await t("byKey", "ko")).toBe("korean base");
      });
    });

    it("default-locale override IS the fallback when the requested locale has neither override nor bundle", async () => {
      const {
        addStrings,
        setStringOverride,
        t,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { onlyEn: "english base" });
      // no ko bundle for `onlyEn`

      await withCurrentSite("default", async () => {
        await setStringOverride("en", "onlyEn", "english override");
        // ko has no bundle key + no ko override → falls through
        // to en override (Phase D step 2).
        expect(await t("onlyEn", "ko")).toBe("english override");
      });
    });

    // ============== HTTP API ==============

    it("GET /api/admin/i18n/strings returns the merged registry + overrides (editor+)", async () => {
      const editor = await seedUser({ role: "editor" });
      const {
        addStrings,
        setStringOverride,
        withCurrentSite,
      } = await import("@nexpress/core");
      addStrings("en", { tagline: "Hello" });
      await withCurrentSite("default", async () => {
        await setStringOverride("en", "tagline", "Howdy");
      });

      const { GET } = await import("@/app/api/admin/i18n/strings/route");
      const req = buildRequest("/api/admin/i18n/strings", { session: editor });
      const res = await GET(req);
      const { status, body } = await readJson<{
        keys?: Array<{
          key: string;
          values: Record<string, { base: string | null; override: string | null }>;
        }>;
      }>(res);
      expect(status).toBe(200);
      const tagline = body.keys?.find((k) => k.key === "tagline");
      expect(tagline?.values.en?.base).toBe("Hello");
      expect(tagline?.values.en?.override).toBe("Howdy");
    });

    it("PUT /api/admin/i18n/strings sets an override (admin-only)", async () => {
      const admin = await seedUser({ role: "admin" });
      const { addStrings, listStringOverridesForSite } = await import(
        "@nexpress/core"
      );
      addStrings("en", { foo: "Foo" });

      const { PUT } = await import("@/app/api/admin/i18n/strings/route");
      const req = buildRequest("/api/admin/i18n/strings", {
        session: admin,
        method: "PUT",
        body: { locale: "en", key: "foo", value: "Bar" },
      });
      const res = await PUT(req);
      const { status } = await readJson(res);
      expect(status).toBe(200);
      const rows = await listStringOverridesForSite("default");
      expect(rows.find((r) => r.key === "foo")?.value).toBe("Bar");
    });

    it("PUT forbids non-admins (editor cannot write)", async () => {
      const editor = await seedUser({ role: "editor" });
      const { PUT } = await import("@/app/api/admin/i18n/strings/route");
      const req = buildRequest("/api/admin/i18n/strings", {
        session: editor,
        method: "PUT",
        body: { locale: "en", key: "x", value: "y" },
      });
      const res = await PUT(req);
      const { status } = await readJson(res);
      expect(status).toBe(403);
    });

    it("DELETE drops the override row", async () => {
      const admin = await seedUser({ role: "admin" });
      const { setStringOverride, withCurrentSite, listStringOverridesForSite } =
        await import("@nexpress/core");
      await withCurrentSite("default", async () => {
        await setStringOverride("en", "doomed", "value");
      });

      const { DELETE } = await import("@/app/api/admin/i18n/strings/route");
      const req = buildRequest(
        "/api/admin/i18n/strings?locale=en&key=doomed",
        { session: admin, method: "DELETE" },
      );
      const res = await DELETE(req);
      const { status } = await readJson(res);
      expect(status).toBe(200);
      const rows = await listStringOverridesForSite("default");
      expect(rows.find((r) => r.key === "doomed")).toBeUndefined();
    });
  },
);
