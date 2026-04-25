import { describe, expect, it } from "vitest";

import { createGoogleOAuthProvider } from "./index.js";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(responses: Map<string, Response | (() => Response)>) {
  const calls: FetchCall[] = [];
  const fn: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? undefined });
    const matcher = [...responses.entries()].find(([prefix]) => url.startsWith(prefix));
    if (!matcher) throw new Error(`unexpected fetch ${url}`);
    const value = matcher[1];
    return Promise.resolve(typeof value === "function" ? value() : value);
  };
  return { fetch: fn, calls };
}

describe("createGoogleOAuthProvider", () => {
  const provider = (overrides?: Partial<Parameters<typeof createGoogleOAuthProvider>[0]>) =>
    createGoogleOAuthProvider({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret-x",
      fetch: () => Promise.resolve(jsonResponse({})),
      ...overrides,
    });

  it("requires clientId and clientSecret", () => {
    expect(() =>
      // @ts-expect-error — testing the runtime guard
      createGoogleOAuthProvider({ clientId: "", clientSecret: "" }),
    ).toThrow(/clientId and clientSecret/);
  });

  it("authorize() builds the Google URL with response_type=code, scope, and prompt=select_account", () => {
    const url = new URL(
      provider().authorize({
        state: "STATE-1",
        redirectUri: "https://site.example/api/auth/oauth/google/callback",
      }) as string,
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client.apps.googleusercontent.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("STATE-1");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("exchange() POSTs form-encoded body and returns the verified profile", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://oauth2.googleapis.com/token", jsonResponse({ access_token: "tok", scope: "openid email profile" })],
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({
          sub: "google|118100000000000000000",
          email: "alice@example.com",
          email_verified: true,
          name: "Alice Example",
          picture: "https://lh3.googleusercontent.com/a/abc",
        }),
      ],
    ]);
    const { fetch: stubFetch, calls } = makeFetch(responses);
    const profile = await provider({ fetch: stubFetch }).exchange({
      code: "abc",
      state: "s",
      redirectUri: "https://site.example/cb",
    });
    expect(profile).toEqual({
      providerUserId: "google|118100000000000000000",
      email: "alice@example.com",
      name: "Alice Example",
      avatarUrl: "https://lh3.googleusercontent.com/a/abc",
      metadata: {
        sub: "google|118100000000000000000",
        email_verified: true,
        scope: "openid email profile",
      },
    });

    // Verify the token call used form-encoded body — JSON would 400.
    const tokenCall = calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
    expect(tokenCall).toBeDefined();
    const headers = new Headers(tokenCall!.init?.headers as HeadersInit | undefined);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(typeof tokenCall!.init?.body).toBe("string");
    const params = new URLSearchParams(tokenCall!.init!.body as string);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("abc");
    expect(params.get("client_id")).toBe("client.apps.googleusercontent.com");
  });

  it("exchange() drops email when email_verified is false (no email-match silently linking)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://oauth2.googleapis.com/token", jsonResponse({ access_token: "tok" })],
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({
          sub: "sub-X",
          email: "unverified@example.com",
          email_verified: false,
          name: "Unverified",
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await provider({ fetch: stubFetch }).exchange({
      code: "abc",
      state: "s",
      redirectUri: "https://site.example/cb",
    });
    expect(profile.email).toBeNull();
    expect(profile.providerUserId).toBe("sub-X");
  });

  it("exchange() falls back to given_name + family_name when name is missing", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://oauth2.googleapis.com/token", jsonResponse({ access_token: "tok" })],
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({
          sub: "sub-Y",
          email_verified: true,
          email: "y@example.com",
          given_name: "Yui",
          family_name: "Tanaka",
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await provider({ fetch: stubFetch }).exchange({
      code: "abc",
      state: "s",
      redirectUri: "https://site.example/cb",
    });
    expect(profile.name).toBe("Yui Tanaka");
  });

  it("exchange() throws on token error payload", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://oauth2.googleapis.com/token",
        jsonResponse({ error: "invalid_grant", error_description: "Bad code" }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(
      provider({ fetch: stubFetch }).exchange({
        code: "abc",
        state: "s",
        redirectUri: "https://site.example/cb",
      }),
    ).rejects.toThrow(/Bad code/);
  });

  it("exchange() throws on non-2xx userinfo", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://oauth2.googleapis.com/token", jsonResponse({ access_token: "tok" })],
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        new Response("denied", { status: 401 }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(
      provider({ fetch: stubFetch }).exchange({
        code: "abc",
        state: "s",
        redirectUri: "https://site.example/cb",
      }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("exchange() throws when userinfo lacks sub (Google OIDC contract violation)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://oauth2.googleapis.com/token", jsonResponse({ access_token: "tok" })],
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({ email: "x@example.com", email_verified: true }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(
      provider({ fetch: stubFetch }).exchange({
        code: "abc",
        state: "s",
        redirectUri: "https://site.example/cb",
      }),
    ).rejects.toThrow(/missing sub/);
  });
});
