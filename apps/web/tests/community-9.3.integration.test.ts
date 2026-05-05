import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  const { hashPassword, npUsers, signToken } = await import("@nexpress/core");
  const db = await getTestDb();
  const password = await hashPassword("password12345");
  const [user] = (await db
    .insert(npUsers)
    .values({ email: "staff@example.com", password, name: "Staff", role: "editor" })
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
      cookies: [`nx-session=${token}`, `nx-csrf=${csrf}`],
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({
        title: "9.3 target",
        slug: "9-3-target",
        content: { root: { type: "root", children: [] } },
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
        `nx-mb-session=${authorCookies.sessionCookie}`,
        `nx-mb-csrf=${authorCookies.csrfCookie}`,
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
        cookies: [
          `nx-mb-session=${reactor.sessionCookie}`,
          `nx-mb-csrf=${reactor.csrfCookie}`,
        ],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(add.status).toBe(201);

    // Idempotent — same reactor + same kind returns 201 and the same row id.
    const dup = await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [
          `nx-mb-session=${reactor.sessionCookie}`,
          `nx-mb-csrf=${reactor.csrfCookie}`,
        ],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(dup.status).toBe(201);

    const summary = await reactionsGET(
      jsonRequest(
        `/api/reactions?targetType=comment&targetId=${commentId}`,
      ),
    );
    const sumBody = await readJson<{ counts: Record<string, number>; mine: string[] }>(summary);
    expect(sumBody.body.counts.like).toBe(1);
    expect(sumBody.body.mine).toEqual([]); // reader is anonymous

    const remove = await reactionsDELETE(
      jsonRequest(
        `/api/reactions?targetType=comment&targetId=${commentId}&kind=like`,
        {
          method: "DELETE",
          cookies: [
            `nx-mb-session=${reactor.sessionCookie}`,
            `nx-mb-csrf=${reactor.csrfCookie}`,
          ],
          headers: { "x-csrf-token": reactor.csrfCookie },
        },
      ),
    );
    expect(remove.status).toBe(200);

    const summaryAfter = await reactionsGET(
      jsonRequest(`/api/reactions?targetType=comment&targetId=${commentId}`),
    );
    const after = await readJson<{ counts: Record<string, number> }>(summaryAfter);
    expect(after.body.counts.like ?? 0).toBe(0);
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
        cookies: [
          `nx-mb-session=${reactor.sessionCookie}`,
          `nx-mb-csrf=${reactor.csrfCookie}`,
        ],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );

    const list = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`nx-mb-session=${author.sessionCookie}`],
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
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    const list2 = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`nx-mb-session=${author.sessionCookie}`],
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
        cookies: [`nx-mb-session=${author.sessionCookie}`],
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

  it("follow + unfollow + isFollowing + notification", async () => {
    const a = await seedActiveMember("gail", "gail@example.com");
    const b = await seedActiveMember("hank", "hank@example.com");

    const f = await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: b.memberId }),
      }),
    );
    expect(f.status).toBe(201);

    // b should have a follow.received notification.
    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`nx-mb-session=${b.sessionCookie}`],
      }),
    );
    const inboxBody = await readJson<{ unread: number }>(inbox);
    expect(inboxBody.body.unread).toBe(1);

    // List a's follows.
    const list = await followsGET(
      jsonRequest("/api/follows?targetType=member", {
        cookies: [`nx-mb-session=${a.sessionCookie}`],
      }),
    );
    const listBody = await readJson<{ follows: Array<{ targetId: string }> }>(list);
    expect(listBody.body.follows.map((r) => r.targetId)).toContain(b.memberId);

    const un = await followsDELETE(
      jsonRequest(`/api/follows?targetType=member&targetId=${b.memberId}`, {
        method: "DELETE",
        cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
      }),
    );
    expect(un.status).toBe(200);

    const after = await followsGET(
      jsonRequest("/api/follows", { cookies: [`nx-mb-session=${a.sessionCookie}`] }),
    );
    const afterBody = await readJson<{ follows: unknown[] }>(after);
    expect(afterBody.body.follows).toHaveLength(0);
  });

  it("/api/follows/check returns boolean for the current viewer's follow state", async () => {
    const viewer = await seedActiveMember("vic", "vic@example.com");
    const target = await seedActiveMember("tina", "tina@example.com");

    // Initially not following.
    const before = await followsCheckGET(
      jsonRequest(
        `/api/follows/check?targetType=member&targetId=${target.memberId}`,
        { cookies: [`nx-mb-session=${viewer.sessionCookie}`] },
      ),
    );
    const beforeBody = await readJson<{ following: boolean }>(before);
    expect(before.status).toBe(200);
    expect(beforeBody.body.following).toBe(false);

    await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`nx-mb-session=${viewer.sessionCookie}`, `nx-mb-csrf=${viewer.csrfCookie}`],
        headers: { "x-csrf-token": viewer.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: target.memberId }),
      }),
    );

    const after = await followsCheckGET(
      jsonRequest(
        `/api/follows/check?targetType=member&targetId=${target.memberId}`,
        { cookies: [`nx-mb-session=${viewer.sessionCookie}`] },
      ),
    );
    const afterBody = await readJson<{ following: boolean }>(after);
    expect(afterBody.body.following).toBe(true);
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
          cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
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
        and(
          eq(npFollows.followerId, a.memberId),
          eq(npFollows.targetId, b.memberId),
        ),
      )) as Array<unknown>;
    expect(rows).toHaveLength(1);

    // And only ONE follow.received notification — the conflict
    // path doesn't re-fire it.
    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`nx-mb-session=${b.sessionCookie}`],
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
        cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
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
          cookies: [
            `nx-mb-session=${reactor.sessionCookie}`,
            `nx-mb-csrf=${reactor.csrfCookie}`,
          ],
          headers: { "x-csrf-token": reactor.csrfCookie },
          body: JSON.stringify({ targetType: "comment", targetId: id, kind: "like" }),
        }),
      );
    }

    // Mark all read.
    const ack = await markReadPOST(
      jsonRequest("/api/notifications/mark-read", {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
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
        cookies: [`nx-mb-session=${author.sessionCookie}`],
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
