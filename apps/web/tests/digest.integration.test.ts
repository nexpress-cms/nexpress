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

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as followsPOST } from "@/app/api/follows/route";
import { PUT as prefsPUT } from "@/app/api/members/me/notification-prefs/route";

import type { NxEmailAdapter, NxEmailMessage } from "@nexpress/core";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

async function seedActiveMember(
  handle: string,
): Promise<{
  memberId: string;
  email: string;
  sessionCookie: string;
  csrfCookie: string;
  handle: string;
}> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    memberId: session.memberId,
    email: session.email,
    handle: session.handle,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
  };
}

async function seedStaffPostId(slug: string): Promise<string> {
  const { hashPassword, nxUsers, signToken } = await import("@nexpress/core");
  const db = await getTestDb();
  const password = await hashPassword("password12345");
  const [user] = (await db
    .insert(nxUsers)
    .values({ email: `staff-${slug}@example.com`, password, name: "Staff", role: "editor" })
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
        title: "digest target",
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
  author: { sessionCookie: string; csrfCookie: string },
  bodyMd: string,
  parentId?: string,
): Promise<string> {
  const res = await commentsPOST(
    jsonRequest(`/api/collections/posts/${postId}/comments`, {
      method: "POST",
      cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
      headers: { "x-csrf-token": author.csrfCookie },
      body: JSON.stringify(parentId ? { bodyMd, parentId } : { bodyMd }),
    }),
    { params: Promise.resolve({ slug: "posts", id: postId }) },
  );
  if (res.status !== 201) throw new Error(`postComment failed: ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

class CapturingEmailAdapter implements NxEmailAdapter {
  readonly kind = "capturing";
  readonly sent: NxEmailMessage[] = [];
  send(message: NxEmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe.skipIf(skipIfNoTestDb())("16.4 email digest (integration)", () => {
  let originalAdapter: NxEmailAdapter | null = null;
  let capture: CapturingEmailAdapter;

  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const core = await import("@nexpress/core");
    originalAdapter = core.getEmailAdapter();
  });
  beforeEach(async () => {
    await truncateAll();
    capture = new CapturingEmailAdapter();
    const { setEmailAdapter } = await import("@nexpress/core");
    setEmailAdapter(capture);
  });
  afterEach(async () => {
    if (originalAdapter) {
      const { setEmailAdapter } = await import("@nexpress/core");
      setEmailAdapter(originalAdapter);
    }
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("PUT accepts digest=daily and persists it", async () => {
    const m = await seedActiveMember("digest1");
    const res = await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`nx-mb-session=${m.sessionCookie}`, `nx-mb-csrf=${m.csrfCookie}`],
        headers: { "x-csrf-token": m.csrfCookie },
        body: JSON.stringify({ digest: "daily" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ prefs: { digest: string } }>(res);
    expect(body.body.prefs.digest).toBe("daily");
  });

  it("PUT rejects unknown digest value with 400", async () => {
    const m = await seedActiveMember("digest2");
    const res = await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`nx-mb-session=${m.sessionCookie}`, `nx-mb-csrf=${m.csrfCookie}`],
        headers: { "x-csrf-token": m.csrfCookie },
        body: JSON.stringify({ digest: "monthly" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("runDigestSweep('daily') emails opted-in member with unread notifications", async () => {
    const postId = await seedStaffPostId("16-4-daily-flow");
    const author = await seedActiveMember("digestauthor");
    const replier = await seedActiveMember("digestreplier");

    // Author opts into daily digest.
    await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ digest: "daily" }),
      }),
    );

    // Replier replies → unread notification fires.
    const parentId = await postComment(postId, author, "first");
    await postComment(postId, replier, "reply", parentId);

    const { runDigestSweep } = await import("@nexpress/core");
    const result = await runDigestSweep({ cadence: "daily", siteName: "TestSite" });
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    expect(capture.sent).toHaveLength(1);
    expect(capture.sent[0].to).toBe(author.email);
    expect(capture.sent[0].subject).toContain("daily digest");
    expect(capture.sent[0].subject).toContain("TestSite");
    expect(capture.sent[0].text).toContain("@digestauthor");
    expect(capture.sent[0].html).toContain("New reply");
  });

  it("members with digest=off are skipped", async () => {
    const postId = await seedStaffPostId("16-4-off-skip");
    const author = await seedActiveMember("digestoff");
    const replier = await seedActiveMember("digestoffreplier");
    const parentId = await postComment(postId, author, "first");
    await postComment(postId, replier, "reply", parentId);

    const { runDigestSweep } = await import("@nexpress/core");
    const result = await runDigestSweep({ cadence: "daily" });
    expect(result.considered).toBe(0);
    expect(result.sent).toBe(0);
    expect(capture.sent).toHaveLength(0);
  });

  it("members with no unread notifications are skipped (no empty digest emails)", async () => {
    const m = await seedActiveMember("digestempty");
    await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`nx-mb-session=${m.sessionCookie}`, `nx-mb-csrf=${m.csrfCookie}`],
        headers: { "x-csrf-token": m.csrfCookie },
        body: JSON.stringify({ digest: "daily" }),
      }),
    );
    const { runDigestSweep } = await import("@nexpress/core");
    const result = await runDigestSweep({ cadence: "daily" });
    expect(result.considered).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(capture.sent).toHaveLength(0);
  });

  it("runDigestSweep stamps lastDigestAt; second sweep doesn't re-send same window", async () => {
    const author = await seedActiveMember("digestlast");
    const follower = await seedActiveMember("digestlastfollower");

    await prefsPUT(
      jsonRequest("/api/members/me/notification-prefs", {
        method: "PUT",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ digest: "daily" }),
      }),
    );

    // Follower follows → unread notification fires.
    await followsPOST(
      jsonRequest("/api/follows", {
        method: "POST",
        cookies: [`nx-mb-session=${follower.sessionCookie}`, `nx-mb-csrf=${follower.csrfCookie}`],
        headers: { "x-csrf-token": follower.csrfCookie },
        body: JSON.stringify({ targetType: "member", targetId: author.memberId }),
      }),
    );

    const { runDigestSweep } = await import("@nexpress/core");
    const result1 = await runDigestSweep({ cadence: "daily" });
    expect(result1.sent).toBe(1);

    // Verify lastDigestAt was written.
    const db = await getTestDb();
    const { nxMembers } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [row] = (await db
      .select({ prefs: nxMembers.notificationPrefs })
      .from(nxMembers)
      .where(eq(nxMembers.id, author.memberId))) as Array<{ prefs: Record<string, unknown> }>;
    expect(typeof row.prefs.lastDigestAt).toBe("string");

    // Second sweep with the same data → no new send (notification was unread but
    // arrived BEFORE lastDigestAt; the window predicate excludes it).
    capture.sent.length = 0;
    const result2 = await runDigestSweep({ cadence: "daily" });
    expect(result2.sent).toBe(0);
    expect(result2.skipped).toBe(1);
    expect(capture.sent).toHaveLength(0);
  });

  it("buildDigestEmail renders subject + plain text + html for one notification", async () => {
    const { buildDigestEmail } = await import("@nexpress/core");
    const out = buildDigestEmail({
      member: { displayName: "Alice", handle: "alice" },
      notifications: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          kind: "comment.reply",
          payload: {},
          createdAt: new Date("2026-04-28T10:00:00Z"),
        },
      ],
      cadence: "daily",
      siteName: "TestSite",
    });
    expect(out.subject).toBe("Your daily digest from TestSite: 1 notification");
    expect(out.text).toContain("@alice");
    expect(out.text).toContain("New reply on your comment");
    expect(out.html).toContain("<strong>New reply on your comment</strong>");
  });
});
