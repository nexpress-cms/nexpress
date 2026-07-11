import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";
import {
  DELETE as reactionDELETE,
  POST as reactionPOST,
} from "@/app/api/reactions/route";
import { POST as staffHidePOST } from "@/app/api/admin/community/comments/[id]/hide/route";
import { DELETE as staffDeleteDELETE } from "@/app/api/admin/community/comments/[id]/route";

import { NextRequest } from "next/server";

import type { NpReputationEvent } from "@nexpress/core";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
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

async function seedStaffPost(staff: TestUserSession): Promise<string> {
  const create = await collectionPOST(
    staffRequest("/api/collections/posts", staff, {
      method: "POST",
      body: JSON.stringify({
        title: "Reputation target",
        slug: "reputation-target",
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
    }),
    { params: Promise.resolve({ slug: "posts" }) },
  );
  if (create.status !== 201) throw new Error(`post create failed: ${await create.text()}`);
  const body = (await create.json()) as { id: string };
  return body.id;
}

async function readReputation(memberId: string): Promise<number> {
  const db = await getTestDb();
  const { npMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ reputation: npMembers.reputation })
    .from(npMembers)
    .where(eq(npMembers.id, memberId))
    .limit(1)) as Array<{ reputation: number }>;
  if (!row) throw new Error(`member ${memberId} not found`);
  return row.reputation;
}

describe.skipIf(skipIfNoTestDb())("reputation adapter (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetReputationAdapter();
    core.resetSpamAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("default no-op adapter: reputation stays at 0 for visible comment writes", async () => {
    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-anna", "rep-anna@example.com", "password-12");

    expect(await readReputation(author.memberId)).toBe(0);

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "first" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(created.status).toBe(201);
    expect(await readReputation(author.memberId)).toBe(0);
  });

  it("`comment.created` event credits the author with the adapter delta", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        return event.kind === "comment.created" ? 5 : 0;
      },
    });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-bea", "rep-bea@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "credit me" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(created.status).toBe(201);

    expect(events.map((e) => e.kind)).toEqual(["comment.created"]);
    expect(await readReputation(author.memberId)).toBe(5);
  });

  it("flagged (pending) comments do NOT fire `comment.created`", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        return 5;
      },
    });
    core.setSpamAdapter({ check: () => ({ kind: "flag" }) });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-carl", "rep-carl@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "sus" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(created.status).toBe(201);
    core.resetSpamAdapter();

    expect(events).toHaveLength(0);
    expect(await readReputation(author.memberId)).toBe(0);
  });

  it("staff hide fires `comment.hidden` (debit author)", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        if (event.kind === "comment.created") return 5;
        if (event.kind === "comment.hidden") return -10;
        return 0;
      },
    });

    const staff = await seedUser({ role: "moderator" });
    const postId = await seedStaffPost(await seedUser({ role: "editor" }));
    const author = await seedActiveMember("rep-dora", "rep-dora@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "rude" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    expect(await readReputation(author.memberId)).toBe(5);

    const hide = await staffHidePOST(
      staffRequest(`/api/admin/community/comments/${commentId}/hide`, staff, {
        method: "POST",
        body: JSON.stringify({ reason: "rule violation" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(hide.status).toBe(200);

    expect(events.map((e) => e.kind)).toEqual(["comment.created", "comment.hidden"]);
    expect(await readReputation(author.memberId)).toBe(-5);
  });

  it("staff delete fires `comment.deleted`", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        if (event.kind === "comment.created") return 5;
        if (event.kind === "comment.deleted") return -20;
        return 0;
      },
    });

    const staff = await seedUser({ role: "moderator" });
    const postId = await seedStaffPost(await seedUser({ role: "editor" }));
    const author = await seedActiveMember("rep-eve", "rep-eve@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "doomed" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const del = await staffDeleteDELETE(
      staffRequest(`/api/admin/community/comments/${commentId}`, staff, { method: "DELETE" }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(del.status).toBe(200);

    expect(events.map((e) => e.kind)).toEqual(["comment.created", "comment.deleted"]);
    expect(await readReputation(author.memberId)).toBe(-15);
  });

  it("`reaction.received` credits the recipient; self-reactions do not fire", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        if (event.kind === "reaction.received") return 1;
        return 0;
      },
    });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-fan", "rep-fan@example.com", "password-12");
    const reactor = await seedActiveMember("rep-gus", "rep-gus@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "likeable" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const baseRep = await readReputation(author.memberId);

    // Self-react: no event fires.
    const selfRes = await reactionPOST(
      memberRequest("/api/reactions", author, {
        method: "POST",
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(selfRes.status).toBe(201);
    expect(events.filter((e) => e.kind === "reaction.received")).toHaveLength(0);
    expect(await readReputation(author.memberId)).toBe(baseRep);

    // Foreign react: credits author.
    const foreignRes = await reactionPOST(
      memberRequest("/api/reactions", reactor, {
        method: "POST",
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(foreignRes.status).toBe(201);
    expect(events.filter((e) => e.kind === "reaction.received")).toHaveLength(1);
    expect(await readReputation(author.memberId)).toBe(baseRep + 1);
  });

  it("`reaction.removed` is symmetric to `reaction.received`", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        if (event.kind === "reaction.received") return 1;
        if (event.kind === "reaction.removed") return -1;
        return 0;
      },
    });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-han", "rep-han@example.com", "password-12");
    const reactor = await seedActiveMember("rep-ivy", "rep-ivy@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "toggle" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const baseRep = await readReputation(author.memberId);

    await reactionPOST(
      memberRequest("/api/reactions", reactor, {
        method: "POST",
        body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
      }),
    );
    expect(await readReputation(author.memberId)).toBe(baseRep + 1);

    const undo = await reactionDELETE(
      memberRequest(
        `/api/reactions?targetType=comment&targetId=${commentId}&kind=like`,
        reactor,
        { method: "DELETE" },
      ),
    );
    expect(undo.status).toBe(200);

    expect(events.filter((e) => e.kind === "reaction.removed")).toHaveLength(1);
    expect(await readReputation(author.memberId)).toBe(baseRep);
  });

  // Regression: a DELETE on a reaction that never existed (or already
  // got removed by an earlier call) must not emit `reaction.removed`,
  // otherwise a malicious member could spam-DELETE to drain a
  // recipient's reputation without ever having reacted.
  it("no-op `removeReaction` (no row to delete) does NOT fire `reaction.removed`", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        return -100;
      },
    });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-mia", "rep-mia@example.com", "password-12");
    const sneak = await seedActiveMember("rep-ned", "rep-ned@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "phantom" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const baseRep = await readReputation(author.memberId);
    events.length = 0;

    // sneak has never reacted — DELETE is a no-op.
    const undo = await reactionDELETE(
      memberRequest(
        `/api/reactions?targetType=comment&targetId=${commentId}&kind=like`,
        sneak,
        { method: "DELETE" },
      ),
    );
    expect(undo.status).toBe(200);

    expect(events.filter((e) => e.kind === "reaction.removed")).toHaveLength(0);
    expect(await readReputation(author.memberId)).toBe(baseRep);
  });

  // Fail-soft: an adapter that throws (buggy plugin, network outage,
  // etc.) MUST NOT block the underlying community write. Sites that
  // want fail-closed wrap their adapter and return 0 explicitly.
  it("adapter that throws is treated as no-op (fail-soft)", async () => {
    const core = await import("@nexpress/core");
    core.setReputationAdapter({
      apply: () => {
        throw new Error("upstream unavailable");
      },
    });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-jay", "rep-jay@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "still works" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(created.status).toBe(201);
    expect(await readReputation(author.memberId)).toBe(0);
  });

  it("non-finite delta (NaN/Infinity) is skipped, write succeeds", async () => {
    const core = await import("@nexpress/core");
    core.setReputationAdapter({ apply: () => Number.NaN });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-kim", "rep-kim@example.com", "password-12");

    const created = await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "nan delta" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(created.status).toBe(201);
    expect(await readReputation(author.memberId)).toBe(0);
  });

  it("non-integer delta is truncated toward zero", async () => {
    const core = await import("@nexpress/core");
    core.setReputationAdapter({ apply: () => 4.9 });

    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("rep-lee", "rep-lee@example.com", "password-12");

    await commentsPOST(
      memberRequest(`/api/collections/posts/${postId}/comments`, author, {
        method: "POST",
        body: JSON.stringify({ bodyMd: "fractional" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect(await readReputation(author.memberId)).toBe(4);
  });
});
