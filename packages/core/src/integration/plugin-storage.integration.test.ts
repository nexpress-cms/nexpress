import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPluginRuntimeContext } from "../plugins/context.js";
import { closeTestDb, ensureMigrated, skipIfNoTestDb, truncateAll } from "./setup.js";

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
      };
    };
  }

  it("round-trips a value via the np_plugin_storage table", async () => {
    const ctx = makeCtx();
    await ctx.storage.set("alpha", { n: 1 });
    expect(await ctx.storage.get("alpha")).toEqual({ n: 1 });
    expect(await ctx.storage.has("alpha")).toBe(true);
  });

  it("overwrites the row on repeat set (upsert)", async () => {
    const ctx = makeCtx();
    await ctx.storage.set("x", "first");
    await ctx.storage.set("x", "second");
    expect(await ctx.storage.get("x")).toBe("second");
  });

  it("delete removes the row", async () => {
    const ctx = makeCtx();
    await ctx.storage.set("y", 42);
    await ctx.storage.delete("y");
    expect(await ctx.storage.get("y")).toBeNull();
    expect(await ctx.storage.has("y")).toBe(false);
  });

  it("list returns only keys for this plugin", async () => {
    const a = makeCtx("plugin-a");
    const b = makeCtx("plugin-b");
    await a.storage.set("foo", 1);
    await a.storage.set("bar", 2);
    await b.storage.set("baz", 3);

    const keysA = (await a.storage.list()).sort();
    const keysB = await b.storage.list();
    expect(keysA).toEqual(["bar", "foo"]);
    expect(keysB).toEqual(["baz"]);
  });

  it("list honours a prefix filter", async () => {
    const ctx = makeCtx();
    await ctx.storage.set("users:1", "a");
    await ctx.storage.set("users:2", "b");
    await ctx.storage.set("posts:1", "c");
    expect((await ctx.storage.list("users:")).sort()).toEqual(["users:1", "users:2"]);
  });

  it("expired entries are invisible to get/list/has", async () => {
    const ctx = makeCtx();
    // 0.5s TTL
    await ctx.storage.set("ephemeral", "poof", { ttl: 0.5 });
    await new Promise((r) => setTimeout(r, 700));
    expect(await ctx.storage.get("ephemeral")).toBeNull();
    expect(await ctx.storage.has("ephemeral")).toBe(false);
    expect(await ctx.storage.list()).not.toContain("ephemeral");
  });
});
