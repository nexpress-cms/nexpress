import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { hashPassword } from "../auth/password.js";
import type { NpAuthUser } from "../config/types.js";
import { npUsers } from "../db/schema/system.js";
import { publishScheduledDocuments } from "../collections/scheduled.js";
import { saveDocument } from "../collections/pipeline.js";
import { loadPlugins, resetPlugins } from "../plugins/host.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";
import { categoriesTable, pagesTable, postsTable, registerTestCollections } from "./fixtures.js";

describe.skipIf(skipIfNoTestDb())("publishScheduledDocuments (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });

  beforeEach(async () => {
    await truncateAll();
    resetPlugins();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedUser(): Promise<NpAuthUser> {
    const db = await getTestDb();
    const hash = await hashPassword("password12345");
    const [row] = await db
      .insert(npUsers)
      .values({
        email: "scheduler@example.com",
        password: hash,
        name: "Scheduler",
        role: "editor",
      })
      .returning();
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      tokenVersion: row.tokenVersion,
    };
  }

  const baseDoc = {
    title: "Scheduled Post",
    content: { root: { type: "root", children: [] } },
  };

  it("pipeline coerces published + future publishedAt to scheduled", async () => {
    const user = await seedUser();
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const result = await saveDocument("posts", null, { ...baseDoc, publishedAt: future }, user, {
      status: "published",
    });
    expect(result.doc.status).toBe("scheduled");

    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, result.doc.id as string));
    expect(row.status).toBe("scheduled");
  });

  it("pipeline accepts future publishedAt strings on framework-managed columns", async () => {
    const user = await seedUser();
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await saveDocument(
      "pages",
      null,
      { title: "Scheduled Page", publishedAt: futureIso },
      user,
      { status: "published" },
    );
    expect(result.doc.status).toBe("scheduled");

    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, result.doc.id as string));
    expect(row.status).toBe("scheduled");
  });

  it("pipeline preserves scheduled status on framework-managed column updates", async () => {
    const user = await seedUser();
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await saveDocument(
      "pages",
      null,
      { title: "Scheduled Page", publishedAt: futureIso },
      user,
      { status: "published" },
    );

    const updated = await saveDocument(
      "pages",
      created.doc.id as string,
      { title: "Scheduled Page Updated" },
      user,
      { status: "scheduled" },
    );
    expect(updated.doc.status).toBe("scheduled");

    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, created.doc.id as string));
    expect(row.title).toBe("Scheduled Page Updated");
    expect(row.status).toBe("scheduled");
  });

  it("does not treat publishedAt as framework-managed without draft versions", async () => {
    const user = await seedUser();
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await saveDocument(
      "categories",
      null,
      { name: "Scheduling", publishedAt: futureIso },
      user,
      { status: "published" },
    );
    expect(result.doc.status).toBe("published");

    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, result.doc.id as string));
    expect(row.name).toBe("Scheduling");
    expect(row.status).toBe("published");
  });

  it("publishScheduledDocuments flips only rows whose publishedAt has passed", async () => {
    const user = await seedUser();
    const past = new Date(Date.now() - 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    const due = await saveDocument(
      "posts",
      null,
      { ...baseDoc, title: "Due", publishedAt: past },
      user,
      { status: "scheduled" },
    );
    const notDue = await saveDocument(
      "posts",
      null,
      { ...baseDoc, title: "Not due", publishedAt: future },
      user,
      { status: "scheduled" },
    );

    const result = await publishScheduledDocuments();
    expect(result.published).toBe(1);
    expect(result.byCollection.posts).toEqual([due.doc.id]);

    const db = await getTestDb();
    const [dueRow] = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, due.doc.id as string));
    const [futureRow] = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, notDue.doc.id as string));
    expect(dueRow.status).toBe("published");
    expect(futureRow.status).toBe("scheduled");
  });

  it("publishScheduledDocuments includes draft collections with framework-managed publishedAt", async () => {
    const user = await seedUser();
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const due = await saveDocument(
      "pages",
      null,
      { title: "Due Scheduled Page", publishedAt: past },
      user,
      { status: "scheduled" },
    );

    const result = await publishScheduledDocuments();

    expect(result.byCollection.pages).toContain(due.doc.id as string);
    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(pagesTable)
      .where(eq(pagesTable.id, due.doc.id as string));
    expect(row.status).toBe("published");
  });

  it("fires content:afterUpdate, afterPublish hooks with the full doc", async () => {
    const afterUpdate = vi.fn();
    const afterPublish = vi.fn();
    await loadPlugins([
      {
        manifest: {
          id: "test-publisher",
          name: "Test publisher",
          capabilities: ["hooks:content"],
        },
        hooks: {
          "content:afterUpdate": afterUpdate,
          "content:afterPublish": afterPublish,
        },
      },
    ]);

    const user = await seedUser();
    const past = new Date(Date.now() - 60 * 1000);
    const due = await saveDocument("posts", null, { ...baseDoc, publishedAt: past }, user, {
      status: "scheduled",
    });

    await publishScheduledDocuments();

    expect(afterUpdate).toHaveBeenCalledTimes(1);
    expect(afterPublish).toHaveBeenCalledTimes(1);
    // Scheduler events use the same content payload as request events, with
    // source="scheduler", principal=null, and the full row in document.
    const afterPublishArgs = afterPublish.mock.calls[0][0];
    expect(afterPublishArgs.data.collection).toBe("posts");
    expect(afterPublishArgs.data.documentId).toBe(due.doc.id);
    expect(afterPublishArgs.data.document.id).toBe(due.doc.id);
    expect(afterPublishArgs.data.document.title).toBe("Scheduled Post");
    expect(afterPublishArgs.data.document.status).toBe("published");
    expect(afterPublishArgs.data.originalDocument).toBeNull();
    expect(afterPublishArgs.data.source).toBe("scheduler");
    expect(afterPublishArgs.data.principal).toBeNull();
  });

  it("is idempotent — second run finds nothing", async () => {
    const user = await seedUser();
    const past = new Date(Date.now() - 60 * 1000);
    await saveDocument("posts", null, { ...baseDoc, publishedAt: past }, user, {
      status: "scheduled",
    });

    const first = await publishScheduledDocuments();
    const second = await publishScheduledDocuments();
    expect(first.published).toBe(1);
    expect(second.published).toBe(0);
  });
});
