import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("theme layout swap (Phase 11.2)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
    // The framework registers `[defaultTheme, magazineTheme]` from
    // nexpress.config.ts during the read bootstrap. truncate
    // clears np_settings but doesn't touch the in-memory
    // registry; we just need both themes available + no
    // activeTheme setting (so getActiveTheme falls back to
    // first registered).
    const { resetThemes, registerThemes } = await import("@nexpress/core");
    const { defaultTheme } = await import("@nexpress/theme-default");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    resetThemes();
    registerThemes([defaultTheme, magazineTheme]);
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("registry resolves the default theme as active when no setting is persisted", async () => {
    const { getActiveTheme } = await import("@nexpress/core");
    const active = await getActiveTheme();
    expect(active?.manifest.id).toBe("default");
  });

  it("the default theme exposes shell + header + footer + CSS", async () => {
    const { getActiveTheme } = await import("@nexpress/core");
    const active = await getActiveTheme();
    const impl = active?.impl as {
      shell?: unknown;
      slots?: { header?: unknown; footer?: unknown };
      css?: string;
    };
    expect(impl.shell).toBeTypeOf("function");
    expect(impl.slots?.header).toBeTypeOf("function");
    expect(impl.slots?.footer).toBeTypeOf("function");
    expect(impl.css).toContain(".np-site-header");
    expect(impl.css).toContain(".np-site-footer");
  });

  it("setActiveThemeId('magazine') swaps the active theme; CSS reflects the swap", async () => {
    const admin = await seedUser({ role: "admin" });
    const { setActiveThemeId, getActiveTheme } = await import("@nexpress/core");
    await setActiveThemeId("magazine", admin.userId);

    const active = await getActiveTheme();
    expect(active?.manifest.id).toBe("magazine");
    const impl = active?.impl as { css?: string };
    // Minimal theme owns the `.np-magazine-header` look (centered
    // logo, dotted rule, serif type) — distinct from the
    // default theme's flex-row header layout.
    expect(impl.css).toContain(".np-magazine-header");
    expect(impl.css).toContain("text-align: center");
  });

  it("active themes' CSS doesn't include other themes' rules (no leakage)", async () => {
    const { getActiveTheme } = await import("@nexpress/core");
    const active = await getActiveTheme();
    const impl = active?.impl as { css?: string };
    // Default-active. The magazine theme's `.np-magazine-header`
    // class shouldn't be in the default theme's CSS string.
    expect(impl.css).not.toContain("np-magazine-header");
  });

  it("absent active theme falls back to first registered (resilience)", async () => {
    // Operator removed `default` from nexpress.config.ts but
    // `np_settings.activeTheme` still says `default`. Resolver
    // should still return SOMETHING (the first remaining theme)
    // rather than null — so the site keeps rendering.
    const { resetThemes, registerThemes, getActiveTheme } = await import("@nexpress/core");
    const { magazineTheme } = await import("@nexpress/theme-magazine");
    resetThemes();
    registerThemes([magazineTheme]);

    const active = await getActiveTheme();
    expect(active?.manifest.id).toBe("magazine");
  });

  it("each theme's slots ARE distinct functions (proves the swap reaches the layout)", async () => {
    // Sanity: the layout renders `Header = active.impl.slots.header`.
    // If both themes happened to expose the same function reference
    // the swap would be a no-op visually. Confirm the references
    // actually differ.
    const { getThemeById } = await import("@nexpress/core");
    const def = getThemeById("default");
    const min = getThemeById("magazine");
    const defHeader = (def?.impl as { slots?: { header?: unknown } }).slots?.header;
    const minHeader = (min?.impl as { slots?: { header?: unknown } }).slots?.header;
    expect(defHeader).toBeDefined();
    expect(minHeader).toBeDefined();
    expect(defHeader).not.toBe(minHeader);
  });
});
