import { describe, expect, it } from "vitest";

import { createGitHubOAuthProvider } from "./index.js";

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
    if (!matcher) {
      throw new Error(`unexpected fetch ${url}`);
    }
    const value = matcher[1];
    return Promise.resolve(typeof value === "function" ? value() : value);
  };
  return { fetch: fn, calls };
}

describe("createGitHubOAuthProvider", () => {
  const provider = (overrides?: Partial<Parameters<typeof createGitHubOAuthProvider>[0]>) =>
    createGitHubOAuthProvider({
      clientId: "client-x",
      clientSecret: "secret-x",
      fetch: () => Promise.resolve(jsonResponse({})),
      ...overrides,
    });

  it("requires clientId and clientSecret", () => {
    expect(() =>
      // @ts-expect-error — testing the runtime guard
      createGitHubOAuthProvider({ clientId: "", clientSecret: "" }),
    ).toThrow(/clientId and clientSecret/);
  });

  it("authorize() builds the GitHub URL with state, redirect_uri, and default scope", () => {
    const url = new URL(
      provider().authorize({
        state: "STATE-1",
        redirectUri: "https://site.example/api/auth/oauth/github/callback",
      }) as string,
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-x");
    expect(url.searchParams.get("state")).toBe("STATE-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://site.example/api/auth/oauth/github/callback",
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });

  it("exchange() returns a normalized profile from /user (email present)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://github.com/login/oauth/access_token", jsonResponse({ access_token: "tok" })],
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
    const profile = await provider({ fetch: stubFetch }).exchange({
      code: "abc",
      state: "s",
      redirectUri: "https://site.example/cb",
    });
    expect(profile).toEqual({
      providerUserId: "4242",
      email: "octo@example.com",
      name: "Octo Cat",
      avatarUrl: "https://avatars.githubusercontent.com/u/4242",
      metadata: { login: "octo", scope: "read:user user:email" },
    });
    // Should NOT have hit /user/emails — email was on /user.
    expect(calls.some((c) => c.url.startsWith("https://api.github.com/user/emails"))).toBe(false);
  });

  it("exchange() falls back to /user/emails when /user.email is null, picks the verified primary", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://github.com/login/oauth/access_token", jsonResponse({ access_token: "tok" })],
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
    const profile = await provider({ fetch: stubFetch }).exchange({
      code: "abc",
      state: "s",
      redirectUri: "https://site.example/cb",
    });
    expect(profile.email).toBe("primary@x.com");
    expect(profile.providerUserId).toBe("7");
    // Falls back to login when name is missing.
    expect(profile.name).toBe("ghost");
  });

  it("exchange() leaves email=null when /user.email is missing AND /user/emails fails", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://github.com/login/oauth/access_token", jsonResponse({ access_token: "tok" })],
      ["https://api.github.com/user/emails", new Response("nope", { status: 403 })],
      [
        "https://api.github.com/user",
        jsonResponse({ id: 8, login: "private", name: null, email: null }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await provider({ fetch: stubFetch }).exchange({
      code: "abc",
      state: "s",
      redirectUri: "https://site.example/cb",
    });
    expect(profile.email).toBeNull();
  });

  it("exchange() throws when token endpoint returns an error payload", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://github.com/login/oauth/access_token",
        jsonResponse({ error: "bad_verification_code", error_description: "nope" }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(
      provider({ fetch: stubFetch }).exchange({
        code: "abc",
        state: "s",
        redirectUri: "https://site.example/cb",
      }),
    ).rejects.toThrow(/nope/);
  });

  it("exchange() returns email=null when /user/emails returns 200 but malformed JSON (soft-fail)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://github.com/login/oauth/access_token", jsonResponse({ access_token: "tok" })],
      [
        "https://api.github.com/user",
        jsonResponse({ id: 9, login: "private", name: null, email: null }),
      ],
      [
        "https://api.github.com/user/emails",
        new Response("not actually json", {
          status: 200,
          headers: { "content-type": "application/json" },
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
    expect(profile.providerUserId).toBe("9");
  });

  it("exchange() throws on non-2xx /user", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://github.com/login/oauth/access_token", jsonResponse({ access_token: "tok" })],
      ["https://api.github.com/user", new Response("denied", { status: 401 })],
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
});
