import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NxForbiddenError } from "../errors.js";
import { createPluginRuntimeContext } from "./context.js";

// The context module pulls in `getDb`, media, and storage adapter singletons
// transitively. The tests below only exercise surfaces that DON'T touch
// those (cache, capability checks, http.fetch allowedHosts), so we don't
// wire up the full fixture — calls into DB-bound methods are NOT covered by
// this file and belong in an integration test.

function buildCtx(overrides?: {
  capabilities?: readonly string[];
  allowedHosts?: readonly string[];
  config?: Record<string, unknown>;
}) {
  const registration = {
    actions: new Map(),
  };
  return createPluginRuntimeContext({
    pluginId: "test-plugin",
    capabilities: overrides?.capabilities ?? [],
    allowedHosts: overrides?.allowedHosts ?? [],
    config: overrides?.config ?? {},
    registration,
    lookupRegistration: () => undefined,
  }) as {
    pluginId: string;
    config: Record<string, unknown>;
    capabilities: readonly string[];
    cache: {
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown, ttl?: number): Promise<void>;
      invalidate(key: string): Promise<void>;
      invalidateAll(): Promise<void>;
    };
    http: {
      fetch(
        url: string,
        opts?: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number },
      ): Promise<{ ok: boolean; status: number; headers: Record<string, string>; body?: unknown }>;
    };
    storage: {
      get(key: string): Promise<unknown>;
    };
  };
}

describe("ctx.config / capabilities / pluginId", () => {
  it("exposes the values provided at build time", () => {
    const ctx = buildCtx({
      capabilities: ["content:read"],
      config: { foo: 1 },
    });
    expect(ctx.pluginId).toBe("test-plugin");
    expect(ctx.capabilities).toEqual(["content:read"]);
    expect(ctx.config).toEqual({ foo: 1 });
  });
});

describe("ctx.cache", () => {
  it("round-trips a value set without TTL", async () => {
    const ctx = buildCtx();
    await ctx.cache.set("key-1", { hello: "world" });
    expect(await ctx.cache.get("key-1")).toEqual({ hello: "world" });
  });

  it("expires entries past their TTL", async () => {
    const ctx = buildCtx();
    await ctx.cache.set("short", "value", 1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    expect(await ctx.cache.get("short")).toBeNull();
    vi.useRealTimers();
  });

  it("invalidate removes one entry, invalidateAll clears the plugin's entries", async () => {
    const ctx = buildCtx();
    await ctx.cache.set("a", 1);
    await ctx.cache.set("b", 2);

    await ctx.cache.invalidate("a");
    expect(await ctx.cache.get("a")).toBeNull();
    expect(await ctx.cache.get("b")).toBe(2);

    await ctx.cache.invalidateAll();
    expect(await ctx.cache.get("b")).toBeNull();
  });

  it("isolates caches across plugins with different ids", async () => {
    const registrationA = { actions: new Map() };
    const registrationB = { actions: new Map() };
    const ctxA = createPluginRuntimeContext({
      pluginId: "plugin-a",
      capabilities: [],
      allowedHosts: [],
      config: {},
      registration: registrationA,
      lookupRegistration: () => undefined,
    }) as { cache: { set: (k: string, v: unknown) => Promise<void>; get: (k: string) => Promise<unknown> } };
    const ctxB = createPluginRuntimeContext({
      pluginId: "plugin-b",
      capabilities: [],
      allowedHosts: [],
      config: {},
      registration: registrationB,
      lookupRegistration: () => undefined,
    }) as { cache: { get: (k: string) => Promise<unknown> } };

    await ctxA.cache.set("shared-key", "a-value");
    expect(await ctxB.cache.get("shared-key")).toBeNull();
  });
});

describe("ctx.http.fetch allowedHosts", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      text: () => Promise.resolve("ok"),
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires the network:fetch capability", async () => {
    const ctx = buildCtx({ capabilities: [], allowedHosts: ["example.com"] });
    await expect(ctx.http.fetch("https://example.com/x")).rejects.toBeInstanceOf(
      NxForbiddenError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks every URL when allowedHosts is empty", async () => {
    const ctx = buildCtx({ capabilities: ["network:fetch"], allowedHosts: [] });
    await expect(ctx.http.fetch("https://example.com/x")).rejects.toThrow(
      /allowedHosts/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows an exact hostname match", async () => {
    const ctx = buildCtx({
      capabilities: ["network:fetch"],
      allowedHosts: ["example.com"],
    });
    const res = await ctx.http.fetch("https://example.com/api");
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects a different hostname", async () => {
    const ctx = buildCtx({
      capabilities: ["network:fetch"],
      allowedHosts: ["example.com"],
    });
    await expect(ctx.http.fetch("https://other.com/x")).rejects.toThrow(
      /other\.com/,
    );
  });

  it("supports *.domain wildcards for subdomains", async () => {
    const ctx = buildCtx({
      capabilities: ["network:fetch"],
      allowedHosts: ["*.example.com"],
    });
    const res = await ctx.http.fetch("https://api.example.com/x");
    expect(res.ok).toBe(true);
  });

  it("rejects malformed URLs", async () => {
    const ctx = buildCtx({
      capabilities: ["network:fetch"],
      allowedHosts: ["example.com"],
    });
    await expect(ctx.http.fetch("not-a-url")).rejects.toThrow(/invalid URL/);
  });
});

describe("ctx.storage capability gating", () => {
  it("refuses storage.get without storage:kv", async () => {
    const ctx = buildCtx({ capabilities: [] });
    await expect(ctx.storage.get("any-key")).rejects.toBeInstanceOf(
      NxForbiddenError,
    );
  });
});
