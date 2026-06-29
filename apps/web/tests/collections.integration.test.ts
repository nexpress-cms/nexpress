import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

import { GET as listGET, POST as listPOST } from "@/app/api/collections/[slug]/route";
import {
  DELETE as idDELETE,
  GET as idGET,
  PATCH as idPATCH,
} from "@/app/api/collections/[slug]/[id]/route";
import { POST as bulkPOST } from "@/app/api/collections/[slug]/bulk/route";
import { POST as autosavePOST } from "@/app/api/collections/[slug]/[id]/autosave/route";
import { POST as publishScheduledPOST } from "@/app/api/internal/publish-scheduled/route";

describe.skipIf(skipIfNoTestDb())("collections API (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });
  const idParams = (slug: string, id: string) => ({ params: Promise.resolve({ slug, id }) });

  it("POST creates a document and GET list returns it", async () => {
    const session = await seedUser({ role: "editor" });

    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Hello world",
          slug: "hello-world",
          content: { root: { type: "root", children: [] } },
          _status: "published",
        },
      }),
      slugParams("posts"),
    );
    const created = await readJson<{ id: string; title: string; status: string }>(createRes);
    expect(created.status).toBe(201);
    expect(created.body.title).toBe("Hello world");
    expect(created.body.status).toBe("published");

    const listRes = await listGET(buildRequest("/api/collections/posts"), slugParams("posts"));
    const listed = await readJson<{ docs: Array<{ id: string }>; totalDocs: number }>(listRes);
    expect(listed.status).toBe(200);
    expect(listed.body.totalDocs).toBe(1);
    expect(listed.body.docs[0]?.id).toBe(created.body.id);
  });

  it("PATCH updates a document; DELETE removes it", async () => {
    const session = await seedUser({ role: "editor" });
    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Original",
          slug: "original",
          content: { root: { type: "root", children: [] } },
          _status: "draft",
        },
      }),
      slugParams("posts"),
    );
    const { body: created } = await readJson<{ id: string }>(createRes);
    const id = created.id;

    const patchRes = await idPATCH(
      buildRequest(`/api/collections/posts/${id}`, {
        method: "PATCH",
        session,
        body: {
          title: "Updated",
          slug: "original",
          content: { root: { type: "root", children: [] } },
          _status: "draft",
        },
      }),
      idParams("posts", id),
    );
    const patched = await readJson<{ title: string }>(patchRes);
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe("Updated");

    const deleteRes = await idDELETE(
      buildRequest(`/api/collections/posts/${id}`, { method: "DELETE", session }),
      idParams("posts", id),
    );
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await idGET(
      buildRequest(`/api/collections/posts/${id}`),
      idParams("posts", id),
    );
    expect(getAfterDelete.status).toBe(404);
  });

  it("POST without auth returns 401", async () => {
    const res = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        body: { title: "Anon", _status: "draft" },
      }),
      slugParams("posts"),
    );
    expect(res.status).toBe(401);
  });

  it("scheduled publish: future publishedAt + _status=published lands as status=scheduled", async () => {
    const session = await seedUser({ role: "editor" });
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Scheduled",
          slug: "scheduled",
          content: { root: { type: "root", children: [] } },
          publishedAt: futureIso,
          _status: "published",
        },
      }),
      slugParams("posts"),
    );
    const created = await readJson<{ id: string; status: string; publishedAt: string }>(createRes);
    expect(created.status).toBe(201);
    // Pipeline coerces published+future → scheduled.
    expect(created.body.status).toBe("scheduled");
    expect(new Date(created.body.publishedAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("scheduled documents stay hidden from anonymous REST list and detail reads", async () => {
    const session = await seedUser({ role: "editor" });
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Visible public post",
          slug: "visible-public-post",
          content: { root: { type: "root", children: [] } },
          _status: "published",
        },
      }),
      slugParams("posts"),
    );
    const scheduledRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Hidden scheduled post",
          slug: "hidden-scheduled-post",
          content: { root: { type: "root", children: [] } },
          publishedAt: futureIso,
          _status: "published",
        },
      }),
      slugParams("posts"),
    );
    const scheduled = await readJson<{ id: string; status: string }>(scheduledRes);
    expect(scheduled.body.status).toBe("scheduled");

    const anonListRes = await listGET(buildRequest("/api/collections/posts"), slugParams("posts"));
    const anonList = await readJson<{
      docs: Array<{ id: string; title: string; status: string }>;
      totalDocs: number;
    }>(anonListRes);
    expect(anonList.status).toBe(200);
    expect(anonList.body.totalDocs).toBe(1);
    expect(anonList.body.docs.map((doc) => doc.title)).toEqual(["Visible public post"]);

    const anonDetailRes = await idGET(
      buildRequest(`/api/collections/posts/${scheduled.body.id}`),
      idParams("posts", scheduled.body.id),
    );
    expect(anonDetailRes.status).toBe(404);
  });

  it("bulk publish: flips multiple drafts to published in one call", async () => {
    const session = await seedUser({ role: "editor" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await listPOST(
        buildRequest("/api/collections/posts", {
          method: "POST",
          session,
          body: {
            title: `Bulk ${i}`,
            slug: `bulk-${i}`,
            content: { root: { type: "root", children: [] } },
            _status: "draft",
          },
        }),
        slugParams("posts"),
      );
      const { body } = await readJson<{ id: string }>(res);
      ids.push(body.id);
    }

    const bulkRes = await bulkPOST(
      buildRequest("/api/collections/posts/bulk", {
        method: "POST",
        session,
        body: { action: "publish", ids },
      }),
      slugParams("posts"),
    );
    const { status, body: bulkBody } = await readJson<{
      succeeded: string[];
      failed: Array<{ id: string; error: string }>;
    }>(bulkRes);
    expect(status).toBe(200);
    expect(bulkBody.succeeded).toHaveLength(3);
    expect(bulkBody.failed).toHaveLength(0);

    const firstAfter = await idGET(
      buildRequest(`/api/collections/posts/${ids[0]}`),
      idParams("posts", ids[0]!),
    );
    const after = await readJson<{ status: string }>(firstAfter);
    expect(after.body.status).toBe("published");
  });

  it("bulk delete: removes selected docs, reports unknown ids as failed", async () => {
    const session = await seedUser({ role: "admin" });
    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Will be deleted",
          slug: "will-be-deleted",
          content: { root: { type: "root", children: [] } },
          _status: "draft",
        },
      }),
      slugParams("posts"),
    );
    const { body: created } = await readJson<{ id: string }>(createRes);

    const bulkRes = await bulkPOST(
      buildRequest("/api/collections/posts/bulk", {
        method: "POST",
        session,
        body: {
          action: "delete",
          ids: [created.id, "00000000-0000-0000-0000-000000000000"],
        },
      }),
      slugParams("posts"),
    );
    const { body } = await readJson<{
      succeeded: string[];
      failed: Array<{ id: string; error: string }>;
    }>(bulkRes);
    expect(body.succeeded).toContain(created.id);
    expect(body.failed.some((f) => f.id === "00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("bulk: rejects empty ids and unknown actions", async () => {
    const session = await seedUser({ role: "editor" });
    const emptyRes = await bulkPOST(
      buildRequest("/api/collections/posts/bulk", {
        method: "POST",
        session,
        body: { action: "publish", ids: [] },
      }),
      slugParams("posts"),
    );
    expect(emptyRes.status).toBe(400);

    const badActionRes = await bulkPOST(
      buildRequest("/api/collections/posts/bulk", {
        method: "POST",
        session,
        body: { action: "nuke", ids: ["00000000-0000-0000-0000-000000000000"] },
      }),
      slugParams("posts"),
    );
    expect(badActionRes.status).toBe(400);
  });

  it("autosave: writes a status=autosave revision without touching the main doc", async () => {
    const session = await seedUser({ role: "editor" });
    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Autosave seed",
          slug: "autosave-seed",
          content: { root: { type: "root", children: [] } },
          _status: "draft",
        },
      }),
      slugParams("posts"),
    );
    const { body: created } = await readJson<{ id: string; updatedAt: string }>(createRes);

    const autosaveRes = await autosavePOST(
      buildRequest(`/api/collections/posts/${created.id}/autosave`, {
        method: "POST",
        session,
        body: {
          title: "Autosave draft typing in progress",
          slug: "autosave-seed",
          content: { root: { type: "root", children: [] } },
        },
      }),
      { params: Promise.resolve({ slug: "posts", id: created.id }) },
    );
    const auto = await readJson<{
      id: string;
      version: number;
      status: string;
      reused: boolean;
    }>(autosaveRes);
    expect(auto.status).toBe(200);
    expect(auto.body.status).toBe("autosave");
    expect(auto.body.reused).toBe(false);

    // The main doc must be unchanged — autosave persists into np_revisions only.
    // Anonymous reads now hide drafts (#56), so re-fetch with the
    // staff session so we can verify the unchanged main row.
    const after = await idGET(
      buildRequest(`/api/collections/posts/${created.id}`, { session }),
      idParams("posts", created.id),
    );
    const fetched = await readJson<{ title: string }>(after);
    expect(fetched.body.title).toBe("Autosave seed");
  });

  it("autosave: dedup returns reused=true when the snapshot is unchanged", async () => {
    const session = await seedUser({ role: "editor" });
    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Dedup",
          slug: "dedup",
          content: { root: { type: "root", children: [] } },
          _status: "draft",
        },
      }),
      slugParams("posts"),
    );
    const { body: created } = await readJson<{ id: string }>(createRes);

    const snapshot = {
      title: "Dedup typing",
      slug: "dedup",
      content: { root: { type: "root", children: [] } },
    };
    const ctx = { params: Promise.resolve({ slug: "posts", id: created.id }) };
    const first = await autosavePOST(
      buildRequest(`/api/collections/posts/${created.id}/autosave`, {
        method: "POST",
        session,
        body: snapshot,
      }),
      ctx,
    );
    const firstBody = await readJson<{ reused: boolean; version: number }>(first);
    expect(firstBody.body.reused).toBe(false);

    const second = await autosavePOST(
      buildRequest(`/api/collections/posts/${created.id}/autosave`, {
        method: "POST",
        session,
        body: snapshot,
      }),
      ctx,
    );
    const secondBody = await readJson<{ reused: boolean; version: number }>(second);
    expect(secondBody.body.reused).toBe(true);
    expect(secondBody.body.version).toBe(firstBody.body.version);
  });

  it("cancel schedule: PATCH _status=draft + publishedAt=null returns to draft", async () => {
    const session = await seedUser({ role: "editor" });
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createRes = await listPOST(
      buildRequest("/api/collections/posts", {
        method: "POST",
        session,
        body: {
          title: "Will-cancel",
          slug: "will-cancel",
          content: { root: { type: "root", children: [] } },
          publishedAt: futureIso,
          _status: "published",
        },
      }),
      slugParams("posts"),
    );
    const { body: created } = await readJson<{ id: string; status: string }>(createRes);
    expect(created.status).toBe("scheduled");

    const cancelRes = await idPATCH(
      buildRequest(`/api/collections/posts/${created.id}`, {
        method: "PATCH",
        session,
        body: {
          title: "Will-cancel",
          slug: "will-cancel",
          content: { root: { type: "root", children: [] } },
          publishedAt: null,
          _status: "draft",
        },
      }),
      idParams("posts", created.id),
    );
    const cancelled = await readJson<{ status: string; publishedAt: string | null }>(cancelRes);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("draft");
  });

  it("internal scheduled trigger publishes due rows and reports sweep time", async () => {
    const previousToken = process.env.NP_SCHEDULER_TOKEN;
    process.env.NP_SCHEDULER_TOKEN = "test-scheduler-token";
    try {
      const session = await seedUser({ role: "editor" });
      const dueIso = new Date(Date.now() - 60 * 1000).toISOString();
      const createRes = await listPOST(
        buildRequest("/api/collections/posts", {
          method: "POST",
          session,
          body: {
            title: "Due scheduled trigger",
            slug: "due-scheduled-trigger",
            content: { root: { type: "root", children: [] } },
            publishedAt: dueIso,
            _status: "scheduled",
          },
        }),
        slugParams("posts"),
      );
      const created = await readJson<{ id: string; status: string }>(createRes);
      expect(created.body.status).toBe("scheduled");

      const triggerRes = await publishScheduledPOST(
        buildRequest("/api/internal/publish-scheduled", {
          method: "POST",
          headers: { authorization: "Bearer test-scheduler-token" },
        }),
      );
      const triggered = await readJson<{
        published: number;
        byCollection: Record<string, string[]>;
        at: string;
      }>(triggerRes);
      expect(triggered.status).toBe(200);
      expect(triggered.body.published).toBe(1);
      expect(triggered.body.byCollection.posts).toContain(created.body.id);
      expect(new Date(triggered.body.at).getTime()).not.toBeNaN();
    } finally {
      if (previousToken === undefined) {
        delete process.env.NP_SCHEDULER_TOKEN;
      } else {
        process.env.NP_SCHEDULER_TOKEN = previousToken;
      }
    }
  });
});
