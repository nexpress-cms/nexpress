import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import {
  GET as commentsGET,
  POST as commentsPOST,
} from "@/app/api/collections/[slug]/[id]/comments/route";
import { PATCH as commentPATCH } from "@/app/api/comments/[id]/route";

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
  _password: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const session = await harnessSeedActiveMember({ handle, email });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
  };
}

async function seedStaffPost(): Promise<string> {
  const { hashPassword, npUsers, signToken } = await import("@nexpress/core");
  const db = await getTestDb();
  const password = await hashPassword("password12345");
  const [user] = (await db
    .insert(npUsers)
    .values({ email: "spam-staff@example.com", password, name: "Staff", role: "editor" })
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
        title: "Spam target",
        slug: "spam-target",
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

describe.skipIf(skipIfNoTestDb())("spam adapter (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetSpamAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("default no-op adapter: comments land as `visible` (existing behavior)", async () => {
    const postId = await seedStaffPost();
    const author = await seedActiveMember("anna", "anna@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Genuine comment" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ id: string; status: string }>(created);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("visible");
  });

  it("`flag` verdict: comment lands as `pending`, hidden from default list", async () => {
    const core = await import("@nexpress/core");
    core.setSpamAdapter({
      check: () => ({ kind: "flag", reason: "low reputation", metadata: { score: 0.7 } }),
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("bea", "bea@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Suspicious content" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ id: string; status: string }>(created);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("pending");

    // Public list filters to status=visible — pending row hidden.
    const list = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const listBody = await readJson<{ totalDocs: number }>(list);
    expect(listBody.body.totalDocs).toBe(0);

    // Audit log captured the flag with adapter metadata.
    const db = await getTestDb();
    const { npAuditEvents } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "comment.flag"))) as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    const payload = audits[0].payload;
    // Combined spam+profanity audit shape (Phase 9.7n): `sources`
    // tells mods which adapter(s) flagged, `spam` carries the
    // verdict reason+metadata, `profanity` is null when only spam
    // flagged.
    expect(payload.sources).toEqual(["spam"]);
    const spamPayload = payload.spam as { reason: string; metadata: Record<string, unknown> };
    expect(spamPayload.reason).toBe("low reputation");
    expect(spamPayload.metadata).toEqual({ score: 0.7 });
    expect(payload.profanity).toBeNull();
  });

  it("`reject` verdict: comment write refused with 400, no row written", async () => {
    const core = await import("@nexpress/core");
    core.setSpamAdapter({
      check: () => ({ kind: "reject", reason: "Detected as spam by Akismet" }),
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("carl", "carl@example.com", "password-12");

    const res = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Buy cheap pills here" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ error?: { message?: string; details?: Array<{ message?: string }> } }>(
      res,
    );
    const detailMessage = body.body.error?.details?.[0]?.message;
    expect(detailMessage).toContain("Akismet");

    // No row inserted.
    const list = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments?includeHidden=1`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const listBody = await readJson<{ totalDocs: number }>(list);
    expect(listBody.body.totalDocs).toBe(0);
  });

  // Fail-open: an adapter that throws (Akismet 5xx, OpenAI timeout,
  // etc.) must not block legitimate comment writes. Sites that want
  // fail-closed wrap their adapter in try/catch and return `reject`.
  it("adapter that throws is treated as pass (fail-open)", async () => {
    const core = await import("@nexpress/core");
    core.setSpamAdapter({
      check: () => {
        throw new Error("upstream unavailable");
      },
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("flo", "flo@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Genuine comment" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ id: string; status: string }>(created);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("visible");
  });

  it("`flag` verdict skips parent reply notification (avoids leaking pending content)", async () => {
    const postId = await seedStaffPost();
    const parentAuthor = await seedActiveMember("dora", "dora@example.com", "password-12");

    // Parent comment: written under default no-op adapter.
    const parent = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${parentAuthor.sessionCookie}`,
          `nx-mb-csrf=${parentAuthor.csrfCookie}`,
        ],
        headers: { "x-csrf-token": parentAuthor.csrfCookie },
        body: JSON.stringify({ bodyMd: "parent" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: parentId } = await readJson<{ id: string }>(parent).then((r) => r.body);

    const replier = await seedActiveMember("eric", "eric@example.com", "password-12");

    // Now flip to flag and post a reply.
    const core = await import("@nexpress/core");
    core.setSpamAdapter({ check: () => ({ kind: "flag" }) });

    await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${replier.sessionCookie}`,
          `nx-mb-csrf=${replier.csrfCookie}`,
        ],
        headers: { "x-csrf-token": replier.csrfCookie },
        body: JSON.stringify({ bodyMd: "reply", parentId }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );

    // dora (parent author) should NOT have a notification — the
    // pending reply is invisible to her until a mod restores it.
    const db = await getTestDb();
    const { npNotifications } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const inbox = (await db
      .select()
      .from(npNotifications)
      .where(eq(npNotifications.memberId, parentAuthor.memberId))) as Array<unknown>;
    expect(inbox).toHaveLength(0);
  });

  // Issue #123 — `updateComment` skipped moderation entirely.
  // Member could land a clean visible comment then PATCH to spam
  // / banned language and the row stayed visible. Now the edit
  // path runs the same profanity → spam chain.
  it("clean create then flagged edit demotes the comment to pending (#123)", async () => {
    const core = await import("@nexpress/core");
    core.setSpamAdapter({ check: () => ({ kind: "pass" }) });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("edit-flag", "edit-flag@example.com", "password-12");
    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Clean original" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId, status: createdStatus } = await readJson<{
      id: string;
      status: string;
    }>(created).then((r) => r.body);
    expect(createdStatus).toBe("visible");

    core.setSpamAdapter({
      check: () => ({ kind: "flag", reason: "low rep" }),
    });

    const patch = await commentPATCH(
      new NextRequest(`http://localhost:3000/api/comments/${commentId}`, {
        method: "PATCH",
        headers: {
          cookie: `nx-mb-session=${author.sessionCookie}; nx-mb-csrf=${author.csrfCookie}`,
          "x-csrf-token": author.csrfCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ bodyMd: "Now flagged content" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(patch.status).toBe(200);
    const patched = await readJson<{ status: string }>(patch);
    expect(patched.body.status).toBe("pending");

    // Audit row carries `event: "update"` so mods scanning
    // `comment.flag` rows can tell create-flags from edit-flags.
    const db = await getTestDb();
    const { npAuditEvents } = await import("@nexpress/core");
    const { and, eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.action, "comment.flag"),
          eq(npAuditEvents.targetId, commentId),
        ),
      )) as Array<{ payload: Record<string, unknown> }>;
    expect(audits).toHaveLength(1);
    expect(audits[0].payload.event).toBe("update");
    expect(audits[0].payload.sources).toEqual(["spam"]);
  });

  it("comment edit reject verdict refuses the patch (#123)", async () => {
    const core = await import("@nexpress/core");
    core.setSpamAdapter({ check: () => ({ kind: "pass" }) });

    const postId = await seedStaffPost();
    const author = await seedActiveMember(
      "edit-reject",
      "edit-reject@example.com",
      "password-12",
    );
    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Clean" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then(
      (r) => r.body,
    );

    core.setSpamAdapter({
      check: () => ({ kind: "reject", reason: "Detected as spam" }),
    });

    const patch = await commentPATCH(
      new NextRequest(`http://localhost:3000/api/comments/${commentId}`, {
        method: "PATCH",
        headers: {
          cookie: `nx-mb-session=${author.sessionCookie}; nx-mb-csrf=${author.csrfCookie}`,
          "x-csrf-token": author.csrfCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ bodyMd: "Spam edit" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(patch.status).toBe(400);

    // Body wasn't updated — the reject throws before the UPDATE runs.
    const db = await getTestDb();
    const { npComments } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [row] = (await db
      .select({ bodyMd: npComments.bodyMd, status: npComments.status })
      .from(npComments)
      .where(eq(npComments.id, commentId))
      .limit(1)) as Array<{ bodyMd: string; status: string }>;
    expect(row.bodyMd).toBe("Clean");
    expect(row.status).toBe("visible");
  });
});
