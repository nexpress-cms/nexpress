import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { PATCH as collectionPATCH } from "@/app/api/collections/[slug]/[id]/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { POST as mutesPOST } from "@/app/api/members/me/mutes/route";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
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

function richText(text: string) {
  const content = npCreateEmptyRichTextContent();
  const paragraph = content.document.root.children[0];
  if (!paragraph) throw new Error("empty rich text must contain a paragraph");
  paragraph.children = [{ type: "text", version: 1, text }];
  return content;
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string; handle: string }> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    memberId: session.memberId,
    handle: session.handle,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
  };
}

async function seedStaffPostId(slug: string): Promise<string> {
  const { hashPassword, npUsers, signToken } = await import("@nexpress/core");
  const db = await getTestDb();
  const password = await hashPassword("password12345");
  const [user] = (await db
    .insert(npUsers)
    .values({ email: `staff-${slug}@example.com`, password, name: "Staff", role: "editor" })
    .returning({
      id: npUsers.id,
      email: npUsers.email,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })) as Array<{ id: string; email: string; role: "editor"; tokenVersion: number }>;
  const token = await signToken(
    { id: user.id, role: user.role, tokenVersion: user.tokenVersion },
    process.env.NP_SECRET!,
  );
  const csrf = "csrf-staff";
  const create = await collectionPOST(
    jsonRequest("/api/collections/posts", {
      method: "POST",
      cookies: [`np-session=${token}`, `np-csrf=${csrf}`],
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({
        title: "Mention target",
        slug,
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
    }),
    { params: Promise.resolve({ slug: "posts" }) },
  );
  const body = (await create.json()) as { id: string };
  return body.id;
}

async function postComment(
  postId: string,
  author: { sessionCookie: string; csrfCookie: string },
  bodyMd: string,
  parentId?: string,
): Promise<string> {
  const res = await commentsPOST(
    jsonRequest(`/api/collections/posts/${postId}/comments`, {
      method: "POST",
      cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
      headers: { "x-csrf-token": author.csrfCookie },
      body: JSON.stringify(parentId ? { bodyMd, parentId } : { bodyMd }),
    }),
    { params: Promise.resolve({ slug: "posts", id: postId }) },
  );
  if (res.status !== 201) throw new Error(`postComment failed: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function notificationsFor(member: {
  sessionCookie: string;
}): Promise<Array<{ kind: string; payload: Record<string, unknown> }>> {
  const list = await notificationsGET(
    jsonRequest("/api/notifications", {
      cookies: [`np-mb-session=${member.sessionCookie}`],
    }),
  );
  const body = await readJson<{
    notifications: Array<{ kind: string; payload: Record<string, unknown> }>;
  }>(list);
  return body.body.notifications;
}

describe.skipIf(skipIfNoTestDb())("16.2 @mention notifications (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const config = defineDiscussionsCollection();
    registerCollection("discussions", discussionsTable as never, {
      ...config,
      access: undefined,
      hooks: undefined,
    });
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetReputationAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("@mention in a comment notifies the mentioned member", async () => {
    const postId = await seedStaffPostId("16-2-mention-basic");
    const author = await seedActiveMember("authorm1");
    const target = await seedActiveMember("targetm1");
    await postComment(postId, author, `Hey @${target.handle}, look at this!`);

    const inbox = await notificationsFor(target);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("comment.mention");
    expect(inbox[0]?.payload.mentionedHandle).toBe(target.handle);
    expect(inbox[0]?.payload.commentId).toBeTruthy();

    // Author themselves gets nothing.
    const authorInbox = await notificationsFor(author);
    expect(authorInbox).toHaveLength(0);
  });

  it("self-mention is silently dropped", async () => {
    const postId = await seedStaffPostId("16-2-self-mention");
    const author = await seedActiveMember("solo1");
    await postComment(postId, author, `Look at me @${author.handle}!`);

    const inbox = await notificationsFor(author);
    expect(inbox).toHaveLength(0);
  });

  it("reply that mentions the parent author fires only `comment.reply` (not also `comment.mention`)", async () => {
    const postId = await seedStaffPostId("16-2-reply-dedupe");
    const parent = await seedActiveMember("parentm");
    const replier = await seedActiveMember("replierm");
    const parentId = await postComment(postId, parent, "first");
    await postComment(postId, replier, `Thanks @${parent.handle}!`, parentId);

    const inbox = await notificationsFor(parent);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("comment.reply");
  });

  it("muted recipient does not receive `comment.mention`", async () => {
    const postId = await seedStaffPostId("16-2-mute-mention");
    const muter = await seedActiveMember("muterm");
    const noisy = await seedActiveMember("noisym");

    // Muter mutes noisy first.
    await mutesPOST(
      jsonRequest("/api/members/me/mutes", {
        method: "POST",
        cookies: [`np-mb-session=${muter.sessionCookie}`, `np-mb-csrf=${muter.csrfCookie}`],
        headers: { "x-csrf-token": muter.csrfCookie },
        body: JSON.stringify({ targetId: noisy.memberId }),
      }),
    );

    // Noisy mentions muter — notification suppressed by mute filter.
    await postComment(postId, noisy, `Hey @${muter.handle}!`);

    const inbox = await notificationsFor(muter);
    expect(inbox).toHaveLength(0);
  });

  it("non-existent / inactive handles are silently ignored", async () => {
    const postId = await seedStaffPostId("16-2-unknown-handle");
    const author = await seedActiveMember("authorm2");
    await postComment(postId, author, "Hello @nonexistent-user and @also-not-real, anyone home?");
    // No throws; the comment was accepted (status 201 from postComment).
    // Author has nothing in their inbox either.
    const inbox = await notificationsFor(author);
    expect(inbox).toHaveLength(0);
  });

  it("editing a comment to add a new mention only notifies the newly-added handle", async () => {
    const postId = await seedStaffPostId("16-2-edit-delta");
    const author = await seedActiveMember("editorm");
    const a = await seedActiveMember("alpham");
    const b = await seedActiveMember("betam");
    const commentId = await postComment(postId, author, `Hi @${a.handle}`);

    // Initial mention to alpha.
    const aInboxBefore = await notificationsFor(a);
    expect(aInboxBefore).toHaveLength(1);

    // Edit adds beta — only beta should get a new notification; alpha
    // already had one and should not receive a duplicate.
    const { updateComment } = await import("@nexpress/core");
    await updateComment({
      commentId,
      memberId: author.memberId,
      bodyMd: `Hi @${a.handle} and @${b.handle}`,
    });

    const aInboxAfter = await notificationsFor(a);
    expect(aInboxAfter).toHaveLength(1); // unchanged

    const bInbox = await notificationsFor(b);
    expect(bInbox).toHaveLength(1);
    expect(bInbox[0]?.kind).toBe("comment.mention");
  });

  it("@mention in a member-authored discussion fires `document.mention`", async () => {
    const author = await seedActiveMember("docauthor1");
    const target = await seedActiveMember("doctarget1");

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", author, {
        method: "POST",
        body: JSON.stringify({
          title: "Hello world",
          slug: "hello-from-mention-test",
          body: richText(`cc @${target.handle}`),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    expect(create.status).toBe(201);

    const inbox = await notificationsFor(target);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("document.mention");
    expect(inbox[0]?.payload.mentionedHandle).toBe(target.handle);
    expect(inbox[0]?.payload.collectionSlug).toBe("discussions");
  });

  it("editing a discussion to add a new mention only notifies the new handle", async () => {
    const author = await seedActiveMember("docauthor2");
    const a = await seedActiveMember("doca");
    const b = await seedActiveMember("docb");

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", author, {
        method: "POST",
        body: JSON.stringify({
          title: "Edit case",
          slug: "edit-mention-case",
          body: richText(`cc @${a.handle}`),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId } = (await create.json()) as { id: string };

    // Confirm a got 1 from create.
    expect(await notificationsFor(a)).toHaveLength(1);
    expect(await notificationsFor(b)).toHaveLength(0);

    // Edit adds b; a stays mentioned but should not be re-notified.
    const patch = await collectionPATCH(
      memberRequest(`/api/collections/discussions/${docId}`, author, {
        method: "PATCH",
        body: JSON.stringify({
          title: "Edit case",
          slug: "edit-mention-case",
          body: richText(`cc @${a.handle} and @${b.handle}`),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(patch.status).toBe(200);

    expect(await notificationsFor(a)).toHaveLength(1);
    const bInbox = await notificationsFor(b);
    expect(bInbox).toHaveLength(1);
    expect(bInbox[0]?.kind).toBe("document.mention");
  });

  it("`extractMentionHandles` skips email addresses (negative lookbehind)", async () => {
    const { extractMentionHandles } = await import("@nexpress/core");
    expect(extractMentionHandles("Email me at user@example.com")).toEqual([]);
    expect(extractMentionHandles("Hi @alice and email user@example.com")).toEqual(["alice"]);
    expect(extractMentionHandles("Two: @bob, @charlie!")).toEqual(["bob", "charlie"]);
  });
});
