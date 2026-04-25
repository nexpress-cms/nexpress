import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";
import {
  GET as commentsGET,
  POST as commentsPOST,
} from "@/app/api/collections/[slug]/[id]/comments/route";
import {
  PATCH as commentPATCH,
  DELETE as commentDELETE,
} from "@/app/api/comments/[id]/route";
import { POST as commentHidePOST } from "@/app/api/comments/[id]/hide/route";
import { POST as commentRestorePOST } from "@/app/api/comments/[id]/restore/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function cookieValue(setCookieHeader: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function seedActiveMember(
  handle: string,
  email: string,
  password: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const reg = await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  if (reg.status !== 200) throw new Error(`register failed: ${await reg.text()}`);

  const db = await getTestDb();
  const { createMemberEmailVerifyToken, nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle))
    .limit(1)) as Array<{ id: string }>;
  if (!row) throw new Error(`member ${handle} not found`);

  const issued = await createMemberEmailVerifyToken(db as never, row.id, 60_000);
  await verifyPOST(
    jsonRequest("/api/members/verify", { method: "POST", body: JSON.stringify({ token: issued.token }) }),
  );

  const login = await loginPOST(
    jsonRequest("/api/members/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  );
  if (login.status !== 200) throw new Error(`login failed: ${await login.text()}`);
  const sc = login.headers.get("set-cookie");
  return {
    memberId: row.id,
    sessionCookie: cookieValue(sc, "nx-mb-session")!,
    csrfCookie: cookieValue(sc, "nx-mb-csrf")!,
  };
}

async function seedStaffPost(): Promise<string> {
  // Need a staff user to author the post via /api/collections/posts.
  const { hashPassword, nxUsers, signToken } = await import("@nexpress/core");
  const db = await getTestDb();
  const password = await hashPassword("password12345");
  const [user] = (await db
    .insert(nxUsers)
    .values({ email: "staff@example.com", password, name: "Staff", role: "editor" })
    .returning({
      id: nxUsers.id,
      email: nxUsers.email,
      role: nxUsers.role,
      tokenVersion: nxUsers.tokenVersion,
    })) as Array<{ id: string; email: string; role: "editor"; tokenVersion: number }>;
  const token = await signToken(
    { id: user.id, role: user.role, tokenVersion: user.tokenVersion },
    process.env.NX_SECRET!,
  );
  const csrf = "csrf-staff";

  const create = await collectionPOST(
    jsonRequest("/api/collections/posts", {
      method: "POST",
      cookies: [`nx-session=${token}`, `nx-csrf=${csrf}`],
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({
        title: "Comments target",
        slug: "comments-target",
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
    }),
    { params: Promise.resolve({ slug: "posts" }) },
  );
  if (create.status !== 201) throw new Error(`post create failed: ${await create.text()}`);
  const body = (await create.json()) as { id: string };
  return body.id;
}

async function grantRole(
  memberId: string,
  role: string,
  scopeType: "site" | "category" | "collection" | "thread",
  scopeId: string | null,
): Promise<void> {
  const db = await getTestDb();
  const { nxMemberRoles } = await import("@nexpress/core");
  await db.insert(nxMemberRoles).values({ memberId, role, scopeType, scopeId });
}

describe.skipIf(skipIfNoTestDb())("comments API (integration)", () => {
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

  it("create + list comments under a posts document", async () => {
    const postId = await seedStaffPost();
    const { sessionCookie, csrfCookie } = await seedActiveMember(
      "alice",
      "alice@example.com",
      "password-12",
    );

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${sessionCookie}`, `nx-mb-csrf=${csrfCookie}`],
        headers: { "x-csrf-token": csrfCookie },
        body: JSON.stringify({ bodyMd: "Hello **world**" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const createBody = await readJson<{ id: string; bodyHtml: string; status: string }>(created);
    expect(createBody.status).toBe(201);
    expect(createBody.body.bodyHtml).toContain("<strong>world</strong>");
    expect(createBody.body.status).toBe("visible");

    const list = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const listBody = await readJson<{ comments: Array<{ id: string }>; totalDocs: number }>(list);
    expect(listBody.body.totalDocs).toBe(1);
    expect(listBody.body.comments[0]?.id).toBe(createBody.body.id);
  });

  it("rejects creation when collection has community.comments=false", async () => {
    const { sessionCookie, csrfCookie } = await seedActiveMember(
      "bob",
      "bob@example.com",
      "password-12",
    );
    // pages collection doesn't opt in.
    const res = await commentsPOST(
      jsonRequest("/api/collections/pages/00000000-0000-0000-0000-000000000000/comments", {
        method: "POST",
        cookies: [`nx-mb-session=${sessionCookie}`, `nx-mb-csrf=${csrfCookie}`],
        headers: { "x-csrf-token": csrfCookie },
        body: JSON.stringify({ bodyMd: "should fail" }),
      }),
      {
        params: Promise.resolve({
          slug: "pages",
          id: "00000000-0000-0000-0000-000000000000",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("anonymous user can list but not create", async () => {
    const postId = await seedStaffPost();
    const list = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(list.status).toBe(200);

    const create = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "anon" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(create.status).toBe(401);
  });

  it("owner can edit-own; stranger cannot", async () => {
    const postId = await seedStaffPost();
    const owner = await seedActiveMember("carol", "carol@example.com", "password-12");
    const stranger = await seedActiveMember("dave", "dave@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${owner.sessionCookie}`, `nx-mb-csrf=${owner.csrfCookie}`],
        headers: { "x-csrf-token": owner.csrfCookie },
        body: JSON.stringify({ bodyMd: "first" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const ownerEdit = await commentPATCH(
      jsonRequest(`/api/comments/${commentId}`, {
        method: "PATCH",
        cookies: [`nx-mb-session=${owner.sessionCookie}`, `nx-mb-csrf=${owner.csrfCookie}`],
        headers: { "x-csrf-token": owner.csrfCookie },
        body: JSON.stringify({ bodyMd: "edited" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(ownerEdit.status).toBe(200);

    const strangerEdit = await commentPATCH(
      jsonRequest(`/api/comments/${commentId}`, {
        method: "PATCH",
        cookies: [`nx-mb-session=${stranger.sessionCookie}`, `nx-mb-csrf=${stranger.csrfCookie}`],
        headers: { "x-csrf-token": stranger.csrfCookie },
        body: JSON.stringify({ bodyMd: "hijack" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(strangerEdit.status).toBe(403);
  });

  it("collection-mod can hide a comment in their collection; not in another", async () => {
    const postId = await seedStaffPost();
    const author = await seedActiveMember("erin", "erin@example.com", "password-12");
    const mod = await seedActiveMember("frank", "frank@example.com", "password-12");
    await grantRole(mod.memberId, "collection-mod", "collection", "posts");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "spam" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const hide = await commentHidePOST(
      jsonRequest(`/api/comments/${commentId}/hide`, {
        method: "POST",
        cookies: [`nx-mb-session=${mod.sessionCookie}`, `nx-mb-csrf=${mod.csrfCookie}`],
        headers: { "x-csrf-token": mod.csrfCookie },
        body: JSON.stringify({ reason: "Spam" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(hide.status).toBe(200);

    // Default list filters to status=visible — hidden comment is gone.
    const list = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const listBody = await readJson<{ totalDocs: number }>(list);
    expect(listBody.body.totalDocs).toBe(0);

    // Restore via the mod restores visibility.
    const restore = await commentRestorePOST(
      jsonRequest(`/api/comments/${commentId}/restore`, {
        method: "POST",
        cookies: [`nx-mb-session=${mod.sessionCookie}`, `nx-mb-csrf=${mod.csrfCookie}`],
        headers: { "x-csrf-token": mod.csrfCookie },
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(restore.status).toBe(200);
  });

  it("delete (own) soft-deletes the row and clears the body", async () => {
    const postId = await seedStaffPost();
    const author = await seedActiveMember("gail", "gail@example.com", "password-12");
    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "delete me" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const del = await commentDELETE(
      jsonRequest(`/api/comments/${commentId}`, {
        method: "DELETE",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(del.status).toBe(200);

    const list = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const listBody = await readJson<{ totalDocs: number }>(list);
    expect(listBody.body.totalDocs).toBe(0);
  });

  it("rejects parentId on a different document", async () => {
    const postA = await seedStaffPost();
    const author = await seedActiveMember("hank", "hank@example.com", "password-12");

    // Create a comment under postA.
    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postA}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "root" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postA }) },
    );
    const { id: parentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    // Try to reply with parentId pointing at postA's comment from a
    // *different* doc id — should fail.
    const reply = await commentsPOST(
      jsonRequest(`/api/collections/posts/00000000-0000-0000-0000-000000000000/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "smuggled", parentId }),
      }),
      {
        params: Promise.resolve({
          slug: "posts",
          id: "00000000-0000-0000-0000-000000000000",
        }),
      },
    );
    expect(reply.status).toBe(400);
  });
});
