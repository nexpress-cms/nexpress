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
  npGetPersistedCollectionDocumentById,
  npGetPersistedCollectionDocumentIds,
  saveDocument,
} from "../collections/pipeline.js";
import { setJobQueue } from "../jobs/queue.js";
import { resetPlugins } from "../plugins/host.js";
import { withCurrentSite } from "../sites/context.js";
import { createSite } from "../sites/registry.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";
import { postsTable, registerTestCollections } from "./fixtures.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../agent/read-capability-executors.js";
import type { NpAgentContentFilterV1 } from "../agent-contract/index.js";

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

  it("keeps Agent date-filtered reads behind the existing site/status/visibility pipeline", async () => {
    const user = await seedUser();
    await createSite({ id: "agent-read-other", name: "Other read site" });
    const timestamp = "2026-09-01T00:00:00.000Z";
    const db = await getTestDb();
    let visibleId = "";
    for (const [siteId, status, visibility] of [
      ["default", "published", "public"],
      ["default", "published", "private"],
      ["default", "draft", "public"],
      ["agent-read-other", "published", "public"],
    ] as const) {
      const result = await withCurrentSite(siteId, () =>
        saveDocument(
          "posts",
          null,
          { ...baseDoc, slug: `agent-${siteId}-${status}-${visibility}`, visibility },
          user,
          { status },
        ),
      );
      const id = result.doc.id as string;
      if (visibleId === "") visibleId = id;
      await db
        .update(postsTable)
        .set({ updatedAt: new Date(timestamp) })
        .where(eq(postsTable.id, id));
    }
    const installed = createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "read-test", key: new Uint8Array(32).fill(17) },
      resolveUser: () => user,
      resolveBlockSchemas: () => [],
    });
    for (const filter of [
      { op: "eq", field: "updatedAt", value: timestamp },
      { op: "gte", field: "updatedAt", value: timestamp },
      { op: "in", field: "updatedAt", values: [timestamp, null] },
    ] satisfies NpAgentContentFilterV1[]) {
      const output = await withCurrentSite("default", () =>
        installed["content.query"](
          {
            collection: "posts",
            filter,
            fields: ["title"],
            audience: "public",
            status: "published",
            sort: [{ field: "updatedAt", direction: "desc" }],
            limit: 20,
            cursor: null,
          },
          {
            siteId: "default",
            principal: {
              kind: "service",
              siteId: "default",
              principalId: "01900000-0000-7000-8000-000000000010",
              authority: { kind: "user", userId: user.id },
              credentialId: "01900000-0000-7000-8000-000000000011",
              gatewayExposureCeiling: "read",
              scopes: ["content:read"],
            },
            requestedAt: timestamp,
            invocationId: "01900000-0000-7000-8000-000000000012",
            idempotencyKey: null,
            abortSignal: new AbortController().signal,
          },
        ),
      );
      expect(output.items.map((item) => item.id)).toEqual([visibleId]);
      expect(output.items[0]?.updatedAt).toBe(timestamp);
      expect(output.nextCursor).toBeNull();
    }
  });

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

  it("preserves a caller-owned create id for idempotent content transfer", async () => {
    const user = await seedUser();
    const createId = "44444444-4444-4444-8444-444444444444";
    const created = await saveDocument("posts", null, baseDoc, user, {
      status: "draft",
      createId,
    });

    expect(created.doc.id).toBe(createId);
    await expect(
      saveDocument("posts", createId, { title: "Updated" }, user, { createId }),
    ).rejects.toMatchObject({
      errors: [
        {
          field: "createId",
          message: expect.stringMatching(/only valid for document creates/u),
        },
      ],
    });
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

  it("scopes framework-host persisted document hydration to the explicit site", async () => {
    const user = await seedUser();
    await createSite({ id: "tenant-a", name: "Tenant A" });
    const created = await withCurrentSite("tenant-a", () =>
      saveDocument("posts", null, baseDoc, user, { status: "draft" }),
    );

    await expect(
      npGetPersistedCollectionDocumentById("posts", created.doc.id as string, "tenant-a"),
    ).resolves.toMatchObject({ id: created.doc.id, siteId: "tenant-a" });
    await expect(
      npGetPersistedCollectionDocumentById("posts", created.doc.id as string, "default"),
    ).rejects.toThrow(/cross-site/u);
    await expect(
      npGetPersistedCollectionDocumentIds("posts", [created.doc.id as string], "tenant-a"),
    ).resolves.toEqual([created.doc.id]);
    await expect(
      npGetPersistedCollectionDocumentIds("posts", [created.doc.id as string], "default"),
    ).rejects.toThrow(/cross-site/u);
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
