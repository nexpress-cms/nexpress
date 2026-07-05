import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
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

import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as collectionPOST } from "@/app/api/collections/[slug]/route";
import { POST as commentsPOST } from "@/app/api/collections/[slug]/[id]/comments/route";
import { POST as reactionPOST } from "@/app/api/reactions/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/admin/community/settings/route";

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
        title: "Settings target",
        slug: `settings-target-${Math.random().toString(36).slice(2)}`,
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

async function seedComment(
  postId: string,
  member: { sessionCookie: string; csrfCookie: string },
  body = "test",
): Promise<string> {
  const created = await commentsPOST(
    memberRequest(`/api/collections/posts/${postId}/comments`, member, {
      method: "POST",
      body: JSON.stringify({ bodyMd: body }),
    }),
    { params: Promise.resolve({ slug: "posts", id: postId }) },
  );
  const { body: data } = await readJson<{ id: string }>(created);
  return data.id;
}

describe.skipIf(skipIfNoTestDb())("community settings (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    const core = await import("@nexpress/core");
    core.resetReputationAdapter();
    core.resetSpamAdapter();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  describe("GET /api/admin/community/settings", () => {
    it("returns defaults when no row exists", async () => {
      const admin = await seedUser({ role: "admin" });
      const res = await settingsGET(staffRequest("/api/admin/community/settings", admin));
      const body = await readJson<{
        reactionKinds: string[];
        registrationEnabled: boolean;
      }>(res);
      expect(body.status).toBe(200);
      expect(body.body.reactionKinds).toEqual(["like"]);
      expect(body.body.registrationEnabled).toBe(true);
    });

    it("moderator can read", async () => {
      const mod = await seedUser({ role: "moderator" });
      const res = await settingsGET(staffRequest("/api/admin/community/settings", mod));
      expect(res.status).toBe(200);
    });

    it("author role is forbidden", async () => {
      const author = await seedUser({ role: "author" });
      const res = await settingsGET(staffRequest("/api/admin/community/settings", author));
      expect(res.status).toBe(403);
    });

    it("unauthenticated request rejected", async () => {
      const res = await settingsGET(buildRequest("/api/admin/community/settings"));
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/admin/community/settings", () => {
    it("admin can update reactionKinds and registrationEnabled", async () => {
      const admin = await seedUser({ role: "admin" });
      const res = await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({
            reactionKinds: ["like", "love", "fire"],
            registrationEnabled: false,
          }),
        }),
      );
      const body = await readJson<{
        reactionKinds: string[];
        registrationEnabled: boolean;
      }>(res);
      expect(body.status).toBe(200);
      expect(body.body.reactionKinds).toEqual(["like", "love", "fire"]);
      expect(body.body.registrationEnabled).toBe(false);

      // Persisted across reads.
      const re = await settingsGET(staffRequest("/api/admin/community/settings", admin));
      const after = await readJson<{ reactionKinds: string[] }>(re);
      expect(after.body.reactionKinds).toEqual(["like", "love", "fire"]);
    });

    it("moderator cannot update (admin-only)", async () => {
      const mod = await seedUser({ role: "moderator" });
      const res = await settingsPUT(
        staffRequest("/api/admin/community/settings", mod, {
          method: "PUT",
          body: JSON.stringify({ registrationEnabled: false }),
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects malformed reaction kind with field-level error", async () => {
      const admin = await seedUser({ role: "admin" });
      const res = await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({ reactionKinds: ["like", "BadKind"] }),
        }),
      );
      const body = await readJson<{
        error?: { details?: Array<{ field?: string; message?: string }> };
      }>(res);
      expect(body.status).toBe(400);
      expect(body.body.error?.details?.[0]?.field).toBe("reactionKinds[1]");
    });

    it("rejects duplicate reaction kinds", async () => {
      const admin = await seedUser({ role: "admin" });
      const res = await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({ reactionKinds: ["like", "like"] }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("partial update preserves untouched fields", async () => {
      const admin = await seedUser({ role: "admin" });
      // Set both first.
      await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({
            reactionKinds: ["heart"],
            registrationEnabled: false,
          }),
        }),
      );
      // Now patch only registrationEnabled.
      const res = await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({ registrationEnabled: true }),
        }),
      );
      const body = await readJson<{
        reactionKinds: string[];
        registrationEnabled: boolean;
      }>(res);
      expect(body.status).toBe(200);
      expect(body.body.reactionKinds).toEqual(["heart"]);
      expect(body.body.registrationEnabled).toBe(true);
    });
  });

  describe("registration gate", () => {
    it("registration disabled → /api/members/register returns 403", async () => {
      const admin = await seedUser({ role: "admin" });
      await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({ registrationEnabled: false }),
        }),
      );

      const res = await registerPOST(
        jsonRequest("/api/members/register", {
          method: "POST",
          body: JSON.stringify({
            email: "blocked@example.com",
            password: "password-12",
            handle: "blocked",
            displayName: "Blocked",
          }),
        }),
      );
      expect(res.status).toBe(403);
    });

    it("registration enabled (default) → /api/members/register works", async () => {
      const res = await registerPOST(
        jsonRequest("/api/members/register", {
          method: "POST",
          body: JSON.stringify({
            email: "ok@example.com",
            password: "password-12",
            handle: "okhandle",
            displayName: "OK",
          }),
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("reaction kind allow-list", () => {
    it("default settings allow `like`", async () => {
      const staff = await seedUser({ role: "editor" });
      const postId = await seedStaffPost(staff);
      const author = await seedActiveMember("cs-anna", "cs-anna@example.com", "password-12");
      const reactor = await seedActiveMember("cs-bea", "cs-bea@example.com", "password-12");
      const commentId = await seedComment(postId, author);

      const res = await reactionPOST(
        memberRequest("/api/reactions", reactor, {
          method: "POST",
          body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
        }),
      );
      expect(res.status).toBe(201);
    });

    it("kind not in allow-list is rejected with 400", async () => {
      const admin = await seedUser({ role: "admin" });
      // Allow-list includes only `like` by default; `love` is rejected.
      const staff = await seedUser({ role: "editor" });
      const postId = await seedStaffPost(staff);
      const author = await seedActiveMember("cs-carl", "cs-carl@example.com", "password-12");
      const reactor = await seedActiveMember("cs-dora", "cs-dora@example.com", "password-12");
      const commentId = await seedComment(postId, author);

      const res = await reactionPOST(
        memberRequest("/api/reactions", reactor, {
          method: "POST",
          body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "love" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await readJson<{
        error?: { details?: Array<{ field?: string; message?: string }> };
      }>(res);
      expect(body.body.error?.details?.[0]?.field).toBe("kind");

      // After admin adds `love`, reaction succeeds.
      await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({ reactionKinds: ["like", "love"] }),
        }),
      );
      const after = await reactionPOST(
        memberRequest("/api/reactions", reactor, {
          method: "POST",
          body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "love" }),
        }),
      );
      expect(after.status).toBe(201);
    });

    it("empty list disables reactions entirely", async () => {
      const admin = await seedUser({ role: "admin" });
      await settingsPUT(
        staffRequest("/api/admin/community/settings", admin, {
          method: "PUT",
          body: JSON.stringify({ reactionKinds: [] }),
        }),
      );

      const staff = await seedUser({ role: "editor" });
      const postId = await seedStaffPost(staff);
      const author = await seedActiveMember("cs-eve", "cs-eve@example.com", "password-12");
      const reactor = await seedActiveMember("cs-fan", "cs-fan@example.com", "password-12");
      const commentId = await seedComment(postId, author);

      const res = await reactionPOST(
        memberRequest("/api/reactions", reactor, {
          method: "POST",
          body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("collection-scoped bans block reactions on comments in that collection", async () => {
      const admin = await seedUser({ role: "admin" });
      const staff = await seedUser({ role: "editor" });
      const postId = await seedStaffPost(staff);
      const author = await seedActiveMember("cs-gia", "cs-gia@example.com", "password-12");
      const reactor = await seedActiveMember("cs-han", "cs-han@example.com", "password-12");
      const commentId = await seedComment(postId, author);

      const { issueBan } = await import("@nexpress/core");
      await issueBan({
        memberId: reactor.memberId,
        scopeType: "collection",
        scopeId: "posts",
        kind: "permanent",
        reason: "reaction scope regression",
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

      const res = await reactionPOST(
        memberRequest("/api/reactions", reactor, {
          method: "POST",
          body: JSON.stringify({ targetType: "comment", targetId: commentId, kind: "like" }),
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});
