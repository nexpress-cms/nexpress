import { describe, expect, it } from "vitest";

import { createGitHubOAuthProvider, fetchGitHubProfile } from "./index.js";

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
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? undefined });
    const matcher = [...responses.entries()].find(([prefix]) => url.startsWith(prefix));
    if (!matcher) throw new Error(`unexpected fetch ${url}`);
    const value = matcher[1];
    return Promise.resolve(typeof value === "function" ? value() : value);
  };
  return { fetch: fn, calls };
}

describe("createGitHubOAuthProvider (factory guards)", () => {
  it("requires clientId and clientSecret", () => {
    expect(() =>
      createGitHubOAuthProvider({ clientId: "", clientSecret: "" }),
    ).toThrow(/clientId and clientSecret/);
  });

  it("returns an OAuthProvider with id='github'", () => {
    const provider = createGitHubOAuthProvider({
      clientId: "id",
      clientSecret: "secret",
    });
    expect(provider.id).toBe("github");
    expect(provider.label).toBe("GitHub");
  });
});

// Profile fetching is the GitHub-specific logic worth covering here.
// The token exchange + URL building live in `arctic` and are exercised
// by arctic's own test suite; mocking arctic's internal fetch would
// duplicate that without adding signal.
describe("fetchGitHubProfile", () => {
  it("returns a normalized profile when /user.email is set", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://api.github.com/user",
        jsonResponse({
          id: 4242,
          login: "octo",
          name: "Octo Cat",
          email: "octo@example.com",
          avatar_url: "https://avatars.githubusercontent.com/u/4242",
        }),
      ],
    ]);
    const { fetch: stubFetch, calls } = makeFetch(responses);
    const profile = await fetchGitHubProfile("tok", stubFetch);
    expect(profile).toEqual({
      providerUserId: "4242",
      email: "octo@example.com",
      name: "Octo Cat",
      avatarUrl: "https://avatars.githubusercontent.com/u/4242",
      metadata: { login: "octo" },
    });
    expect(calls.some((c) => c.url.startsWith("https://api.github.com/user/emails"))).toBe(false);
  });

  it("falls back to /user/emails for the verified primary when /user.email is null", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://api.github.com/user/emails",
        jsonResponse([
          { email: "secondary@x.com", primary: false, verified: true },
          { email: "primary@x.com", primary: true, verified: true },
          { email: "unverified@x.com", primary: false, verified: false },
        ]),
      ],
      [
        "https://api.github.com/user",
        jsonResponse({ id: 7, login: "ghost", name: null, email: null, avatar_url: null }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGitHubProfile("tok", stubFetch);
    expect(profile.email).toBe("primary@x.com");
    expect(profile.providerUserId).toBe("7");
    expect(profile.name).toBe("ghost"); // fallback to login when name is null
  });

  it("leaves email=null when /user.email is missing AND /user/emails errors", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://api.github.com/user/emails", new Response("nope", { status: 403 })],
      [
        "https://api.github.com/user",
        jsonResponse({ id: 8, login: "private", name: null, email: null }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGitHubProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
  });

  it("soft-fails when /user/emails returns 200 but malformed body", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://api.github.com/user/emails",
        new Response("not actually json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ],
      [
        "https://api.github.com/user",
        jsonResponse({ id: 9, login: "x", name: null, email: null }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchGitHubProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
    expect(profile.providerUserId).toBe("9");
  });

  it("throws on non-2xx /user", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://api.github.com/user", new Response("denied", { status: 401 })],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(fetchGitHubProfile("tok", stubFetch)).rejects.toThrow(/HTTP 401/);
  });

  it("throws when /user payload is missing id (contract violation)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://api.github.com/user",
        jsonResponse({ login: "no-id", email: "x@example.com" }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(fetchGitHubProfile("tok", stubFetch)).rejects.toThrow(/missing id/);
  });
});
