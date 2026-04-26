import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET as oauthStartGET } from "@/app/api/members/oauth/[provider]/start/route";
import { GET as oauthCallbackGET } from "@/app/api/members/oauth/[provider]/callback/route";
import { GET as meGET } from "@/app/api/members/me/route";

import { NextRequest } from "next/server";

type Bookkeeping = {
  authorizeCalls: number;
  exchangeCalls: number;
  lastAuthorizeState?: string;
};

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function cookieValue(setCookie: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function registerStub(
  bookkeeping: Bookkeeping,
  options: {
    id?: string;
    profileEmail?: string | null;
    profileSubject?: string;
    profileName?: string | null;
    failExchange?: boolean;
  } = {},
) {
  // Same ESM dynamic-import pattern used in the staff oauth tests so
  // both the test and the route resolve to the same provider registry
  // module instance.
  const core = await import("@nexpress/core");
  const id = options.id ?? "stub";
  core.resetOAuthProviders();
  core.registerOAuthProvider({
    id,
    label: "Stub",
    authorize({ state, redirectUri }) {
      bookkeeping.authorizeCalls += 1;
      bookkeeping.lastAuthorizeState = state;
      const url = new URL("https://example.invalid/oauth/authorize");
      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", redirectUri);
      return url.toString();
    },
    async exchange({ code }) {
      bookkeeping.exchangeCalls += 1;
      if (options.failExchange) throw new Error("stub-failure");
      return {
        providerUserId: options.profileSubject ?? `subject-${code}`,
        email: options.profileEmail === undefined ? `oauth-${code}@example.com` : options.profileEmail,
        name: options.profileName === undefined ? "Stub Member" : options.profileName,
        metadata: { login: "stub-login" },
      };
    },
  });
  return id;
}

describe.skipIf(skipIfNoTestDb())("member oauth (integration)", () => {
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

  it("/start sets nx-mb-oauth-state and 302s to the provider", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping);

    const res = await oauthStartGET(
      jsonRequest(`/api/members/oauth/${id}/start`),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location") ?? "").toContain("https://example.invalid/oauth/authorize");
    const cookieState = cookieValue(res.headers.get("set-cookie"), "nx-mb-oauth-state");
    expect(cookieState).toBeDefined();
    expect(cookieState).toBe(bookkeeping.lastAuthorizeState);
  });

  it("/start 404s for an unregistered provider", async () => {
    const res = await oauthStartGET(
      jsonRequest(`/api/members/oauth/missing/start`),
      { params: Promise.resolve({ provider: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("callback creates a fresh active member, sets member session cookies, and the cookie works on /me", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { profileEmail: "fresh@example.com" });

    const start = await oauthStartGET(
      jsonRequest(`/api/members/oauth/${id}/start`),
      { params: Promise.resolve({ provider: id }) },
    );
    const state = cookieValue(start.headers.get("set-cookie"), "nx-mb-oauth-state")!;

    const callback = await oauthCallbackGET(
      jsonRequest(
        `/api/members/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`,
        { cookies: [`nx-mb-oauth-state=${state}`] },
      ),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(callback.status).toBe(307);
    expect(callback.headers.get("location") ?? "").toMatch(/\/(?:$|\?)/);
    const setCookies = callback.headers.get("set-cookie") ?? "";
    expect(setCookies).toMatch(/nx-mb-session=/);
    expect(setCookies).toMatch(/nx-mb-csrf=/);

    const session = cookieValue(setCookies, "nx-mb-session");
    expect(session).toBeDefined();

    // Cookie minted by OAuth callback must work on a member-auth route.
    const me = await meGET(
      jsonRequest("/api/members/me", { cookies: [`nx-mb-session=${session}`] }),
    );
    expect(me.status).toBe(200);

    const db = await getTestDb();
    const { nxMembers, nxMemberIdentities } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [created] = (await db
      .select({ id: nxMembers.id, status: nxMembers.status, handle: nxMembers.handle })
      .from(nxMembers)
      .where(eq(nxMembers.email, "fresh@example.com"))
      .limit(1)) as Array<{ id: string; status: string; handle: string }>;
    expect(created).toBeDefined();
    expect(created.status).toBe("active");
    expect(created.handle).toMatch(/^[a-z0-9][a-z0-9_-]+$/);

    const links = (await db
      .select()
      .from(nxMemberIdentities)
      .where(eq(nxMemberIdentities.memberId, created.id))) as Array<unknown>;
    expect(links).toHaveLength(1);
  });

  it("callback links a new identity to an existing member when email matches", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { profileEmail: "existing@example.com" });

    const db = await getTestDb();
    const { hashPassword, nxMembers } = await import("@nexpress/core");
    const password = await hashPassword("password-12");
    await db.insert(nxMembers).values({
      email: "existing@example.com",
      password,
      handle: "existing",
      displayName: "Existing",
      status: "active",
    });

    const start = await oauthStartGET(
      jsonRequest(`/api/members/oauth/${id}/start`),
      { params: Promise.resolve({ provider: id }) },
    );
    const state = cookieValue(start.headers.get("set-cookie"), "nx-mb-oauth-state")!;
    const cb = await oauthCallbackGET(
      jsonRequest(
        `/api/members/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`,
        { cookies: [`nx-mb-oauth-state=${state}`] },
      ),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(cb.status).toBe(307);

    const { eq } = await import("drizzle-orm");
    const all = (await db
      .select()
      .from(nxMembers)
      .where(eq(nxMembers.email, "existing@example.com"))) as Array<unknown>;
    expect(all).toHaveLength(1); // no duplicate created
  });

  it("callback rejects state mismatch with oauth_error redirect", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping);

    const start = await oauthStartGET(
      jsonRequest(`/api/members/oauth/${id}/start`),
      { params: Promise.resolve({ provider: id }) },
    );
    const cookieState = cookieValue(start.headers.get("set-cookie"), "nx-mb-oauth-state")!;

    const cb = await oauthCallbackGET(
      jsonRequest(
        `/api/members/oauth/${id}/callback?code=abc&state=tampered`,
        { cookies: [`nx-mb-oauth-state=${cookieState}`] },
      ),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(cb.status).toBe(307);
    expect(cb.headers.get("location") ?? "").toContain("/members/login");
    expect(cb.headers.get("location") ?? "").toContain("oauth_error=state_mismatch");
    expect(bookkeeping.exchangeCalls).toBe(0);
  });

  it("callback fails closed when exchange throws", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { failExchange: true });

    const start = await oauthStartGET(
      jsonRequest(`/api/members/oauth/${id}/start`),
      { params: Promise.resolve({ provider: id }) },
    );
    const state = cookieValue(start.headers.get("set-cookie"), "nx-mb-oauth-state")!;

    const cb = await oauthCallbackGET(
      jsonRequest(
        `/api/members/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`,
        { cookies: [`nx-mb-oauth-state=${state}`] },
      ),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(cb.status).toBe(307);
    expect(cb.headers.get("location") ?? "").toContain("oauth_error=exchange_failed");
  });

  it("callback refuses suspended members", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { profileEmail: "suspended@example.com" });

    const db = await getTestDb();
    const { hashPassword, nxMembers } = await import("@nexpress/core");
    const password = await hashPassword("password-12");
    await db.insert(nxMembers).values({
      email: "suspended@example.com",
      password,
      handle: "suspended",
      displayName: "Suspended",
      status: "suspended",
    });

    const start = await oauthStartGET(
      jsonRequest(`/api/members/oauth/${id}/start`),
      { params: Promise.resolve({ provider: id }) },
    );
    const state = cookieValue(start.headers.get("set-cookie"), "nx-mb-oauth-state")!;
    const cb = await oauthCallbackGET(
      jsonRequest(
        `/api/members/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`,
        { cookies: [`nx-mb-oauth-state=${state}`] },
      ),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(cb.status).toBe(307);
    expect(cb.headers.get("location") ?? "").toContain("oauth_error=member_inactive");
    // No session cookie set.
    expect(cb.headers.get("set-cookie") ?? "").not.toMatch(/nx-mb-session=[^;]+;/);
  });

  it("repeat login with same provider id re-uses the member (no duplicate identity rows)", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, {
      profileSubject: "stable-id",
      profileEmail: null,
    });

    async function runOnce() {
      const start = await oauthStartGET(
        jsonRequest(`/api/members/oauth/${id}/start`),
        { params: Promise.resolve({ provider: id }) },
      );
      const state = cookieValue(start.headers.get("set-cookie"), "nx-mb-oauth-state")!;
      return oauthCallbackGET(
        jsonRequest(
          `/api/members/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`,
          { cookies: [`nx-mb-oauth-state=${state}`] },
        ),
        { params: Promise.resolve({ provider: id }) },
      );
    }
    await runOnce();
    await runOnce();

    const db = await getTestDb();
    const { nxMemberIdentities } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const links = (await db
      .select()
      .from(nxMemberIdentities)
      .where(eq(nxMemberIdentities.provider, id))) as Array<unknown>;
    expect(links).toHaveLength(1);
  });
});
