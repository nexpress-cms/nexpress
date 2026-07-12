import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { npPlugins, npSettings } from "../db/schema/system.js";
import { getPluginConfig, setPluginConfig } from "../plugins/config.js";
import { createPluginRuntimeContext } from "../plugins/context.js";
import { loadPlugins, resetPlugins } from "../plugins/host.js";
import { DEFAULT_THEME } from "../theme/defaults.js";
import type { NpThemeTokens, NpThemeTokensOverlay } from "../theme/types.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

describe.skipIf(skipIfNoTestDb())("ctx.settings / ctx.theme (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    resetPlugins();
    await truncateAll();
  });

  afterAll(async () => {
    resetPlugins();
    await closeTestDb();
  });

  function makeCtx(opts?: { capabilities?: readonly string[]; pluginId?: string }) {
    return createPluginRuntimeContext({
      pluginId: opts?.pluginId ?? "test-plugin",
      capabilities: opts?.capabilities ?? [
        "settings:read",
        "settings:write",
        "theme:read",
        "theme:write",
      ],
      allowedHosts: [],
      config: {},
      registration: { actions: new Map() },
      lookupRegistration: () => undefined,
    }) as {
      settings: {
        getSite(): Promise<Record<string, unknown>>;
        getPlugin(): Promise<Record<string, unknown>>;
        setPlugin(data: Record<string, unknown>): Promise<void>;
      };
      theme: {
        getTokens(): Promise<NpThemeTokens>;
        setTokens(tokens: NpThemeTokensOverlay): Promise<void>;
      };
    };
  }

  it("settings.getSite returns {} when npSettings has no site row", async () => {
    const ctx = makeCtx();
    expect(await ctx.settings.getSite()).toEqual({});
  });

  it("settings.getSite returns the stored value when a site row exists", async () => {
    const db = await getTestDb();
    await db.insert(npSettings).values({
      key: "site",
      value: { name: "Acme", description: "A site" },
    });
    const ctx = makeCtx();
    expect(await ctx.settings.getSite()).toEqual({ name: "Acme", description: "A site" });
  });

  it("settings.getPlugin/setPlugin round-trip plugin config through np_settings", async () => {
    // G.1 — config moved from np_plugins.config to np_settings
    // (key="plugin.config:<id>"). setPlugin no longer requires a
    // pre-existing np_plugins row because the new path uses
    // INSERT … ON CONFLICT DO UPDATE on np_settings directly.
    // Seeding the np_plugins row is still done so the plugin
    // appears in `listPluginStates` for adjacent assertions, but
    // it's not load-bearing for this test.
    const db = await getTestDb();
    await db.insert(npPlugins).values({
      id: "test-plugin",
      enabled: true,
    });

    const ctx = makeCtx();
    await ctx.settings.setPlugin({ apiKey: "abc", refreshInterval: 60 });
    expect(await ctx.settings.getPlugin()).toEqual({
      apiKey: "abc",
      refreshInterval: 60,
    });
  });

  it("setPluginConfig persists legacy admin.settings plugins without configSchema", async () => {
    await loadPlugins([
      {
        manifest: {
          id: "legacy-settings",
          name: "Legacy Settings",
          version: "0.1.0",
          capabilities: ["admin:panel"],
        },
        admin: {
          settings: {
            fields: [{ type: "text", name: "apiKey", label: "API key" }],
          },
        },
      },
    ]);

    await expect(
      setPluginConfig("legacy-settings", { apiKey: "abc", enabled: true }, null),
    ).resolves.toEqual({ apiKey: "abc", enabled: true });

    expect(await getPluginConfig("legacy-settings")).toEqual({
      apiKey: "abc",
      enabled: true,
    });

    await expect(
      setPluginConfig("legacy-settings", "not-an-object", "user-1"),
    ).rejects.toMatchObject({
      name: "NpValidationError",
      message: "Invalid input",
      errors: [
        {
          field: "value",
          message: "Plugin config must be an object when configSchema is not declared.",
        },
      ],
    });
  });

  it("theme.setTokens merges with existing tokens rather than replacing", async () => {
    const ctx = makeCtx();

    await ctx.theme.setTokens({
      colors: { accent: "#f00" },
      shape: { radiusMd: "8px" },
    });
    expect(await ctx.theme.getTokens()).toEqual({
      ...DEFAULT_THEME,
      colors: { ...DEFAULT_THEME.colors, accent: "#f00" },
      shape: { ...DEFAULT_THEME.shape, radiusMd: "8px" },
    });

    // Second call partial-updates a single token; unrelated keys preserved.
    await ctx.theme.setTokens({ colors: { accent: "#0f0" } });
    expect(await ctx.theme.getTokens()).toMatchObject({
      colors: { accent: "#0f0" },
      shape: { radiusMd: "8px" },
    });
  });

  it("theme.setTokens uses INSERT ON CONFLICT — no duplicate row even under repeated writes", async () => {
    const ctx = makeCtx();

    await ctx.theme.setTokens({ colors: { primary: "#111" } });
    await ctx.theme.setTokens({ typography: { fontBody: "serif" } });
    await ctx.theme.setTokens({ shape: { radiusSm: "2px" } });

    const db = await getTestDb();
    const rows = await db.select().from(npSettings);
    expect(rows.filter((r) => r.key === "theme")).toHaveLength(1);
  });

  it("theme.setTokens rejects unknown and unsafe token values before writing", async () => {
    const ctx = makeCtx();

    await expect(
      ctx.theme.setTokens({ colors: { primary: "url(https://example.com/x)" } }),
    ).rejects.toMatchObject({ name: "NpValidationError" });
    await expect(
      ctx.theme.setTokens({ colors: { brand: "#fff" } } as unknown as NpThemeTokensOverlay),
    ).rejects.toMatchObject({ name: "NpValidationError" });

    const db = await getTestDb();
    const rows = await db.select().from(npSettings);
    expect(rows.filter((row) => row.key === "theme")).toHaveLength(0);
  });

  it("theme.getTokens rejects without theme:read capability", async () => {
    const ctx = makeCtx({ capabilities: [] });
    await expect(ctx.theme.getTokens()).rejects.toThrow();
  });

  it("theme.getTokens fails closed on malformed persisted overlays", async () => {
    const db = await getTestDb();
    await db.insert(npSettings).values({
      key: "theme",
      value: { colors: { primary: 42 } },
    });

    await expect(makeCtx().theme.getTokens()).rejects.toMatchObject({
      name: "NpValidationError",
      errors: [expect.objectContaining({ field: "settings.theme.colors.primary" })],
    });
  });
});
