import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, asc } from "drizzle-orm";

import { hashPassword } from "../auth/password.js";
import type { NxAuthUser } from "../config/types.js";
import { nxRevisions, nxUsers } from "../db/schema/system.js";
import {
  deleteDocument,
  findDocuments,
  getDocumentById,
  saveDocument,
} from "../collections/pipeline.js";
import { resetPlugins } from "../plugins/host.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  skipIfNoTestDb,
  truncateAll,
} from "./setup.js";
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
    content: { root: { type: "root", children: [] } },
  };

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
      .from(nxRevisions)
      .where(
        and(
          eq(nxRevisions.collection, "posts"),
          eq(nxRevisions.documentId, result.doc.id as string),
        ),
      );
    expect(revs).toHaveLength(1);
    expect(revs[0].status).toBe("draft");
    expect(revs[0].version).toBe(1);
  });

  it("updates keep version counter monotonic", async () => {
    const user = await seedUser();
    const created = await saveDocument("posts", null, baseDoc, user, { status: "draft" });

    await saveDocument(
      "posts",
      created.doc.id as string,
      { ...baseDoc, title: "Second" },
      user,
      { status: "draft" },
    );
    await saveDocument(
      "posts",
      created.doc.id as string,
      { ...baseDoc, title: "Third" },
      user,
      { status: "published" },
    );

    const db = await getTestDb();
    const revs = await db
      .select()
      .from(nxRevisions)
      .where(eq(nxRevisions.documentId, created.doc.id as string))
      .orderBy(asc(nxRevisions.version));
    expect(revs.map((r) => r.version)).toEqual([1, 2, 3]);
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

  it("deleteDocument removes the row (revisions remain for history)", async () => {
    const user = await seedUser();
    const created = await saveDocument("posts", null, baseDoc, user, { status: "draft" });

    await deleteDocument("posts", created.doc.id as string, user);

    const db = await getTestDb();
    const rows = await db.select().from(postsTable).where(eq(postsTable.id, created.doc.id as string));
    expect(rows).toHaveLength(0);
  });
});
