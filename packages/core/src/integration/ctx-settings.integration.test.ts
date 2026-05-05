import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { npPlugins, npSettings } from "../db/schema/system.js";
import { createPluginRuntimeContext } from "../plugins/context.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  skipIfNoTestDb,
  truncateAll,
} from "./setup.js";

describe.skipIf(skipIfNoTestDb())("ctx.settings / ctx.theme (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
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
        getTokens(): Promise<Record<string, unknown>>;
        setTokens(tokens: Record<string, unknown>): Promise<void>;
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

  it("settings.getPlugin/setPlugin round-trip the npPlugins config", async () => {
    const db = await getTestDb();
    // seed the plugin row because setPlugin updates, not insert
    await db.insert(npPlugins).values({
      id: "test-plugin",
      enabled: true,
      config: {},
    });

    const ctx = makeCtx();
    await ctx.settings.setPlugin({ apiKey: "abc", refreshInterval: 60 });
    expect(await ctx.settings.getPlugin()).toEqual({
      apiKey: "abc",
      refreshInterval: 60,
    });
  });

  it("theme.setTokens merges with existing tokens rather than replacing", async () => {
    const ctx = makeCtx();

    await ctx.theme.setTokens({ accent: "#f00", radius: "8px" });
    expect(await ctx.theme.getTokens()).toEqual({ accent: "#f00", radius: "8px" });

    // Second call partial-updates a single token; unrelated keys preserved.
    await ctx.theme.setTokens({ accent: "#0f0" });
    expect(await ctx.theme.getTokens()).toEqual({ accent: "#0f0", radius: "8px" });
  });

  it("theme.setTokens uses INSERT ON CONFLICT — no duplicate row even under repeated writes", async () => {
    const ctx = makeCtx();

    await ctx.theme.setTokens({ a: 1 });
    await ctx.theme.setTokens({ b: 2 });
    await ctx.theme.setTokens({ c: 3 });

    const db = await getTestDb();
    const rows = await db.select().from(npSettings);
    expect(rows.filter((r) => r.key === "theme")).toHaveLength(1);
  });

  it("theme.getTokens rejects without theme:read capability", async () => {
    const ctx = makeCtx({ capabilities: [] });
    await expect(ctx.theme.getTokens()).rejects.toThrow();
  });
});
