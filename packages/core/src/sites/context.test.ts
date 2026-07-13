import { afterEach, describe, expect, it } from "vitest";

import { NpSiteContextMissingError } from "../errors.js";
import {
  getCurrentSiteId,
  requireSiteId,
  resetCurrentSiteResolver,
  setCurrentSiteResolver,
  withCurrentSite,
} from "./context.js";

describe("requireSiteId (#272 / #290)", () => {
  afterEach(() => {
    resetCurrentSiteResolver();
  });

  it("returns the resolved site id when a resolver is wired", async () => {
    setCurrentSiteResolver(() => "tenant-a");
    expect(await requireSiteId()).toBe("tenant-a");
  });

  it("supports an async resolver", async () => {
    setCurrentSiteResolver(() => Promise.resolve("tenant-b"));
    expect(await requireSiteId()).toBe("tenant-b");
  });

  it("throws an NpSiteContextMissingError (status 500) when no resolver is set", async () => {
    await expect(requireSiteId()).rejects.toBeInstanceOf(NpSiteContextMissingError);
    await expect(requireSiteId()).rejects.toMatchObject({
      name: "NpSiteContextMissingError",
      code: "SITE_CONTEXT_MISSING",
      statusCode: 500,
    });
  });

  it("throws when the resolver returns null", async () => {
    setCurrentSiteResolver(() => null);
    await expect(requireSiteId()).rejects.toMatchObject({
      code: "SITE_CONTEXT_MISSING",
    });
  });

  it("throws when the resolver returns an empty string", async () => {
    setCurrentSiteResolver(() => "");
    await expect(requireSiteId()).rejects.toThrow("must be a canonical lowercase site id");
  });

  it("integrates with withCurrentSite — resolves inside, throws outside", async () => {
    await expect(requireSiteId()).rejects.toMatchObject({ code: "SITE_CONTEXT_MISSING" });
    await withCurrentSite("tenant-c", async () => {
      expect(await requireSiteId()).toBe("tenant-c");
    });
    // resolver is restored to its previous value (null) on exit
    await expect(requireSiteId()).rejects.toMatchObject({ code: "SITE_CONTEXT_MISSING" });
  });

  it("getCurrentSiteId still returns null where requireSiteId throws", async () => {
    expect(await getCurrentSiteId()).toBeNull();
    await expect(requireSiteId()).rejects.toMatchObject({ code: "SITE_CONTEXT_MISSING" });
  });

  it("rejects malformed resolvers, scope ids, and callbacks at the boundary", async () => {
    expect(() => setCurrentSiteResolver("tenant-a" as never)).toThrow("must be a function or null");
    await expect(withCurrentSite("Tenant A", () => undefined)).rejects.toThrow(
      "must be a canonical lowercase site id",
    );
    await expect(withCurrentSite("tenant-a", null as never)).rejects.toThrow(
      "callback must be a function",
    );
  });

  it("isolates concurrent and nested site scopes while preserving the fallback", async () => {
    setCurrentSiteResolver(() => "fallback");
    const observed: string[] = [];

    await Promise.all([
      withCurrentSite("tenant-a", async () => {
        observed.push(`a:start:${String(await getCurrentSiteId())}`);
        await Promise.resolve();
        await withCurrentSite("tenant-nested", async () => {
          observed.push(`a:nested:${String(await getCurrentSiteId())}`);
        });
        observed.push(`a:end:${String(await getCurrentSiteId())}`);
      }),
      withCurrentSite("tenant-b", async () => {
        observed.push(`b:start:${String(await getCurrentSiteId())}`);
        await Promise.resolve();
        observed.push(`b:end:${String(await getCurrentSiteId())}`);
      }),
    ]);

    expect(observed).toEqual(
      expect.arrayContaining([
        "a:start:tenant-a",
        "a:nested:tenant-nested",
        "a:end:tenant-a",
        "b:start:tenant-b",
        "b:end:tenant-b",
      ]),
    );
    expect(await getCurrentSiteId()).toBe("fallback");
  });

  it("retains the site for async resources created inside a completed scope", async () => {
    let release: (() => void) | undefined;
    let observed: Promise<string | null> | undefined;

    await withCurrentSite("tenant-late", () => {
      observed = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => getCurrentSiteId());
    });

    release?.();
    await expect(observed).resolves.toBe("tenant-late");
    expect(await getCurrentSiteId()).toBeNull();
  });

  it("does not erase an active async scope when the fallback is reset", async () => {
    setCurrentSiteResolver(() => "fallback");
    await withCurrentSite("tenant-a", async () => {
      resetCurrentSiteResolver();
      expect(await getCurrentSiteId()).toBe("tenant-a");
    });
    expect(await getCurrentSiteId()).toBeNull();
  });
});
