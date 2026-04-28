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
import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";

import { NextRequest } from "next/server";

function jsonRequest(
  path: string,
  init: RequestInit & { cookies?: string[] } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
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

async function seedStaffPost(): Promise<string> {
  const { hashPassword, nxUsers, signToken } = await import("@nexpress/core");
  const db = await getTestDb();
  const password = await hashPassword("password12345");
  const [user] = (await db
    .insert(nxUsers)
    .values({
      email: "prof-staff@example.com",
      password,
      name: "Staff",
      role: "editor",
    })
    .returning({
      id: nxUsers.id,
      email: nxUsers.email,
      role: nxUsers.role,
      tokenVersion: nxUsers.tokenVersion,
    })) as Array<{
    id: string;
    email: string;
    role: "editor";
    tokenVersion: number;
  }>;
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
        title: "Profanity target",
        slug: "profanity-target",
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

describe.skipIf(skipIfNoTestDb())("profanity adapter (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetProfanityAdapter();
    core.resetSpamAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("default no-op adapter: comment lands as `visible` (existing behavior)", async () => {
    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-anna");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Clean comment" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ id: string; status: string }>(created);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("visible");
  });

  it("`flag` verdict from profanity adapter pushes comment to `pending`", async () => {
    const core = await import("@nexpress/core");
    core.setProfanityAdapter({
      check: () => ({
        kind: "flag",
        reason: "matched profanity list",
        metadata: { matched: ["badword"], severity: "mild" },
      }),
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-bea");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "edgy content" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ id: string; status: string }>(created);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("pending");

    const db = await getTestDb();
    const { nxAuditEvents } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(nxAuditEvents)
      .where(eq(nxAuditEvents.action, "comment.flag"))) as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    const payload = audits[0].payload;
    expect(payload.sources).toEqual(["profanity"]);
    const profanity = payload.profanity as {
      reason: string;
      metadata: Record<string, unknown>;
    };
    expect(profanity.reason).toBe("matched profanity list");
    expect(profanity.metadata).toEqual({ matched: ["badword"], severity: "mild" });
    expect(payload.spam).toBeNull();
  });

  it("`reject` verdict from profanity adapter refuses the comment with 400", async () => {
    const core = await import("@nexpress/core");
    core.setProfanityAdapter({
      check: () => ({
        kind: "reject",
        reason: "Comment contains banned slur",
      }),
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-carl");

    const res = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "anything" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      error?: { details?: Array<{ message?: string }> };
    }>(res);
    const detailMessage = body.body.error?.details?.[0]?.message;
    expect(detailMessage).toContain("slur");
  });

  it("profanity reject short-circuits — spam adapter is not invoked", async () => {
    let spamCalls = 0;
    const core = await import("@nexpress/core");
    core.setProfanityAdapter({
      check: () => ({ kind: "reject", reason: "blocked" }),
    });
    core.setSpamAdapter({
      check: () => {
        spamCalls += 1;
        return { kind: "pass" };
      },
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-dora");

    await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "irrelevant" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(spamCalls).toBe(0);
  });

  it("profanity flag + spam pass → pending; both adapters ran", async () => {
    let spamCalls = 0;
    const core = await import("@nexpress/core");
    core.setProfanityAdapter({
      check: () => ({ kind: "flag", reason: "mild" }),
    });
    core.setSpamAdapter({
      check: () => {
        spamCalls += 1;
        return { kind: "pass" };
      },
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-eric");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "edgy but not spam" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ status: string }>(created);
    expect(body.body.status).toBe("pending");
    expect(spamCalls).toBe(1);
  });

  it("both flag → pending; audit lists both sources", async () => {
    const core = await import("@nexpress/core");
    core.setProfanityAdapter({
      check: () => ({
        kind: "flag",
        reason: "language",
        metadata: { score: 0.4 },
      }),
    });
    core.setSpamAdapter({
      check: () => ({ kind: "flag", reason: "low reputation", metadata: { score: 0.6 } }),
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-flo");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "questionable" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(created.status).toBe(201);

    const db = await getTestDb();
    const { nxAuditEvents } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(nxAuditEvents)
      .where(eq(nxAuditEvents.action, "comment.flag"))) as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    expect(audits[0].payload.sources).toEqual(["profanity", "spam"]);
    expect(audits[0].payload.profanity).not.toBeNull();
    expect(audits[0].payload.spam).not.toBeNull();
  });

  it("adapter that throws is treated as pass (fail-open)", async () => {
    const core = await import("@nexpress/core");
    core.setProfanityAdapter({
      check: () => {
        throw new Error("upstream unavailable");
      },
    });

    const postId = await seedStaffPost();
    const author = await seedActiveMember("prof-gus");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [
          `nx-mb-session=${author.sessionCookie}`,
          `nx-mb-csrf=${author.csrfCookie}`,
        ],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "Genuine comment" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const body = await readJson<{ status: string }>(created);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("visible");
  });
});
