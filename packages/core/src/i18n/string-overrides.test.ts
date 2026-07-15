import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  queries: [] as Array<() => Promise<unknown[]>>,
  selectCalls: 0,
}));

vi.mock("../db/runtime.js", () => ({
  getDb: () => ({
    select: () => {
      runtime.selectCalls += 1;
      return {
        from: () => ({
          where: () => {
            const query = runtime.queries.shift();
            if (!query) throw new Error("Unexpected string override query.");
            return query();
          },
        }),
      };
    },
  }),
}));

const { clearStringOverrideCacheForSite, getStringOverridesForSite, resetStringOverrideCache } =
  await import("./string-overrides.js");
const { resetI18nConfig, setI18nConfig } = await import("./registry.js");

function row(value: string) {
  return {
    siteId: "default",
    locale: "en",
    key: "title",
    value,
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedBy: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  runtime.queries = [];
  runtime.selectCalls = 0;
  resetStringOverrideCache();
  setI18nConfig({ locales: ["en"], defaultLocale: "en" });
});

afterEach(() => {
  vi.useRealTimers();
  resetStringOverrideCache();
  resetI18nConfig();
});

describe("string override cache contract", () => {
  it("de-duplicates concurrent cold reads and returns an immutable catalog", async () => {
    runtime.queries.push(() => Promise.resolve([row("First")]));

    const [first, second] = await Promise.all([
      getStringOverridesForSite("default"),
      getStringOverridesForSite("default"),
    ]);

    expect(runtime.selectCalls).toBe(1);
    expect(second).toBe(first);
    expect(first.en?.title).toBe("First");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.en)).toBe(true);
  });

  it("lets invalidation win over a read already in flight", async () => {
    const stale = deferred<unknown[]>();
    runtime.queries.push(
      () => stale.promise,
      () => Promise.resolve([row("Fresh")]),
    );

    const pending = getStringOverridesForSite("default");
    clearStringOverrideCacheForSite("default");
    stale.resolve([row("Stale")]);

    await expect(pending).resolves.toEqual({ en: { title: "Fresh" } });
    expect(runtime.selectCalls).toBe(2);
    await expect(getStringOverridesForSite("default")).resolves.toEqual({
      en: { title: "Fresh" },
    });
    expect(runtime.selectCalls).toBe(2);
  });

  it("refreshes an otherwise valid cache after the multi-process TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    runtime.queries.push(
      () => Promise.resolve([row("First")]),
      () => Promise.resolve([row("Second")]),
    );

    await expect(getStringOverridesForSite("default")).resolves.toEqual({
      en: { title: "First" },
    });
    vi.advanceTimersByTime(30_001);
    await expect(getStringOverridesForSite("default")).resolves.toEqual({
      en: { title: "Second" },
    });
    expect(runtime.selectCalls).toBe(2);
  });

  it("rejects malformed persisted rows before caching them", async () => {
    runtime.queries.push(() => Promise.resolve([{ ...row("Broken"), locale: "fr" }]));

    await expect(getStringOverridesForSite("default")).rejects.toThrow(/not configured/u);
    expect(runtime.selectCalls).toBe(1);
  });
});
