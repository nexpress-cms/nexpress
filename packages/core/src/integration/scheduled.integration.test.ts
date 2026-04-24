import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { hashPassword } from "../auth/password.js";
import type { NxAuthUser } from "../config/types.js";
import { nxUsers } from "../db/schema/system.js";
import { publishScheduledDocuments } from "../collections/scheduled.js";
import { saveDocument } from "../collections/pipeline.js";
import { loadPlugins, resetPlugins } from "../plugins/host.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  skipIfNoTestDb,
  truncateAll,
} from "./setup.js";
import { postsTable, registerTestCollections } from "./fixtures.js";

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

  async function seedUser(): Promise<NxAuthUser> {
    const db = await getTestDb();
    const hash = await hashPassword("password12345");
    const [row] = await db
      .insert(nxUsers)
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
    const result = await saveDocument(
      "posts",
      null,
      { ...baseDoc, publishedAt: future },
      user,
      { status: "published" },
    );
    expect(result.doc.status).toBe("scheduled");

    const db = await getTestDb();
    const [row] = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, result.doc.id as string));
    expect(row.status).toBe("scheduled");
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
    const due = await saveDocument(
      "posts",
      null,
      { ...baseDoc, publishedAt: past },
      user,
      { status: "scheduled" },
    );

    await publishScheduledDocuments();

    expect(afterUpdate).toHaveBeenCalledTimes(1);
    expect(afterPublish).toHaveBeenCalledTimes(1);
    // Handler wrapper passes { hook, data, collection, ctx }; the full
    // row is in data.doc. Confirm it's not the {id: ...} shape the bug
    // from audit round #2 produced.
    const afterPublishArgs = afterPublish.mock.calls[0][0];
    expect(afterPublishArgs.data.collection).toBe("posts");
    expect(afterPublishArgs.data.doc.id).toBe(due.doc.id);
    expect(afterPublishArgs.data.doc.title).toBe("Scheduled Post");
    expect(afterPublishArgs.data.doc.status).toBe("published");
    expect(afterPublishArgs.data.scheduled).toBe(true);
  });

  it("is idempotent — second run finds nothing", async () => {
    const user = await seedUser();
    const past = new Date(Date.now() - 60 * 1000);
    await saveDocument(
      "posts",
      null,
      { ...baseDoc, publishedAt: past },
      user,
      { status: "scheduled" },
    );

    const first = await publishScheduledDocuments();
    const second = await publishScheduledDocuments();
    expect(first.published).toBe(1);
    expect(second.published).toBe(0);
  });
});
