import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
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
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

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

describe.skipIf(skipIfNoTestDb())("findDocuments memberAuthorId filter (Phase 9.7f)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const config = defineDiscussionsCollection();
    registerCollection(
      "discussions",
      discussionsTable as never,
      { ...config, access: undefined, hooks: undefined },
    );
    const { ensureCoreServices } = await import("@/lib/bootstrap");
    ensureCoreServices();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("filters by memberAuthorId — returns only the requested member's docs", async () => {
    const a = await seedActiveMember("filt-a");
    const b = await seedActiveMember("filt-b");

    // a posts 2, b posts 1.
    for (const slug of ["a-1", "a-2"]) {
      await collectionPOST(
        memberRequest("/api/collections/discussions", a, {
          method: "POST",
          body: JSON.stringify({
            title: `By a slug ${slug}`,
            slug,
            body: { root: { type: "root", children: [] } },
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
    }
    await collectionPOST(
      memberRequest("/api/collections/discussions", b, {
        method: "POST",
        body: JSON.stringify({
          title: "By b",
          slug: "b-1",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );

    // Use findDocuments directly — that's how the site server
    // component queries it. The site UI doesn't go through the
    // /api/collections HTTP endpoint for reads.
    const { findDocuments } = await import("@nexpress/core");
    const aResult = await findDocuments("discussions", {
      where: { memberAuthorId: a.memberId, status: "published" },
      sort: "-createdAt",
    });
    expect(aResult.totalDocs).toBe(2);
    const aTitles = aResult.docs.map((d) => d.title as string).sort();
    expect(aTitles).toEqual(["By a slug a-1", "By a slug a-2"]);

    const bResult = await findDocuments("discussions", {
      where: { memberAuthorId: b.memberId, status: "published" },
      sort: "-createdAt",
    });
    expect(bResult.totalDocs).toBe(1);
    expect(bResult.docs[0].title).toBe("By b");
  });

  it("returns empty when filtering by a memberAuthorId that has no docs", async () => {
    const a = await seedActiveMember("filt-empty");
    const { findDocuments } = await import("@nexpress/core");
    const result = await findDocuments("discussions", {
      where: { memberAuthorId: a.memberId },
    });
    expect(result.totalDocs).toBe(0);
  });

  it("memberAuthorId filter without status filter includes pending rows (for `?author=me` UX)", async () => {
    // Switch the discussions registration to defaultStatus=pending so
    // member creates land pending — that's the moderation gate the
    // "my threads" filter is most useful in: a member needs to see
    // their own pending submissions even though the public list
    // hides them.
    const { defineDiscussionsCollection } = await import("@nexpress/plugin-forum");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const config = defineDiscussionsCollection();
    registerCollection(
      "discussions",
      discussionsTable as never,
      {
        ...config,
        community: {
          ...(config.community ?? {}),
          memberWrite: {
            ...(config.community?.memberWrite ?? {}),
            defaultStatus: "pending" as const,
          },
        },
        access: undefined,
        hooks: undefined,
      },
    );

    const a = await seedActiveMember("filt-pending");
    await collectionPOST(
      memberRequest("/api/collections/discussions", a, {
        method: "POST",
        body: JSON.stringify({
          title: "Pending submission",
          slug: "pending-sub",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );

    const { findDocuments } = await import("@nexpress/core");

    // Public list (anonymous, status=published filter): hidden.
    const publicList = await findDocuments("discussions", {
      where: { status: "published" },
    });
    expect(publicList.totalDocs).toBe(0);

    // Author "my threads" view (no status filter, memberAuthorId=me):
    // visible.
    const myList = await findDocuments("discussions", {
      where: { memberAuthorId: a.memberId },
    });
    expect(myList.totalDocs).toBe(1);
    expect(myList.docs[0].status).toBe("pending");

    // Reset for subsequent tests.
    registerCollection(
      "discussions",
      discussionsTable as never,
      { ...config, access: undefined, hooks: undefined },
    );
  });

  it("staff-authored rows are EXCLUDED when filtering by memberAuthorId", async () => {
    const a = await seedActiveMember("filt-mix");
    const editor = await seedUser({ role: "editor" });

    // Member creates a doc.
    await collectionPOST(
      memberRequest("/api/collections/discussions", a, {
        method: "POST",
        body: JSON.stringify({
          title: "Member doc",
          slug: "member-doc",
          body: { root: { type: "root", children: [] } },
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );

    // Staff creates a doc (memberAuthorId = null).
    await collectionPOST(
      staffRequest("/api/collections/discussions", editor, {
        method: "POST",
        body: JSON.stringify({
          title: "Staff doc",
          slug: "staff-doc",
          body: { root: { type: "root", children: [] } },
          _status: "published",
        }),
      }),
      { params: Promise.resolve({ slug: "discussions" }) },
    );

    const { findDocuments } = await import("@nexpress/core");
    const result = await findDocuments("discussions", {
      where: { memberAuthorId: a.memberId },
    });
    // Only the member's own row — staff's null memberAuthorId
    // doesn't equal `a.memberId`.
    expect(result.totalDocs).toBe(1);
    expect(result.docs[0].title).toBe("Member doc");
  });
});
