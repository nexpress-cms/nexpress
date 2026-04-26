import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { DELETE as collectionDELETE } from "@/app/api/collections/[slug]/[id]/route";
import {
  POST as commentsPOST,
} from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as reactionsPOST } from "@/app/api/reactions/route";
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (
    !headers.has("content-type") &&
    init.body &&
    typeof init.body === "string"
  ) {
    headers.set("content-type", "application/json");
  }
  if (init.cookies && init.cookies.length > 0) {
    headers.set("cookie", init.cookies.join("; "));
  }
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function staffRequest(
  path: string,
  user: TestUserSession,
  init: RequestInit = {},
): NextRequest {
  return jsonRequest(path, {
    ...init,
    cookies: [`nx-session=${user.accessToken}`, `nx-csrf=${user.csrfToken}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": user.csrfToken },
  });
}

function memberRequest(
  path: string,
  member: { sessionCookie: string; csrfCookie: string },
  init: RequestInit = {},
): NextRequest {
  return jsonRequest(path, {
    ...init,
    cookies: [`nx-mb-session=${member.sessionCookie}`, `nx-mb-csrf=${member.csrfCookie}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": member.csrfCookie },
  });
}

function cookieValue(setCookie: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const password = "password-12345";
  const email = `${handle}@example.com`;
  await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  const db = await getTestDb();
  const { createMemberEmailVerifyToken, nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle))
    .limit(1)) as Array<{ id: string }>;
  const issued = await createMemberEmailVerifyToken(db as never, row.id, 60_000);
  await verifyPOST(
    jsonRequest("/api/members/verify", {
      method: "POST",
      body: JSON.stringify({ token: issued.token }),
    }),
  );
  const login = await loginPOST(
    jsonRequest("/api/members/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );
  const setCookies = login.headers.get("set-cookie");
  return {
    memberId: row.id,
    sessionCookie: cookieValue(setCookies, "nx-mb-session")!,
    csrfCookie: cookieValue(setCookies, "nx-mb-csrf")!,
  };
}

async function seedStaffPost(staff: TestUserSession): Promise<string> {
  // Posts have `slugField: { useField: "title", unique: true }`, so
  // the pipeline derives slug from title and overrides whatever
  // we pass. Vary the title per call to dodge the unique-slug
  // collision when one test seeds two posts.
  const suffix = Math.random().toString(36).slice(2, 8);
  const create = await collectionPOST(
    staffRequest("/api/collections/posts", staff, {
      method: "POST",
      body: JSON.stringify({
        title: `Cascade target ${suffix}`,
        content: { root: { type: "root", children: [] } },
        _status: "published",
      }),
    }),
    { params: Promise.resolve({ slug: "posts" }) },
  );
  if (create.status !== 201) throw new Error("post seed failed");
  const body = (await create.json()) as { id: string };
  return body.id;
}

async function postComment(
  member: { sessionCookie: string; csrfCookie: string },
  collection: string,
  docId: string,
  text: string,
  parentId?: string,
): Promise<string> {
  const res = await commentsPOST(
    memberRequest(`/api/collections/${collection}/${docId}/comments`, member, {
      method: "POST",
      body: JSON.stringify({ bodyMd: text, parentId }),
    }),
    { params: Promise.resolve({ slug: collection, id: docId }) },
  );
  const body = await readJson<{ id: string }>(res);
  if (body.status !== 201) {
    throw new Error(`comment seed failed: ${JSON.stringify(body.body)}`);
  }
  return body.body.id;
}

async function postReaction(
  member: { sessionCookie: string; csrfCookie: string },
  commentId: string,
): Promise<void> {
  const res = await reactionsPOST(
    memberRequest("/api/reactions", member, {
      method: "POST",
      body: JSON.stringify({
        targetType: "comment",
        targetId: commentId,
        kind: "like",
      }),
    }),
  );
  if (res.status !== 201) throw new Error("reaction seed failed");
}

describe.skipIf(skipIfNoTestDb())("comment cascade on doc delete (Phase 9.7m)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const config = defineDiscussionsCollection();
    registerCollection(
      "discussions",
      discussionsTable as never,
      { ...config, access: undefined, hooks: undefined },
    );
    const { ensureCoreServices } = await import("@/lib/bootstrap");
    ensureCoreServices();
    registerCollection(
      "discussions",
      discussionsTable as never,
      { ...config, access: undefined, hooks: undefined },
    );
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("staff doc delete cascades comments on the doc (other docs untouched)", async () => {
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("cas-anna");

    const targetDoc = await seedStaffPost(editor);
    const otherDoc = await seedStaffPost(editor);
    await postComment(member, "posts", targetDoc, "comment 1");
    await postComment(member, "posts", targetDoc, "comment 2");
    await postComment(member, "posts", otherDoc, "untouched");

    const del = await collectionDELETE(
      staffRequest(`/api/collections/posts/${targetDoc}`, editor, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "posts", id: targetDoc }) },
    );
    expect(del.status).toBe(204);

    const db = await getTestDb();
    const { nxComments } = await import("@nexpress/core");
    const { and, eq } = await import("drizzle-orm");

    const onTarget = (await db
      .select()
      .from(nxComments)
      .where(
        and(eq(nxComments.targetType, "posts"), eq(nxComments.targetId, targetDoc)),
      )) as Array<unknown>;
    expect(onTarget).toHaveLength(0);

    const onOther = (await db
      .select()
      .from(nxComments)
      .where(
        and(eq(nxComments.targetType, "posts"), eq(nxComments.targetId, otherDoc)),
      )) as Array<unknown>;
    expect(onOther).toHaveLength(1);
  });

  it("nested replies cascade automatically (parent_id self-FK)", async () => {
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("cas-bea");

    const doc = await seedStaffPost(editor);
    const parent = await postComment(member, "posts", doc, "parent");
    await postComment(member, "posts", doc, "reply 1", parent);
    await postComment(member, "posts", doc, "reply 2", parent);

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${doc}`, editor, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "posts", id: doc }) },
    );

    const db = await getTestDb();
    const { nxComments } = await import("@nexpress/core");
    const all = (await db.select().from(nxComments)) as Array<unknown>;
    // Parent + 2 replies all gone (parent went via the explicit
    // cascade in deleteDocumentImpl, replies via the nx_comments
    // parent_id self-FK).
    expect(all).toHaveLength(0);
  });

  it("reactions on comments under the doc are also cleaned up", async () => {
    const editor = await seedUser({ role: "editor" });
    const author = await seedActiveMember("cas-react-author");
    const reactor = await seedActiveMember("cas-react-reactor");

    const doc = await seedStaffPost(editor);
    const commentId = await postComment(author, "posts", doc, "likeable");
    await postReaction(reactor, commentId);

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${doc}`, editor, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "posts", id: doc }) },
    );

    const db = await getTestDb();
    const { nxReactions, nxComments } = await import("@nexpress/core");
    const reactions = (await db.select().from(nxReactions)) as Array<unknown>;
    const comments = (await db.select().from(nxComments)) as Array<unknown>;
    // Reactions live on the comment via the polymorphic
    // (target_type='comment', target_id=$commentId) shape; there's
    // no DB-level FK from nx_reactions to nx_comments, so the
    // cascade in deleteDocumentImpl explicitly queries the
    // doc-scoped comment ids first and deletes their reactions
    // before the comments themselves go away.
    expect(reactions).toHaveLength(0);
    expect(comments).toHaveLength(0);
  });

  it("reactions targeting the doc directly are cleaned up", async () => {
    // Hypothetical: a site that allows reactions on the doc itself
    // (targetType=collection, targetId=docId). The nx_reactions
    // schema is polymorphic so it accepts that shape — and our
    // explicit cascade handles it.
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("cas-doc-react");

    const doc = await seedStaffPost(editor);
    // Insert a reaction directly so we don't need an API surface
    // that allows this (the existing reactions API is comment-only
    // until 9.4, but the schema supports the shape).
    const db = await getTestDb();
    const { nxReactions } = await import("@nexpress/core");
    await db.insert(nxReactions).values({
      targetType: "posts",
      targetId: doc,
      memberId: member.memberId,
      kind: "like",
    });

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${doc}`, editor, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "posts", id: doc }) },
    );

    const remaining = (await db.select().from(nxReactions)) as Array<unknown>;
    expect(remaining).toHaveLength(0);
  });

  it("member-side delete (`deleteMemberDocument`) also cascades", async () => {
    // The cascade lives in `deleteDocumentImpl`, which both staff
    // and member delete paths share — so a member self-deleting
    // their own discussion should drop comments under it too.
    const member = await seedActiveMember("cas-self");
    const commenter = await seedActiveMember("cas-on-self");

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Self-doc",
          slug: "cas-self-doc",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId } = await readJson<{ id: string }>(create).then((r) => r.body);
    await postComment(commenter, "discussions", docId, "on member's doc");

    const del = await collectionDELETE(
      memberRequest(`/api/collections/discussions/${docId}`, member, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(del.status).toBe(204);

    const db = await getTestDb();
    const { nxComments } = await import("@nexpress/core");
    const remaining = (await db.select().from(nxComments)) as Array<unknown>;
    expect(remaining).toHaveLength(0);
  });

  it("comments and reactions on OTHER docs are not collateral damage", async () => {
    // Sanity check: the cascade is target_id-scoped, not a blanket
    // wipe. A delete on doc A must not touch comments on doc B.
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("cas-isolation");

    const docA = await seedStaffPost(editor);
    const docB = await seedStaffPost(editor);
    const commentA = await postComment(member, "posts", docA, "on a");
    const commentB = await postComment(member, "posts", docB, "on b");
    await postReaction(member, commentB);

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${docA}`, editor, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "posts", id: docA }) },
    );

    const db = await getTestDb();
    const { nxComments, nxReactions } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const survivingComments = (await db
      .select()
      .from(nxComments)
      .where(eq(nxComments.id, commentB))) as Array<unknown>;
    expect(survivingComments).toHaveLength(1);
    const survivingReactions = (await db
      .select()
      .from(nxReactions)
      .where(eq(nxReactions.targetId, commentB))) as Array<unknown>;
    expect(survivingReactions).toHaveLength(1);

    // commentA is gone (cascade cleanup).
    const goneComments = (await db
      .select()
      .from(nxComments)
      .where(eq(nxComments.id, commentA))) as Array<unknown>;
    expect(goneComments).toHaveLength(0);
  });
});
