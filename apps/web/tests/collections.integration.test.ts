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
});
