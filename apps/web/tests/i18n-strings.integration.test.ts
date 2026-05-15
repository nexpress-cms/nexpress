import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 12.5 — UI-string i18n. Verifies plugin and theme
 * bundles are merged into the global string registry at
 * registration time and that `t()` resolves them via the
 * locale → defaultLocale → key fallback chain.
 *
 * Phase D made `t()` async (it now consults the per-site
 * override layer); these tests still cover the bundle-only
 * path because no overrides are written. Awaiting `t()`
 * resolves the override cache for the default site
 * (essentially an empty cache, no overrides).
 */
describe.skipIf(skipIfNoTestDb())("i18n UI strings (Phase 12.5)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetStrings, resetStringOverrideCache } = await import(
      "@nexpress/core"
    );
    resetStrings();
    resetStringOverrideCache();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("a registered theme's i18n bundle lands in the global string registry", async () => {
    const { resetThemes, registerThemes, t } = await import("@nexpress/core");
    resetThemes();
    registerThemes([
      {
        manifest: { id: "test-theme", name: "Test", version: "0.1.0" },
        impl: {
          i18n: {
            en: { "test.greeting": "Hello" },
            ko: { "test.greeting": "안녕" },
          },
        },
      },
    ]);

    expect(await t("test.greeting", "en")).toBe("Hello");
    expect(await t("test.greeting", "ko")).toBe("안녕");
  });

  it("the magazine theme ships its tagline bundle", async () => {
    const { resetThemes, registerThemes, t } = await import("@nexpress/core");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    resetThemes();
    registerThemes([magazineTheme]);

    // Assert presence + locale variance rather than pinning the
    // exact tagline copy — the magazine theme's content has
    // already drifted once (#735 redesign) and a brittle string
    // match adds churn without protecting any behavior. What
    // matters is the bundle reaches `t()` and each locale
    // resolves independently.
    const en = await t("magazine.tagline", "en");
    const ko = await t("magazine.tagline", "ko");
    expect(typeof en).toBe("string");
    expect(en.length).toBeGreaterThan(0);
    expect(typeof ko).toBe("string");
    expect(ko.length).toBeGreaterThan(0);
    expect(en).not.toBe(ko);
  });

  it("later registrations override earlier keys (last writer wins)", async () => {
    const { resetThemes, registerThemes, t } = await import("@nexpress/core");
    resetThemes();
    registerThemes([
      {
        manifest: { id: "first", name: "First", version: "0.1.0" },
        impl: { i18n: { en: { brand: "Original" } } },
      },
      {
        manifest: { id: "second", name: "Second", version: "0.1.0" },
        impl: { i18n: { en: { brand: "Override" } } },
      },
    ]);
    expect(await t("brand", "en")).toBe("Override");
  });

  it("t() falls back to the key when no theme + no plugin contributed it", async () => {
    const { t } = await import("@nexpress/core");
    expect(await t("totally.unknown.key", "en")).toBe("totally.unknown.key");
  });
});
