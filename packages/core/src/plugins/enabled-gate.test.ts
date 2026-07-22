import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  invalidatePluginEnabled,
  isPluginEnabled,
  resetEnabledGate,
  setFetchImplForTest,
} from "./enabled-gate.js";

describe("enabled-gate cache invalidation race (#462)", () => {
  beforeEach(() => {
    resetEnabledGate();
  });

  afterEach(() => {
    resetEnabledGate();
  });

  it("does not re-cache a stale value when invalidate fires while a fetch is in flight", async () => {
    // Build a controllable fetch: each call returns a deferred promise we
    // resolve manually. That lets us interleave two reads and a toggle in
    // the exact order from the issue:
    //   T0  read A starts (about to return true)
    //   T1  invalidate (toggle)
    //   T2  read B starts (about to return false), settles first
    //   T3  read A finally settles → MUST NOT overwrite the false cache
    type Deferred = { resolve: (value: boolean) => void; promise: Promise<boolean> };
    const deferreds: Deferred[] = [];
    setFetchImplForTest(() => {
      let resolve!: (value: boolean) => void;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      const entry = { resolve, promise };
      deferreds.push(entry);
      return promise;
    });

    // T0 — first read kicks off fetch #0. Don't await yet.
    const readA = isPluginEnabled("foo", "default");
    // Site resolution is async. Let the DB read actually start before the
    // toggle; invalidating before this point would correctly make the first
    // read observe the post-toggle database state instead of a stale value.
    await Promise.resolve();

    // T1 — admin toggles. invalidate clears cache + inflight + bumps gen.
    invalidatePluginEnabled("foo", "default");

    // T2 — second read kicks off fetch #1.
    const readB = isPluginEnabled("foo", "default");
    await Promise.resolve();

    // Settle them in REVERSE order: fetch #1 (the new one) reports false
    // first; fetch #0 (the old one) reports true second.
    expect(deferreds.length).toBe(2);
    deferreds[1].resolve(false);
    deferreds[0].resolve(true);

    expect(await readA).toBe(true); // A still returns its own result …
    expect(await readB).toBe(false); // … B returns its own result …

    // … but the cache holds the post-invalidate value. Without the
    // generation token, A's late .then() would have overwritten this with
    // `true` and the next read would see the stale value.
    setFetchImplForTest(null); // any further fetches must hit the cache, not invent a value
    const readC = await isPluginEnabled("foo", "default");
    expect(readC).toBe(false);
  });

  it("a single uncontested fetch caches normally", async () => {
    let calls = 0;
    setFetchImplForTest(() => {
      calls++;
      return Promise.resolve(true);
    });

    expect(await isPluginEnabled("foo")).toBe(true);
    // Cache hit — no second fetch.
    expect(await isPluginEnabled("foo")).toBe(true);
    expect(calls).toBe(1);
  });

  it("keeps cache and invalidation isolated by site", async () => {
    const reads: string[] = [];
    setFetchImplForTest((_pluginId, siteId) => {
      reads.push(siteId);
      return Promise.resolve(siteId !== "tenant-b");
    });

    expect(await isPluginEnabled("foo", "tenant-a")).toBe(true);
    expect(await isPluginEnabled("foo", "tenant-b")).toBe(false);
    expect(await isPluginEnabled("foo", "tenant-a")).toBe(true);
    expect(reads).toEqual(["tenant-a", "tenant-b"]);

    invalidatePluginEnabled("foo", "tenant-b");
    expect(await isPluginEnabled("foo", "tenant-a")).toBe(true);
    expect(await isPluginEnabled("foo", "tenant-b")).toBe(false);
    expect(reads).toEqual(["tenant-a", "tenant-b", "tenant-b"]);
  });
});
