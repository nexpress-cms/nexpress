import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

import {
  DELETE as collectionDELETE,
  PATCH as collectionPATCH,
} from "@/app/api/collections/[slug]/[id]/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
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

async function seedMemberDiscussion(
  member: { sessionCookie: string; csrfCookie: string },
  title: string,
  slug: string,
): Promise<string> {
  const create = await collectionPOST(
    memberRequest("/api/collections/discussions", member, {
      method: "POST",
      body: JSON.stringify({
        title,
        slug,
        body: { root: { type: "root", children: [] } },
      }),
    }),
    { params: Promise.resolve({ slug: "discussions" }) },
  );
  const { body } = await readJson<{ id: string }>(create);
  return body.id;
}

describe.skipIf(skipIfNoTestDb())("member-write update + delete (Phase 9.7b)", () => {
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

  describe("create stamps member_author_id", () => {
    it("member create writes member_author_id; staff create leaves it null", async () => {
      const member = await seedActiveMember("authorstamp");
      const docId = await seedMemberDiscussion(member, "Member-authored", "stamp-1");

      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select()
        .from(discussionsTable)
        .where(eq(discussionsTable.id, docId))) as Array<{
        memberAuthorId: string | null;
        createdBy: string | null;
      }>;
      expect(row.memberAuthorId).toBe(member.memberId);
      expect(row.createdBy).toBeNull();

      // Staff-authored discussion in the same table leaves it null.
      const staff = await seedUser({ role: "editor" });
      const staffCreate = await collectionPOST(
        staffRequest("/api/collections/discussions", staff, {
          method: "POST",
          body: JSON.stringify({
            title: "Staff thread",
            slug: "stamp-staff",
            body: { root: { type: "root", children: [] } },
            _status: "published",
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      const { id: staffDocId } = await readJson<{ id: string }>(staffCreate).then((r) => r.body);
      const [staffRow] = (await db
        .select()
        .from(discussionsTable)
        .where(eq(discussionsTable.id, staffDocId))) as Array<{
        memberAuthorId: string | null;
        createdBy: string | null;
      }>;
      expect(staffRow.memberAuthorId).toBeNull();
      expect(staffRow.createdBy).toBe(staff.userId);
    });
  });

  describe("PATCH /api/collections/discussions/[id]", () => {
    it("author updates own discussion (200, body changed)", async () => {
      const member = await seedActiveMember("editor1");
      const docId = await seedMemberDiscussion(member, "Original title", "edit-1");

      const update = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Edited title", slug: "edit-1" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      const body = await readJson<{ title: string }>(update);
      expect(body.status).toBe(200);
      expect(body.body.title).toBe("Edited title");
    });

    it("rejects update when caller is a different member (403)", async () => {
      const owner = await seedActiveMember("owner1");
      const intruder = await seedActiveMember("intruder1");
      const docId = await seedMemberDiscussion(owner, "Owner thread", "owned-1");

      const update = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, intruder, {
          method: "PATCH",
          body: JSON.stringify({ title: "Stolen", slug: "owned-1" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(update.status).toBe(403);
    });

    it("rejects update of staff-authored discussion (memberAuthorId is null)", async () => {
      const staff = await seedUser({ role: "editor" });
      const member = await seedActiveMember("staffeditor");
      const staffCreate = await collectionPOST(
        staffRequest("/api/collections/discussions", staff, {
          method: "POST",
          body: JSON.stringify({
            title: "Staff",
            slug: "no-edit-staff",
            body: { root: { type: "root", children: [] } },
            _status: "published",
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      const { id: docId } = await readJson<{ id: string }>(staffCreate).then((r) => r.body);

      const update = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Pwn", slug: "no-edit-staff" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(update.status).toBe(403);
    });

    it("strips `_status` from member update body — members can't transition status", async () => {
      const member = await seedActiveMember("statusguard");
      const docId = await seedMemberDiscussion(member, "Initial", "status-guard");

      const update = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated",
            slug: "status-guard",
            _status: "draft",
          }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      const body = await readJson<{ title: string; status: string }>(update);
      expect(body.status).toBe(200);
      expect(body.body.title).toBe("Updated");
      // Status remains "published" — the `_status: "draft"` body field
      // was stripped.
      expect(body.body.status).toBe("published");
    });

    it("records `document.update` audit event with member actor", async () => {
      const member = await seedActiveMember("updateaudit");
      const docId = await seedMemberDiscussion(member, "Pre", "audit-update");

      await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Post", slug: "audit-update" }),
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
            eq(nxAuditEvents.action, "document.update"),
            eq(nxAuditEvents.targetId, docId),
          ),
        )) as Array<{ actorMemberId: string | null; targetType: string | null }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].actorMemberId).toBe(member.memberId);
      expect(audits[0].targetType).toBe("discussions");
    });

    it("collection without `memberWrite.update` rejects with 403 (posts)", async () => {
      // posts doesn't opt in to memberWrite at all. Even create would
      // 403 from 9.7a; this also exercises the update-side guard.
      const staff = await seedUser({ role: "editor" });
      const staffCreate = await collectionPOST(
        staffRequest("/api/collections/posts", staff, {
          method: "POST",
          body: JSON.stringify({
            title: "Post",
            slug: "post-no-edit",
            content: { root: { type: "root", children: [] } },
            _status: "published",
          }),
        }),
        { params: Promise.resolve({ slug: "posts" }) },
      );
      const { id: docId } = await readJson<{ id: string }>(staffCreate).then((r) => r.body);

      const member = await seedActiveMember("postedit");
      const update = await collectionPATCH(
        memberRequest(`/api/collections/posts/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Hijack" }),
        }),
        { params: Promise.resolve({ slug: "posts", id: docId }) },
      );
      expect(update.status).toBe(403);
    });

    // Admin role required: the discussions access policy is
    // `isOwnerOrAdmin` for update — an editor that didn't author the
    // doc (createdBy is null on member-authored rows) gets denied.
    // That's intended behavior of the staff access tree, untouched
    // by 9.7b.
    it("admin PATCH still works on member-authored doc (mod editing)", async () => {
      const staff = await seedUser({ role: "admin" });
      const member = await seedActiveMember("modedited");
      const docId = await seedMemberDiscussion(member, "Original", "mod-edit");

      const update = await collectionPATCH(
        staffRequest(`/api/collections/discussions/${docId}`, staff, {
          method: "PATCH",
          body: JSON.stringify({ title: "Mod-edited", slug: "mod-edit" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(update.status).toBe(200);
      // member_author_id stays — staff edit doesn't reassign authorship.
      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select()
        .from(discussionsTable)
        .where(eq(discussionsTable.id, docId))) as Array<{ memberAuthorId: string | null }>;
      expect(row.memberAuthorId).toBe(member.memberId);
    });
  });

  describe("DELETE /api/collections/discussions/[id]", () => {
    it("author deletes own discussion (204; row removed)", async () => {
      const member = await seedActiveMember("delowner");
      const docId = await seedMemberDiscussion(member, "Goodbye", "del-1");

      const del = await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, member, { method: "DELETE" }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(del.status).toBe(204);

      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const { eq } = await import("drizzle-orm");
      const rows = (await db
        .select()
        .from(discussionsTable)
        .where(eq(discussionsTable.id, docId))) as Array<unknown>;
      expect(rows).toHaveLength(0);
    });

    it("rejects delete by a different member (403; row preserved)", async () => {
      const owner = await seedActiveMember("delowner2");
      const intruder = await seedActiveMember("delintruder");
      const docId = await seedMemberDiscussion(owner, "Mine", "del-2");

      const del = await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, intruder, { method: "DELETE" }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(del.status).toBe(403);

      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const { eq } = await import("drizzle-orm");
      const rows = (await db
        .select()
        .from(discussionsTable)
        .where(eq(discussionsTable.id, docId))) as Array<unknown>;
      expect(rows).toHaveLength(1);
    });

    it("fires `document.deleted` reputation event on owner delete", async () => {
      const core = await import("@nexpress/core");
      const events: NxReputationEvent[] = [];
      core.setReputationAdapter({
        apply: (event) => {
          events.push(event);
          if (event.kind === "document.created") return 5;
          if (event.kind === "document.deleted") return -5;
          return 0;
        },
      });

      const member = await seedActiveMember("repdel");
      const docId = await seedMemberDiscussion(member, "Boom", "rep-del");

      const del = await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, member, { method: "DELETE" }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(del.status).toBe(204);

      const kinds = events.map((e) => e.kind);
      expect(kinds).toEqual(["document.created", "document.deleted"]);
      // Net zero — adapter credited +5 on create, debited -5 on delete.
      const db = await getTestDb();
      const { nxMembers } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select({ reputation: nxMembers.reputation })
        .from(nxMembers)
        .where(eq(nxMembers.id, member.memberId))
        .limit(1)) as Array<{ reputation: number }>;
      expect(row.reputation).toBe(0);
    });

    it("records `document.delete` audit event with member actor", async () => {
      const member = await seedActiveMember("delaudit");
      const docId = await seedMemberDiscussion(member, "Doomed", "audit-del");

      await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, member, { method: "DELETE" }),
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
            eq(nxAuditEvents.action, "document.delete"),
            eq(nxAuditEvents.targetId, docId),
          ),
        )) as Array<{ actorMemberId: string | null }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].actorMemberId).toBe(member.memberId);
    });

    it("admin DELETE still works on member-authored doc (mod removal)", async () => {
      const staff = await seedUser({ role: "admin" });
      const member = await seedActiveMember("moddeleted");
      const docId = await seedMemberDiscussion(member, "Bye", "mod-del");

      const del = await collectionDELETE(
        staffRequest(`/api/collections/discussions/${docId}`, staff, { method: "DELETE" }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(del.status).toBe(204);
    });

    it("banned author can't delete their own doc (403)", async () => {
      const admin = await seedUser({ role: "admin" });
      const member = await seedActiveMember("bandel");
      const docId = await seedMemberDiscussion(member, "Mine", "bandel-1");

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

      const del = await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, member, { method: "DELETE" }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(del.status).toBe(403);
    });
  });
});
