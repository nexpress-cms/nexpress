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

import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";
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
import {
  GET as bansGET,
  POST as bansPOST,
} from "@/app/api/admin/community/bans/route";
import { DELETE as banDELETE } from "@/app/api/admin/community/bans/[id]/route";
import { GET as auditGET } from "@/app/api/admin/audit/route";

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

function cookieValue(setCookieHeader: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function seedActiveMember(
  handle: string,
  email: string,
  password: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const reg = await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  if (reg.status !== 200) throw new Error(`register failed: ${await reg.text()}`);

  const db = await getTestDb();
  const { createMemberEmailVerifyToken, nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle))
    .limit(1)) as Array<{ id: string }>;
  if (!row) throw new Error(`member ${handle} not found`);

  const issued = await createMemberEmailVerifyToken(db as never, row.id, 60_000);
  await verifyPOST(
    jsonRequest("/api/members/verify", { method: "POST", body: JSON.stringify({ token: issued.token }) }),
  );

  const login = await loginPOST(
    jsonRequest("/api/members/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  );
  if (login.status !== 200) throw new Error(`login failed: ${await login.text()}`);
  const sc = login.headers.get("set-cookie");
  return {
    memberId: row.id,
    sessionCookie: cookieValue(sc, "nx-mb-session")!,
    csrfCookie: cookieValue(sc, "nx-mb-csrf")!,
  };
}

async function seedStaffPost(staff: TestUserSession): Promise<string> {
  const create = await collectionPOST(
    staffRequest("/api/collections/posts", staff, {
      method: "POST",
      body: JSON.stringify({
        title: "Moderation target",
        slug: "moderation-target",
        content: { root: { type: "root", children: [] } },
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
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
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
        cookies: [`nx-mb-session=${reporter.sessionCookie}`, `nx-mb-csrf=${reporter.csrfCookie}`],
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
        cookies: [`nx-mb-session=${author.sessionCookie}`, `nx-mb-csrf=${author.csrfCookie}`],
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
    const after = await commentsGET(
      jsonRequest(`/api/collections/posts/${postId}/comments`),
      { params: Promise.resolve({ slug: "posts", id: postId }) },
    );
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
      staffRequest(
        `/api/admin/audit?targetType=comment&targetId=${commentId}`,
        staff,
      ),
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
      staffRequest(
        `/api/admin/audit?targetType=member&targetId=${target.memberId}`,
        staff,
      ),
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
        cookies: [`nx-mb-session=${reporter.sessionCookie}`, `nx-mb-csrf=${reporter.csrfCookie}`],
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
      staffRequest(
        `/api/admin/community/reports/${filedBody.body.id}/resolve`,
        staff,
        { method: "POST", body: JSON.stringify({ resolution: "dismissed" }) },
      ),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(first.status).toBe(200);

    const second = await resolveReportPOST(
      staffRequest(
        `/api/admin/community/reports/${filedBody.body.id}/resolve`,
        staff,
        { method: "POST", body: JSON.stringify({ resolution: "dismissed" }) },
      ),
      { params: Promise.resolve({ id: filedBody.body.id }) },
    );
    expect(second.status).toBe(400);
  });
});
