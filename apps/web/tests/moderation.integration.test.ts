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

  it("member files a comment report; mod hides the target and resolves it", async () => {
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
    const secondReporter = await seedActiveMember(
      "reporter1b",
      "reporter1b@example.com",
      "password-12",
    );
    const secondFiled = await readJson<{ id: string }>(
      await reportPOST(
        jsonRequest("/api/reports", {
          method: "POST",
          cookies: [
            `np-mb-session=${secondReporter.sessionCookie}`,
            `np-mb-csrf=${secondReporter.csrfCookie}`,
          ],
          headers: { "x-csrf-token": secondReporter.csrfCookie },
          body: JSON.stringify({ targetType: "comment", targetId: commentId, reason: "abuse" }),
        }),
      ),
    );
    expect(secondFiled.status).toBe(201);

    // Mod (editor) lists reports.
    const list = await adminReportsGET(staffRequest("/api/admin/community/reports", staff));
    const listBody = await readJson<{ docs: Array<{ id: string }>; totalDocs: number }>(list);
    expect(listBody.status).toBe(200);
    expect(listBody.body.totalDocs).toBe(2);
    expect(listBody.body.docs.map((report) => report.id)).toEqual(
      expect.arrayContaining([reportId, secondFiled.body.id]),
    );

    // Mod resolves the report.
    const resolved = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${reportId}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ action: "hide-comment" }),
      }),
      { params: Promise.resolve({ id: reportId }) },
    );
    expect(resolved.status).toBe(200);

    // A second reporter can close the same incident without applying the
    // comment penalty or audit side effects twice.
    const secondResolved = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${secondFiled.body.id}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ action: "hide-comment" }),
      }),
      { params: Promise.resolve({ id: secondFiled.body.id }) },
    );
    expect(secondResolved.status).toBe(200);

    const commentsAfter = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
    expect((await readJson<{ totalDocs: number }>(commentsAfter)).body.totalDocs).toBe(0);

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

    const nonModerator = await seedUser({ role: "author" });
    const { resolveReport } = await import("@nexpress/core/community");
    await expect(
      resolveReport({
        reportId: filedBody.body.id,
        action: "dismiss",
        actor: {
          kind: "staff",
          user: {
            id: nonModerator.userId,
            email: nonModerator.email,
            name: nonModerator.name,
            role: nonModerator.role,
            tokenVersion: 0,
          },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const incompatible = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filedBody.body.id}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ action: "hide-comment" }),
      }),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(incompatible.status).toBe(400);

    const first = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filedBody.body.id}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(first.status).toBe(200);

    const second = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filedBody.body.id}/resolve`, staff, {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(second.status).toBe(400);
  });

  it("rejects a malformed report id before resolution", async () => {
    const staff = await seedUser({ role: "moderator" });
    const response = await resolveReportPOST(
      staffRequest("/api/admin/community/reports/not-a-uuid/resolve", staff, {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
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
        // targetId omitted on purpose.
        body: JSON.stringify({ targetType: "comment", reason: "spam" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("reports a collection document, exposes context, deduplicates, and unpublishes", async () => {
    const moderator = await seedUser({ role: "moderator" });
    const editor = await seedUser({ role: "editor" });
    const postId = await seedStaffPost(editor);
    const reporter = await seedActiveMember(
      "document-reporter",
      "document-reporter@example.com",
      "password-12",
    );
    const reportRequest = () =>
      reportPOST(
        jsonRequest("/api/reports", {
          method: "POST",
          cookies: [`np-mb-session=${reporter.sessionCookie}`, `np-mb-csrf=${reporter.csrfCookie}`],
          headers: { "x-csrf-token": reporter.csrfCookie },
          body: JSON.stringify({ targetType: "posts", targetId: postId, reason: "illegal ad" }),
        }),
      );

    const filed = await readJson<{ id: string }>(await reportRequest());
    expect(filed.status).toBe(201);
    expect((await reportRequest()).status).toBe(409);

    const queue = await readJson<{
      docs: Array<{
        id: string;
        target: { kind: string; label: string; excerpt: string; href: string; status: string };
      }>;
    }>(await adminReportsGET(staffRequest("/api/admin/community/reports", moderator)));
    expect(queue.body.docs[0]).toMatchObject({
      id: filed.body.id,
      target: {
        kind: "document",
        label: "Moderation target",
        excerpt: "Moderation target",
        href: `/admin/collections/posts/${postId}`,
        status: "published",
      },
    });

    const { getDb } = await import("@nexpress/core/db");
    const { postsTable } = await import("@/db/generated/collections");
    const { eq } = await import("drizzle-orm");
    await getDb().update(postsTable).set({ status: "draft" }).where(eq(postsTable.id, postId));
    const staleAction = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filed.body.id}/resolve`, moderator, {
        method: "POST",
        body: JSON.stringify({ action: "unpublish-document" }),
      }),
      { params: Promise.resolve({ id: filed.body.id }) },
    );
    expect(staleAction.status).toBe(400);
    await getDb().update(postsTable).set({ status: "published" }).where(eq(postsTable.id, postId));

    // A caller cannot smuggle the moderation-only ACL bypass through the
    // public save options. Only the capability-gated helper owns that control.
    const { saveDocument } = await import("@nexpress/core/collections");
    const smuggledOptions = Object.assign(
      { status: "pending" as const },
      { bypassStaffAccess: true },
    ) as Parameters<typeof saveDocument>[4];
    await expect(
      saveDocument(
        "posts",
        postId,
        {},
        {
          id: moderator.userId,
          email: moderator.email,
          name: moderator.name,
          role: moderator.role,
          tokenVersion: 0,
        },
        smuggledOptions,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const resolved = await resolveReportPOST(
      staffRequest(`/api/admin/community/reports/${filed.body.id}/resolve`, moderator, {
        method: "POST",
        body: JSON.stringify({ action: "unpublish-document" }),
      }),
      { params: Promise.resolve({ id: filed.body.id }) },
    );
    const resolvedBody = await readJson<{ resolution: string }>(resolved);
    expect(resolvedBody.status).toBe(200);
    expect(resolvedBody.body.resolution).toBe("unpublish-document");

    const [post] = await getDb()
      .select({ status: postsTable.status })
      .from(postsTable)
      .where(eq(postsTable.id, postId));
    expect(post?.status).toBe("pending");

    // The partial unique index covers only unresolved rows, so a later
    // incident can be filed after moderators close the first report and the
    // document has passed review and returned to public visibility.
    await getDb().update(postsTable).set({ status: "published" }).where(eq(postsTable.id, postId));
    expect((await reportRequest()).status).toBe(201);
  });
});
