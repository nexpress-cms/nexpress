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
 * usual locale → defaultLocale → key fallback chain.
 */
describe.skipIf(skipIfNoTestDb())("i18n UI strings (Phase 12.5)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
    const { resetStrings } = await import("@nexpress/core");
    resetStrings();
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

    expect(t("test.greeting", "en")).toBe("Hello");
    expect(t("test.greeting", "ko")).toBe("안녕");
  });

  it("the magazine theme ships its tagline bundle", async () => {
    const { resetThemes, registerThemes, t } = await import("@nexpress/core");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    resetThemes();
    registerThemes([magazineTheme]);

    expect(t("magazine.tagline", "en")).toBe("Stories, essays, and reports");
    expect(t("magazine.tagline", "ko")).toBe(
      "이야기, 에세이, 그리고 리포트",
    );
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
    expect(t("brand", "en")).toBe("Override");
  });

  it("t() falls back to the key when no theme + no plugin contributed it", async () => {
    const { t } = await import("@nexpress/core");
    expect(t("totally.unknown.key", "en")).toBe("totally.unknown.key");
  });
});
