import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { npCommunityRealtimeEvents } from "@nexpress/core";
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
} from "./harness.js";

import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import {
  GET as reactionsGET,
  POST as reactionsPOST,
  DELETE as reactionsDELETE,
} from "@/app/api/reactions/route";
import {
  GET as followsGET,
  POST as followsPOST,
  DELETE as followsDELETE,
} from "@/app/api/follows/route";
import { GET as followsCheckGET } from "@/app/api/follows/check/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { POST as markReadPOST } from "@/app/api/notifications/mark-read/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

async function seedActiveMember(
  handle: string,
  email: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const session = await harnessSeedActiveMember({ handle, email });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
  };
}

async function seedStaffPostId(): Promise<string> {
  const user = await seedUser({
    email: "staff@example.com",
    password: "password12345",
    name: "Staff",
    role: "editor",
  });
  const token = user.accessToken;
  const csrf = "csrf-staff";
  const create = await collectionPOST(
    jsonRequest("/api/collections/posts", {
      method: "POST",
      cookies: [`np-session=${token}`, `np-csrf=${csrf}`],
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({
        title: "9.3 target",
        slug: "9-3-target",
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
  authorCookies: { sessionCookie: string; csrfCookie: string },
  bodyMd: string,
  parentId?: string,
): Promise<string> {
  const res = await commentsPOST(
    jsonRequest(`/api/collections/posts/${postId}/comments`, {
      method: "POST",
      cookies: [
        `np-mb-session=${authorCookies.sessionCookie}`,
        `np-mb-csrf=${authorCookies.csrfCookie}`,
      ],
      headers: { "x-csrf-token": authorCookies.csrfCookie },
      body: JSON.stringify(parentId ? { bodyMd, parentId } : { bodyMd }),
    }),
    { params: Promise.resolve({ slug: "posts", id: postId }) },
  );
  if (res.status !== 201) throw new Error(`postComment failed: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

describe.skipIf(skipIfNoTestDb())("9.3 reactions / follows / notifications (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // App bootstrap reconciles the active project collections and intentionally
    // removes this test-only fixture. Register it once more after bootstrap so
    // the owner-notification case exercises the real member-write route.
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
    const { discussionsCollection } = await import("@/collections/discussions");
    const { discussionsTable } = await import("@/db/generated/collections");
    const { registerCollection } = await import("@nexpress/core");
    registerCollection("discussions", discussionsTable as never, {
      ...discussionsCollection,
      access: undefined,
      hooks: undefined,
    });
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("react + count + remove flow on a comment", async () => {
    const postId = await seedStaffPostId();
    const author = await seedActiveMember("alice", "alice@example.com");
    const reactor = await seedActiveMember("bob", "bob@example.com");
    const commentId = await postComment(postId, author, "first");

    const add = await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [`np-mb-session=${reactor.sessionCookie}`, `np-mb-csrf=${reactor.csrfCookie}`],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(add.status).toBe(201);

    // Idempotent — same reactor + same kind returns 201 and the same row id.
    const dup = await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [`np-mb-session=${reactor.sessionCookie}`, `np-mb-csrf=${reactor.csrfCookie}`],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(dup.status).toBe(201);

    const summary = await reactionsGET(
      jsonRequest(`/api/reactions?targetType=comment&targetId=${commentId}`),
    );
    const sumBody = await readJson<{ counts: Record<string, number>; mine: string[] }>(summary);
    expect(sumBody.body.counts.like).toBe(1);
    expect(sumBody.body.mine).toEqual([]); // reader is anonymous

    const remove = await reactionsDELETE(
      jsonRequest(`/api/reactions?targetType=comment&targetId=${commentId}&kind=like`, {
        method: "DELETE",
        cookies: [`np-mb-session=${reactor.sessionCookie}`, `np-mb-csrf=${reactor.csrfCookie}`],
        headers: { "x-csrf-token": reactor.csrfCookie },
      }),
    );
    expect(remove.status).toBe(200);

    const summaryAfter = await reactionsGET(
      jsonRequest(`/api/reactions?targetType=comment&targetId=${commentId}`),
    );
    const after = await readJson<{ counts: Record<string, number> }>(summaryAfter);
    expect(after.body.counts.like ?? 0).toBe(0);

    const realtime = await (
      await getTestDb()
    )
      .select({ channel: npCommunityRealtimeEvents.channel })
      .from(npCommunityRealtimeEvents);
    expect(realtime.map((event) => event.channel)).toEqual(
      expect.arrayContaining(["comments", "reactions", "notifications"]),
    );
  });

  it("reaction notification fans out to the comment author (skips self-reaction)", async () => {
    const postId = await seedStaffPostId();
    const author = await seedActiveMember("carol", "carol@example.com");
    const reactor = await seedActiveMember("dave", "dave@example.com");
    const commentId = await postComment(postId, author, "look at me");

    // Reactor reacts → notification to author.
    await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [`np-mb-session=${reactor.sessionCookie}`, `np-mb-csrf=${reactor.csrfCookie}`],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );

    const list = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${author.sessionCookie}`],
      }),
    );
    const notifs = await readJson<{
      notifications: Array<{ kind: string; payload: { reactorId: string } }>;
      unread: number;
    }>(list);
    expect(notifs.body.unread).toBe(1);
    expect(notifs.body.notifications[0]?.kind).toBe("reaction.received");
    expect(notifs.body.notifications[0]?.payload.reactorId).toBe(reactor.memberId);

    // Author reacts to their own comment → no extra notification.
    await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    const list2 = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${author.sessionCookie}`],
      }),
    );
    const notifs2 = await readJson<{ unread: number }>(list2);
    expect(notifs2.body.unread).toBe(1); // unchanged
  });

  it("reply to a comment notifies the parent author", async () => {
    const postId = await seedStaffPostId();
    const author = await seedActiveMember("erin", "erin@example.com");
    const replier = await seedActiveMember("frank", "frank@example.com");
    const parentId = await postComment(postId, author, "parent");
    await postComment(postId, replier, "child", parentId);

    const list = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${author.sessionCookie}`],
      }),
    );
    const notifs = await readJson<{
      notifications: Array<{ kind: string; payload: Record<string, unknown> }>;
      unread: number;
    }>(list);
    expect(notifs.body.unread).toBe(1);
    expect(notifs.body.notifications[0]?.kind).toBe("comment.reply");
    expect(notifs.body.notifications[0]?.payload.replyAuthorId).toBe(replier.memberId);
  });

  it("top-level comments notify a member-authored document owner", async () => {
    const owner = await seedActiveMember("discussion-owner", "discussion-owner@example.com");
    const commenter = await seedActiveMember(
      "discussion-commenter",
      "discussion-commenter@example.com",
    );
    const created = await collectionPOST(
      jsonRequest("/api/collections/discussions", {
        method: "POST",
        cookies: [`np-mb-session=${owner.sessionCookie}`, `np-mb-csrf=${owner.csrfCookie}`],
        headers: { "x-csrf-token": owner.csrfCookie },
        body: JSON.stringify({
          title: "Owned discussion",
          slug: "owned-discussion",
          body: npCreateEmptyRichTextContent(),
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const discussion = await readJson<{ id: string }>(created);
    expect(discussion.status).toBe(201);

    const response = await commentsPOST(
      jsonRequest(`/api/collections/discussions/${discussion.body.id}/comments`, {
        method: "POST",
        cookies: [`np-mb-session=${commenter.sessionCookie}`, `np-mb-csrf=${commenter.csrfCookie}`],
        headers: { "x-csrf-token": commenter.csrfCookie },
        body: JSON.stringify({ bodyMd: "top-level reply" }),
      }),
      { params: Promise.resolve({ slug: "discussions", id: discussion.body.id }) },
    );
    expect(response.status).toBe(201);

    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${owner.sessionCookie}`],
      }),
    );
    const body = await readJson<{
      unread: number;
      notifications: Array<{ kind: string; payload: Record<string, unknown> }>;
    }>(inbox);
    expect(body.body.unread).toBe(1);
    expect(body.body.notifications[0]).toMatchObject({
      kind: "comment.received",
      payload: { targetType: "discussions", targetId: discussion.body.id },
    });
  });

  it("follow + unfollow + isFollowing + notification", async () => {
    const a = await seedActiveMember("gail", "gail@example.com");
    const b = await seedActiveMember("hank", "hank@example.com");

    const f = await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`np-mb-session=${a.sessionCookie}`, `np-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: b.memberId }),
      }),
    );
    expect(f.status).toBe(201);

    // b should have a follow.received notification.
    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${b.sessionCookie}`],
      }),
    );
    const inboxBody = await readJson<{ unread: number }>(inbox);
    expect(inboxBody.body.unread).toBe(1);

    // List a's follows.
    const list = await followsGET(
      jsonRequest("/api/follows?targetType=member", {
        cookies: [`np-mb-session=${a.sessionCookie}`],
      }),
    );
    const listBody = await readJson<{ follows: Array<{ targetId: string }> }>(list);
    expect(listBody.body.follows.map((r) => r.targetId)).toContain(b.memberId);

    const un = await followsDELETE(
      jsonRequest(`/api/follows?targetType=member&targetId=${b.memberId}`, {
        method: "DELETE",
        cookies: [`np-mb-session=${a.sessionCookie}`, `np-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
      }),
    );
    expect(un.status).toBe(200);

    const after = await followsGET(
      jsonRequest("/api/follows", { cookies: [`np-mb-session=${a.sessionCookie}`] }),
    );
    const afterBody = await readJson<{ follows: unknown[] }>(after);
    expect(afterBody.body.follows).toHaveLength(0);
  });

  it("/api/follows/check returns boolean for the current viewer's follow state", async () => {
    const viewer = await seedActiveMember("vic", "vic@example.com");
    const target = await seedActiveMember("tina", "tina@example.com");

    // Initially not following.
    const before = await followsCheckGET(
      jsonRequest(`/api/follows/check?targetType=member&targetId=${target.memberId}`, {
        cookies: [`np-mb-session=${viewer.sessionCookie}`],
      }),
    );
    const beforeBody = await readJson<{ following: boolean }>(before);
    expect(before.status).toBe(200);
    expect(beforeBody.body.following).toBe(false);

    await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`np-mb-session=${viewer.sessionCookie}`, `np-mb-csrf=${viewer.csrfCookie}`],
        headers: { "x-csrf-token": viewer.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: target.memberId }),
      }),
    );

    const after = await followsCheckGET(
      jsonRequest(`/api/follows/check?targetType=member&targetId=${target.memberId}`, {
        cookies: [`np-mb-session=${viewer.sessionCookie}`],
      }),
    );
    const afterBody = await readJson<{ following: boolean }>(after);
    expect(afterBody.body.following).toBe(true);
  });

  it("subscribes to an enabled collection document and receives one actionable comment event", async () => {
    const postId = await seedStaffPostId();
    const subscriber = await seedActiveMember("watcher", "watcher@example.com");
    const commenter = await seedActiveMember("commenter", "commenter@example.com");

    const followed = await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [
          `np-mb-session=${subscriber.sessionCookie}`,
          `np-mb-csrf=${subscriber.csrfCookie}`,
        ],
        headers: { "x-csrf-token": subscriber.csrfCookie },
        body: JSON.stringify({ targetType: "posts", targetId: postId }),
      }),
    );
    expect(followed.status).toBe(201);

    await postComment(postId, commenter, "new activity");
    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${subscriber.sessionCookie}`],
      }),
    );
    const body = await readJson<{
      unread: number;
      notifications: Array<{ kind: string; payload: Record<string, unknown> }>;
    }>(inbox);
    expect(body.body.unread).toBe(1);
    expect(body.body.notifications[0]).toMatchObject({
      kind: "follow.activity",
      payload: {
        activity: "comment.created",
        subjectType: "posts",
        subjectId: postId,
        targetType: "posts",
        targetId: postId,
        href: "/blog/9-3-target",
      },
    });
  });

  it("prefers a direct reply over a duplicate subscription notification", async () => {
    const postId = await seedStaffPostId();
    const subscriber = await seedActiveMember("reply-watcher", "reply-watcher@example.com");
    const replier = await seedActiveMember("reply-writer", "reply-writer@example.com");
    const parentId = await postComment(postId, subscriber, "parent");
    await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [
          `np-mb-session=${subscriber.sessionCookie}`,
          `np-mb-csrf=${subscriber.csrfCookie}`,
        ],
        headers: { "x-csrf-token": subscriber.csrfCookie },
        body: JSON.stringify({ targetType: "posts", targetId: postId }),
      }),
    );

    await postComment(postId, replier, "reply", parentId);
    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${subscriber.sessionCookie}`],
      }),
    );
    const body = await readJson<{
      unread: number;
      notifications: Array<{ kind: string }>;
    }>(inbox);
    expect(body.body.unread).toBe(1);
    expect(body.body.notifications.map((item) => item.kind)).toEqual(["comment.reply"]);
  });

  it("rejects document follows when the collection has not opted in", async () => {
    const postId = await seedStaffPostId();
    const member = await seedActiveMember("no-follow", "no-follow@example.com");
    const response = await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`np-mb-session=${member.sessionCookie}`, `np-mb-csrf=${member.csrfCookie}`],
        headers: { "x-csrf-token": member.csrfCookie },
        body: JSON.stringify({ targetType: "pages", targetId: postId }),
      }),
    );
    expect(response.status).toBe(400);
  });

  // Issue #124 — pre-fix `follow()` did select-then-insert. Two
  // identical follow requests racing each other could both miss
  // the existing row, then both insert; the unique-constraint
  // loser bubbled a 500 to the client. Now uses
  // `onConflictDoNothing` mirroring the reactions write path.
  it("concurrent identical follow requests are idempotent (#124)", async () => {
    const a = await seedActiveMember("race-a", "race-a@example.com");
    const b = await seedActiveMember("race-b", "race-b@example.com");

    const fire = () =>
      followsPOST(
        jsonRequest("/api/follows", {
          method: "POST",
          cookies: [`np-mb-session=${a.sessionCookie}`, `np-mb-csrf=${a.csrfCookie}`],
          headers: { "x-csrf-token": a.csrfCookie },
          body: JSON.stringify({ targetType: "member", targetId: b.memberId }),
        }),
      );

    const results = await Promise.all([fire(), fire(), fire()]);
    for (const res of results) {
      // Every concurrent POST returns 201 — there's exactly one
      // row in the DB regardless of who won the insert race.
      expect(res.status).toBe(201);
    }

    // Only one row in `np_follows` despite three POSTs.
    const db = await getTestDb();
    const { npFollows } = await import("@nexpress/core");
    const { and, eq } = await import("drizzle-orm");
    const rows = (await db
      .select()
      .from(npFollows)
      .where(
        and(eq(npFollows.followerId, a.memberId), eq(npFollows.targetId, b.memberId)),
      )) as Array<unknown>;
    expect(rows).toHaveLength(1);

    // And only ONE follow.received notification — the conflict
    // path doesn't re-fire it.
    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`np-mb-session=${b.sessionCookie}`],
      }),
    );
    const inboxBody = await readJson<{ unread: number }>(inbox);
    expect(inboxBody.body.unread).toBe(1);
  });

  it("self-follow is rejected", async () => {
    const a = await seedActiveMember("ivy", "ivy@example.com");
    const res = await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`np-mb-session=${a.sessionCookie}`, `np-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: a.memberId }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("mark-read accepts ids and `all: true`", async () => {
    const postId = await seedStaffPostId();
    const author = await seedActiveMember("jess", "jess@example.com");
    const reactor = await seedActiveMember("kira", "kira@example.com");
    const c1 = await postComment(postId, author, "one");
    const c2 = await postComment(postId, author, "two");

    // Two reactions → two notifications for `author`.
    for (const id of [c1, c2]) {
      await reactionsPOST(
        jsonRequest("/api/reactions", {
          method: "POST",
          cookies: [`np-mb-session=${reactor.sessionCookie}`, `np-mb-csrf=${reactor.csrfCookie}`],
          headers: { "x-csrf-token": reactor.csrfCookie },
          body: JSON.stringify({ targetType: "comment", targetId: id, kind: "like" }),
        }),
      );
    }

    // Mark all read.
    const ack = await markReadPOST(
      jsonRequest("/api/notifications/mark-read", {
        method: "POST",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ all: true }),
      }),
    );
    const ackBody = await readJson<{ marked: number; all: boolean }>(ack);
    expect(ackBody.body.marked).toBe(2);
    expect(ackBody.body.all).toBe(true);

    // Unread is now 0.
    const probe = await notificationsGET(
      jsonRequest("/api/notifications?count=1", {
        cookies: [`np-mb-session=${author.sessionCookie}`],
      }),
    );
    const probeBody = await readJson<{ unread: number }>(probe);
    expect(probeBody.body.unread).toBe(0);
  });

  it("unauthenticated reactions/follows write attempts are 401", async () => {
    const postId = await seedStaffPostId();
    const author = await seedActiveMember("liam", "liam@example.com");
    const commentId = await postComment(postId, author, "x");

    const react = await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(react.status).toBe(401);

    const f = await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        body: JSON.stringify({ targetType: "member", targetId: author.memberId }),
      }),
    );
    expect(f.status).toBe(401);

    const inbox = await notificationsGET(jsonRequest("/api/notifications"));
    expect(inbox.status).toBe(401);
  });
});
