import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("theme registry (Phase 11.1)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureCoreServices } = await import("@/lib/init-core");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
    // Restore the canonical default-theme registration after
    // truncation wipes nx_settings — and reset the in-memory
    // registry so prior tests' theme registrations don't leak.
    const { resetThemes, registerThemes } = await import("@nexpress/core");
    resetThemes();
    const { defaultTheme } = await import("@nexpress/theme-default");
    registerThemes([defaultTheme]);
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("registry holds themes registered from config; lookup by id works", async () => {
    const { getRegisteredThemes, getThemeById } = await import("@nexpress/core");
    const all = getRegisteredThemes();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const found = getThemeById("default");
    expect(found).toBeDefined();
    expect(found?.manifest.name).toBe("NexPress Default");
  });

  it("getActiveTheme falls back to the first registered theme when no setting exists", async () => {
    const { getActiveTheme, getActiveThemeId } = await import("@nexpress/core");
    const id = await getActiveThemeId();
    expect(id).toBeNull();

    const active = await getActiveTheme();
    expect(active?.manifest.id).toBe("default");
  });

  it("setActiveThemeId persists; subsequent getActiveTheme reads it back", async () => {
    const {
      registerThemes,
      setActiveThemeId,
      getActiveTheme,
      getActiveThemeId,
    } = await import("@nexpress/core");

    // Register a second theme so we have a non-trivial choice.
    registerThemes([
      {
        manifest: {
          id: "alt",
          name: "Alternate",
          version: "0.1.0",
        },
        impl: { /* opaque to core */ },
      },
    ]);

    const admin = await seedUser({ role: "admin" });
    await setActiveThemeId("alt", admin.userId);

    expect(await getActiveThemeId()).toBe("alt");
    const active = await getActiveTheme();
    expect(active?.manifest.id).toBe("alt");
  });

  it("setActiveThemeId rejects unknown ids before they hit the DB", async () => {
    const { setActiveThemeId, NxValidationError } = await import("@nexpress/core");
    try {
      await setActiveThemeId("nonexistent-theme");
      throw new Error("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NxValidationError);
    }
  });

  it("getActiveTheme silently falls back when the persisted id no longer resolves", async () => {
    // Operator removed `oldTheme` from nexpress.config.ts but
    // `nx_settings.activeTheme` still says `oldTheme`. The
    // resolver should NOT throw — it should return the first
    // registered theme so the site keeps rendering.
    const db = await getTestDb();
    const { nxSettings, getActiveTheme } = await import("@nexpress/core");
    await db.insert(nxSettings).values({
      key: "activeTheme",
      value: "ghost-theme",
      updatedAt: new Date(),
      updatedBy: null,
    });
    const active = await getActiveTheme();
    expect(active?.manifest.id).toBe("default");
  });

  it("registerThemes is idempotent — re-registering by id overwrites", async () => {
    const { registerThemes, getThemeById } = await import("@nexpress/core");
    registerThemes([
      {
        manifest: { id: "swap", name: "First", version: "0.1.0" },
        impl: {},
      },
    ]);
    expect(getThemeById("swap")?.manifest.name).toBe("First");
    registerThemes([
      {
        manifest: { id: "swap", name: "Second", version: "0.2.0" },
        impl: {},
      },
    ]);
    expect(getThemeById("swap")?.manifest.name).toBe("Second");
    expect(getThemeById("swap")?.manifest.version).toBe("0.2.0");
  });

  it("default theme exposes shell + header + footer slots", async () => {
    const { defaultTheme } = await import("@nexpress/theme-default");
    expect(defaultTheme.manifest.id).toBe("default");
    expect(defaultTheme.impl.shell).toBeTypeOf("function");
    expect(defaultTheme.impl.slots?.header).toBeTypeOf("function");
    expect(defaultTheme.impl.slots?.footer).toBeTypeOf("function");
  });
});
