import { afterEach, describe, expect, it } from "vitest";

import { NxSiteContextMissingError } from "../errors.js";
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
    setCurrentSiteResolver(async () => "tenant-b");
    expect(await requireSiteId()).toBe("tenant-b");
  });

  it("throws an NxSiteContextMissingError (status 500) when no resolver is set", async () => {
    await expect(requireSiteId()).rejects.toBeInstanceOf(NxSiteContextMissingError);
    await expect(requireSiteId()).rejects.toMatchObject({
      name: "NxSiteContextMissingError",
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
    await expect(requireSiteId()).rejects.toMatchObject({
      code: "SITE_CONTEXT_MISSING",
    });
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
});
