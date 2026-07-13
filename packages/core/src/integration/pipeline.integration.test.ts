import { npCreateEmptyRichTextContent } from "../fields/rich-text.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, asc } from "drizzle-orm";

import { hashPassword } from "../auth/password.js";
import type { NpAuthUser } from "../config/types.js";
import { npRevisions, npUsers } from "../db/schema/system.js";
import {
  deleteDocument,
  findDocuments,
  getDocumentById,
  saveDocument,
} from "../collections/pipeline.js";
import { setJobQueue } from "../jobs/queue.js";
import { resetPlugins } from "../plugins/host.js";
import { withCurrentSite } from "../sites/context.js";
import { createSite } from "../sites/registry.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";
import { postsTable, registerTestCollections } from "./fixtures.js";

describe.skipIf(skipIfNoTestDb())("saveDocument / revisions (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });

  beforeEach(async () => {
    await truncateAll();
    // Plugin registry is shared in-process; clear between tests so stale
    // hooks from earlier suites don't fire against this one's docs.
    resetPlugins();
    setJobQueue(null);
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
        email: "author@example.com",
        password: hash,
        name: "Author",
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
    title: "Hello",
    content: npCreateEmptyRichTextContent(),
  };

  it("persists the originating site in save and delete follow-up jobs", async () => {
    const user = await seedUser();
    await createSite({ id: "tenant-a", name: "Tenant A" });
    const enqueue = vi.fn().mockResolvedValue("job-1");
    setJobQueue({
      enqueue,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    });

    const created = await withCurrentSite("tenant-a", () =>
      saveDocument("posts", null, baseDoc, user, { status: "draft" }),
    );
    expect(enqueue).toHaveBeenCalledWith("content:afterSave", {
      siteId: "tenant-a",
      collection: "posts",
      documentId: created.doc.id,
      operation: "create",
      userId: user.id,
      memberId: null,
    });

    enqueue.mockClear();
    await withCurrentSite("tenant-a", () =>
      deleteDocument("posts", created.doc.id as string, user),
    );
    expect(enqueue).toHaveBeenCalledWith("content:afterDelete", {
      siteId: "tenant-a",
      collection: "posts",
      documentId: created.doc.id,
      userId: user.id,
      memberId: null,
    });
  });

  it("creates a document with a generated slug and writes a draft revision", async () => {
    const user = await seedUser();
    const result = await saveDocument("posts", null, baseDoc, user, { status: "draft" });

    expect(result.operation).toBe("create");
    expect(result.doc.status).toBe("draft");
    expect(result.doc.slug).toBe("hello");

    // Revision persisted with status=draft (per PR #15 mapping).
    const db = await getTestDb();
    const revs = await db
      .select()
      .from(npRevisions)
      .where(
        and(
          eq(npRevisions.collection, "posts"),
          eq(npRevisions.documentId, result.doc.id as string),
        ),
      );
    expect(revs).toHaveLength(1);
    expect(revs[0].status).toBe("draft");
    expect(revs[0].version).toBe(1);
  });

  it("keeps version counters monotonic after versions.max prunes old rows", async () => {
    const user = await seedUser();
    const created = await saveDocument("posts", null, baseDoc, user, { status: "draft" });

    for (let version = 2; version <= 23; version += 1) {
      await saveDocument(
        "posts",
        created.doc.id as string,
        { ...baseDoc, title: `Version ${version.toString()}` },
        user,
        { status: version === 23 ? "published" : "draft" },
      );
    }

    const db = await getTestDb();
    const revs = await db
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, created.doc.id as string))
      .orderBy(asc(npRevisions.version));
    expect(revs).toHaveLength(20);
    expect(revs.map((r) => r.version)).toEqual(Array.from({ length: 20 }, (_, index) => index + 4));
    expect(revs.at(-1)?.status).toBe("published");
  });

  it("findDocuments / getDocumentById round-trip the persisted row", async () => {
    const user = await seedUser();
    const created = await saveDocument(
      "posts",
      null,
      { ...baseDoc, excerpt: "Lookup target" },
      user,
      { status: "published" },
    );

    const byId = await getDocumentById("posts", created.doc.id as string);
    expect(byId?.excerpt).toBe("Lookup target");

    const found = await findDocuments("posts", { limit: 10 });
    expect(found.totalDocs).toBe(1);
    expect(found.docs[0].id).toBe(created.doc.id);
  });

  it("deleteDocument removes both the row and its revision history", async () => {
    const user = await seedUser();
    const created = await saveDocument("posts", null, baseDoc, user, { status: "draft" });

    await deleteDocument("posts", created.doc.id as string, user);

    const db = await getTestDb();
    const rows = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, created.doc.id as string));
    expect(rows).toHaveLength(0);
    const revisions = await db
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, created.doc.id as string));
    expect(revisions).toHaveLength(0);
  });
});
