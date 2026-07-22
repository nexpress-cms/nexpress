import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("site quota contract", () => {
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
    await createSite({ id: "quota-a", name: "Quota A" });
  });

  afterEach(async () => {
    const { setJobQueue } = await import("@nexpress/core/bootstrap");
    setJobQueue(null);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedActor() {
    const session = await seedUser({ role: "admin" });
    return {
      session,
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
        tokenVersion: 0,
      },
    };
  }

  it("serializes concurrent document creates and restores headroom after delete", async () => {
    const { user } = await seedActor();
    const { deleteDocument, saveDocument, setSiteQuotas, withCurrentSite } =
      await import("@nexpress/core");
    await setSiteQuotas(
      { storageBytes: null, documents: 1, jobEnqueuesPerHour: null },
      user.id,
      "quota-a",
    );

    const results = await withCurrentSite("quota-a", () =>
      Promise.allSettled(
        ["First", "Second"].map((title) =>
          saveDocument("posts", null, { title, content: npCreateEmptyRichTextContent() }, user, {
            status: "draft",
          }),
        ),
      ),
    );
    const failureMessages = results
      .filter((result) => result.status === "rejected")
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      )
      .join(" | ");
    expect(
      results.filter((result) => result.status === "fulfilled"),
      failureMessages,
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.objectContaining({ code: "RATE_LIMITED" }) });

    const created = results.find((result) => result.status === "fulfilled");
    if (!created || created.status !== "fulfilled") throw new Error("Expected one create");
    await withCurrentSite("quota-a", () =>
      deleteDocument("posts", String(created.value.doc.id), user),
    );
    await expect(
      withCurrentSite("quota-a", () =>
        saveDocument(
          "posts",
          null,
          { title: "Replacement", content: npCreateEmptyRichTextContent() },
          user,
          { status: "draft" },
        ),
      ),
    ).resolves.toMatchObject({ operation: "create" });
  });

  it("counts original and variant bytes and blocks concurrent storage overage", async () => {
    const { user } = await seedActor();
    const { getStorageAdapter } = await import("@nexpress/core/storage");
    const { setStorageAdapter } = await import("@nexpress/core/bootstrap");
    const { getSiteQuotaSnapshot, npMedia, setSiteQuotas, uploadMedia, withCurrentSite } =
      await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const originalAdapter = getStorageAdapter();
    const objects = new Map<string, Uint8Array>();
    setStorageAdapter({
      kind: "quota-memory",
      upload: (key, data) => {
        objects.set(key, data instanceof Uint8Array ? data : new Uint8Array());
        return Promise.resolve();
      },
      getStream: (key) =>
        Promise.resolve(new Blob([objects.get(key) ?? new Uint8Array()]).stream()),
      getUrl: (key) => Promise.resolve(`https://storage.example/${key}`),
      delete: (key) => {
        objects.delete(key);
        return Promise.resolve();
      },
      exists: (key) => Promise.resolve(objects.has(key)),
    });
    try {
      await setSiteQuotas(
        { storageBytes: 10, documents: null, jobEnqueuesPerHour: null },
        user.id,
        "quota-a",
      );
      const uploads = await withCurrentSite("quota-a", () =>
        Promise.allSettled(
          [Buffer.from("123456"), Buffer.from("abcdef")].map((buffer, index) =>
            uploadMedia(
              {
                buffer,
                originalFilename: `quota-${index.toString()}.pdf`,
                mimeType: "application/pdf",
              },
              null,
            ),
          ),
        ),
      );
      expect(uploads.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(uploads.find((result) => result.status === "rejected")).toMatchObject({
        reason: expect.objectContaining({ code: "RATE_LIMITED" }),
      });

      const [media] = await getDb().select().from(npMedia);
      if (!media) throw new Error("Expected stored media");
      await getDb()
        .update(npMedia)
        .set({
          sizes: {
            thumbnail: {
              filename: "thumbnail.webp",
              mimeType: "image/webp",
              filesize: 3,
              width: 10,
              height: 10,
              storageKey: `media/quota-a/${media.id}/thumbnail.webp`,
            },
          },
        })
        .where((await import("drizzle-orm")).eq(npMedia.id, media.id));
      await expect(getSiteQuotaSnapshot("quota-a")).resolves.toMatchObject({
        usage: { storageBytes: 9 },
      });
    } finally {
      setStorageAdapter(originalAdapter);
    }
  });

  it("releases failed upload reservations only after object cleanup is confirmed", async () => {
    const { user } = await seedActor();
    const { getStorageAdapter } = await import("@nexpress/core/storage");
    const { setStorageAdapter } = await import("@nexpress/core/bootstrap");
    const { getSiteQuotaSnapshot, npMedia, setSiteQuotas, uploadMedia, withCurrentSite } =
      await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const originalAdapter = getStorageAdapter();
    const objects = new Map<string, Uint8Array>();
    let cleanupFails = false;
    setStorageAdapter({
      kind: "quota-failing-memory",
      upload: (key, data) => {
        objects.set(key, data instanceof Uint8Array ? data : new Uint8Array());
        return Promise.reject(new Error("ambiguous upload failure"));
      },
      getStream: (key) =>
        Promise.resolve(new Blob([objects.get(key) ?? new Uint8Array()]).stream()),
      getUrl: (key) => Promise.resolve(`https://storage.example/${key}`),
      delete: (key) => {
        if (cleanupFails) return Promise.reject(new Error("cleanup unavailable"));
        objects.delete(key);
        return Promise.resolve();
      },
      exists: (key) => Promise.resolve(objects.has(key)),
    });
    try {
      await setSiteQuotas(
        { storageBytes: 20, documents: null, jobEnqueuesPerHour: null },
        user.id,
        "quota-a",
      );
      const upload = (filename: string) =>
        withCurrentSite("quota-a", () =>
          uploadMedia(
            { buffer: Buffer.from("123456"), originalFilename: filename, mimeType: "text/plain" },
            null,
          ),
        );

      await expect(upload("reclaimed.txt")).rejects.toThrow("ambiguous upload failure");
      await expect(getDb().select().from(npMedia)).resolves.toHaveLength(0);
      await expect(getSiteQuotaSnapshot("quota-a")).resolves.toMatchObject({
        usage: { storageBytes: 0 },
      });

      cleanupFails = true;
      await expect(upload("reserved.txt")).rejects.toThrow("ambiguous upload failure");
      await expect(getDb().select().from(npMedia)).resolves.toMatchObject([
        { status: "error", filesize: 6 },
      ]);
      await expect(getSiteQuotaSnapshot("quota-a")).resolves.toMatchObject({
        usage: { storageBytes: 6 },
      });
    } finally {
      setStorageAdapter(originalAdapter);
    }
  });

  it("rechecks a completed image row before reserving or uploading stale variants", async () => {
    const { getStorageAdapter } = await import("@nexpress/core/storage");
    const { setStorageAdapter } = await import("@nexpress/core/bootstrap");
    const { npMedia, processMediaImage, uploadMedia, withCurrentSite } =
      await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const { eq } = await import("drizzle-orm");
    const originalAdapter = getStorageAdapter();
    const source = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    );
    const objects = new Map<string, Uint8Array>();
    let completeOnRead: string | null = null;
    const upload = vi.fn((key: string, data: unknown) => {
      objects.set(key, data instanceof Uint8Array ? data : new Uint8Array());
      return Promise.resolve();
    });
    setStorageAdapter({
      kind: "quota-image-race",
      upload,
      getStream: async (key) => {
        if (completeOnRead) {
          const mediaId = completeOnRead;
          completeOnRead = null;
          await getDb()
            .update(npMedia)
            .set({
              status: "ready",
              sizes: {
                thumbnail: {
                  filename: "thumbnail.png",
                  mimeType: "image/png",
                  filesize: 8,
                  width: 1,
                  height: 1,
                  storageKey: `media/quota-a/${mediaId}/thumbnail.png`,
                },
              },
            })
            .where(eq(npMedia.id, mediaId));
        }
        return new Blob([objects.get(key) ?? new Uint8Array()]).stream();
      },
      getUrl: (key) => Promise.resolve(`https://storage.example/${key}`),
      delete: (key) => {
        objects.delete(key);
        return Promise.resolve();
      },
      exists: (key) => Promise.resolve(objects.has(key)),
    });
    try {
      const media = await withCurrentSite("quota-a", () =>
        uploadMedia({ buffer: source, originalFilename: "race.png", mimeType: "image/png" }, null),
      );
      completeOnRead = media.id;
      await withCurrentSite("quota-a", () =>
        processMediaImage(media.id, {
          sizes: [{ name: "thumbnail", width: 1 }],
          format: "png",
        }),
      );

      expect(upload).toHaveBeenCalledOnce();
      await expect(
        getDb().select().from(npMedia).where(eq(npMedia.id, media.id)),
      ).resolves.toMatchObject([{ status: "ready", sizes: { thumbnail: { filesize: 8 } } }]);
    } finally {
      setStorageAdapter(originalAdapter);
    }
  });

  it("admits only the configured number of quota-participating site jobs", async () => {
    const { user } = await seedActor();
    const { enqueueJob, registerBuiltinHandlers } = await import("@nexpress/core/jobs");
    const { setJobQueue } = await import("@nexpress/core/bootstrap");
    const { setSiteQuotas } = await import("@nexpress/core/sites");
    registerBuiltinHandlers();
    await setSiteQuotas(
      { storageBytes: null, documents: null, jobEnqueuesPerHour: 1 },
      user.id,
      "quota-a",
    );
    let admitted = 0;
    const enqueue = vi.fn(async () => {
      admitted += 1;
      return `job-${admitted.toString()}`;
    });
    const countSiteEnqueues = vi.fn(async () => admitted);
    setJobQueue({
      enqueue,
      countSiteEnqueues,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    });

    const attempts = await Promise.allSettled([
      enqueueJob("plugin:scheduledTask", {
        siteId: "quota-a",
        pluginId: "analytics",
        taskId: "daily",
      }),
      enqueueJob("plugin:scheduledTask", {
        siteId: "quota-a",
        pluginId: "analytics",
        taskId: "daily",
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "RATE_LIMITED" }),
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(countSiteEnqueues).toHaveBeenCalledTimes(2);

    setJobQueue({
      enqueue,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    });
    await expect(
      enqueueJob("plugin:scheduledTask", {
        siteId: "quota-a",
        pluginId: "analytics",
        taskId: "daily",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("exposes exact quota snapshots and reserves updates for super-admins", async () => {
    const { session: superSession, user } = await seedActor();
    const { setSuperAdmin } = await import("@nexpress/core");
    await setSuperAdmin(user.id, true);
    const { GET, PATCH } = await import("@/app/api/admin/sites/[id]/quotas/route");
    const patch = await PATCH(
      buildRequest("/api/admin/sites/quota-a/quotas", {
        session: superSession,
        method: "PATCH",
        body: { storageBytes: 1_000, documents: 50, jobEnqueuesPerHour: null },
      }),
      { params: Promise.resolve({ id: "quota-a" }) },
    );
    expect(await readJson(patch)).toMatchObject({
      status: 200,
      body: {
        limits: { storageBytes: 1_000, documents: 50, jobEnqueuesPerHour: null },
        usage: { storageBytes: 0, documents: 0, jobEnqueuesLastHour: null },
      },
    });

    const siteAdmin = await seedUser({ role: "editor" });
    const { grantSiteMembership } = await import("@nexpress/core/sites");
    await grantSiteMembership("quota-a", siteAdmin.userId, "admin");
    const get = await GET(buildRequest("/api/admin/sites/quota-a/quotas", { session: siteAdmin }), {
      params: Promise.resolve({ id: "quota-a" }),
    });
    expect(get.status).toBe(200);
    const forbidden = await PATCH(
      buildRequest("/api/admin/sites/quota-a/quotas", {
        session: siteAdmin,
        method: "PATCH",
        body: { storageBytes: null, documents: null, jobEnqueuesPerHour: null },
      }),
      { params: Promise.resolve({ id: "quota-a" }) },
    );
    expect(forbidden.status).toBe(403);
  });
});
