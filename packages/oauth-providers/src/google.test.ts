import { describe, expect, it } from "vitest";

import { createGoogleOAuthProvider, fetchGoogleProfile } from "./google.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(responses: Map<string, Response | (() => Response)>) {
  const fn: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const matcher = [...responses.entries()].find(([prefix]) => url.startsWith(prefix));
    if (!matcher) throw new Error(`unexpected fetch ${url}`);
    const value = matcher[1];
    return Promise.resolve(typeof value === "function" ? value() : value);
  };
  return { fetch: fn };
}

describe("createGoogleOAuthProvider (factory guards)", () => {
  it("requires clientId and clientSecret", () => {
    expect(() =>
      createGoogleOAuthProvider({ clientId: "", clientSecret: "" }),
    ).toThrow(/clientId and clientSecret/);
  });

  it("returns an OAuthProvider with id='google'", () => {
    const provider = createGoogleOAuthProvider({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
    });
    expect(provider.id).toBe("google");
    expect(provider.label).toBe("Google");
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
      [
        "https://openidconnect.googleapis.com/v1/userinfo",
        new Response("denied", { status: 401 }),
      ],
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
