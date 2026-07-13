import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

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
import { POST as reactionsPOST } from "@/app/api/reactions/route";
import { POST as followsPOST } from "@/app/api/follows/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { GET as prefsGET, PUT as prefsPUT } from "@/app/api/members/me/notification-prefs/route";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
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
  const user = await seedUser({
    email: `staff-${slug}@example.com`,
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
        title: "prefs target",
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

async function inboxOf(member: { sessionCookie: string }): Promise<{
  unread: number;
  notifications: Array<{ kind: string }>;
}> {
  const list = await notificationsGET(
    jsonRequest("/api/notifications", {
      cookies: [`np-mb-session=${member.sessionCookie}`],
    }),
  );
  const body = await readJson<{
    notifications: Array<{ kind: string }>;
    unread: number;
  }>(list);
  return { unread: body.body.unread, notifications: body.body.notifications };
}

describe.skipIf(skipIfNoTestDb())("16.3 notification preferences (integration)", () => {
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

  it("GET returns empty disabled list and the kind catalog by default", async () => {
    const m = await seedActiveMember("prefs1");
    const res = await prefsGET(
      jsonRequest("/api/members/me/notification-prefs", {
        cookies: [`np-mb-session=${m.sessionCookie}`],
      }),
    );
    const body = await readJson<{
      prefs: { disabled: string[] };
      kinds: Array<{ kind: string; label: string }>;
    }>(res);
    expect(res.status).toBe(200);
    expect(body.body.prefs.disabled).toEqual([]);
    expect(body.body.kinds.length).toBeGreaterThan(0);
    const ks = body.body.kinds.map((k) => k.kind);
    expect(ks).toContain("comment.reply");
    expect(ks).toContain("comment.mention");
    expect(ks).toContain("reaction.received");
    expect(ks).toContain("follow.received");
  });

  it("PUT replaces the deny list and the gate drops disabled kinds", async () => {
    const postId = await seedStaffPostId("16-3-disable-reply");
    const author = await seedActiveMember("prefsauthor");
    const replier = await seedActiveMember("prefsreplier");

    // Author disables `comment.reply`.
    const put = await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ disabled: ["comment.reply"] }),
      }),
    );
    expect(put.status).toBe(200);
    const putBody = await readJson<{ prefs: { disabled: string[] } }>(put);
    expect(putBody.body.prefs.disabled).toEqual(["comment.reply"]);

    // Replier replies to author's comment — author should NOT be notified.
    const parentId = await postComment(postId, author, "first");
    await postComment(postId, replier, "child", parentId);

    const inbox = await inboxOf(author);
    expect(inbox.unread).toBe(0);
  });

  it("disabling `reaction.received` drops reactions but keeps follows", async () => {
    const postId = await seedStaffPostId("16-3-disable-reactions");
    const author = await seedActiveMember("prefsauthor2");
    const reactor = await seedActiveMember("prefsreactor");
    const follower = await seedActiveMember("prefsfollower");

    // Author disables reactions only.
    await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ disabled: ["reaction.received"] }),
      }),
    );

    const commentId = await postComment(postId, author, "look at me");

    // Reactor reacts → no notification (disabled).
    await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [`np-mb-session=${reactor.sessionCookie}`, `np-mb-csrf=${reactor.csrfCookie}`],
        headers: { "x-csrf-token": reactor.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );

    // Follower follows → notification fires.
    await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`np-mb-session=${follower.sessionCookie}`, `np-mb-csrf=${follower.csrfCookie}`],
        headers: { "x-csrf-token": follower.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: author.memberId }),
      }),
    );

    const inbox = await inboxOf(author);
    expect(inbox.unread).toBe(1);
    expect(inbox.notifications[0]?.kind).toBe("follow.received");
  });

  it("PUT rejects unknown kinds with 400", async () => {
    const m = await seedActiveMember("prefsbad");
    const res = await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`np-mb-session=${m.sessionCookie}`, `np-mb-csrf=${m.csrfCookie}`],
        headers: { "x-csrf-token": m.csrfCookie },
        body: JSON.stringify({ disabled: ["definitely.not.a.kind"] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // CSRF enforcement moved to apps/web/src/proxy.ts (#281); the
  // handler-level unit test no longer covers the missing-CSRF
  // case since direct handler invocation bypasses the proxy.

  it("PUT preserves unrelated keys in notification_prefs JSONB (forward compat for digest in 16.4)", async () => {
    const m = await seedActiveMember("prefsmerge");
    // Seed an unrelated key directly in DB.
    const db = await getTestDb();
    const { npMembers } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    await db
      .update(npMembers)
      .set({ notificationPrefs: { digest: "weekly", custom: { foo: "bar" } } })
      .where(eq(npMembers.id, m.memberId));

    // PUT updates only `disabled`; other keys must survive.
    await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`np-mb-session=${m.sessionCookie}`, `np-mb-csrf=${m.csrfCookie}`],
        headers: { "x-csrf-token": m.csrfCookie },
        body: JSON.stringify({ disabled: ["follow.received"] }),
      }),
    );

    const [row] = (await db
      .select({ prefs: npMembers.notificationPrefs })
      .from(npMembers)
      .where(eq(npMembers.id, m.memberId))) as Array<{ prefs: Record<string, unknown> }>;
    expect(row.prefs.digest).toBe("weekly");
    expect((row.prefs.custom as Record<string, unknown>).foo).toBe("bar");
    expect(row.prefs.disabled).toEqual(["follow.received"]);
  });
});
