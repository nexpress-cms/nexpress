import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";
import { npPluginStorage } from "../db/schema/system.js";

import { createPluginRuntimeContext } from "../plugins/context.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

describe.skipIf(skipIfNoTestDb())("ctx.storage (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  function makeCtx(pluginId = "test-plugin") {
    return createPluginRuntimeContext({
      pluginId,
      capabilities: ["storage:kv"],
      allowedHosts: [],
      config: {},
      registration: { actions: new Map() },
      lookupRegistration: () => undefined,
    }) as {
      storage: {
        get<T>(key: string): Promise<T | null>;
        set(key: string, value: unknown, opts?: { ttl?: number }): Promise<void>;
        delete(key: string): Promise<void>;
        list(prefix?: string): Promise<string[]>;
        has(key: string): Promise<boolean>;
        append<T>(prefix: string, value: T, opts?: { ttl?: number }): Promise<string>;
        listValues<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
      };
    };
  }

  it("round-trips, overwrites and deletes one persisted value", async () => {
    const ctx = makeCtx();
    await ctx.storage.set("alpha", { n: 1 });
    expect(await ctx.storage.get("alpha")).toEqual({ n: 1 });
    expect(await ctx.storage.has("alpha")).toBe(true);
    await ctx.storage.set("alpha", { n: 2 });
    expect(await ctx.storage.get("alpha")).toEqual({ n: 2 });
    expect(await ctx.storage.list()).toEqual(["alpha"]);
    await ctx.storage.delete("alpha");
    expect(await ctx.storage.get("alpha")).toBeNull();
    expect(await ctx.storage.has("alpha")).toBe(false);
  });

  it("scopes list and prefix filtering to the owning plugin", async () => {
    const a = makeCtx("plugin-a");
    const b = makeCtx("plugin-b");
    await a.storage.set("users:1", "a");
    await a.storage.set("users:2", "b");
    await a.storage.set("posts:1", "c");
    await b.storage.set("users:foreign", "private");
    expect((await a.storage.list()).sort()).toEqual(["posts:1", "users:1", "users:2"]);
    expect(await b.storage.list()).toEqual(["users:foreign"]);
    expect((await a.storage.list("users:")).sort()).toEqual(["users:1", "users:2"]);
    expect(await b.storage.list("users:")).toEqual(["users:foreign"]);
  });

  it("persists TTL for set and append, hiding expired rows from every reader", async () => {
    const ctx = makeCtx();
    const before = Date.now();
    await ctx.storage.set("ephemeral", "poof", { ttl: 60.5 });
    const appended = await ctx.storage.append("short:", "gone", { ttl: 60.5 });
    const after = Date.now();
    const db = await getTestDb();
    const rows = await db.select().from(npPluginStorage);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.expiresAt?.getTime(), row.key).toBeGreaterThanOrEqual(before + 60_500);
      expect(row.expiresAt?.getTime(), row.key).toBeLessThanOrEqual(after + 60_500);
    }
    expect(await ctx.storage.get("ephemeral")).toBe("poof");
    expect(await ctx.storage.has("ephemeral")).toBe(true);
    expect((await ctx.storage.list()).sort()).toEqual(["ephemeral", appended].sort());
    expect(await ctx.storage.listValues("short:")).toEqual([{ key: appended, value: "gone" }]);
    // Age the persisted fixture rather than sleeping or faking the driver clock.
    // The real readers still perform their PostgreSQL expiry predicates.
    await db
      .update(npPluginStorage)
      .set({ expiresAt: new Date(before - 1) })
      .where(eq(npPluginStorage.pluginId, "test-plugin"));
    expect(await ctx.storage.get("ephemeral")).toBeNull();
    expect(await ctx.storage.has("ephemeral")).toBe(false);
    expect(await ctx.storage.list()).toEqual([]);
    expect(await ctx.storage.listValues("short:")).toEqual([]);
    expect(await db.select().from(npPluginStorage)).toHaveLength(2);
  });

  it("append writes unique prefixed keys and listValues returns ordered values", async () => {
    const ctx = makeCtx();
    const first = await ctx.storage.append("events:2026-05-22:", { path: "/docs" });
    const second = await ctx.storage.append("events:2026-05-22:", { path: "/pricing" });
    await ctx.storage.append("events:2026-05-23:", { path: "/ignored" });

    expect(first).toMatch(/^events:2026-05-22:/);
    expect(second).toMatch(/^events:2026-05-22:/);
    expect(first).not.toBe(second);
    expect(await ctx.storage.listValues("events:2026-05-22:")).toEqual([
      { key: first, value: { path: "/docs" } },
      { key: second, value: { path: "/pricing" } },
    ]);
  });
});
