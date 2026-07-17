import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET as oauthStartGET } from "@/app/api/auth/oauth/[provider]/start/route";
import { GET as oauthCallbackGET } from "@/app/api/auth/oauth/[provider]/callback/route";

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
    failExchange?: boolean;
  } = {},
) {
  // ESM dynamic import — must match the route's `import` resolution so
  // both call sides share the same module-scoped provider registry. A
  // CJS `require()` would land on a different module instance and the
  // route would 404 with "provider not registered".
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
        email:
          options.profileEmail === undefined ? `oauth-${code}@example.com` : options.profileEmail,
        name: "Stub User",
      };
    },
  });
  return id;
}

describe.skipIf(skipIfNoTestDb())("oauth (integration)", () => {
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

  it("/start sets a state cookie and 302s to the provider's authorize URL", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping);

    const res = await oauthStartGET(jsonRequest(`/api/auth/oauth/${id}/start`), {
      params: Promise.resolve({ provider: id }),
    });
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("https://example.invalid/oauth/authorize");
    expect(location).toContain("state=");
    expect(bookkeeping.authorizeCalls).toBe(1);
    const state = cookieValue(res.headers.get("set-cookie"), "np-oauth-state");
    expect(state).toBeDefined();
    expect(state).toBe(bookkeeping.lastAuthorizeState);
  });

  it("/start 404s for an unregistered provider", async () => {
    const res = await oauthStartGET(jsonRequest(`/api/auth/oauth/missing/start`), {
      params: Promise.resolve({ provider: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("callback creates a fresh user when no email match exists, sets session cookies", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { profileEmail: "fresh@example.com" });

    const start = await oauthStartGET(jsonRequest(`/api/auth/oauth/${id}/start`), {
      params: Promise.resolve({ provider: id }),
    });
    const state = cookieValue(start.headers.get("set-cookie"), "np-oauth-state")!;

    const callback = await oauthCallbackGET(
      jsonRequest(`/api/auth/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`, {
        cookies: [`np-oauth-state=${state}`],
      }),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(callback.status).toBe(307);
    expect(callback.headers.get("location") ?? "").toMatch(/\/admin($|\?|\/)/);
    const cookies = callback.headers.get("set-cookie") ?? "";
    expect(cookies).toMatch(/np-session=/);
    expect(cookies).toMatch(/np-csrf=/);
    expect(bookkeeping.exchangeCalls).toBe(1);

    const db = await getTestDb();
    const { npUsers, npUserOAuthIdentities } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [user] = (await db
      .select({ id: npUsers.id, role: npUsers.role })
      .from(npUsers)
      .where(eq(npUsers.email, "fresh@example.com"))
      .limit(1)) as Array<{ id: string; role: string }>;
    expect(user).toBeDefined();
    expect(user.role).toBe("viewer");
    const links = (await db
      .select()
      .from(npUserOAuthIdentities)
      .where(eq(npUserOAuthIdentities.userId, user.id))) as Array<unknown>;
    expect(links).toHaveLength(1);
  });

  it("callback links a new identity to an existing user when email matches", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { profileEmail: "existing@example.com" });

    const db = await getTestDb();
    const { hashPassword, npUsers } = await import("@nexpress/core");
    await db.insert(npUsers).values({
      email: "existing@example.com",
      password: await hashPassword("password-12"),
      name: "Existing",
      role: "editor",
    });

    const start = await oauthStartGET(jsonRequest(`/api/auth/oauth/${id}/start`), {
      params: Promise.resolve({ provider: id }),
    });
    const state = cookieValue(start.headers.get("set-cookie"), "np-oauth-state")!;
    const callback = await oauthCallbackGET(
      jsonRequest(`/api/auth/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`, {
        cookies: [`np-oauth-state=${state}`],
      }),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(callback.status).toBe(307);

    const { eq } = await import("drizzle-orm");
    const all = (await db
      .select()
      .from(npUsers)
      .where(eq(npUsers.email, "existing@example.com"))) as Array<unknown>;
    expect(all).toHaveLength(1); // no duplicate user created
  });

  it("callback rejects state-mismatch with oauth_error redirect", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping);

    const start = await oauthStartGET(jsonRequest(`/api/auth/oauth/${id}/start`), {
      params: Promise.resolve({ provider: id }),
    });
    const cookieState = cookieValue(start.headers.get("set-cookie"), "np-oauth-state")!;

    const res = await oauthCallbackGET(
      jsonRequest(`/api/auth/oauth/${id}/callback?code=abc&state=tampered`, {
        cookies: [`np-oauth-state=${cookieState}`],
      }),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/admin/login");
    expect(loc).toContain("oauth_error=state_mismatch");
    expect(bookkeeping.exchangeCalls).toBe(0);
  });

  it("callback fails closed when exchange throws", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { failExchange: true });

    const start = await oauthStartGET(jsonRequest(`/api/auth/oauth/${id}/start`), {
      params: Promise.resolve({ provider: id }),
    });
    const state = cookieValue(start.headers.get("set-cookie"), "np-oauth-state")!;
    const res = await oauthCallbackGET(
      jsonRequest(`/api/auth/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`, {
        cookies: [`np-oauth-state=${state}`],
      }),
      { params: Promise.resolve({ provider: id }) },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location") ?? "").toContain("oauth_error=exchange_failed");
  });

  it("subsequent login with same provider id re-uses the user (no duplicates)", async () => {
    const bookkeeping: Bookkeeping = { authorizeCalls: 0, exchangeCalls: 0 };
    const id = await registerStub(bookkeeping, { profileSubject: "stable-id", profileEmail: null });

    async function runOnce() {
      const start = await oauthStartGET(jsonRequest(`/api/auth/oauth/${id}/start`), {
        params: Promise.resolve({ provider: id }),
      });
      const state = cookieValue(start.headers.get("set-cookie"), "np-oauth-state")!;
      return oauthCallbackGET(
        jsonRequest(`/api/auth/oauth/${id}/callback?code=abc&state=${encodeURIComponent(state)}`, {
          cookies: [`np-oauth-state=${state}`],
        }),
        { params: Promise.resolve({ provider: id }) },
      );
    }
    await runOnce();
    await runOnce();

    const db = await getTestDb();
    const { npUserOAuthIdentities } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const links = (await db
      .select()
      .from(npUserOAuthIdentities)
      .where(eq(npUserOAuthIdentities.provider, id))) as Array<unknown>;
    expect(links).toHaveLength(1);
  });
});
