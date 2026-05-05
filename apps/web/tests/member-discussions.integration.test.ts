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

import {
  GET as collectionGET,
  POST as collectionPOST,
} from "@/app/api/collections/[slug]/route";

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
    cookies: [`nx-session=${user.accessToken}`, `nx-csrf=${user.csrfToken}`],
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
    cookies: [`nx-mb-session=${member.sessionCookie}`, `nx-mb-csrf=${member.csrfCookie}`],
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

describe.skipIf(skipIfNoTestDb())("member-write discussions (Phase 9.7a)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // Register the discussions collection just like forum.integration
    // does — but KEEP the `community.memberWrite` block so the
    // member-write path is actually exercised. We strip only `access`
    // (so synthetic test principals can write) and `hooks`.
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const config = defineDiscussionsCollection();
    registerCollection(
      "discussions",
      discussionsTable as never,
      { ...config, access: undefined, hooks: undefined },
    );
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

  it("active member creates a discussion; row is published", async () => {
    const member = await seedActiveMember("alice");
    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "First member-authored thread",
          slug: "first-member-thread",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const body = await readJson<{ id: string; status: string; title: string; createdBy: string | null }>(
      create,
    );
    expect(body.status).toBe(201);
    expect(body.body.title).toBe("First member-authored thread");
    expect(body.body.status).toBe("published");
    // `createdBy` references np_users — for a member-authored doc it
    // must be null (audit log carries the actual member id).
    expect(body.body.createdBy).toBeNull();

    // Listing returns it for everyone (read access is open).
    const list = await collectionGET(
      jsonRequest("/api/collections/discussions"),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const listBody = await readJson<{ totalDocs: number; docs: Array<{ id: string }> }>(list);
    expect(listBody.body.totalDocs).toBe(1);
  });

  it("revision row is created with authorId=null", async () => {
    const member = await seedActiveMember("revauthor");
    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Has revision",
          slug: "has-revision",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId } = await readJson<{ id: string }>(create).then((r) => r.body);

    const db = await getTestDb();
    const { npRevisions } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const revs = (await db
      .select()
      .from(npRevisions)
      .where(eq(npRevisions.documentId, docId))) as Array<{
      authorId: string | null;
      version: number;
      status: string;
    }>;
    expect(revs).toHaveLength(1);
    expect(revs[0].authorId).toBeNull();
    expect(revs[0].version).toBe(1);
    expect(revs[0].status).toBe("published");
  });

  it("fires `document.created` reputation event with collection slug + member id", async () => {
    const core = await import("@nexpress/core");
    const events: NpReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        return event.kind === "document.created" ? 10 : 0;
      },
    });

    const member = await seedActiveMember("repmember");
    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Reputation thread",
          slug: "rep-thread",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId } = await readJson<{ id: string }>(create).then((r) => r.body);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("document.created");
    if (events[0].kind === "document.created") {
      expect(events[0].collectionSlug).toBe("discussions");
      expect(events[0].documentId).toBe(docId);
      expect(events[0].memberId).toBe(member.memberId);
    }

    // Reputation row was bumped.
    const db = await getTestDb();
    const { npMembers } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [row] = (await db
      .select({ reputation: npMembers.reputation })
      .from(npMembers)
      .where(eq(npMembers.id, member.memberId))
      .limit(1)) as Array<{ reputation: number }>;
    expect(row.reputation).toBe(10);
  });

  it("collection without `community.memberWrite.create` rejects member writes with 403", async () => {
    // `posts` doesn't opt in.
    const member = await seedActiveMember("postwriter");
    const create = await collectionPOST(
      memberRequest("/api/collections/posts", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Should not work",
          slug: "no-go",
          content: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "posts" }) },
    );
    expect(create.status).toBe(403);
  });

  it("banned member is rejected with 403 even on opt-in collection", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("banned");

    // Issue a permanent site-wide ban.
    const { issueBan } = await import("@nexpress/core");
    await issueBan({
      memberId: member.memberId,
      scopeType: "site",
      kind: "permanent",
      reason: "test",
      actor: {
        kind: "staff",
        user: {
          id: admin.userId,
          email: admin.email,
          name: null,
          role: admin.role,
          tokenVersion: 0,
        },
      },
    });

    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Should fail",
          slug: "banned-attempt",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    expect(create.status).toBe(403);

    // No row inserted.
    const db = await getTestDb();
    const { getCollectionTable } = await import("@nexpress/core");
    const table = getCollectionTable("discussions") as never;
    const rows = (await db.select().from(table)) as Array<unknown>;
    expect(rows).toHaveLength(0);
  });

  it("unauthenticated request rejected (no staff or member session)", async () => {
    const create = await collectionPOST(
      jsonRequest("/api/collections/discussions", {
        method: "POST",
        body: JSON.stringify({
          title: "Anon",
          slug: "anon",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    expect(create.status).toBe(401);
  });

  // CSRF enforcement moved to apps/web/src/proxy.ts (#281); the
  // handler unit test no longer covers the missing-header case
  // because invoking the handler directly bypasses the proxy.

  // Regression: a member can't sneak `_status: "draft"` or
  // `"archived"` into the body to bypass public-list filtering.
  // createMemberDocument forces status=published.
  it("member-supplied `_status` is overridden to `published`", async () => {
    const member = await seedActiveMember("statussneak");
    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Draft attempt",
          slug: "draft-attempt",
          body: { root: { type: "root", children: [] } },
          _status: "draft",
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const body = await readJson<{ status: string }>(create);
    expect(body.status).toBe(201);
    expect(body.body.status).toBe("published");
  });

  it("audit log records `document.create` with member actor + collection target", async () => {
    const member = await seedActiveMember("auditme");
    const create = await collectionPOST(
      memberRequest("/api/collections/discussions", member, {
        method: "POST",
        body: JSON.stringify({
          title: "Audited",
          slug: "audited",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId } = await readJson<{ id: string }>(create).then((r) => r.body);

    const db = await getTestDb();
    const { npAuditEvents } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "document.create"))) as Array<{
      actorKind: string;
      actorMemberId: string | null;
      actorUserId: string | null;
      targetType: string | null;
      targetId: string | null;
      payload: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    expect(audits[0].actorKind).toBe("member");
    expect(audits[0].actorMemberId).toBe(member.memberId);
    expect(audits[0].actorUserId).toBeNull();
    expect(audits[0].targetType).toBe("discussions");
    expect(audits[0].targetId).toBe(docId);
    expect(audits[0].payload.collectionSlug).toBe("discussions");
  });

  it("staff path still works on the same endpoint when both auths absent", async () => {
    const staff = await seedUser({ role: "editor" });
    const create = await collectionPOST(
      staffRequest("/api/collections/discussions", staff, {
        method: "POST",
        body: JSON.stringify({
          title: "Staff thread",
          slug: "staff-thread",
          body: { root: { type: "root", children: [] } },
          _status: "published",
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    expect(create.status).toBe(201);
    const body = await readJson<{ createdBy: string | null }>(create);
    // Staff path stamps createdBy with their user id.
    expect(body.body.createdBy).toBe(staff.userId);
  });
});
