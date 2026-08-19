import { describe, expect, it } from "vitest";

import { createGoogleOAuthProvider, fetchGoogleProfile } from "./google.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(responses: Map<string, Response | (() => Response)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? undefined });
    const matcher = [...responses.entries()].find(([prefix]) => url.startsWith(prefix));
    if (!matcher) throw new Error(`unexpected fetch ${url}`);
    const value = matcher[1];
    return Promise.resolve(typeof value === "function" ? value() : value);
  };
  return { fetch: fn, calls };
}

describe("createGoogleOAuthProvider (factory guards)", () => {
  it("requires clientId and clientSecret", () => {
    expect(() => createGoogleOAuthProvider({ clientId: "", clientSecret: "" })).toThrow(
      /clientId and clientSecret/,
    );
  });

  it("returns an OAuthProvider with id='google'", () => {
    const provider = createGoogleOAuthProvider({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
    });
    expect(provider.id).toBe("google");
    expect(provider.label).toBe("Google");
  });

  it("uses Google's PKCE endpoints and request-body client authentication", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const responses = new Map<string, Response | (() => Response)>([
      ["https://oauth2.googleapis.com/token", () => jsonResponse({ access_token: "google-token" })],
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        () => jsonResponse({ sub: "google-user", email: "g@example.com", email_verified: true }),
      ],
    ]);
    const { fetch: stubFetch, calls } = makeFetch(responses);
    const provider = createGoogleOAuthProvider({
      clientId: "google-client",
      clientSecret: "google-secret",
      fetch: stubFetch,
    });

    const authorizationUrl = new URL(
      await provider.authorize({
        state: "state",
        redirectUri: "https://cms.example.test/google/callback",
        codeVerifier: verifier,
      }),
    );
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");

    await expect(
      provider.exchange({
        code: "google-code",
        state: "state",
        redirectUri: "https://cms.example.test/google/callback",
        codeVerifier: verifier,
      }),
    ).resolves.toMatchObject({ providerUserId: "google-user", email: "g@example.com" });
    const tokenCall = calls.find((call) => call.url === "https://oauth2.googleapis.com/token");
    expect(tokenCall?.init?.body).toBeInstanceOf(URLSearchParams);
    const body = tokenCall?.init?.body as URLSearchParams;
    expect(body.get("client_id")).toBe("google-client");
    expect(body.get("client_secret")).toBe("google-secret");
  });
});

describe("fetchGoogleProfile (verified-email enforcement)", () => {
  it("returns the verified profile when email_verified === true", async () => {
    const responses = new Map<string, Response | (() => Response)>([
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
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGoogleProfile("tok", stubFetch);
    expect(profile).toEqual({
      providerUserId: "google|118100000000000000000",
      email: "alice@example.com",
      name: "Alice Example",
      avatarUrl: "https://lh3.googleusercontent.com/a/abc",
      metadata: {
        sub: "google|118100000000000000000",
        email_verified: true,
      },
    });
  });

  it("drops email when email_verified is false", async () => {
    const responses = new Map<string, Response | (() => Response)>([
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
    const profile = await fetchGoogleProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
    expect(profile.providerUserId).toBe("sub-X");
  });

  it("drops email when email_verified is missing entirely", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({ sub: "no-flag", email: "x@example.com", name: "X" }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGoogleProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
  });

  it("drops email when email_verified is the string 'true' (not boolean)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({
          sub: "string-flag",
          email: "x@example.com",
          email_verified: "true",
          name: "X",
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGoogleProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
  });

  it("returns email=null when userinfo omits email entirely (limited scope)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({ sub: "no-email", name: "Anon" }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGoogleProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
    expect(profile.providerUserId).toBe("no-email");
  });

  it("falls back to given_name + family_name when name is missing", async () => {
    const responses = new Map<string, Response | (() => Response)>([
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
    const profile = await fetchGoogleProfile("tok", stubFetch);
    expect(profile.name).toBe("Yui Tanaka");
  });

  it("throws on non-2xx userinfo", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://openidconnect.googleapis.com/v1/userinfo", new Response("denied", { status: 401 })],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(fetchGoogleProfile("tok", stubFetch)).rejects.toThrow(/HTTP 401/);
  });

  it("throws when userinfo lacks sub (OIDC contract violation)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        jsonResponse({ email: "x@example.com", email_verified: true }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(fetchGoogleProfile("tok", stubFetch)).rejects.toThrow(/missing sub/);
  });
});
