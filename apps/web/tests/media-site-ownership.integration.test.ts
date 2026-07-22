import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("media site ownership", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });

  beforeEach(async () => {
    await truncateAll();
    const { createSite, deleteSite, listSites } = await import("@nexpress/core");
    for (const site of await listSites()) {
      if (!site.isDefault) await deleteSite(site.id, { cascade: true });
    }
    await createSite({ id: "media-a", name: "Media A" });
    await createSite({ id: "media-b", name: "Media B" });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("stamps uploads and fails closed across list, read, delete, and folder boundaries", async () => {
    const {
      deleteMedia,
      getMediaById,
      listMedia,
      npMedia,
      npMediaFolders,
      uploadMedia,
      withCurrentSite,
    } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const [folderB] = await db
      .insert(npMediaFolders)
      .values({ siteId: "media-b", name: "B only" })
      .returning({ id: npMediaFolders.id });
    if (!folderB) throw new Error("Failed to seed media folder");

    const uploaded = await withCurrentSite("media-a", () =>
      uploadMedia(
        {
          buffer: Buffer.from("site-owned-media"),
          originalFilename: "owned.pdf",
          mimeType: "application/pdf",
        },
        null,
      ),
    );
    const [persisted] = await db
      .select({ siteId: npMedia.siteId, storageKey: npMedia.storageKey })
      .from(npMedia)
      .where(eq(npMedia.id, uploaded.id));
    expect(persisted).toEqual({
      siteId: "media-a",
      storageKey: expect.stringMatching(/^media\/media-a\//u),
    });

    const { listMediaReferences, syncMediaRefs } = await import("@nexpress/core/media");
    await expect(
      withCurrentSite("media-b", () =>
        db.transaction((tx) =>
          syncMediaRefs(tx as never, "posts", "11111111-1111-4111-8111-111111111111", [
            { mediaId: uploaded.id, field: "coverImage" },
          ]),
        ),
      ),
    ).rejects.toThrow("active media row");
    await withCurrentSite("media-a", () =>
      db.transaction((tx) =>
        syncMediaRefs(tx as never, "posts", "11111111-1111-4111-8111-111111111111", [
          { mediaId: uploaded.id, field: "coverImage" },
        ]),
      ),
    );

    await withCurrentSite("media-a", async () => {
      expect(await getMediaById(uploaded.id)).toMatchObject({ siteId: "media-a" });
      expect((await listMedia({ limit: 10 })).docs).toHaveLength(1);
      expect(await listMediaReferences(uploaded.id)).toEqual([
        expect.objectContaining({ siteId: "media-a", mediaId: uploaded.id }),
      ]);
      await expect(
        uploadMedia(
          {
            buffer: Buffer.from("wrong-folder"),
            originalFilename: "wrong.pdf",
            mimeType: "application/pdf",
          },
          null,
          folderB.id,
        ),
      ).rejects.toThrow("Invalid media folder");
    });

    await withCurrentSite("media-b", async () => {
      expect(await getMediaById(uploaded.id)).toBeNull();
      expect((await listMedia({ limit: 10 })).docs).toHaveLength(0);
      expect(await listMediaReferences(uploaded.id)).toHaveLength(0);
      await expect(deleteMedia(uploaded.id)).resolves.toEqual({ deleted: false });
    });
  });

  it("counts all owned media rows and cascades them without leaving active assets", async () => {
    const {
      createSite,
      cleanupDeletedMedia,
      deleteSite,
      getSiteById,
      getSiteUsageSummary,
      npMedia,
      npMediaFolders,
      npMediaRefs,
      npMembers,
      npUsers,
    } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    await createSite({ id: "media-cascade", name: "Media cascade" });
    const [folder] = await db
      .insert(npMediaFolders)
      .values({ siteId: "media-cascade", name: "Owned" })
      .returning({ id: npMediaFolders.id });
    const [media] = await db
      .insert(npMedia)
      .values({
        siteId: "media-cascade",
        folderId: folder?.id,
        filename: "owned.pdf",
        originalFilename: "owned.pdf",
        mimeType: "application/pdf",
        filesize: 4,
        storageKey: "media/media-cascade/owned/original.pdf",
        hash: "c".repeat(64),
        status: "ready",
      })
      .returning({ id: npMedia.id });
    if (!folder || !media) throw new Error("Failed to seed owned media");
    const [staff] = await db
      .insert(npUsers)
      .values({
        email: "media-owner@example.com",
        password: "test-only-hash",
        name: "Media owner",
        role: "admin",
        avatar: media.id,
      })
      .returning({ id: npUsers.id });
    const [member] = await db
      .insert(npMembers)
      .values({
        handle: "media-owner",
        email: "member-media-owner@example.com",
        displayName: "Media owner",
        avatar: media.id,
      })
      .returning({ id: npMembers.id });
    if (!staff || !member) throw new Error("Failed to seed avatar owners");
    await db.insert(npMediaRefs).values({
      siteId: "media-cascade",
      mediaId: media.id,
      collection: "posts",
      documentId: "11111111-1111-4111-8111-111111111111",
      field: "coverImage",
    });

    expect(await getSiteUsageSummary("media-cascade")).toMatchObject({
      media: 1,
      mediaFolders: 1,
      mediaRefs: 1,
    });
    await expect(deleteSite("media-cascade")).rejects.toThrow("Invalid input");
    await deleteSite("media-cascade", { cascade: true });

    expect(await getSiteById("media-cascade")).toBeNull();
    expect(
      await db.select().from(npMediaFolders).where(eq(npMediaFolders.siteId, "media-cascade")),
    ).toHaveLength(0);
    expect(
      await db.select().from(npMediaRefs).where(eq(npMediaRefs.siteId, "media-cascade")),
    ).toHaveLength(0);
    await expect(
      db.select({ avatar: npUsers.avatar }).from(npUsers).where(eq(npUsers.id, staff.id)),
    ).resolves.toEqual([{ avatar: null }]);
    await expect(
      db.select({ avatar: npMembers.avatar }).from(npMembers).where(eq(npMembers.id, member.id)),
    ).resolves.toEqual([{ avatar: null }]);
    expect(await db.select().from(npMedia).where(eq(npMedia.siteId, "media-cascade"))).toEqual([
      expect.objectContaining({ folderId: null, deletedAt: expect.any(Date) }),
    ]);
    await db
      .update(npMedia)
      .set({ deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000) })
      .where(eq(npMedia.siteId, "media-cascade"));

    const { getStorageAdapter } = await import("@nexpress/core/storage");
    const { setStorageAdapter } = await import("@nexpress/core/bootstrap");
    const originalAdapter = getStorageAdapter();
    try {
      setStorageAdapter({
        kind: "cleanup-failure-test",
        upload: (key, data, metadata) => originalAdapter.upload(key, data, metadata),
        getStream: (key) => originalAdapter.getStream(key),
        getUrl: (key) => originalAdapter.getUrl(key),
        delete: () => Promise.reject(new Error("storage unavailable")),
        exists: (key) => originalAdapter.exists(key),
      });
      await expect(cleanupDeletedMedia(0)).resolves.toBe(0);
      expect(
        await db.select().from(npMedia).where(eq(npMedia.siteId, "media-cascade")),
      ).toHaveLength(1);
    } finally {
      setStorageAdapter(originalAdapter);
    }

    const { getJobHandler, registerBuiltinHandlers } = await import("@nexpress/core/jobs");
    registerBuiltinHandlers();
    const cleanupHandler = getJobHandler("media:cleanup");
    expect(cleanupHandler).toBeDefined();
    await cleanupHandler?.({});
    expect(await db.select().from(npMedia).where(eq(npMedia.siteId, "media-cascade"))).toHaveLength(
      0,
    );
  });

  it("surfaces cross-site references through doctor", async () => {
    const { npMedia, npMediaRefs } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const db = getDb();
    const [media] = await db
      .insert(npMedia)
      .values({
        siteId: "media-a",
        filename: "doctor.pdf",
        originalFilename: "doctor.pdf",
        mimeType: "application/pdf",
        filesize: 4,
        storageKey: "media/media-a/doctor/original.pdf",
        hash: "d".repeat(64),
        status: "ready",
      })
      .returning({ id: npMedia.id });
    if (!media) throw new Error("Failed to seed doctor media");
    await db.insert(npMediaRefs).values({
      siteId: "media-b",
      mediaId: media.id,
      collection: "posts",
      documentId: "11111111-1111-4111-8111-111111111111",
      field: "coverImage",
    });

    // eslint-disable-next-line import-x/no-relative-packages
    const { collectDoctorChecks } =
      await import("../../../packages/app/src/scripts/doctor-core.js");
    const checks = await collectDoctorChecks({
      cwd: process.cwd(),
      env: { DATABASE_URL: getTestDatabaseUrl() ?? undefined },
      nodeVersion: process.versions.node,
    });
    expect(checks.find((check) => check.id === "media.contract")).toEqual(
      expect.objectContaining({
        state: "error",
        detail: expect.stringContaining("same site"),
      }),
    );
  });
});
