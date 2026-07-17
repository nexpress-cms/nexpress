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

import {
  GET as roleGrantsGET,
  POST as roleGrantsPOST,
} from "@/app/api/admin/community/role-grants/route";
import { DELETE as roleGrantDELETE } from "@/app/api/admin/community/role-grants/[id]/route";
import { GET as rolesGET } from "@/app/api/admin/community/roles/route";
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

async function seedActiveMember(handle: string): Promise<{ memberId: string }> {
  const session = await harnessSeedActiveMember({ handle });
  return { memberId: session.memberId };
}

describe.skipIf(skipIfNoTestDb())("member role grants (Phase 9.5b)", () => {
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

  it("admin grants community-mod (site), member-can() now resolves the capability", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("rg-anna");

    const granted = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "community-mod",
          scopeType: "site",
        }),
      }),
    );
    expect(granted.status).toBe(201);
    const { id: grantId } = await readJson<{ id: string }>(granted).then((r) => r.body);
    expect(typeof grantId).toBe("string");

    // memberCan() should now reflect the grant — community-mod
    // includes `hide-comment` site-wide, so a hide-comment probe
    // succeeds even though the member is otherwise an ordinary
    // account. (`scopes` is a per-target scope chain — site grants
    // match regardless of what's in it.)
    const { memberCan } = await import("@nexpress/core");
    const allowed = await memberCan(member.memberId, "hide-comment", {
      type: "comment",
      id: "00000000-0000-0000-0000-000000000000",
      ownerId: "00000000-0000-0000-0000-000000000001",
      scopes: [],
    });
    expect(allowed).toBe(true);
  });

  it("listing returns the active grant; revoke clears it; audit log records both", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("rg-bea");

    const granted = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "category-mod",
          scopeType: "category",
          scopeId: "general",
        }),
      }),
    );
    const { id: grantId } = await readJson<{ id: string }>(granted).then((r) => r.body);

    const list = await roleGrantsGET(
      staffRequest(`/api/admin/community/role-grants?memberId=${member.memberId}`, admin),
    );
    const listBody = await readJson<{ docs: Array<{ id: string; scopeId: string }> }>(list);
    expect(listBody.body.docs).toHaveLength(1);
    expect(listBody.body.docs[0].scopeId).toBe("general");

    const revoked = await roleGrantDELETE(
      staffRequest(`/api/admin/community/role-grants/${grantId}`, admin, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: grantId }) },
    );
    expect(revoked.status).toBe(200);

    const after = await roleGrantsGET(
      staffRequest(`/api/admin/community/role-grants?memberId=${member.memberId}`, admin),
    );
    const afterBody = await readJson<{ docs: Array<unknown> }>(after);
    expect(afterBody.body.docs).toHaveLength(0);

    const audit = await auditGET(
      staffRequest(`/api/admin/audit?targetType=member&targetId=${member.memberId}`, admin),
    );
    const auditBody = await readJson<{ docs: Array<{ action: string }> }>(audit);
    const actions = auditBody.body.docs.map((d) => d.action).sort();
    expect(actions).toContain("member.role.grant");
    expect(actions).toContain("member.role.revoke");
  });

  it("granting a non-registered (role, scope) pair is rejected with 400", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("rg-carl");

    const res = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          // category-mod is registered for `category` scope, not site —
          // a `category-mod` site-wide grant must be rejected.
          role: "category-mod",
          scopeType: "site",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      error?: { details?: Array<{ field?: string; message?: string }> };
    }>(res);
    const detail = body.body.error?.details?.[0];
    expect(detail?.field).toBe("role");
  });

  it("scoped grant without scopeId is rejected with 400", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("rg-dora");

    const res = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "category-mod",
          scopeType: "category",
          // scopeId omitted on purpose
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("duplicate grant is rejected with 409 (NULLS NOT DISTINCT unique)", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("rg-eric");

    const first = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "community-mod",
          scopeType: "site",
        }),
      }),
    );
    expect(first.status).toBe(201);

    const dup = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "community-mod",
          scopeType: "site",
        }),
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("editor cannot grant (admin-only); editor CAN list (staff-mod read)", async () => {
    const admin = await seedUser({ role: "admin" });
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("rg-flo");

    // First, admin grants — so the listing has something to show.
    await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", admin, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "community-mod",
          scopeType: "site",
        }),
      }),
    );

    // Editor can list (staff-mod read).
    const list = await roleGrantsGET(
      staffRequest(`/api/admin/community/role-grants?memberId=${member.memberId}`, editor),
    );
    expect(list.status).toBe(200);
    const listBody = await readJson<{ docs: Array<unknown> }>(list);
    expect(listBody.body.docs).toHaveLength(1);

    // But editor cannot grant a new one (admin-only write).
    const denied = await roleGrantsPOST(
      staffRequest("/api/admin/community/role-grants", editor, {
        method: "POST",
        body: JSON.stringify({
          memberId: member.memberId,
          role: "category-mod",
          scopeType: "category",
          scopeId: "another",
        }),
      }),
    );
    expect(denied.status).toBe(403);
  });

  it("roles registry endpoint returns built-in role definitions", async () => {
    const admin = await seedUser({ role: "admin" });
    const res = await rolesGET(staffRequest("/api/admin/community/roles", admin));
    expect(res.status).toBe(200);
    const body = await readJson<{
      docs: Array<{ role: string; scopeType: string }>;
    }>(res);
    const summary = body.body.docs.map((d) => `${d.scopeType}:${d.role}`);
    expect(summary).toContain("site:community-mod");
    expect(summary).toContain("category:category-mod");
    expect(summary).toContain("collection:collection-mod");
  });

  it("revoking a non-existent grant returns 404", async () => {
    const admin = await seedUser({ role: "admin" });
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await roleGrantDELETE(
      staffRequest(`/api/admin/community/role-grants/${fakeId}`, admin, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: fakeId }) },
    );
    expect(res.status).toBe(404);
  });
});
