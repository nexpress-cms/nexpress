import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
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
    cookies: [`np-session=${user.accessToken}`, `np-csrf=${user.csrfToken}`],
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
    cookies: [`np-mb-session=${member.sessionCookie}`, `np-mb-csrf=${member.csrfCookie}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": member.csrfCookie },
  });
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
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
        content: npCreateEmptyRichTextContent(),
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
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
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
    const { npComments } = await import("@nexpress/core");
    const { and, eq } = await import("drizzle-orm");

    const onTarget = (await db
      .select()
      .from(npComments)
      .where(
        and(eq(npComments.targetType, "posts"), eq(npComments.targetId, targetDoc)),
      )) as Array<unknown>;
    expect(onTarget).toHaveLength(0);

    const onOther = (await db
      .select()
      .from(npComments)
      .where(
        and(eq(npComments.targetType, "posts"), eq(npComments.targetId, otherDoc)),
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
    const { npComments } = await import("@nexpress/core");
    const all = (await db.select().from(npComments)) as Array<unknown>;
    // Parent + 2 replies all gone (parent went via the explicit
    // cascade in deleteDocumentImpl, replies via the np_comments
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
    const { npReactions, npComments } = await import("@nexpress/core");
    const reactions = (await db.select().from(npReactions)) as Array<unknown>;
    const comments = (await db.select().from(npComments)) as Array<unknown>;
    // Reactions live on the comment via the polymorphic
    // (target_type='comment', target_id=$commentId) shape; there's
    // no DB-level FK from np_reactions to np_comments, so the
    // cascade in deleteDocumentImpl explicitly queries the
    // doc-scoped comment ids first and deletes their reactions
    // before the comments themselves go away.
    expect(reactions).toHaveLength(0);
    expect(comments).toHaveLength(0);
  });

  it("reactions targeting the doc directly are cleaned up", async () => {
    // Hypothetical: a site that allows reactions on the doc itself
    // (targetType=collection, targetId=docId). The np_reactions
    // schema is polymorphic so it accepts that shape — and our
    // explicit cascade handles it.
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("cas-doc-react");

    const doc = await seedStaffPost(editor);
    // Insert a reaction directly so we don't need an API surface
    // that allows this (the existing reactions API is comment-only
    // until 9.4, but the schema supports the shape).
    const db = await getTestDb();
    const { npReactions } = await import("@nexpress/core");
    await db.insert(npReactions).values({
      targetType: "posts",
      targetId: doc,
      memberId: member.memberId,
      kind: "like",
    });

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${doc}`, editor, { method: "DELETE" }),
      { params: Promise.resolve({ slug: "posts", id: doc }) },
    );

    const remaining = (await db.select().from(npReactions)) as Array<unknown>;
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
          body: npCreateEmptyRichTextContent(),
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
    const { npComments } = await import("@nexpress/core");
    const remaining = (await db.select().from(npComments)) as Array<unknown>;
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
    const { npComments, npReactions } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const survivingComments = (await db
      .select()
      .from(npComments)
      .where(eq(npComments.id, commentB))) as Array<unknown>;
    expect(survivingComments).toHaveLength(1);
    const survivingReactions = (await db
      .select()
      .from(npReactions)
      .where(eq(npReactions.targetId, commentB))) as Array<unknown>;
    expect(survivingReactions).toHaveLength(1);

    // commentA is gone (cascade cleanup).
    const goneComments = (await db
      .select()
      .from(npComments)
      .where(eq(npComments.id, commentA))) as Array<unknown>;
    expect(goneComments).toHaveLength(0);
  });

  // Phase 9.7q — reports filed against the cascaded comments would
  // otherwise outlive their target. Hard-deleting a doc must also
  // sweep the report queue so mods aren't staring at rows that
  // dereference to nothing.
  it("reports filed against cascaded comments are cleaned up (Phase 9.7q)", async () => {
    const editor = await seedUser({ role: "editor" });
    const author = await seedActiveMember("cas-rep-author");
    const reporter = await seedActiveMember("cas-rep-reporter");

    const docToKill = await seedStaffPost(editor);
    const docToKeep = await seedStaffPost(editor);
    const targetCommentId = await postComment(
      author,
      "posts",
      docToKill,
      "reportable",
    );
    const survivingCommentId = await postComment(
      author,
      "posts",
      docToKeep,
      "innocent",
    );

    // File two reports — one against each comment. Only the report
    // pointing at the about-to-cascade comment should disappear.
    const { fileReport, npReports } = await import("@nexpress/core");
    await fileReport({
      reporterId: reporter.memberId,
      targetType: "comment",
      targetId: targetCommentId,
      reason: "spam",
    });
    await fileReport({
      reporterId: reporter.memberId,
      targetType: "comment",
      targetId: survivingCommentId,
      reason: "spam too",
    });

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${docToKill}`, editor, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "posts", id: docToKill }) },
    );

    const db = await getTestDb();
    const { eq } = await import("drizzle-orm");
    const remaining = (await db.select().from(npReports)) as Array<{
      targetId: string;
    }>;
    // The unrelated report still points at the surviving comment.
    expect(remaining).toHaveLength(1);
    expect(remaining[0].targetId).toBe(survivingCommentId);

    // And belt-and-braces: a query keyed on the deleted comment id
    // returns zero rows.
    const orphans = (await db
      .select()
      .from(npReports)
      .where(eq(npReports.targetId, targetCommentId))) as Array<unknown>;
    expect(orphans).toHaveLength(0);
  });

  it("reports targeting OTHER members survive (cascade is comment-scoped)", async () => {
    // Member-target reports (`target_type='member'`) are unrelated
    // to the doc being deleted — they must NOT be collateral damage
    // of the cascade.
    const editor = await seedUser({ role: "editor" });
    const offender = await seedActiveMember("cas-rep-offender");
    const reporter = await seedActiveMember("cas-rep-watchdog");
    const docToKill = await seedStaffPost(editor);
    await postComment(offender, "posts", docToKill, "noise");

    const { fileReport, npReports } = await import("@nexpress/core");
    await fileReport({
      reporterId: reporter.memberId,
      targetType: "member",
      targetId: offender.memberId,
      reason: "repeat behavior",
    });

    await collectionDELETE(
      staffRequest(`/api/collections/posts/${docToKill}`, editor, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "posts", id: docToKill }) },
    );

    const db = await getTestDb();
    const { eq } = await import("drizzle-orm");
    const memberReports = (await db
      .select()
      .from(npReports)
      .where(eq(npReports.targetType, "member"))) as Array<unknown>;
    expect(memberReports).toHaveLength(1);
  });
});
