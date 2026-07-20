import { createComment, listMemberProfileActivity } from "@nexpress/core/community";
import { npMembers } from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { GET as activityGET } from "@/app/api/members/[handle]/activity/route";
import { GET as profileGET } from "@/app/api/members/[handle]/route";
import { discussionsTable } from "@/db/generated/collections";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedActiveMember,
  skipIfNoTestDb,
  truncateAll,
  type TestMemberSession,
} from "./harness.js";

function memberRequest(path: string, member: TestMemberSession, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `np-mb-session=${member.sessionCookie}; np-mb-csrf=${member.csrfCookie}`,
      "x-csrf-token": member.csrfCookie,
    },
    body: JSON.stringify(body),
  });
}

async function createDiscussion(member: TestMemberSession, title: string): Promise<string> {
  const response = await collectionPOST(
    memberRequest("/api/collections/discussions", member, {
      title,
      body: npCreateEmptyRichTextContent(),
    }),
    { params: Promise.resolve({ slug: "discussions" }) },
  );
  const result = await readJson<{ id: string }>(response);
  expect(result.status).toBe(201);
  return result.body.id;
}

describe.skipIf(skipIfNoTestDb())("public member profile activity (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { discussionsCollection } = await import("@/collections/discussions");
    const { registerCollection } = await import("@nexpress/core");
    registerCollection("discussions", discussionsTable as never, {
      ...discussionsCollection,
      access: undefined,
      hooks: undefined,
    });
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("pages only published/public member documents with stable destinations", async () => {
    const member = await seedActiveMember({ handle: "activity-author" });
    const olderId = await createDiscussion(member, "Older discussion");
    const newerId = await createDiscussion(member, "Newer discussion");
    const privateId = await createDiscussion(member, "Private discussion");
    const db = await getTestDb();
    await db
      .update(discussionsTable)
      .set({
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
        updatedAt: new Date("2026-07-19T00:00:00.000Z"),
      })
      .where(eq(discussionsTable.id, olderId));
    await db
      .update(discussionsTable)
      .set({
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
      })
      .where(eq(discussionsTable.id, newerId));
    await db
      .update(discussionsTable)
      .set({ visibility: "private" })
      .where(eq(discussionsTable.id, privateId));

    const first = await listMemberProfileActivity(member.memberId, {
      kind: "documents",
      page: 1,
      limit: 1,
    });
    const second = await listMemberProfileActivity(member.memberId, {
      kind: "documents",
      page: 2,
      limit: 1,
    });

    expect(first).toMatchObject({ totalDocs: 2, totalPages: 2, hasNextPage: true });
    expect(first.items[0]).toMatchObject({
      kind: "document",
      documentId: newerId,
      href: `/discussions/${newerId}`,
    });
    expect(second.items[0]).toMatchObject({
      kind: "document",
      documentId: olderId,
      href: `/discussions/${olderId}`,
    });
  });

  it("lists visible comments only while the target remains public", async () => {
    const member = await seedActiveMember({ handle: "activity-commenter" });
    const visibleTarget = await createDiscussion(member, "Visible target");
    const privateTarget = await createDiscussion(member, "Private target");
    await createComment({
      targetType: "discussions",
      targetId: visibleTarget,
      bodyMd: "A **useful** public reply",
      memberId: member.memberId,
    });
    await createComment({
      targetType: "discussions",
      targetId: privateTarget,
      bodyMd: "This target becomes private",
      memberId: member.memberId,
    });
    await (
      await getTestDb()
    )
      .update(discussionsTable)
      .set({ visibility: "private" })
      .where(eq(discussionsTable.id, privateTarget));

    const result = await listMemberProfileActivity(member.memberId, {
      kind: "comments",
      page: 1,
      limit: 20,
    });
    expect(result.totalDocs).toBe(1);
    expect(result.items[0]).toMatchObject({
      kind: "comment",
      targetId: visibleTarget,
      targetTitle: "Visible target",
      excerpt: "A useful public reply",
    });
    expect(result.items[0]?.href).toMatch(
      new RegExp(`^/discussions/${visibleTarget}#comment-[0-9a-f-]+$`, "u"),
    );
  });

  it("serves the same exact profile and activity wire contracts over HTTP", async () => {
    const member = await seedActiveMember({
      handle: "activity-api",
      displayName: "Activity API",
    });
    await createDiscussion(member, "API discussion");

    const profile = await readJson<Record<string, unknown>>(
      await profileGET(new NextRequest("http://localhost:3000/api/members/activity-api"), {
        params: Promise.resolve({ handle: "activity-api" }),
      }),
    );
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      id: member.memberId,
      handle: "activity-api",
      displayName: "Activity API",
      avatarUrl: null,
    });
    expect(profile.body).not.toHaveProperty("email");

    const activity = await readJson<{ kind: string; totalDocs: number }>(
      await activityGET(
        new NextRequest(
          "http://localhost:3000/api/members/activity-api/activity?kind=documents&limit=20&page=1",
        ),
        { params: Promise.resolve({ handle: "activity-api" }) },
      ),
    );
    expect(activity).toMatchObject({ status: 200, body: { kind: "documents", totalDocs: 1 } });

    const invalid = await readJson<Record<string, unknown>>(
      await activityGET(
        new NextRequest(
          "http://localhost:3000/api/members/activity-api/activity?kind=documents&page=10001",
        ),
        { params: Promise.resolve({ handle: "activity-api" }) },
      ),
    );
    expect(invalid.status).toBe(400);

    const unknown = await readJson<Record<string, unknown>>(
      await activityGET(
        new NextRequest(
          "http://localhost:3000/api/members/activity-api/activity?kind=documents&private=true",
        ),
        { params: Promise.resolve({ handle: "activity-api" }) },
      ),
    );
    expect(unknown.status).toBe(400);

    const duplicate = await readJson<Record<string, unknown>>(
      await activityGET(
        new NextRequest(
          "http://localhost:3000/api/members/activity-api/activity?kind=documents&kind=comments",
        ),
        { params: Promise.resolve({ handle: "activity-api" }) },
      ),
    );
    expect(duplicate.status).toBe(400);
  });

  it("fails closed when the activity subject is no longer public", async () => {
    const member = await seedActiveMember({ handle: "hidden-activity" });
    await createDiscussion(member, "Previously public discussion");
    await (
      await getTestDb()
    )
      .update(npMembers)
      .set({ status: "suspended" })
      .where(eq(npMembers.id, member.memberId));

    await expect(
      listMemberProfileActivity(member.memberId, {
        kind: "documents",
        page: 1,
        limit: 20,
      }),
    ).rejects.toThrow(/member/u);
  });
});
