import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import {
  GET as commentsGET,
  POST as commentsPOST,
} from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as reportPOST } from "@/app/api/reports/route";
import { GET as adminReportsGET } from "@/app/api/admin/community/reports/route";
import { POST as resolveReportPOST } from "@/app/api/admin/community/reports/[id]/resolve/route";
import { POST as staffHidePOST } from "@/app/api/admin/community/comments/[id]/hide/route";
import { POST as staffRestorePOST } from "@/app/api/admin/community/comments/[id]/restore/route";
import { DELETE as staffDeleteDELETE } from "@/app/api/admin/community/comments/[id]/route";
import { GET as bansGET, POST as bansPOST } from "@/app/api/admin/community/bans/route";
import { DELETE as banDELETE } from "@/app/api/admin/community/bans/[id]/route";
import { GET as auditGET } from "@/app/api/admin/audit/route";

import { NextRequest } from "next/server";

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
        title: "Moderation target",
        slug: "moderation-target",
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

describe.skipIf(skipIfNoTestDb())("moderation API (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("member files a report; mod sees it; mod resolves it", async () => {
    const staff = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(staff);
    const author = await seedActiveMember("alpha", "alpha@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "spam content" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    // Reporter is a different member.
    const reporter = await seedActiveMember("reporter1", "reporter1@example.com", "password-12");
    const filed = await reportPOST(
      jsonRequest("/api/reports", {
        method: "POST",
        cookies: [`np-mb-session=${reporter.sessionCookie}`, `np-mb-csrf=${reporter.csrfCookie}`],
        headers: { "x-csrf-token": reporter.csrfCookie },
        body: JSON.stringify({ targetType: "comment", targetId: commentId, reason: "spam" }),
      }),
    );
    const filedBody = await readJson<{ id: string }>(filed);
    expect(filedBody.status).toBe(201);
    const reportId = filedBody.body.id;

    // Mod (editor) lists reports.
    const list = await adminReportsGET(staffRequest("/api/admin/community/reports", staff));
    const listBody = await readJson<{ docs: Array<{ id: string }>; totalDocs: number }>(list);
    expect(listBody.status).toBe(200);
    expect(listBody.body.totalDocs).toBe(1);
    expect(listBody.body.docs[0]?.id).toBe(reportId);

    // Mod resolves the report.
    const resolved = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${reportId}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ resolution: "hidden" }),
      }),
      { params: Promise.resolve({ id: reportId }) },
    );
    expect(resolved.status).toBe(200);

    // Default list (unresolved) is now empty.
    const after = await adminReportsGET(staffRequest("/api/admin/community/reports", staff));
    const afterBody = await readJson<{ totalDocs: number }>(after);
    expect(afterBody.body.totalDocs).toBe(0);
  });

  it("non-mod staff (author role) cannot list reports", async () => {
    const author = await seedUser({ role: "author" });
    const list = await adminReportsGET(staffRequest("/api/admin/community/reports", author));
    expect(list.status).toBe(403);
  });

  it("moderator role can list reports just like admin/editor", async () => {
    const mod = await seedUser({ role: "moderator" });
    const list = await adminReportsGET(staffRequest("/api/admin/community/reports", mod));
    expect(list.status).toBe(200);
  });

  it("staff hide + restore + delete a comment, audit log records each", async () => {
    const staff = await seedUser({ role: "moderator" });
    const postId = await seedStaffPost(await seedUser({ role: "editor" }));
    const author = await seedActiveMember("alpha2", "alpha2@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "rude" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const hide = await staffHidePOST(
      staffRequest(`/api/admin/community/comments/${commentId}/hide`, staff, {
        method: "POST",
        body: JSON.stringify({ reason: "rule violation" }),
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(hide.status).toBe(200);

    // Public listing hides it.
    const after = await commentsGET(jsonRequest(`/api/collections/posts/${postId}/comments`), {
      params: Promise.resolve({ slug: "posts", id: postId }),
    });
    const afterBody = await readJson<{ totalDocs: number }>(after);
    expect(afterBody.body.totalDocs).toBe(0);

    const restore = await staffRestorePOST(
      staffRequest(`/api/admin/community/comments/${commentId}/restore`, staff, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(restore.status).toBe(200);

    const del = await staffDeleteDELETE(
      staffRequest(`/api/admin/community/comments/${commentId}`, staff, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(del.status).toBe(200);

    // Audit log shows hide + restore + delete actions targeting the comment.
    const audit = await auditGET(
      staffRequest(`/api/admin/audit?targetType=comment&targetId=${commentId}`, staff),
    );
    const auditBody = await readJson<{ docs: Array<{ action: string }> }>(audit);
    expect(auditBody.status).toBe(200);
    const actions = auditBody.body.docs.map((d) => d.action).sort();
    expect(actions).toContain("comment.hide");
    expect(actions).toContain("comment.restore");
    expect(actions).toContain("comment.delete");
  });

  it("issue + revoke ban; audit log records both", async () => {
    const staff = await seedUser({ role: "admin" });
    const target = await seedActiveMember("target1", "target1@example.com", "password-12");

    const issued = await bansPOST(
      staffRequest("/api/admin/community/bans", staff, {
        method: "POST",
        body: JSON.stringify({
          memberId: target.memberId,
          scopeType: "site",
          kind: "permanent",
          reason: "harassment",
        }),
      }),
    );
    const issuedBody = await readJson<{ id: string }>(issued);
    expect(issuedBody.status).toBe(201);
    const banId = issuedBody.body.id;

    const list = await bansGET(
      staffRequest(`/api/admin/community/bans?memberId=${target.memberId}`, staff),
    );
    const listBody = await readJson<{ docs: Array<{ id: string }> }>(list);
    expect(listBody.body.docs).toHaveLength(1);

    const revoked = await banDELETE(
      staffRequest(`/api/admin/community/bans/${banId}`, staff, { method: "DELETE" }),
      { params: Promise.resolve({ id: banId }) },
    );
    expect(revoked.status).toBe(200);

    const after = await bansGET(
      staffRequest(`/api/admin/community/bans?memberId=${target.memberId}`, staff),
    );
    const afterBody = await readJson<{ docs: Array<unknown> }>(after);
    expect(afterBody.body.docs).toHaveLength(0);

    const audit = await auditGET(
      staffRequest(`/api/admin/audit?targetType=member&targetId=${target.memberId}`, staff),
    );
    const auditBody = await readJson<{ docs: Array<{ action: string }> }>(audit);
    const actions = auditBody.body.docs.map((d) => d.action).sort();
    expect(actions).toContain("member.ban");
    expect(actions).toContain("member.unban");
  });

  it("temporary ban without expiresAt is rejected", async () => {
    const staff = await seedUser({ role: "admin" });
    const target = await seedActiveMember("target2", "target2@example.com", "password-12");

    const res = await bansPOST(
      staffRequest("/api/admin/community/bans", staff, {
        method: "POST",
        body: JSON.stringify({
          memberId: target.memberId,
          scopeType: "site",
          kind: "temporary",
          // expiresAt omitted on purpose
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("scoped ban without scopeId is rejected", async () => {
    const staff = await seedUser({ role: "admin" });
    const target = await seedActiveMember("target3", "target3@example.com", "password-12");

    const res = await bansPOST(
      staffRequest("/api/admin/community/bans", staff, {
        method: "POST",
        body: JSON.stringify({
          memberId: target.memberId,
          scopeType: "collection",
          kind: "permanent",
          // scopeId omitted on purpose
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("resolving an already-resolved report fails", async () => {
    const staff = await seedUser({ role: "editor" });
    const reporter = await seedActiveMember("reporter2", "reporter2@example.com", "password-12");

    const filed = await reportPOST(
      jsonRequest("/api/reports", {
        method: "POST",
        cookies: [`np-mb-session=${reporter.sessionCookie}`, `np-mb-csrf=${reporter.csrfCookie}`],
        headers: { "x-csrf-token": reporter.csrfCookie },
        body: JSON.stringify({
          targetType: "member",
          targetId: reporter.memberId,
          reason: "self-report-test",
        }),
      }),
    );
    const filedBody = await readJson<{ id: string }>(filed);
    expect(filedBody.status).toBe(201);

    const first = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filedBody.body.id}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ resolution: "dismissed" }),
      }),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(first.status).toBe(200);

    const second = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filedBody.body.id}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ resolution: "dismissed" }),
      }),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(second.status).toBe(400);
  });

  // Regression: SQL operator precedence in listBansForMember had `AND`
  // bind tighter than `OR`, leaking other members' active temp bans.
  it("listBansForMember scopes results by member (no cross-member leak)", async () => {
    const staff = await seedUser({ role: "admin" });
    const memberA = await seedActiveMember("member-a", "member-a@example.com", "password-12");
    const memberB = await seedActiveMember("member-b", "member-b@example.com", "password-12");

    // Permanent ban on A.
    await bansPOST(
      staffRequest("/api/admin/community/bans", staff, {
        method: "POST",
        body: JSON.stringify({
          memberId: memberA.memberId,
          scopeType: "site",
          kind: "permanent",
          reason: "permanent-on-A",
        }),
      }),
    );
    // Active temp ban on B.
    const oneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await bansPOST(
      staffRequest("/api/admin/community/bans", staff, {
        method: "POST",
        body: JSON.stringify({
          memberId: memberB.memberId,
          scopeType: "site",
          kind: "temporary",
          expiresAt: oneHour,
          reason: "temp-on-B",
        }),
      }),
    );

    // Querying A must NOT return B's ban — that was the precedence bug.
    const resA = await bansGET(
      staffRequest(`/api/admin/community/bans?memberId=${memberA.memberId}`, staff),
    );
    const bodyA = await readJson<{ docs: Array<{ memberId: string; reason: string }> }>(resA);
    expect(bodyA.body.docs).toHaveLength(1);
    expect(bodyA.body.docs[0]?.memberId).toBe(memberA.memberId);
    expect(bodyA.body.docs[0]?.reason).toBe("permanent-on-A");

    const resB = await bansGET(
      staffRequest(`/api/admin/community/bans?memberId=${memberB.memberId}`, staff),
    );
    const bodyB = await readJson<{ docs: Array<{ memberId: string; reason: string }> }>(resB);
    expect(bodyB.body.docs).toHaveLength(1);
    expect(bodyB.body.docs[0]?.memberId).toBe(memberB.memberId);
    expect(bodyB.body.docs[0]?.reason).toBe("temp-on-B");
  });

  it("temporary ban with past expiresAt is rejected", async () => {
    const staff = await seedUser({ role: "admin" });
    const target = await seedActiveMember("target-past", "target-past@example.com", "password-12");

    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await bansPOST(
      staffRequest("/api/admin/community/bans", staff, {
        method: "POST",
        body: JSON.stringify({
          memberId: target.memberId,
          scopeType: "site",
          kind: "temporary",
          expiresAt: past,
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("staff hide/restore/delete on a non-existent comment returns 404", async () => {
    const staff = await seedUser({ role: "moderator" });
    const ghostId = "00000000-0000-0000-0000-000000000000";

    const hide = await staffHidePOST(
      staffRequest(`/api/admin/community/comments/${ghostId}/hide`, staff, {
        method: "POST",
        body: JSON.stringify({ reason: "ghost" }),
      }),
      { params: Promise.resolve({ id: ghostId }) },
    );
    expect(hide.status).toBe(404);

    const restore = await staffRestorePOST(
      staffRequest(`/api/admin/community/comments/${ghostId}/restore`, staff, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: ghostId }) },
    );
    expect(restore.status).toBe(404);

    const del = await staffDeleteDELETE(
      staffRequest(`/api/admin/community/comments/${ghostId}`, staff, { method: "DELETE" }),
      { params: Promise.resolve({ id: ghostId }) },
    );
    expect(del.status).toBe(404);

    // None of the failed ops wrote phantom audit rows.
    const audit = await auditGET(
      staffRequest(`/api/admin/audit?targetType=comment&targetId=${ghostId}`, staff),
    );
    const auditBody = await readJson<{ totalDocs: number }>(audit);
    expect(auditBody.body.totalDocs).toBe(0);
  });

  it("staff restore rejects a comment that was deleted (would surface empty body)", async () => {
    const editor = await seedUser({ role: "editor" });
    const mod = await seedUser({ role: "moderator" });
    const postId = await seedStaffPost(editor);
    const author = await seedActiveMember("rd-author", "rd-author@example.com", "password-12");

    const created = await commentsPOST(
      jsonRequest(`/api/collections/posts/${postId}/comments`, {
        method: "POST",
        cookies: [`np-mb-session=${author.sessionCookie}`, `np-mb-csrf=${author.csrfCookie}`],
        headers: { "x-csrf-token": author.csrfCookie },
        body: JSON.stringify({ bodyMd: "delete-me" }),
      }),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    const { id: commentId } = await readJson<{ id: string }>(created).then((r) => r.body);

    const del = await staffDeleteDELETE(
      staffRequest(`/api/admin/community/comments/${commentId}`, mod, { method: "DELETE" }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(del.status).toBe(200);

    // Restoring a deleted row would surface a ghost comment (empty body
    // but original author / timestamp). Service must refuse.
    const restore = await staffRestorePOST(
      staffRequest(`/api/admin/community/comments/${commentId}/restore`, mod, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: commentId }) },
    );
    expect(restore.status).toBe(400);
  });

  it("file report rejects empty targetId", async () => {
    const reporter = await seedActiveMember("empty-reporter", "empty@example.com", "password-12");

    const res = await reportPOST(
      jsonRequest("/api/reports", {
        method: "POST",
        cookies: [`np-mb-session=${reporter.sessionCookie}`, `np-mb-csrf=${reporter.csrfCookie}`],
        headers: { "x-csrf-token": reporter.csrfCookie },
        // targetId omitted on purpose — route coerces to "" and forwards.
        body: JSON.stringify({ targetType: "comment", reason: "spam" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  /**
   * Phase 9.9 — `reply` and `thread` report targets are
   * activated. `reply` resolves to a comment row (replies are
   * stored in np_comments alongside top-level comments).
   * `thread` resolves to a row in the registered `discussions`
   * collection (forum plugin's default slug).
   */
  it("file report accepts a `reply` target by looking up the comment row", async () => {
    const { fileReport, npComments } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const reporter = await seedActiveMember("reply-reporter", "reply-r@example.com", "password-12");
    const author = await seedActiveMember("reply-author", "reply-a@example.com", "password-12");

    // Replies are stored in `np_comments` (Phase 9.2 decision:
    // forum replies reuse the comments table). Insert directly
    // so we don't need a real `posts` row to anchor the
    // synthetic reply against.
    const db = getDb();
    const replyId = "11111111-1111-4111-8111-111111111111";
    await db.insert(npComments).values({
      id: replyId,
      memberId: author.memberId,
      targetType: "posts",
      targetId: "22222222-2222-4222-8222-222222222222",
      bodyMd: "stand-in reply body",
      bodyHtml: "<p>stand-in reply body</p>",
      status: "visible",
    });

    const report = await fileReport({
      reporterId: reporter.memberId,
      targetType: "reply",
      targetId: replyId,
      reason: "rude reply",
    });
    expect(report.targetType).toBe("reply");
    expect(report.targetId).toBe(replyId);
  });

  it("file report rejects a `thread` target with an unresolvable id", async () => {
    const { fileReport, NpNotFoundError, NpValidationError } = await import("@nexpress/core");
    const reporter = await seedActiveMember(
      "thread-reporter",
      "thread-r@example.com",
      "password-12",
    );

    // Two valid outcomes depending on whether prior tests in
    // the same vitest run registered the `discussions`
    // collection (forum plugin):
    //   - Not registered → NpValidationError (clear "feature
    //     not enabled" message)
    //   - Registered but no such id → NpNotFoundError
    // Both are correct rejections — the contract is "fileReport
    // doesn't accept thread targets that can't be resolved."
    await expect(
      fileReport({
        reporterId: reporter.memberId,
        targetType: "thread",
        targetId: "00000000-0000-0000-0000-000000000000",
        reason: "spam thread",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof NpValidationError || error instanceof NpNotFoundError,
    );
  });
});
