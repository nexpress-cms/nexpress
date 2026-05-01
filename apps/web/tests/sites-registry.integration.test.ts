import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 15.1 — multi-site registry. Pin the lookup helpers
 * + the migration's default-site seed. 15.2 adds collection
 * scoping; until then nothing in the existing pipeline
 * actually uses the site id, so these tests focus purely on
 * the registry surface.
 */
describe.skipIf(skipIfNoTestDb())("sites registry (Phase 15.1)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  afterAll(async () => {
    await closeTestDb();
  });
  afterEach(async () => {
    // Wipe non-default sites between tests so id collisions
    // don't cascade. The default site row is preserved by
    // not touching it — `truncateAll` doesn't truncate
    // `nx_sites`, intentionally.
    const { listSites, deleteSite } = await import("@nexpress/core");
    const sites = await listSites();
    for (const site of sites) {
      if (!site.isDefault) {
        await deleteSite(site.id, { cascade: true });
      }
    }
  });

  it("the default site is seeded by migration 0015", async () => {
    const { getDefaultSite } = await import("@nexpress/core");
    const def = await getDefaultSite();
    expect(def).not.toBeNull();
    expect(def?.id).toBe("default");
    expect(def?.isDefault).toBe(true);
  });

  it("createSite + getSiteById round-trip", async () => {
    const { createSite, getSiteById } = await import("@nexpress/core");
    const created = await createSite({
      id: "acme",
      name: "Acme Corp",
      hostname: "acme.example.com",
      description: "Acme's marketing site",
    });
    expect(created.id).toBe("acme");
    expect(created.hostname).toBe("acme.example.com");
    const found = await getSiteById("acme");
    expect(found?.name).toBe("Acme Corp");
  });

  it("createSite rejects invalid id formats (validates against codepath used by collection slugs)", async () => {
    const { createSite, NxValidationError } = await import("@nexpress/core");
    await expect(createSite({ id: "Bad ID", name: "x" })).rejects.toBeInstanceOf(
      NxValidationError,
    );
    await expect(createSite({ id: "1starts", name: "x" })).rejects.toBeInstanceOf(
      NxValidationError,
    );
    await expect(createSite({ id: "has_underscore", name: "x" })).rejects.toBeInstanceOf(
      NxValidationError,
    );
  });

  it("getSiteByHostname is case-insensitive on the host string", async () => {
    const { createSite, getSiteByHostname } = await import("@nexpress/core");
    await createSite({
      id: "caseful",
      name: "Caseful",
      hostname: "CaseFul.Example.com",
    });
    const found = await getSiteByHostname("caseful.example.com");
    expect(found?.id).toBe("caseful");
  });

  it("resolveSiteForHostname returns the matching site, falling back to default on miss", async () => {
    const { createSite, resolveSiteForHostname } = await import(
      "@nexpress/core"
    );
    await createSite({
      id: "blog",
      name: "Blog",
      hostname: "blog.example.com",
    });
    const matched = await resolveSiteForHostname("blog.example.com");
    expect(matched?.id).toBe("blog");

    const missed = await resolveSiteForHostname("ghost.example.com");
    expect(missed?.id).toBe("default");

    const noHost = await resolveSiteForHostname(null);
    expect(noHost?.id).toBe("default");
  });

  it("hostname is unique across non-null rows", async () => {
    const { createSite } = await import("@nexpress/core");
    await createSite({ id: "first", name: "First", hostname: "shared.example.com" });
    await expect(
      createSite({
        id: "second",
        name: "Second",
        hostname: "shared.example.com",
      }),
    ).rejects.toThrow();
  });

  it("listSites returns all rows in createdAt order, default first", async () => {
    const { createSite, listSites } = await import("@nexpress/core");
    await createSite({ id: "alpha", name: "Alpha" });
    await createSite({ id: "beta", name: "Beta" });
    const sites = await listSites();
    expect(sites[0]?.id).toBe("default");
    expect(sites.map((s) => s.id)).toContain("alpha");
    expect(sites.map((s) => s.id)).toContain("beta");
  });

  it("updateSite patches name + hostname + description", async () => {
    const { createSite, updateSite, getSiteById } = await import(
      "@nexpress/core"
    );
    await createSite({ id: "patch", name: "Old name" });
    await updateSite("patch", {
      name: "New name",
      hostname: "patch.example.com",
      description: "Patched",
    });
    const updated = await getSiteById("patch");
    expect(updated?.name).toBe("New name");
    expect(updated?.hostname).toBe("patch.example.com");
    expect(updated?.description).toBe("Patched");
  });

  it("deleteSite refuses to delete the default site (framework invariant)", async () => {
    const { deleteSite, NxValidationError } = await import("@nexpress/core");
    await expect(deleteSite("default")).rejects.toBeInstanceOf(NxValidationError);
  });

  it("deleteSite removes a non-default site cleanly", async () => {
    const { createSite, deleteSite, getSiteById } = await import(
      "@nexpress/core"
    );
    await createSite({ id: "throwaway", name: "Throwaway" });
    await deleteSite("throwaway");
    expect(await getSiteById("throwaway")).toBeNull();
  });

  it("withCurrentSite swaps the resolver for the duration of the callback", async () => {
    const {
      getCurrentSiteId,
      withCurrentSite,
      setCurrentSiteResolver,
    } = await import("@nexpress/core");

    setCurrentSiteResolver(() => "outer");
    expect(await getCurrentSiteId()).toBe("outer");

    const inner = await withCurrentSite("inner", async () => {
      return await getCurrentSiteId();
    });
    expect(inner).toBe("inner");

    // Restored after the block.
    expect(await getCurrentSiteId()).toBe("outer");
  });

  it("getCurrentSiteId returns null when no resolver is wired", async () => {
    const { getCurrentSiteId, resetCurrentSiteResolver } = await import(
      "@nexpress/core"
    );
    resetCurrentSiteResolver();
    expect(await getCurrentSiteId()).toBeNull();
  });

  // Truncate any leftover state so the suite-level afterAll doesn't trip
  // FK constraints from earlier tests.
  it("teardown — truncate non-site tables", async () => {
    await truncateAll();
    expect(true).toBe(true);
  });
});
