import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { POST as promotePOST } from "@/app/api/admin/collections/[slug]/[id]/promote/route";
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

import { NextRequest } from "next/server";

import type { NxReputationEvent } from "@nexpress/core";

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

function cookieValue(setCookie: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const password = "password-12345";
  const email = `${handle}@example.com`;
  await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  const db = await getTestDb();
  const { createMemberEmailVerifyToken, nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle))
    .limit(1)) as Array<{ id: string }>;
  const issued = await createMemberEmailVerifyToken(db as never, row.id, 60_000);
  await verifyPOST(
    jsonRequest("/api/members/verify", {
      method: "POST",
      body: JSON.stringify({ token: issued.token }),
    }),
  );
  const login = await loginPOST(
    jsonRequest("/api/members/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );
  const setCookies = login.headers.get("set-cookie");
  return {
    memberId: row.id,
    sessionCookie: cookieValue(setCookies, "nx-mb-session")!,
    csrfCookie: cookieValue(setCookies, "nx-mb-csrf")!,
  };
}

async function registerDiscussionsWithPendingDefault(): Promise<void> {
  const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
  const { registerCollection } = await import("@nexpress/core");
  const { discussionsTable } = await import("@/db/generated/collections");
  const config = defineDiscussionsCollection();
  const community = {
    ...(config.community ?? {}),
    memberWrite: {
      ...(config.community?.memberWrite ?? {}),
      defaultStatus: "pending" as const,
    },
  };
  registerCollection(
    "discussions",
    discussionsTable as never,
    { ...config, community, access: undefined, hooks: undefined },
  );
}

async function seedPendingDoc(member: {
  sessionCookie: string;
  csrfCookie: string;
}, slug: string): Promise<{ id: string }> {
  // Avoid `:` in title — `search_vector` is a tsvector column and
  // postgres parses `:` as a position separator, so a title like
  // "Pending: foo" rejects with a tsvector syntax error before
  // the row even reaches the FK check.
  const create = await collectionPOST(
    memberRequest("/api/collections/discussions", member, {
      method: "POST",
      body: JSON.stringify({
        title: `Pending ${slug}`,
        slug,
        body: { root: { type: "root", children: [] } },
      }),
    }),
    { params: Promise.resolve({ slug: "discussions" }) },
  );
  const body = await readJson<{ id: string; status: string }>(create);
  if (body.status !== 201) {
    throw new Error(`seedPendingDoc failed (${body.status}): ${JSON.stringify(body.body)}`);
  }
  if (body.body.status !== "pending") {
    throw new Error(`expected pending, got ${body.body.status}`);
  }
  return { id: body.body.id };
}

describe.skipIf(skipIfNoTestDb())("promote pending member-authored doc (Phase 9.7d)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // Prime the app bootstrap so its `ensureCollections()` runs
    // here (ahead of any test) — it's idempotent, so subsequent
    // calls during API requests no-op. The point is to register
    // the 3 baseline collections from `nexpressConfig` BEFORE the
    // beforeEach override below, so the override is the LAST
    // registration to land. (`setup-env.ts` ensures both the
    // bootstrap pool and the test pool target `TEST_DATABASE_URL`,
    // so it doesn't matter which pool the API route writes through.)
    const { ensureCoreServices } = await import("@/lib/bootstrap");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
    await registerDiscussionsWithPendingDefault();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetReputationAdapter();
    core.resetSpamAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("staff mod promotes pending → published; row visible on public list", async () => {
    const mod = await seedUser({ role: "moderator" });
    const member = await seedActiveMember("promo-1");
    const { id: docId } = await seedPendingDoc(member, "promo-1-slug");

    const res = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    const body = await readJson<{ status: string; updatedBy: string | null }>(res);
    expect(body.status).toBe(200);
    expect(body.body.status).toBe("published");
    // updatedBy is stamped with the staff user id.
    expect(body.body.updatedBy).toBe(mod.userId);
  });

  it("admin and editor can also promote (staff-mod surface)", async () => {
    const member = await seedActiveMember("promo-roles");

    const admin = await seedUser({ role: "admin", email: "admin@example.com" });
    const { id: id1 } = await seedPendingDoc(member, "promo-admin");
    const r1 = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${id1}/promote`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: id1 }) },
    );
    expect(r1.status).toBe(200);

    const editor = await seedUser({ role: "editor", email: "editor@example.com" });
    const { id: id2 } = await seedPendingDoc(member, "promo-editor");
    const r2 = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${id2}/promote`, editor, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: id2 }) },
    );
    expect(r2.status).toBe(200);
  });

  it("non-mod staff (author role) is forbidden", async () => {
    const author = await seedUser({ role: "author" });
    const member = await seedActiveMember("promo-noaccess");
    const { id: docId } = await seedPendingDoc(member, "promo-noaccess-slug");

    const res = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, author, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(res.status).toBe(403);
  });

  it("unauthenticated request rejected (401)", async () => {
    const member = await seedActiveMember("promo-anon");
    const { id: docId } = await seedPendingDoc(member, "promo-anon-slug");

    const res = await promotePOST(
      buildRequest(`/api/admin/collections/discussions/${docId}/promote`, { method: "POST" }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(res.status).toBe(401);
  });

  it("missing CSRF rejected (401)", async () => {
    const mod = await seedUser({ role: "moderator" });
    const member = await seedActiveMember("promo-csrf");
    const { id: docId } = await seedPendingDoc(member, "promo-csrf-slug");

    // Cookies present, x-csrf-token header absent.
    const req = jsonRequest(`/api/admin/collections/discussions/${docId}/promote`, {
      method: "POST",
      cookies: [`nx-session=${mod.accessToken}`, `nx-csrf=${mod.csrfToken}`],
    });
    const res = await promotePOST(req, {
      params: Promise.resolve({ slug: "discussions", id: docId }),
    });
    expect(res.status).toBe(401);
  });

  it("404 when doc id doesn't exist", async () => {
    const mod = await seedUser({ role: "moderator" });
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${fakeId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: fakeId }) },
    );
    expect(res.status).toBe(404);
  });

  it("400 when doc is already published (idempotence guard)", async () => {
    const mod = await seedUser({ role: "moderator" });
    const member = await seedActiveMember("promo-idemp");
    const { id: docId } = await seedPendingDoc(member, "promo-idemp-slug");

    const first = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(first.status).toBe(200);

    const second = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(second.status).toBe(400);
  });

  it("400 when doc is staff-authored (memberAuthorId is null)", async () => {
    const mod = await seedUser({ role: "moderator" });
    const editor = await seedUser({ role: "editor", email: "editor2@example.com" });

    // Staff create a discussion (lands pending only because we set
    // _status=pending explicitly here for the test scenario).
    const create = await collectionPOST(
      staffRequest("/api/collections/discussions", editor, {
        method: "POST",
        body: JSON.stringify({
          title: "Staff pending",
          slug: "staff-pending",
          body: { root: { type: "root", children: [] } },
          _status: "pending",
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );
    const { id: docId, status, memberAuthorId } = await readJson<{
      id: string;
      status: string;
      memberAuthorId: string | null;
    }>(create).then((r) => r.body);
    expect(status).toBe("pending");
    expect(memberAuthorId).toBeNull();

    const res = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(res.status).toBe(400);
  });

  it("backfills `document.created` reputation for the original author", async () => {
    const core = await import("@nexpress/core");
    const events: NxReputationEvent[] = [];
    core.setReputationAdapter({
      apply: (event) => {
        events.push(event);
        return event.kind === "document.created" ? 5 : 0;
      },
    });

    const mod = await seedUser({ role: "moderator" });
    const member = await seedActiveMember("promo-rep");
    const { id: docId } = await seedPendingDoc(member, "promo-rep-slug");

    // Pending create did NOT credit reputation (9.7c semantic).
    expect(events.filter((e) => e.kind === "document.created")).toHaveLength(0);
    const db = await getTestDb();
    const { nxMembers } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const beforeRow = (await db
      .select({ reputation: nxMembers.reputation })
      .from(nxMembers)
      .where(eq(nxMembers.id, member.memberId))
      .limit(1)) as Array<{ reputation: number }>;
    expect(beforeRow[0].reputation).toBe(0);

    const res = await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );
    expect(res.status).toBe(200);

    // `document.created` fires now, with the original member as the
    // recipient (NOT the promoting staff user).
    const created = events.filter((e) => e.kind === "document.created");
    expect(created).toHaveLength(1);
    if (created[0].kind === "document.created") {
      expect(created[0].memberId).toBe(member.memberId);
      expect(created[0].documentId).toBe(docId);
    }

    const afterRow = (await db
      .select({ reputation: nxMembers.reputation })
      .from(nxMembers)
      .where(eq(nxMembers.id, member.memberId))
      .limit(1)) as Array<{ reputation: number }>;
    expect(afterRow[0].reputation).toBe(5);
  });

  it("records `document.promote` audit event with staff actor + previousStatus", async () => {
    const mod = await seedUser({ role: "moderator" });
    const member = await seedActiveMember("promo-audit");
    const { id: docId } = await seedPendingDoc(member, "promo-audit-slug");

    await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${docId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: docId }) },
    );

    const db = await getTestDb();
    const { nxAuditEvents } = await import("@nexpress/core");
    const { and, eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(nxAuditEvents)
      .where(
        and(
          eq(nxAuditEvents.action, "document.promote"),
          eq(nxAuditEvents.targetId, docId),
        ),
      )) as Array<{
      actorKind: string;
      actorUserId: string | null;
      actorMemberId: string | null;
      targetType: string | null;
      payload: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    expect(audits[0].actorKind).toBe("staff");
    expect(audits[0].actorUserId).toBe(mod.userId);
    expect(audits[0].actorMemberId).toBeNull();
    expect(audits[0].targetType).toBe("discussions");
    expect(audits[0].payload.previousStatus).toBe("pending");
    expect(audits[0].payload.memberAuthorId).toBe(member.memberId);
  });
});
