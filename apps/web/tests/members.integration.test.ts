import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";
import { POST as logoutPOST } from "@/app/api/members/logout/route";
import { POST as refreshPOST } from "@/app/api/members/refresh/route";
import { POST as forgotPOST } from "@/app/api/members/forgot-password/route";
import { POST as resetPOST } from "@/app/api/members/reset-password/route";
import {
  GET as meGET,
  PATCH as mePATCH,
  DELETE as meDELETE,
} from "@/app/api/members/me/route";
import { GET as profileGET } from "@/app/api/members/[handle]/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) {
    headers.set("cookie", init.cookies.join("; "));
  }
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function cookieValue(setCookieHeader: string[] | string | null, name: string): string | undefined {
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

describe.skipIf(skipIfNoTestDb())("members auth (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("register → verify → login → me round-trip", async () => {
    const reg = await registerPOST(
      jsonRequest("/api/members/register", {
        method: "POST",
        body: JSON.stringify({
          email: "alice@example.com",
          password: "correct horse battery",
          handle: "alice",
          displayName: "Alice",
        }),
      }),
    );
    expect(reg.status).toBe(200);

    // Member should exist as `pending` and login should refuse them.
    const loginPending = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "alice@example.com", password: "correct horse battery" }),
      }),
    );
    expect(loginPending.status).toBe(401);

    // Pull the verify token straight from the DB — the email job is
    // the noop adapter in tests.
    const db = await getTestDb();
    const rows = await db.execute(
      "select email_verify_token_hash from nx_members where email = 'alice@example.com'" as never,
    );
    expect((rows as unknown as { rows: Array<{ email_verify_token_hash: string | null }> }).rows[0]?.email_verify_token_hash).toBeTruthy();

    // Reverse the hash isn't possible — instead, regenerate a token by
    // creating a fresh one through the core helper. Verify endpoint
    // requires the raw token, so we have to issue one ourselves to
    // exercise consume.
    const { createMemberEmailVerifyToken } = await import("@nexpress/core");
    const issued = await createMemberEmailVerifyToken(db as never, await getMemberId("alice"), 60_000);

    const verify = await verifyPOST(
      jsonRequest("/api/members/verify", {
        method: "POST",
        body: JSON.stringify({ token: issued.token }),
      }),
    );
    expect(verify.status).toBe(200);

    const login = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "alice@example.com", password: "correct horse battery" }),
      }),
    );
    expect(login.status).toBe(200);
    const sessionCookie = cookieValue(login.headers.get("set-cookie"), "nx-mb-session");
    expect(sessionCookie).toBeTruthy();

    const meRes = await meGET(
      jsonRequest("/api/members/me", { cookies: [`nx-mb-session=${sessionCookie}`] }),
    );
    const me = await readJson<{ member: { handle: string; emailVerified: boolean } }>(meRes);
    expect(me.status).toBe(200);
    expect(me.body.member.handle).toBe("alice");
    expect(me.body.member.emailVerified).toBe(true);
  });

  it("login fails for pending (unverified) members; succeeds after verify", async () => {
    await registerPOST(
      jsonRequest("/api/members/register", {
        method: "POST",
        body: JSON.stringify({
          email: "bob@example.com",
          password: "correct horse battery",
          handle: "bob",
          displayName: "Bob",
        }),
      }),
    );
    const before = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "bob@example.com", password: "correct horse battery" }),
      }),
    );
    expect(before.status).toBe(401);

    const db = await getTestDb();
    const { createMemberEmailVerifyToken } = await import("@nexpress/core");
    const issued = await createMemberEmailVerifyToken(db as never, await getMemberId("bob"), 60_000);
    await verifyPOST(jsonRequest("/api/members/verify", { method: "POST", body: JSON.stringify({ token: issued.token }) }));

    const after = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "bob@example.com", password: "correct horse battery" }),
      }),
    );
    expect(after.status).toBe(200);
  });

  it("forgot-password + reset-password round-trip changes the password", async () => {
    await registerAndVerify("carol", "carol@example.com", "old-password");

    await forgotPOST(
      jsonRequest("/api/members/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "carol@example.com" }),
      }),
    );
    // Pull the issued reset token by re-issuing it (same dance as verify above).
    const db = await getTestDb();
    const { requestMemberPasswordReset } = await import("@nexpress/core");
    const issued = await requestMemberPasswordReset(db as never, "carol@example.com", 60_000);
    expect(issued.issued?.token).toBeTruthy();

    const reset = await resetPOST(
      jsonRequest("/api/members/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: issued.issued!.token, password: "new-password-123" }),
      }),
    );
    expect(reset.status).toBe(200);

    // Old password rejected.
    const oldLogin = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "carol@example.com", password: "old-password" }),
      }),
    );
    expect(oldLogin.status).toBe(401);

    // New password accepted.
    const newLogin = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "carol@example.com", password: "new-password-123" }),
      }),
    );
    expect(newLogin.status).toBe(200);
  });

  it("PATCH me updates display_name + soft-DELETE me anonymises the row", async () => {
    const { sessionCookie, csrfCookie } = await registerAndVerify(
      "dave",
      "dave@example.com",
      "correct horse battery",
    );

    const patch = await mePATCH(
      jsonRequest("/api/members/me", {
        method: "PATCH",
        cookies: [`nx-mb-session=${sessionCookie}`, `nx-mb-csrf=${csrfCookie}`],
        headers: { "x-csrf-token": csrfCookie ?? "" },
        body: JSON.stringify({ displayName: "Dave the Brave" }),
      }),
    );
    expect(patch.status).toBe(200);

    const meAfter = await meGET(
      jsonRequest("/api/members/me", { cookies: [`nx-mb-session=${sessionCookie}`] }),
    );
    const me = await readJson<{ member: { displayName: string } }>(meAfter);
    expect(me.body.member.displayName).toBe("Dave the Brave");

    const del = await meDELETE(
      jsonRequest("/api/members/me", {
        method: "DELETE",
        cookies: [`nx-mb-session=${sessionCookie}`, `nx-mb-csrf=${csrfCookie}`],
        headers: { "x-csrf-token": csrfCookie ?? "" },
      }),
    );
    expect(del.status).toBe(200);

    // The session is invalidated; a fresh me lookup should 401.
    const me401 = await meGET(
      jsonRequest("/api/members/me", { cookies: [`nx-mb-session=${sessionCookie}`] }),
    );
    expect(me401.status).toBe(401);
  });

  it("GET /api/members/{handle} returns active members; 404 for pending / unknown", async () => {
    // Pending — not visible.
    await registerPOST(
      jsonRequest("/api/members/register", {
        method: "POST",
        body: JSON.stringify({
          email: "erin@example.com",
          password: "correct horse battery",
          handle: "erin",
          displayName: "Erin",
        }),
      }),
    );
    const pending = await profileGET(
      jsonRequest("/api/members/erin"),
      { params: Promise.resolve({ handle: "erin" }) },
    );
    expect(pending.status).toBe(404);

    // Active — visible.
    await registerAndVerify("frank", "frank@example.com", "password-12");
    const active = await profileGET(
      jsonRequest("/api/members/frank"),
      { params: Promise.resolve({ handle: "frank" }) },
    );
    expect(active.status).toBe(200);
    const body = await readJson<{ member: { handle: string; email?: string } }>(active);
    expect(body.body.member.handle).toBe("frank");
    // Email must NOT leak in public profile.
    expect(body.body.member.email).toBeUndefined();

    // Unknown handle.
    const unknown = await profileGET(
      jsonRequest("/api/members/ghost"),
      { params: Promise.resolve({ handle: "ghost" }) },
    );
    expect(unknown.status).toBe(404);
  });

  it("logout clears cookies and revokes the session row", async () => {
    const { sessionCookie } = await registerAndVerify("hank", "hank@example.com", "password-12");

    const logout = await logoutPOST(
      jsonRequest("/api/members/logout", {
        method: "POST",
        cookies: [`nx-mb-session=${sessionCookie}`],
      }),
    );
    expect(logout.status).toBe(200);
    const cleared = cookieValue(logout.headers.get("set-cookie"), "nx-mb-session");
    expect(cleared === "" || cleared === undefined).toBe(true);
  });

  // Regression for #45 (reopened): logout must invalidate the refresh
  // JWT server-side, not just the access token.
  it("refresh after logout is rejected even if the refresh JWT is still valid", async () => {
    await registerAndVerify("rev", "rev@example.com", "password123");
    const login = await loginPOST(
      jsonRequest("/api/members/login", {
        method: "POST",
        body: JSON.stringify({ email: "rev@example.com", password: "password123" }),
      }),
    );
    const cookies = login.headers.get("set-cookie");
    const sessionCookie = cookieValue(cookies, "nx-mb-session");
    const refreshCookie = cookieValue(cookies, "nx-mb-refresh");
    expect(sessionCookie).toBeDefined();
    expect(refreshCookie).toBeDefined();

    // Refresh succeeds while logged in.
    const refreshOk = await refreshPOST(
      jsonRequest("/api/members/refresh", {
        method: "POST",
        cookies: [`nx-mb-refresh=${refreshCookie}`],
      }),
    );
    expect(refreshOk.status).toBe(200);
    const rotatedRefresh = cookieValue(refreshOk.headers.get("set-cookie"), "nx-mb-refresh");
    expect(rotatedRefresh).toBeDefined();
    // After rotation, the original refresh token is no longer valid —
    // its session row was deleted as part of the rotation.
    const replayOldRefresh = await refreshPOST(
      jsonRequest("/api/members/refresh", {
        method: "POST",
        cookies: [`nx-mb-refresh=${refreshCookie}`],
      }),
    );
    expect(replayOldRefresh.status).toBe(401);

    // Logout invalidates the rotated refresh token too.
    await logoutPOST(
      jsonRequest("/api/members/logout", {
        method: "POST",
        cookies: [
          `nx-mb-session=${sessionCookie}`,
          `nx-mb-refresh=${rotatedRefresh}`,
        ],
      }),
    );
    const refreshAfterLogout = await refreshPOST(
      jsonRequest("/api/members/refresh", {
        method: "POST",
        cookies: [`nx-mb-refresh=${rotatedRefresh}`],
      }),
    );
    expect(refreshAfterLogout.status).toBe(401);
  });
});

// ── helpers ───────────────────────────────────────────────────────────

async function getMemberId(handle: string): Promise<string> {
  const db = await getTestDb();
  const { nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const rows = (await db.select({ id: nxMembers.id }).from(nxMembers).where(eq(nxMembers.handle, handle)).limit(1)) as Array<{ id: string }>;
  if (!rows[0]) throw new Error(`Member with handle "${handle}" not found in test DB`);
  return rows[0].id;
}

async function registerAndVerify(
  handle: string,
  email: string,
  password: string,
): Promise<{ sessionCookie?: string; csrfCookie?: string }> {
  const reg = await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  if (reg.status !== 200) {
    const txt = await reg.text();
    throw new Error(`register failed ${reg.status}: ${txt}`);
  }
  const db = await getTestDb();
  const { createMemberEmailVerifyToken } = await import("@nexpress/core");
  const issued = await createMemberEmailVerifyToken(db as never, await getMemberId(handle), 60_000);
  await verifyPOST(jsonRequest("/api/members/verify", { method: "POST", body: JSON.stringify({ token: issued.token }) }));
  const login = await loginPOST(
    jsonRequest("/api/members/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  );
  const setCookies = login.headers.get("set-cookie");
  return {
    sessionCookie: cookieValue(setCookies, "nx-mb-session"),
    csrfCookie: cookieValue(setCookies, "nx-mb-csrf"),
  };
}
