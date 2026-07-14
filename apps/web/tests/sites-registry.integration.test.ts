import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/** Multi-site registry, invariant, usage, and atomic teardown coverage. */
describe.skipIf(skipIfNoTestDb())("sites registry contracts", () => {
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
    // `np_sites`, intentionally.
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

  it("fails closed when the reserved default-site flag is corrupted", async () => {
    const { eq } = await import("drizzle-orm");
    const { getDefaultSite, npSites } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const db = getDb();
    await db.update(npSites).set({ isDefault: false }).where(eq(npSites.id, "default"));
    try {
      await expect(getDefaultSite()).rejects.toThrow("Invalid persisted site");
    } finally {
      await db.update(npSites).set({ isDefault: true }).where(eq(npSites.id, "default"));
    }
  });

  it("doctor accepts the canonical site, membership, and settings registry", async () => {
    // eslint-disable-next-line import-x/no-relative-packages
    const { collectDoctorChecks } =
      await import("../../../packages/app/src/scripts/doctor-core.js");
    const databaseUrl = getTestDatabaseUrl();
    expect(databaseUrl).not.toBeNull();
    const checks = await collectDoctorChecks({
      cwd: process.cwd(),
      env: { DATABASE_URL: databaseUrl ?? undefined },
      nodeVersion: process.versions.node,
    });
    expect(checks.find((check) => check.id === "settings.contract")).toEqual(
      expect.objectContaining({
        state: "ok",
        label: "Site registry and settings contracts",
      }),
    );
  });

  it("doctor rejects a registry that is missing the reserved default site", async () => {
    await truncateAll();
    const { eq } = await import("drizzle-orm");
    const { ensureDefaultSite, npSites } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    await getDb().delete(npSites).where(eq(npSites.id, "default"));

    try {
      // eslint-disable-next-line import-x/no-relative-packages
      const { collectDoctorChecks } =
        await import("../../../packages/app/src/scripts/doctor-core.js");
      const checks = await collectDoctorChecks({
        cwd: process.cwd(),
        env: { DATABASE_URL: getTestDatabaseUrl() ?? undefined },
        nodeVersion: process.versions.node,
      });
      expect(checks.find((check) => check.id === "settings.contract")).toEqual(
        expect.objectContaining({
          state: "error",
          detail: expect.stringMatching(/sites\.default.*missing/u),
        }),
      );
    } finally {
      await ensureDefaultSite();
    }
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
    const { createSite, NpValidationError } = await import("@nexpress/core");
    await expect(createSite({ id: "Bad ID", name: "x" })).rejects.toBeInstanceOf(NpValidationError);
    await expect(createSite({ id: "1starts", name: "x" })).rejects.toBeInstanceOf(
      NpValidationError,
    );
    await expect(createSite({ id: "has_underscore", name: "x" })).rejects.toBeInstanceOf(
      NpValidationError,
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
    const { createSite, resolveSiteForHostname } = await import("@nexpress/core");
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
    const { createSite, updateSite, getSiteById } = await import("@nexpress/core");
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
    const { deleteSite, NpValidationError } = await import("@nexpress/core");
    await expect(deleteSite("default")).rejects.toBeInstanceOf(NpValidationError);
  });

  it("deleteSite removes a non-default site cleanly", async () => {
    const { createSite, deleteSite, getSiteById } = await import("@nexpress/core");
    await createSite({ id: "throwaway", name: "Throwaway" });
    await deleteSite("throwaway");
    expect(await getSiteById("throwaway")).toBeNull();
  });

  it("deleteSite cascades collection-owned revisions and media references", async () => {
    const { createSite, deleteSite, npMedia, npMediaRefs, npRevisions } =
      await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const { and, eq } = await import("drizzle-orm");
    const { postsTable } = await import("../../../packages/core/src/integration/fixtures.js");
    const db = getDb();
    await createSite({ id: "document-cascade", name: "Document cascade" });
    const [document] = await db
      .insert(postsTable)
      .values({
        siteId: "document-cascade",
        title: "Owned document",
        slug: "owned-document",
        content: {
          root: { children: [], direction: null, format: "", indent: 0, type: "root", version: 1 },
        },
      })
      .returning({ id: postsTable.id });
    const [media] = await db
      .insert(npMedia)
      .values({
        filename: "owned.png",
        originalFilename: "owned.png",
        mimeType: "image/png",
        filesize: 1,
        storageKey: "tests/owned.png",
        hash: "document-cascade-media",
        status: "ready",
      })
      .returning({ id: npMedia.id });
    if (!document || !media) throw new Error("Failed to seed cascade dependencies");
    await db.insert(npRevisions).values({
      collection: "posts",
      documentId: document.id,
      version: 1,
      status: "draft",
      snapshot: { title: "Owned document" },
      changedFields: ["title"],
    });
    await db.insert(npMediaRefs).values({
      mediaId: media.id,
      collection: "posts",
      documentId: document.id,
      field: "coverImage",
    });

    await deleteSite("document-cascade", { cascade: true });

    expect(
      await db
        .select({ id: npRevisions.id })
        .from(npRevisions)
        .where(and(eq(npRevisions.collection, "posts"), eq(npRevisions.documentId, document.id))),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: npMediaRefs.id })
        .from(npMediaRefs)
        .where(and(eq(npMediaRefs.collection, "posts"), eq(npMediaRefs.documentId, document.id))),
    ).toHaveLength(0);
  });

  it("deleteSite rolls back every cascade step when one table delete fails", async () => {
    const { createSite, deleteSite, getSiteById, getSiteUsageSummary, npSettings } =
      await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await createSite({ id: "rollback-site", name: "Rollback" });
    await db.insert(npSettings).values({
      siteId: "rollback-site",
      key: "seo",
      value: { defaultOgImage: null, twitterHandle: null, defaultLocale: "en_US" },
      updatedAt: new Date(),
    });
    await db.execute(sql.raw("drop trigger if exists np_test_reject_site_delete on np_settings"));
    await db.execute(
      sql.raw(`create or replace function np_test_reject_site_delete() returns trigger
        language plpgsql as $$ begin raise exception 'forced cascade failure'; end $$`),
    );
    await db.execute(
      sql.raw(`create trigger np_test_reject_site_delete
        before delete on np_settings for each row
        when (old.site_id = 'rollback-site') execute function np_test_reject_site_delete()`),
    );

    try {
      await expect(deleteSite("rollback-site", { cascade: true })).rejects.toThrow();
      expect(await getSiteById("rollback-site")).not.toBeNull();
      expect((await getSiteUsageSummary("rollback-site")).settings).toBe(1);
    } finally {
      await db.execute(sql.raw("drop trigger if exists np_test_reject_site_delete on np_settings"));
      await db.execute(sql.raw("drop function if exists np_test_reject_site_delete()"));
      await deleteSite("rollback-site", { cascade: true });
    }
  });

  it("withCurrentSite swaps the resolver for the duration of the callback", async () => {
    const { getCurrentSiteId, withCurrentSite, setCurrentSiteResolver } =
      await import("@nexpress/core");

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
    const { getCurrentSiteId, resetCurrentSiteResolver } = await import("@nexpress/core");
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
