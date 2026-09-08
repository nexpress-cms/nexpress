/* eslint-disable import-x/no-relative-packages */
import { randomUUID } from "node:crypto";
import { docsTheme } from "../../../packages/themes/docs/src/index.js";
import { getThemeSettings, setThemeSettings } from "../../../packages/core/src/themes/settings.js";
import {
  getActiveTheme,
  getRegisteredThemes,
  registerThemes,
  setActiveThemeId,
} from "../../../packages/core/src/themes/registry.js";
import {
  npAssertSiteDocumentCreateQuota,
  setSiteQuotas,
} from "../../../packages/core/src/sites/quotas.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NpAuthUser } from "../../../packages/core/src/config/types.js";
import {
  saveDocument,
  findDocuments,
  getDocumentById,
  npGetPersistedCollectionDocumentById,
  npGetPersistedCollectionDocumentIds,
  withDeferredPostCommit,
  runPostCommit,
} from "../../../packages/core/src/collections/pipeline.js";
import {
  getCollectionRegistration,
  registerCollection,
} from "../../../packages/core/src/collections/registry.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { npMedia, npMediaRefs } from "../../../packages/core/src/db/schema/media.js";
import {
  npNavigation,
  npSettings,
  npRevisions,
} from "../../../packages/core/src/db/schema/system.js";
import {
  getNavigation,
  setNavigation,
  getSetting,
} from "../../../packages/core/src/content/helpers.js";
import { getSeoSettings, setSeoSettings } from "../../../packages/core/src/settings/service.js";
import { getTheme, setTheme } from "../../../packages/core/src/theme/runtime.js";
import { DEFAULT_THEME } from "../../../packages/core/src/theme/defaults.js";
import { listMediaReferences } from "../../../packages/core/src/media/refs.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import {
  getTestDb,
  ensureMigrated,
  closeTestDb,
  truncateAll,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
} from "./harness.js";

const effects: string[] = [];
const originalThemes = getRegisteredThemes();
async function actor(): Promise<NpAuthUser> {
  const session = await seedUser({ role: "admin" });
  return {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    tokenVersion: 1,
  };
}
const content = () => ({ title: "Atomic content", content: npCreateEmptyRichTextContent() });

describe.skipIf(skipIfNoTestDb())("existing resource transaction boundaries", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    // Files share a worker database; prior suites may leave unrelated resource rows behind.
    await truncateAll();
    effects.length = 0;
    registerTestCollections();
    const registration = getCollectionRegistration("posts");
    registerCollection(
      "posts",
      registration.table,
      {
        ...registration.config,
        hooks: {
          afterCreate: [
            ({ data }) => {
              effects.push("created");
              return data;
            },
          ],
          afterUpdate: [
            ({ data }) => {
              effects.push("updated");
              return data;
            },
          ],
        },
      },
      { childTables: registration.childTables, joinTables: registration.joinTables },
    );
  });
  afterEach(async () => {
    registerTestCollections();
    await truncateAll();
  });
  afterAll(async () => {
    registerThemes(originalThemes);
    await closeTestDb();
  });

  it("rolls back document, revisions, media references, navigation and settings without post-commit effects", async () => {
    const db = await getTestDb();
    const user = await actor();
    const id = randomUUID();
    const [media] = await db
      .insert(npMedia)
      .values({
        siteId: "default",
        filename: "atomic.png",
        originalFilename: "atomic.png",
        mimeType: "image/png",
        filesize: 1,
        storageKey: "fixture-atomic",
        hash: "fixture-hash",
        status: "ready",
      })
      .returning();
    await expect(
      withCurrentSite("default", () =>
        withDeferredPostCommit(() =>
          db.transaction(async (tx) => {
            await withDeferredPostCommit(async () => {
              const category = await saveDocument(
                "categories",
                null,
                { name: "Atomic category" },
                user,
                { tx },
              );
              await saveDocument(
                "posts",
                null,
                { ...content(), coverImage: media!.id, categories: [String(category.doc.id)] },
                user,
                {
                  tx,
                  createId: id,
                  status: "draft",
                },
              );
              expect((await getDocumentById("posts", id, user, { tx }))?.id).toBe(id);
              expect(
                (await npGetPersistedCollectionDocumentById("posts", id, "default", { tx }))
                  ?.categories,
              ).toEqual([category.doc.id]);
              expect(
                (await npGetPersistedCollectionDocumentById("posts", id, "default", { tx }))
                  ?.coverImage,
              ).toBe(media!.id);
              expect(
                await npGetPersistedCollectionDocumentIds("posts", [id], "default", { tx }),
              ).toEqual([id]);
              expect(
                (await findDocuments("posts", { where: { id }, limit: 1 }, user, { tx })).totalDocs,
              ).toBe(1);
              expect(await listMediaReferences(media!.id, { tx })).toHaveLength(1);
              expect(
                await tx.select().from(npRevisions).where(eq(npRevisions.documentId, id)),
              ).toHaveLength(1);
              await setNavigation(
                "header",
                [{ id: "atomic", type: "link", label: "Atomic", url: "/atomic" }],
                user,
                { tx },
              );
              expect((await getNavigation("header", { tx }))[0]?.label).toBe("Atomic");
              const seo = await getSeoSettings("default", { tx });
              await setSeoSettings(seo, user.id, "default", { tx });
              expect(await getSetting("seo", { tx })).toEqual(seo);
              await setTheme(DEFAULT_THEME, user, { tx });
              expect(await getTheme({ tx })).toEqual(DEFAULT_THEME);
              await runPostCommit("cache", { collection: "posts", documentId: id }, async () => {
                effects.push("cache");
              });
            });
            expect(effects).toEqual([]);
            throw new Error("outer rollback");
          }),
        ),
      ),
    ).rejects.toThrow("outer rollback");
    expect(
      await db
        .select()
        .from(
          getCollectionRegistration("posts")
            .table as typeof import("../src/db/generated/collections.js").postsTable,
        ),
    ).toHaveLength(0);
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      0,
    );
    expect(await db.select().from(npMediaRefs).where(eq(npMediaRefs.documentId, id))).toHaveLength(
      0,
    );
    expect(await db.select().from(npNavigation)).toHaveLength(0);
    expect(await db.select().from(npSettings).where(eq(npSettings.key, "theme"))).toHaveLength(0);
    expect(effects).toEqual([]);
  });

  it("keeps create/update/publish/schedule/archive on the existing pipeline until the outer commit", async () => {
    const db = await getTestDb();
    const user = await actor();
    const id = randomUUID();
    await withCurrentSite("default", () =>
      withDeferredPostCommit(() =>
        db.transaction(async (tx) => {
          await saveDocument("posts", null, content(), user, { tx, createId: id, status: "draft" });
          await saveDocument("posts", id, { title: "Changed" }, user, { tx, status: "published" });
          expect((await getDocumentById("posts", id, user, { tx }))?.status).toBe("published");
          await saveDocument("posts", id, { publishedAt: "2099-01-01T00:00:00.000Z" }, user, {
            tx,
            status: "published",
          });
          expect((await getDocumentById("posts", id, user, { tx }))?.status).toBe("scheduled");
          await saveDocument("posts", id, {}, user, { tx, status: "archived" });
          expect((await getDocumentById("posts", id, user, { tx }))?.status).toBe("archived");
          expect(effects).toEqual([]);
        }),
      ),
    );
    expect(effects).toEqual(["created", "updated", "updated", "updated"]);
    expect(await db.select().from(npRevisions).where(eq(npRevisions.documentId, id))).toHaveLength(
      4,
    );
    expect((await getDocumentById("posts", id, user))?.title).toBe("Changed");
  });

  it("reads active theme, schema settings and projected quota from the same pending transaction", async () => {
    const db = await getTestDb();
    const user = await actor();
    registerThemes([docsTheme]);
    const settings = await getThemeSettings("docs");
    await setSiteQuotas(
      { documents: 1, storageBytes: null, jobEnqueuesPerHour: null },
      user.id,
      "default",
    );
    await expect(
      db.transaction(async (tx) => {
        await setActiveThemeId("docs", user.id, { tx });
        expect((await getActiveTheme({ tx }))?.manifest.id).toBe("docs");
        await setThemeSettings("docs", settings, user.id, { tx });
        expect(await getThemeSettings(undefined, { tx })).toEqual(settings);
        await expect(npAssertSiteDocumentCreateQuota(tx, "default", 2)).rejects.toThrow(
          "quota exceeded",
        );
        await expect(npAssertSiteDocumentCreateQuota(tx, "default", 1)).resolves.toBeUndefined();
        await expect(npAssertSiteDocumentCreateQuota(tx, "default", -1)).rejects.toThrow(
          "non-negative",
        );
        throw new Error("rollback theme");
      }),
    ).rejects.toThrow("rollback theme");
    expect(await getSetting("activeTheme")).toBeNull();
    expect(await getSetting("theme.settings:docs")).toBeNull();
  });

  it.each(["existing", "missing"] as const)(
    "uses atomic navigation CAS for concurrent %s rows",
    async (state) => {
      const db = await getTestDb();
      const user = await actor();
      const initial = state === "existing" ? await setNavigation("header", [], user) : null;
      const expectedUpdatedAt = initial?.updatedAt ?? "2000-01-01T00:00:00.000Z";
      let locked!: (pid: number) => void;
      let release!: () => void;
      let countBlocked!: () => Promise<number>;
      const lockReady = new Promise<number>((resolve) => {
        locked = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx.execute(sql`lock table np_navigation in share mode`);
        const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        countBlocked = async () => {
          await tx.execute(sql`select pg_stat_clear_snapshot()`);
          const result = await tx.execute<{ waiting: string }>(
            sql`select count(*)::text as waiting from pg_stat_activity where ${backend.rows[0]!.pid} = any(pg_blocking_pids(pid))`,
          );
          return Number(result.rows[0]?.waiting);
        };
        locked(backend.rows[0]!.pid);
        await released;
      });
      void holder.catch(() => locked(-1));
      const pid = await lockReady;
      expect(pid).toBeGreaterThan(0);
      const writes = Promise.allSettled(
        ["first", "second"].map((name) =>
          setNavigation("header", [{ id: name, type: "link", label: name, url: "/" }], user, {
            expectedUpdatedAt,
          }),
        ),
      );
      try {
        await expect.poll(countBlocked, { timeout: 5000 }).toBe(2);
      } finally {
        release();
        await holder;
      }
      const results = await writes;
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((result) => result.status === "rejected");
      expect(failure?.status === "rejected" ? failure.reason : null).toMatchObject({
        statusCode: 409,
      });
      const winner = results.find((result) => result.status === "fulfilled");
      expect((await getNavigation("header"))[0]?.label).toBe(
        winner?.status === "fulfilled" ? winner.value.items[0]?.label : undefined,
      );
    },
  );

  it("advances the navigation CAS timestamp even when the stored clock is ahead", async () => {
    const db = await getTestDb();
    const user = await actor();
    await setNavigation("header", [], user);
    const future = new Date("2099-01-01T00:00:00.000Z");
    await db
      .update(npNavigation)
      .set({ updatedAt: sql`${future.toISOString()}::timestamptz + interval '456 microseconds'` })
      .where(eq(npNavigation.location, "header"));
    const result = await setNavigation("header", [], user, {
      expectedUpdatedAt: future.toISOString(),
    });
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(future.getTime());
    await expect(
      setNavigation("header", [], user, { expectedUpdatedAt: future.toISOString() }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("retains standalone hooks and denies the same item ACL inside an outer transaction", async () => {
    const db = await getTestDb();
    const user = await actor();
    const result = await saveDocument("posts", null, content(), user, { status: "draft" });
    expect(effects).toEqual(["created"]);
    const registration = getCollectionRegistration("posts");
    registerCollection(
      "posts",
      registration.table,
      { ...registration.config, access: { read: () => false, update: () => false } },
      { childTables: registration.childTables, joinTables: registration.joinTables },
    );
    await expect(
      withDeferredPostCommit(() =>
        db.transaction(async (tx) => {
          await saveDocument("posts", String(result.doc.id), { title: "Forbidden" }, user, { tx });
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => getDocumentById("posts", String(result.doc.id), user, { tx })),
    ).rejects.toThrow();
    expect(effects).toEqual(["created"]);
  });
});
