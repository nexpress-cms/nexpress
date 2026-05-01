import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
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
  GET as userIdentitiesGET,
} from "@/app/api/admin/users/[id]/identities/route";
import {
  DELETE as userIdentityDELETE,
} from "@/app/api/admin/users/[id]/identities/[identityId]/route";
import {
  GET as memberIdentitiesGET,
} from "@/app/api/admin/members/[id]/identities/route";
import {
  DELETE as memberIdentityDELETE,
} from "@/app/api/admin/members/[id]/identities/[identityId]/route";

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

async function seedUserIdentity(
  userId: string,
  provider: string,
  providerUserId: string,
): Promise<string> {
  const db = await getTestDb();
  const { nxUserOAuthIdentities } = await import("@nexpress/core");
  const [row] = (await db
    .insert(nxUserOAuthIdentities)
    .values({
      userId,
      provider,
      providerUserId,
      metadata: { test: true },
    })
    .returning({ id: nxUserOAuthIdentities.id })) as Array<{ id: string }>;
  return row.id;
}

async function seedMemberIdentity(
  memberId: string,
  provider: string,
  subject: string,
  email: string | null = null,
): Promise<string> {
  const db = await getTestDb();
  const { nxMemberIdentities } = await import("@nexpress/core");
  const [row] = (await db
    .insert(nxMemberIdentities)
    .values({
      memberId,
      provider,
      subject,
      email,
      metadata: { test: true },
    })
    .returning({ id: nxMemberIdentities.id })) as Array<{ id: string }>;
  return row.id;
}

async function seedMember(handle: string): Promise<string> {
  const db = await getTestDb();
  const { hashPassword, nxMembers } = await import("@nexpress/core");
  const password = await hashPassword("password-12");
  const [row] = (await db
    .insert(nxMembers)
    .values({
      handle,
      email: `${handle}@example.com`,
      displayName: handle,
      password,
      status: "active",
    })
    .returning({ id: nxMembers.id })) as Array<{ id: string }>;
  return row.id;
}

describe.skipIf(skipIfNoTestDb())("identities admin (integration)", () => {
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

  describe("/api/admin/users/[id]/identities", () => {
    it("admin can list a user's linked identities", async () => {
      const admin = await seedUser({ role: "admin" });
      const target = await seedUser({ email: "target@example.com", role: "editor" });
      await seedUserIdentity(target.userId, "github", "gh-12345");
      await seedUserIdentity(target.userId, "google", "go-67890");

      const res = await userIdentitiesGET(
        staffRequest(`/api/admin/users/${target.userId}/identities`, admin),
        { params: Promise.resolve({ id: target.userId }) },
      );
      const body = await readJson<{
        identities: Array<{ provider: string; providerUserId: string }>;
      }>(res);
      expect(body.status).toBe(200);
      expect(body.body.identities).toHaveLength(2);
      const providers = body.body.identities.map((i) => i.provider).sort();
      expect(providers).toEqual(["github", "google"]);
    });

    it("editor cannot list (admin-only)", async () => {
      const editor = await seedUser({ role: "editor" });
      const target = await seedUser({ email: "t2@example.com" });
      const res = await userIdentitiesGET(
        staffRequest(`/api/admin/users/${target.userId}/identities`, editor),
        { params: Promise.resolve({ id: target.userId }) },
      );
      expect(res.status).toBe(403);
    });

    it("unauthenticated request rejected", async () => {
      const target = await seedUser({ email: "t3@example.com" });
      const res = await userIdentitiesGET(
        buildRequest(`/api/admin/users/${target.userId}/identities`),
        { params: Promise.resolve({ id: target.userId }) },
      );
      expect(res.status).toBe(401);
    });

    it("404 on missing user", async () => {
      const admin = await seedUser({ role: "admin" });
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await userIdentitiesGET(
        staffRequest(`/api/admin/users/${fakeId}/identities`, admin),
        { params: Promise.resolve({ id: fakeId }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/users/[id]/identities/[identityId]", () => {
    it("admin revokes; row deleted; audit event recorded", async () => {
      const admin = await seedUser({ role: "admin" });
      const target = await seedUser({ email: "del-target@example.com" });
      const identityId = await seedUserIdentity(target.userId, "github", "gh-revoke");

      const res = await userIdentityDELETE(
        staffRequest(
          `/api/admin/users/${target.userId}/identities/${identityId}`,
          admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ id: target.userId, identityId }) },
      );
      expect(res.status).toBe(200);

      // Verify removal.
      const db = await getTestDb();
      const { nxUserOAuthIdentities, nxAuditEvents } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const remaining = (await db
        .select()
        .from(nxUserOAuthIdentities)
        .where(eq(nxUserOAuthIdentities.id, identityId))) as Array<unknown>;
      expect(remaining).toHaveLength(0);

      // Audit event captured.
      const audits = (await db
        .select()
        .from(nxAuditEvents)
        .where(eq(nxAuditEvents.action, "user.identity.revoke"))) as Array<{
        actorUserId: string | null;
        targetType: string | null;
        targetId: string | null;
        payload: Record<string, unknown>;
      }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].actorUserId).toBe(admin.userId);
      expect(audits[0].targetType).toBe("user");
      expect(audits[0].targetId).toBe(target.userId);
      expect(audits[0].payload.provider).toBe("github");
      expect(audits[0].payload.providerUserId).toBe("gh-revoke");
    });

    it("editor cannot revoke (admin-only)", async () => {
      const editor = await seedUser({ role: "editor" });
      const target = await seedUser({ email: "edit-target@example.com" });
      const identityId = await seedUserIdentity(target.userId, "github", "gh-eds");
      const res = await userIdentityDELETE(
        staffRequest(
          `/api/admin/users/${target.userId}/identities/${identityId}`,
          editor,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ id: target.userId, identityId }) },
      );
      expect(res.status).toBe(403);
    });

    it("identity belonging to a different user surfaces 404", async () => {
      const admin = await seedUser({ role: "admin" });
      const a = await seedUser({ email: "a@example.com" });
      const b = await seedUser({ email: "b@example.com" });
      const aIdentity = await seedUserIdentity(a.userId, "github", "gh-a");

      // Hit DELETE with b's id but a's identityId — must NOT delete.
      const res = await userIdentityDELETE(
        staffRequest(
          `/api/admin/users/${b.userId}/identities/${aIdentity}`,
          admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ id: b.userId, identityId: aIdentity }) },
      );
      expect(res.status).toBe(404);

      // a's identity should still exist.
      const db = await getTestDb();
      const { nxUserOAuthIdentities } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const remaining = (await db
        .select()
        .from(nxUserOAuthIdentities)
        .where(eq(nxUserOAuthIdentities.id, aIdentity))) as Array<unknown>;
      expect(remaining).toHaveLength(1);
    });

    // CSRF enforcement moved to apps/web/src/proxy.ts (#281); the
    // handler unit test no longer covers it since direct handler
    // invocation bypasses the proxy.
  });

  describe("/api/admin/members/[id]/identities", () => {
    it("editor can list a member's linked identities", async () => {
      const editor = await seedUser({ role: "editor" });
      const memberId = await seedMember("alpha");
      await seedMemberIdentity(memberId, "github", "gh-alpha", "alpha@example.com");

      const res = await memberIdentitiesGET(
        staffRequest(`/api/admin/members/${memberId}/identities`, editor),
        { params: Promise.resolve({ id: memberId }) },
      );
      const body = await readJson<{
        identities: Array<{ provider: string; subject: string; email: string | null }>;
      }>(res);
      expect(body.status).toBe(200);
      expect(body.body.identities).toHaveLength(1);
      expect(body.body.identities[0].provider).toBe("github");
      expect(body.body.identities[0].email).toBe("alpha@example.com");
    });

    it("author cannot list", async () => {
      const author = await seedUser({ role: "author" });
      const memberId = await seedMember("beta");
      const res = await memberIdentitiesGET(
        staffRequest(`/api/admin/members/${memberId}/identities`, author),
        { params: Promise.resolve({ id: memberId }) },
      );
      expect(res.status).toBe(403);
    });

    it("404 on missing member", async () => {
      const editor = await seedUser({ role: "editor" });
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await memberIdentitiesGET(
        staffRequest(`/api/admin/members/${fakeId}/identities`, editor),
        { params: Promise.resolve({ id: fakeId }) },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/members/[id]/identities/[identityId]", () => {
    it("admin revokes member identity; audit recorded", async () => {
      const admin = await seedUser({ role: "admin" });
      const memberId = await seedMember("gamma");
      const identityId = await seedMemberIdentity(memberId, "github", "gh-gamma");

      const res = await memberIdentityDELETE(
        staffRequest(
          `/api/admin/members/${memberId}/identities/${identityId}`,
          admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ id: memberId, identityId }) },
      );
      expect(res.status).toBe(200);

      const db = await getTestDb();
      const { nxMemberIdentities, nxAuditEvents } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const remaining = (await db
        .select()
        .from(nxMemberIdentities)
        .where(eq(nxMemberIdentities.id, identityId))) as Array<unknown>;
      expect(remaining).toHaveLength(0);

      const audits = (await db
        .select()
        .from(nxAuditEvents)
        .where(eq(nxAuditEvents.action, "member.identity.revoke"))) as Array<{
        actorUserId: string | null;
        targetType: string | null;
        targetId: string | null;
        payload: Record<string, unknown>;
      }>;
      expect(audits).toHaveLength(1);
      expect(audits[0].actorUserId).toBe(admin.userId);
      expect(audits[0].targetType).toBe("member");
      expect(audits[0].targetId).toBe(memberId);
      expect(audits[0].payload.provider).toBe("github");
      expect(audits[0].payload.subject).toBe("gh-gamma");
    });

    it("editor cannot revoke member identity (admin-only)", async () => {
      const editor = await seedUser({ role: "editor" });
      const memberId = await seedMember("delta");
      const identityId = await seedMemberIdentity(memberId, "github", "gh-delta");

      const res = await memberIdentityDELETE(
        staffRequest(
          `/api/admin/members/${memberId}/identities/${identityId}`,
          editor,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ id: memberId, identityId }) },
      );
      expect(res.status).toBe(403);
    });

    it("revoking another member's identity surfaces 404", async () => {
      const admin = await seedUser({ role: "admin" });
      const a = await seedMember("eve");
      const b = await seedMember("frank");
      const aIdentity = await seedMemberIdentity(a, "github", "gh-eve");

      const res = await memberIdentityDELETE(
        staffRequest(
          `/api/admin/members/${b}/identities/${aIdentity}`,
          admin,
          { method: "DELETE" },
        ),
        { params: Promise.resolve({ id: b, identityId: aIdentity }) },
      );
      expect(res.status).toBe(404);

      const db = await getTestDb();
      const { nxMemberIdentities } = await import("@nexpress/core");
      const { eq } = await import("drizzle-orm");
      const remaining = (await db
        .select()
        .from(nxMemberIdentities)
        .where(eq(nxMemberIdentities.id, aIdentity))) as Array<unknown>;
      expect(remaining).toHaveLength(1);
    });
  });
});
