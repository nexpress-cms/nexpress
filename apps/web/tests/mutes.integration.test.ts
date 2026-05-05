import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import {
  POST as commentsPOST,
  GET as commentsGET,
} from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { POST as reactionsPOST } from "@/app/api/reactions/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { GET as mutesGET, POST as mutesPOST } from "@/app/api/members/me/mutes/route";
import { DELETE as muteDELETE } from "@/app/api/members/me/mutes/[targetId]/route";

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
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  // Speedup A — direct-insert harness helper. Skips the
  // register → verify → login endpoint chain (~150ms / call).
  const session = await harnessSeedActiveMember({ handle, email });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
  };
}

async function seedStaffPostId(slug = "9-3-mute-target"): Promise<string> {
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
      cookies: [`nx-session=${token}`, `nx-csrf=${csrf}`],
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({
        title: "16.1 mute target",
        slug,
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
): Promise<string> {
  const res = await commentsPOST(
    jsonRequest(`/api/collections/posts/${postId}/comments`, {
      method: "POST",
      cookies: [
        `nx-mb-session=${authorCookies.sessionCookie}`,
        `nx-mb-csrf=${authorCookies.csrfCookie}`,
      ],
      headers: { "x-csrf-token": authorCookies.csrfCookie },
      body: JSON.stringify({ bodyMd }),
    }),
    { params: Promise.resolve({ slug: "posts", id: postId }) },
  );
  if (res.status !== 201) throw new Error(`postComment failed: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

describe.skipIf(skipIfNoTestDb())("16.1 member mutes (integration)", () => {
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

  it("muted author's comments are filtered for the muter, but visible to anonymous viewers", async () => {
    const postId = await seedStaffPostId("16-1-list");
    const muter = await seedActiveMember("muter1", "muter1@example.com");
    const noisy = await seedActiveMember("noisy1", "noisy1@example.com");
    await postComment(postId, noisy, "spam from noisy");
    await postComment(postId, muter, "from muter");

    // Mute noisy.
    const mute = await mutesPOST(
      jsonRequest("/api/members/me/mutes", {
        method: "POST",
        cookies: [`nx-mb-session=${muter.sessionCookie}`, `nx-mb-csrf=${muter.csrfCookie}`],
        headers: { "x-csrf-token": muter.csrfCookie },
        body: JSON.stringify({ targetId: noisy.memberId }),
      }),
    );
    expect(mute.status).toBe(200);

    // Muter listing — noisy comment hidden.
    const listMuter = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        cookies: [`nx-mb-session=${muter.sessionCookie}`],
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const muterBody = await readJson<{
      comments: Array<{ memberId: string }>;
      totalDocs: number;
    }>(listMuter);
    expect(muterBody.body.totalDocs).toBe(1);
    expect(muterBody.body.comments.map((c) => c.memberId)).toEqual([muter.memberId]);

    // Anonymous viewer — both comments visible.
    const listAnon = await commentsGET(jsonRequest(`/api/collections/posts/${postId}/comments`), {
      params: Promise.resolve({ slug: "posts", id: postId }),
    });
    const anonBody = await readJson<{
      comments: Array<{ memberId: string }>;
      totalDocs: number;
    }>(listAnon);
    expect(anonBody.body.totalDocs).toBe(2);
  });

  it("reaction notifications from a muted member are dropped", async () => {
    const postId = await seedStaffPostId("16-1-notif");
    const author = await seedActiveMember("author1", "author1@example.com");
    const noisy = await seedActiveMember("noisy2", "noisy2@example.com");
    const commentId = await postComment(postId, author, "look at me");

    // Author mutes noisy.
    await mutesPOST(
      jsonRequest("/api/members/me/mutes", {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ targetId: noisy.memberId }),
      }),
    );

    // Noisy reacts to author's comment — notification should be suppressed.
    await reactionsPOST(
      jsonRequest("/api/reactions", {
        method: "POST",
        cookies: [`nx-mb-session=${noisy.sessionCookie}`, `nx-mb-csrf=${noisy.csrfCookie}`],
        headers: { "x-csrf-token": noisy.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );

    const inbox = await notificationsGET(
      jsonRequest("/api/notifications", {
        cookies: [`nx-mb-session=${author.sessionCookie}`],
      }),
    );
    const inboxBody = await readJson<{ unread: number }>(inbox);
    expect(inboxBody.body.unread).toBe(0);
  });

  it("self-mute is rejected with 400", async () => {
    const m = await seedActiveMember("self-mute", "selfmute@example.com");
    const res = await mutesPOST(
      jsonRequest("/api/members/me/mutes", {
        method: "POST",
        cookies: [`nx-mb-session=${m.sessionCookie}`, `nx-mb-csrf=${m.csrfCookie}`],
        headers: { "x-csrf-token": m.csrfCookie },
        body: JSON.stringify({ targetId: m.memberId }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("listMutes and unmute round-trip", async () => {
    const a = await seedActiveMember("muter3", "muter3@example.com");
    const b = await seedActiveMember("target3", "target3@example.com");

    // Mute b.
    await mutesPOST(
      jsonRequest("/api/members/me/mutes", {
        method: "POST",
        cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
        body: JSON.stringify({ targetId: b.memberId }),
      }),
    );

    // List shows b.
    const list = await mutesGET(
      jsonRequest("/api/members/me/mutes", {
        cookies: [`nx-mb-session=${a.sessionCookie}`],
      }),
    );
    const listBody = await readJson<{
      mutes: Array<{ targetId: string; handle: string }>;
    }>(list);
    expect(listBody.body.mutes).toHaveLength(1);
    expect(listBody.body.mutes[0]?.targetId).toBe(b.memberId);
    expect(listBody.body.mutes[0]?.handle).toBe("target3");

    // Unmute.
    const del = await muteDELETE(
      jsonRequest(`/api/members/me/mutes/${b.memberId}`, {
        method: "DELETE",
        cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
      }),
      { params: Promise.resolve({ targetId: b.memberId }) },
    );
    const delBody = await readJson<{ ok: boolean; removed: boolean }>(del);
    expect(delBody.body).toEqual({ ok: true, removed: true });

    // Idempotent — second delete returns removed: false.
    const del2 = await muteDELETE(
      jsonRequest(`/api/members/me/mutes/${b.memberId}`, {
        method: "DELETE",
        cookies: [`nx-mb-session=${a.sessionCookie}`, `nx-mb-csrf=${a.csrfCookie}`],
        headers: { "x-csrf-token": a.csrfCookie },
      }),
      { params: Promise.resolve({ targetId: b.memberId }) },
    );
    const del2Body = await readJson<{ ok: boolean; removed: boolean }>(del2);
    expect(del2Body.body).toEqual({ ok: true, removed: false });

    // List is empty again.
    const list2 = await mutesGET(
      jsonRequest("/api/members/me/mutes", {
        cookies: [`nx-mb-session=${a.sessionCookie}`],
      }),
    );
    const list2Body = await readJson<{ mutes: unknown[] }>(list2);
    expect(list2Body.body.mutes).toHaveLength(0);
  });
});
