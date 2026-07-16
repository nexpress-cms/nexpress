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

import {
  DELETE as collectionDELETE,
  PATCH as collectionPATCH,
} from "@/app/api/collections/[slug]/[id]/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";

import { NextRequest } from "next/server";

import type { NpReputationEvent } from "@nexpress/core";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
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
        body: npCreateEmptyRichTextContent(),
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
    const { discussionsCollection: config } = await import("@/collections/discussions");
    const { registerCollection } = await import("@nexpress/core");
    const { discussionsTable } = await import("@/db/generated/collections");
    registerCollection("discussions", discussionsTable as never, {
      ...config,
      access: undefined,
      hooks: undefined,
    });
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
            body: npCreateEmptyRichTextContent(),
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
            body: npCreateEmptyRichTextContent(),
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
      const { npAuditEvents } = await import("@nexpress/core");
      const { and, eq } = await import("drizzle-orm");
      const audits = (await db
        .select()
        .from(npAuditEvents)
        .where(
          and(eq(npAuditEvents.action, "document.update"), eq(npAuditEvents.targetId, docId)),
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
            content: npCreateEmptyRichTextContent(),
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

    // Framework-managed fields fail at the exact write boundary instead of
    // being silently stripped; authorship must still remain unchanged.
    it("rejects body-injected `memberAuthorId` on member update", async () => {
      const owner = await seedActiveMember("hijack-owner");
      const intruder = await seedActiveMember("hijack-target");
      const docId = await seedMemberDiscussion(owner, "Mine", "hijack-1");

      const update = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, owner, {
          method: "PATCH",
          body: JSON.stringify({
            title: "Self-edit",
            slug: "hijack-1",
            memberAuthorId: intruder.memberId,
          }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(update.status).toBe(400);
      expect(await readJson(update).then((result) => result.body)).toMatchObject({
        error: { code: "VALIDATION_ERROR", message: "Invalid input" },
        status: 400,
      });

      const db = await getTestDb();
      const { discussionsTable } = await import("@/db/generated/collections");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select()
        .from(discussionsTable)
        .where(eq(discussionsTable.id, docId))) as Array<{
        memberAuthorId: string | null;
      }>;
      expect(row.memberAuthorId).toBe(owner.memberId);
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
      const events: NpReputationEvent[] = [];
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
      const { npMembers } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select({ reputation: npMembers.reputation })
        .from(npMembers)
        .where(eq(npMembers.id, member.memberId))
        .limit(1)) as Array<{ reputation: number }>;
      expect(row.reputation).toBe(0);
    });

    // Issue #126 — `document.deleted` reputation event was fired
    // unconditionally on member delete. But a pending row never
    // earned the `document.created` credit (the create path
    // withholds it for non-published rows; promote backfills it).
    // Debiting on delete without a matching credit drove the
    // member's reputation negative for retracting their own
    // not-yet-visible content.
    it("pending doc delete does NOT debit reputation (#126)", async () => {
      const core = await import("@nexpress/core");
      const events: NpReputationEvent[] = [];
      core.setReputationAdapter({
        apply: (event) => {
          events.push(event);
          if (event.kind === "document.created") return 5;
          if (event.kind === "document.deleted") return -5;
          return 0;
        },
      });
      // Spam adapter flags every create → row lands `pending` →
      // create-path withholds `document.created` per the existing
      // 9.7c policy. Same setup the moderation tests use.
      core.setSpamAdapter({ check: () => ({ kind: "flag" }) });

      const member = await seedActiveMember("rep-pend-del");
      const docId = await seedMemberDiscussion(member, "Awaits", "pend-del-1");

      const del = await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(del.status).toBe(204);

      // Neither `document.created` (withheld at create) nor
      // `document.deleted` (withheld at delete because the row
      // was never credited) should have fired.
      const kinds = events.map((e) => e.kind);
      expect(kinds).not.toContain("document.created");
      expect(kinds).not.toContain("document.deleted");

      const db = await getTestDb();
      const { npMembers } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const [row] = (await db
        .select({ reputation: npMembers.reputation })
        .from(npMembers)
        .where(eq(npMembers.id, member.memberId))
        .limit(1)) as Array<{ reputation: number }>;
      // No credit, no debit — net zero from the create+delete pair.
      expect(row.reputation).toBe(0);

      core.resetSpamAdapter();
    });

    it("records `document.delete` audit event with member actor", async () => {
      const member = await seedActiveMember("delaudit");
      const docId = await seedMemberDiscussion(member, "Doomed", "audit-del");

      await collectionDELETE(
        memberRequest(`/api/collections/discussions/${docId}`, member, { method: "DELETE" }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );

      const db = await getTestDb();
      const { npAuditEvents } = await import("@nexpress/core");
      const { and, eq } = await import("drizzle-orm");
      const audits = (await db
        .select()
        .from(npAuditEvents)
        .where(
          and(eq(npAuditEvents.action, "document.delete"), eq(npAuditEvents.targetId, docId)),
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

  // Issue #139 — pre-fix `runMemberDocModeration` ran at the top
  // of `createMemberDocument` / `updateMemberDocument`, BEFORE
  // the cheap auth checks (collection opt-in, owner, ban). For
  // sites using a paid moderation provider, doomed requests
  // (banned member, non-owner edit, opt-out collection) still
  // burned an adapter call. Now the cheap auth gate runs first
  // and the adapter only sees authorized writes.
  describe("auth checks run before moderation (#139)", () => {
    let probeCount = 0;
    const probeAdapter = {
      check: () => {
        probeCount += 1;
        return { kind: "pass" as const };
      },
    };

    beforeEach(async () => {
      probeCount = 0;
      const core = await import("@nexpress/core");
      core.setSpamAdapter(probeAdapter);
      core.setProfanityAdapter(probeAdapter);
    });
    afterEach(async () => {
      const core = await import("@nexpress/core");
      core.resetSpamAdapter();
      core.resetProfanityAdapter();
    });

    it("banned member create — moderation NOT called", async () => {
      const admin = await seedUser({ role: "admin" });
      const member = await seedActiveMember("auth-banned-create");
      const { issueBan } = await import("@nexpress/core");
      await issueBan({
        memberId: member.memberId,
        scopeType: "site",
        kind: "permanent",
        actor: {
          kind: "staff",
          user: { id: admin.userId, role: admin.role, tokenVersion: 0 } as never,
        },
      });

      const res = await collectionPOST(
        memberRequest("/api/collections/discussions", member, {
          method: "POST",
          body: JSON.stringify({
            title: "Should not pass moderation",
            slug: "banned-create-1",
            body: npCreateEmptyRichTextContent(),
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      expect(res.status).toBe(403);
      expect(probeCount).toBe(0);
    });

    it("non-owner update — moderation NOT called", async () => {
      const owner = await seedActiveMember("auth-owner");
      const docId = await seedMemberDiscussion(owner, "Mine", "auth-owner-1");

      // probeCount may have ticked during the create; reset for
      // the assertion.
      probeCount = 0;

      const stranger = await seedActiveMember("auth-stranger");
      const patch = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, stranger, {
          method: "PATCH",
          body: JSON.stringify({ title: "Hijack attempt" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(patch.status).toBe(403);
      expect(probeCount).toBe(0);
    });

    it("banned owner update — moderation NOT called", async () => {
      const admin = await seedUser({ role: "admin" });
      const member = await seedActiveMember("auth-banned-edit");
      const docId = await seedMemberDiscussion(member, "Initial", "auth-be-1");

      const { issueBan } = await import("@nexpress/core");
      await issueBan({
        memberId: member.memberId,
        scopeType: "site",
        kind: "permanent",
        actor: {
          kind: "staff",
          user: { id: admin.userId, role: admin.role, tokenVersion: 0 } as never,
        },
      });

      probeCount = 0;
      const patch = await collectionPATCH(
        memberRequest(`/api/collections/discussions/${docId}`, member, {
          method: "PATCH",
          body: JSON.stringify({ title: "Banned edit" }),
        }),
        { params: Promise.resolve({ slug: "discussions", id: docId }) },
      );
      expect(patch.status).toBe(403);
      expect(probeCount).toBe(0);
    });

    it("authorized create still triggers moderation (sanity)", async () => {
      const member = await seedActiveMember("auth-clean");
      const res = await collectionPOST(
        memberRequest("/api/collections/discussions", member, {
          method: "POST",
          body: JSON.stringify({
            title: "Authorized",
            slug: "auth-clean-1",
            body: npCreateEmptyRichTextContent(),
          }),
        }),
        { params: Promise.resolve({ slug: "discussions" }) },
      );
      expect(res.status).toBe(201);
      // profanity + spam each fire once on the create path.
      expect(probeCount).toBe(2);
    });
  });
});
