import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
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
import { GET as pendingGET } from "@/app/api/admin/collections/pending/route";

import { NextRequest } from "next/server";

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
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
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
}, slug: string, title: string): Promise<{ id: string }> {
  // Note: avoid `:` in title — search_vector is tsvector and `:` is
  // a position separator that breaks the parser.
  const create = await collectionPOST(
    memberRequest("/api/collections/discussions", member, {
      method: "POST",
      body: JSON.stringify({
        title,
        slug,
        body: npCreateEmptyRichTextContent(),
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

describe.skipIf(skipIfNoTestDb())("admin pending queue (Phase 9.7e)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // Prime app bootstrap so the beforeEach override of
    // `defaultStatus="pending"` lands AFTER the baseline registration.
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
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

  it("staff mod sees pending docs with member-author info", async () => {
    const mod = await seedUser({ role: "moderator" });
    const a = await seedActiveMember("queue-a");
    const b = await seedActiveMember("queue-b");

    await seedPendingDoc(a, "queue-1", "First pending");
    await seedPendingDoc(b, "queue-2", "Second pending");

    const res = await pendingGET(
      staffRequest("/api/admin/collections/pending", mod),
    );
    const body = await readJson<{
      docs: Array<{
        id: string;
        collectionSlug: string;
        title: string;
        memberAuthor: { id: string; handle: string; displayName: string } | null;
      }>;
      totalDocs: number;
    }>(res);
    expect(body.status).toBe(200);
    expect(body.body.totalDocs).toBe(2);

    const handles = body.body.docs.map((d) => d.memberAuthor?.handle).sort();
    expect(handles).toEqual(["queue-a", "queue-b"]);
    expect(body.body.docs[0].collectionSlug).toBe("discussions");
    expect(body.body.docs[0].memberAuthor?.displayName).toBeDefined();
  });

  it("admin and editor can also list (staff-mod surface)", async () => {
    const a = await seedActiveMember("rbac-a");
    await seedPendingDoc(a, "rbac-1", "Awaits");

    const admin = await seedUser({ role: "admin", email: "admin@example.com" });
    const r1 = await pendingGET(staffRequest("/api/admin/collections/pending", admin));
    expect(r1.status).toBe(200);

    const editor = await seedUser({ role: "editor", email: "editor@example.com" });
    const r2 = await pendingGET(staffRequest("/api/admin/collections/pending", editor));
    expect(r2.status).toBe(200);
  });

  it("non-mod staff (author role) is forbidden", async () => {
    const author = await seedUser({ role: "author" });
    const res = await pendingGET(staffRequest("/api/admin/collections/pending", author));
    expect(res.status).toBe(403);
  });

  it("unauthenticated request rejected (401)", async () => {
    const res = await pendingGET(buildRequest("/api/admin/collections/pending"));
    expect(res.status).toBe(401);
  });

  it("excludes published rows (only pending shown)", async () => {
    const mod = await seedUser({ role: "moderator" });
    const a = await seedActiveMember("excl-a");
    const { id: pendingDocId } = await seedPendingDoc(a, "excl-1", "Pending row");

    // Promote one of them so it leaves pending. (Use the staff promote
    // endpoint via the existing helper to ensure parity with how the
    // queue is drained in production.)
    const { POST: promotePOST } = await import(
      "@/app/api/admin/collections/[slug]/[id]/promote/route"
    );
    await promotePOST(
      staffRequest(`/api/admin/collections/discussions/${pendingDocId}/promote`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "discussions", id: pendingDocId }) },
    );

    // Add another pending doc so the list isn't empty.
    await seedPendingDoc(a, "excl-2", "Still pending");

    const res = await pendingGET(staffRequest("/api/admin/collections/pending", mod));
    const body = await readJson<{ docs: Array<{ id: string }>; totalDocs: number }>(res);
    expect(body.body.totalDocs).toBe(1);
    expect(body.body.docs[0].id).not.toBe(pendingDocId);
  });

  it("excludes staff-authored pending rows (no memberAuthorId)", async () => {
    const mod = await seedUser({ role: "moderator" });
    const editor = await seedUser({ role: "editor", email: "ed@example.com" });

    // Staff-authored pending row.
    await collectionPOST(
      staffRequest("/api/collections/discussions", editor, {
        method: "POST",
        body: JSON.stringify({
          title: "Staff pending",
          slug: "staff-pending",
          body: npCreateEmptyRichTextContent(),
          _status: "pending",
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );

    // Member-authored pending row (auto-pending via defaultStatus).
    const member = await seedActiveMember("excl-m");
    await seedPendingDoc(member, "member-pending", "Member pending");

    const res = await pendingGET(staffRequest("/api/admin/collections/pending", mod));
    const body = await readJson<{
      docs: Array<{ memberAuthor: unknown; title: string }>;
      totalDocs: number;
    }>(res);
    expect(body.body.totalDocs).toBe(1);
    expect(body.body.docs[0].title).toBe("Member pending");
    expect(body.body.docs[0].memberAuthor).not.toBeNull();
  });

  it("filters by `?slug=`", async () => {
    const mod = await seedUser({ role: "moderator" });
    const a = await seedActiveMember("filter-a");
    await seedPendingDoc(a, "filter-1", "discussions only");

    // discussions slug — should return 1
    const r1 = await pendingGET(
      staffRequest("/api/admin/collections/pending?slug=discussions", mod),
    );
    const b1 = await readJson<{ totalDocs: number }>(r1);
    expect(b1.body.totalDocs).toBe(1);

    // posts slug — posts isn't memberWrite-enabled, so 0
    const r2 = await pendingGET(
      staffRequest("/api/admin/collections/pending?slug=posts", mod),
    );
    const b2 = await readJson<{ totalDocs: number }>(r2);
    expect(b2.body.totalDocs).toBe(0);
  });

  it("paginates with `?limit=` and `?page=`", async () => {
    const mod = await seedUser({ role: "moderator" });
    const a = await seedActiveMember("page-a");

    // Seed three pending docs.
    await seedPendingDoc(a, "p1", "alpha");
    await seedPendingDoc(a, "p2", "bravo");
    await seedPendingDoc(a, "p3", "charlie");

    const r1 = await pendingGET(
      staffRequest("/api/admin/collections/pending?limit=2&page=1", mod),
    );
    const b1 = await readJson<{ docs: Array<unknown>; totalDocs: number; totalPages: number }>(r1);
    expect(b1.body.docs).toHaveLength(2);
    expect(b1.body.totalDocs).toBe(3);
    expect(b1.body.totalPages).toBe(2);

    const r2 = await pendingGET(
      staffRequest("/api/admin/collections/pending?limit=2&page=2", mod),
    );
    const b2 = await readJson<{ docs: Array<unknown> }>(r2);
    expect(b2.body.docs).toHaveLength(1);
  });

  it("respects SQL limit even when many pending rows exist (Phase 12.11 regression)", async () => {
    // Pre-12.11 the function fanned out one query per collection
    // with no SQL `LIMIT`, then sliced in JS — meaning every
    // pending row was loaded into memory regardless of `?limit=`.
    // Seed enough rows to make a JS-only limit visibly different
    // from a SQL-side one, then assert the response carries
    // exactly `limit` docs while `totalDocs` reflects the full
    // count.
    const mod = await seedUser({ role: "moderator" });
    const member = await seedActiveMember("queue-large");
    const SEED = 30;
    for (let i = 0; i < SEED; i++) {
      await seedPendingDoc(member, `large-${i}`, `large doc ${i}`);
    }

    const res = await pendingGET(
      staffRequest("/api/admin/collections/pending?limit=5", mod),
    );
    const body = await readJson<{ docs: unknown[]; totalDocs: number }>(res);
    expect(body.status).toBe(200);
    expect(body.body.docs).toHaveLength(5);
    expect(body.body.totalDocs).toBe(SEED);
  });

  it("orders newest-first across collections", async () => {
    const mod = await seedUser({ role: "moderator" });
    const a = await seedActiveMember("order-a");
    await seedPendingDoc(a, "order-1", "older");
    // Brief delay so createdAt differs measurably.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await seedPendingDoc(a, "order-2", "newer");

    const res = await pendingGET(staffRequest("/api/admin/collections/pending", mod));
    const body = await readJson<{ docs: Array<{ title: string }> }>(res);
    expect(body.body.docs[0].title).toBe("newer");
    expect(body.body.docs[1].title).toBe("older");
  });
});
