import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as memberUploadPOST } from "@/app/api/members/media/upload/route";
import { POST as purgePOST } from "@/app/api/admin/members/[id]/purge-content/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  if (init.cookies && init.cookies.length > 0) {
    headers.set("cookie", init.cookies.join("; "));
  }
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function staffRequest(path: string, user: TestUserSession, init: RequestInit = {}): NextRequest {
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

async function seedStaffPost(staff: TestUserSession): Promise<string> {
  const create = await collectionPOST(
    staffRequest("/api/collections/posts", staff, {
      method: "POST",
      body: JSON.stringify({
        title: "Purge target",
        slug: `purge-target-${Math.random().toString(36).slice(2)}`,
        content: npCreateEmptyRichTextContent(),
        _status: "published",
      }),
    }),
    { params: Promise.resolve({ slug: "posts" }) },
  );
  if (create.status !== 201) throw new Error("post seed failed");
  const body = (await create.json()) as { id: string };
  return body.id;
}

async function memberDiscussion(
  member: { sessionCookie: string; csrfCookie: string },
  slug: string,
): Promise<string> {
  const create = await collectionPOST(
    memberRequest("/api/collections/discussions", member, {
      method: "POST",
      body: JSON.stringify({
        title: `Member discussion ${slug}`,
        slug,
        body: npCreateEmptyRichTextContent(),
      }),
    }),
    { params: Promise.resolve({ slug: "discussions" }) },
  );
  const body = await readJson<{ id: string }>(create);
  if (body.status !== 201) {
    throw new Error(`discussion seed failed: ${JSON.stringify(body.body)}`);
  }
  return body.body.id;
}

async function memberComment(
  member: { sessionCookie: string; csrfCookie: string },
  postId: string,
  text: string,
): Promise<string> {
  const create = await commentsPOST(
    memberRequest(`/api/collections/posts/${postId}/comments`, member, {
      method: "POST",
      body: JSON.stringify({ bodyMd: text }),
    }),
    { params: Promise.resolve({ slug: "posts", id: postId }) },
  );
  const body = await readJson<{ id: string }>(create);
  if (body.status !== 201) {
    throw new Error(`comment seed failed: ${JSON.stringify(body.body)}`);
  }
  return body.body.id;
}

async function memberUploadImage(member: {
  sessionCookie: string;
  csrfCookie: string;
}): Promise<string> {
  const formData = new FormData();
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  formData.append("file", new Blob([png], { type: "image/png" }), "img.png");
  const headers = new Headers();
  headers.set("cookie", `np-mb-session=${member.sessionCookie}; np-mb-csrf=${member.csrfCookie}`);
  headers.set("x-csrf-token", member.csrfCookie);
  const req = new NextRequest("http://localhost:3000/api/members/media/upload", {
    method: "POST",
    headers,
    body: formData,
  });
  const res = await memberUploadPOST(req);
  const body = await readJson<{ id?: string }>(res);
  if (body.status !== 202) throw new Error("upload failed");
  return body.body.id!;
}

describe.skipIf(skipIfNoTestDb())("purge member content (Phase 9.7l)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // Register discussions with memberWrite enabled, AND prime the
    // bootstrap so the registration sticks across the first API
    // call (same pattern as 9.7d/9.7e tests).
    const { discussionsCollection: config } = await import("@/collections/discussions");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    registerCollection("discussions", discussionsTable as never, {
      ...config,
      access: undefined,
      hooks: undefined,
    });
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
    // Re-register after the read bootstrap ran (it would have
    // overwritten the test fixture with the bootstrap default).
    registerCollection("discussions", discussionsTable as never, {
      ...config,
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

  it("admin purges all of one member's content; counts add up; other member untouched", async () => {
    const admin = await seedUser({ role: "admin" });
    const editor = await seedUser({ role: "editor", email: "ed@example.com" });
    const target = await seedActiveMember("purge-target");
    const bystander = await seedActiveMember("purge-bystander");

    // Seed: target authors content. Bystander authors content too —
    // the purge MUST NOT touch them.
    const post = await seedStaffPost(editor);
    await memberComment(target, post, "comment 1");
    await memberComment(target, post, "comment 2");
    await memberComment(bystander, post, "bystander comment");
    await memberDiscussion(target, "purge-disc-1");
    await memberDiscussion(target, "purge-disc-2");
    await memberDiscussion(bystander, "bystander-disc");
    await memberUploadImage(target);
    await memberUploadImage(target);
    await memberUploadImage(bystander);

    const res = await purgePOST(
      staffRequest(`/api/admin/members/${target.memberId}/purge-content`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: target.memberId }) },
    );
    const body = await readJson<{
      comments: number;
      documents: Record<string, number>;
      media: { deleted: number; skipped: number };
    }>(res);
    expect(body.status).toBe(200);
    expect(body.body.comments).toBe(2);
    expect(body.body.documents.discussions).toBe(2);
    expect(body.body.media.deleted).toBe(2);
    expect(body.body.media.skipped).toBe(0);

    // Verify DB state.
    const db = await getTestDb();
    const { npComments, npMedia } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    const { and, eq, isNull, ne } = await import("drizzle-orm");

    // Target's comments are tombstoned.
    const targetLiveComments = (await db
      .select({ id: npComments.id })
      .from(npComments)
      .where(
        and(eq(npComments.memberId, target.memberId), ne(npComments.status, "deleted")),
      )) as Array<unknown>;
    expect(targetLiveComments).toHaveLength(0);

    // Target's discussions are gone.
    const targetDiscs = (await db
      .select()
      .from(discussionsTable)
      .where(eq(discussionsTable.memberAuthorId, target.memberId))) as Array<unknown>;
    expect(targetDiscs).toHaveLength(0);

    // Target's media are soft-deleted (deletedAt set).
    const targetLiveMedia = (await db
      .select()
      .from(npMedia)
      .where(
        and(eq(npMedia.uploadedByMemberId, target.memberId), isNull(npMedia.deletedAt)),
      )) as Array<unknown>;
    expect(targetLiveMedia).toHaveLength(0);

    // Bystander's content is untouched.
    const bystanderLiveComments = (await db
      .select({ id: npComments.id })
      .from(npComments)
      .where(
        and(eq(npComments.memberId, bystander.memberId), ne(npComments.status, "deleted")),
      )) as Array<unknown>;
    expect(bystanderLiveComments).toHaveLength(1);

    const bystanderDiscs = (await db
      .select()
      .from(discussionsTable)
      .where(eq(discussionsTable.memberAuthorId, bystander.memberId))) as Array<unknown>;
    expect(bystanderDiscs).toHaveLength(1);

    const bystanderLiveMedia = (await db
      .select()
      .from(npMedia)
      .where(
        and(eq(npMedia.uploadedByMemberId, bystander.memberId), isNull(npMedia.deletedAt)),
      )) as Array<unknown>;
    expect(bystanderLiveMedia).toHaveLength(1);
  });

  it("re-purge returns zero counts (idempotent)", async () => {
    const admin = await seedUser({ role: "admin" });
    const editor = await seedUser({ role: "editor", email: "ed2@example.com" });
    const target = await seedActiveMember("idemp-target");

    const post = await seedStaffPost(editor);
    await memberComment(target, post, "once");
    await memberDiscussion(target, "idemp-disc");
    await memberUploadImage(target);

    // First purge.
    const r1 = await purgePOST(
      staffRequest(`/api/admin/members/${target.memberId}/purge-content`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: target.memberId }) },
    );
    expect(r1.status).toBe(200);

    // Second purge — everything's already wiped, counts should be 0.
    const r2 = await purgePOST(
      staffRequest(`/api/admin/members/${target.memberId}/purge-content`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: target.memberId }) },
    );
    const body2 = await readJson<{
      comments: number;
      documents: Record<string, number>;
      media: { deleted: number; skipped: number };
    }>(r2);
    expect(body2.status).toBe(200);
    expect(body2.body.comments).toBe(0);
    expect(Object.keys(body2.body.documents)).toHaveLength(0);
    expect(body2.body.media.deleted).toBe(0);
  });

  it("editor / moderator role is forbidden (admin-only)", async () => {
    const member = await seedActiveMember("rbac-t");

    const editor = await seedUser({ role: "editor" });
    const r1 = await purgePOST(
      staffRequest(`/api/admin/members/${member.memberId}/purge-content`, editor, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: member.memberId }) },
    );
    expect(r1.status).toBe(403);

    const mod = await seedUser({ role: "moderator", email: "m@example.com" });
    const r2 = await purgePOST(
      staffRequest(`/api/admin/members/${member.memberId}/purge-content`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: member.memberId }) },
    );
    expect(r2.status).toBe(403);
  });

  it("unauthenticated request rejected (401)", async () => {
    const member = await seedActiveMember("anon-t");
    const res = await purgePOST(
      buildRequest(`/api/admin/members/${member.memberId}/purge-content`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: member.memberId }) },
    );
    expect(res.status).toBe(401);
  });

  // CSRF enforcement moved to apps/web/src/proxy.ts (#281). The
  // handler unit test bypasses the proxy by invoking the handler
  // directly, so the missing-CSRF case no longer makes sense at
  // this layer.

  it("404 on non-existent member id", async () => {
    const admin = await seedUser({ role: "admin" });
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await purgePOST(
      staffRequest(`/api/admin/members/${fakeId}/purge-content`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: fakeId }) },
    );
    expect(res.status).toBe(404);
  });

  // Regression: `purgeMemberContent` must pass the FULL staff user
  // (incl. `role`) to `deleteDocument` so the collection's
  // `access.delete` function (e.g. `isOwnerOrAdmin`, which reads
  // `user.role`) gets enough info to authorize. An earlier draft
  // narrowed staffUser to `Pick<NpAuthUser, "id">`, which silently
  // 403'd every doc deletion against real access policies. The
  // other tests in this file strip `access` for convenience, so
  // re-register discussions WITH the access tree intact for this
  // case.
  it("admin purge respects collection access functions (passes full staff user)", async () => {
    const { discussionsCollection: realConfig } = await import("@/collections/discussions");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    registerCollection("discussions", discussionsTable as never, {
      ...realConfig,
      hooks: undefined,
    });

    const admin = await seedUser({ role: "admin" });
    const target = await seedActiveMember("real-acl");
    await memberDiscussion(target, "real-acl-disc");

    const res = await purgePOST(
      staffRequest(`/api/admin/members/${target.memberId}/purge-content`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: target.memberId }) },
    );
    const body = await readJson<{ documents: Record<string, number> }>(res);
    expect(body.status).toBe(200);
    // The discussion got deleted — admin role satisfies
    // `isOwnerOrAdmin`. With a staff user lacking `role`, this
    // would have been 0 and the assertion would have failed.
    expect(body.body.documents.discussions).toBe(1);

    // Restore the test fixture (no access) for the rest of the
    // suite. truncateAll doesn't reset registrations.
    registerCollection("discussions", discussionsTable as never, {
      ...realConfig,
      access: undefined,
      hooks: undefined,
    });
  });

  it("records `member.content.purge` audit event with the count payload", async () => {
    const admin = await seedUser({ role: "admin" });
    const editor = await seedUser({ role: "editor", email: "ed3@example.com" });
    const target = await seedActiveMember("audit-t");

    const post = await seedStaffPost(editor);
    await memberComment(target, post, "x");
    await memberDiscussion(target, "audit-disc");

    await purgePOST(
      staffRequest(`/api/admin/members/${target.memberId}/purge-content`, admin, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: target.memberId }) },
    );

    const db = await getTestDb();
    const { npAuditEvents } = await import("@nexpress/core");
    const { and, eq } = await import("drizzle-orm");
    const audits = (await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.action, "member.content.purge"),
          eq(npAuditEvents.targetId, target.memberId),
        ),
      )) as Array<{
      actorKind: string;
      actorUserId: string | null;
      payload: Record<string, unknown>;
    }>;
    expect(audits).toHaveLength(1);
    expect(audits[0].actorKind).toBe("staff");
    expect(audits[0].actorUserId).toBe(admin.userId);
    expect(audits[0].payload.comments).toBe(1);
    const documents = audits[0].payload.documents as Record<string, number>;
    expect(documents.discussions).toBe(1);
  });
});
