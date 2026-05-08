import { describe, expect, it } from "vitest";

import { createDiscordOAuthProvider, fetchDiscordProfile } from "./discord.js";

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

describe("createDiscordOAuthProvider (factory guards)", () => {
  it("requires clientId and clientSecret", () => {
    expect(() =>
      createDiscordOAuthProvider({ clientId: "", clientSecret: "" }),
    ).toThrow(/clientId and clientSecret/);
  });

  it("returns an OAuthProvider with id='discord'", () => {
    const provider = createDiscordOAuthProvider({
      clientId: "id",
      clientSecret: "secret",
    });
    expect(provider.id).toBe("discord");
    expect(provider.label).toBe("Discord");
  });
});

describe("fetchDiscordProfile (verified-email + avatar handling)", () => {
  it("returns the verified profile when verified === true", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://discord.com/api/users/@me",
        jsonResponse({
          id: "12345",
          username: "alice_h",
          global_name: "Alice",
          email: "alice@example.com",
          verified: true,
          avatar: "abc123hash",
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchDiscordProfile("tok", stubFetch);
    expect(profile).toEqual({
      providerUserId: "12345",
      email: "alice@example.com",
      name: "Alice",
      avatarUrl: "https://cdn.discordapp.com/avatars/12345/abc123hash.png",
      metadata: { username: "alice_h", verified: true },
    });
  });

  it("drops email when verified === false", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://discord.com/api/users/@me",
        jsonResponse({
          id: "9",
          username: "x",
          email: "x@example.com",
          verified: false,
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchDiscordProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
  });

  it("drops email when verified is missing entirely", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://discord.com/api/users/@me",
        jsonResponse({ id: "10", username: "y", email: "y@example.com" }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchDiscordProfile("tok", stubFetch);
    expect(profile.email).toBeNull();
  });

  it("falls back to username when global_name is empty", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://discord.com/api/users/@me",
        jsonResponse({
          id: "11",
          username: "xx_user",
          global_name: "",
          email: "x@example.com",
          verified: true,
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchDiscordProfile("tok", stubFetch);
    expect(profile.name).toBe("xx_user");
  });

  it("returns avatarUrl=null when avatar hash is missing (default avatar)", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://discord.com/api/users/@me",
        jsonResponse({
          id: "12",
          username: "z",
          email: "z@example.com",
          verified: true,
          avatar: null,
        }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    const profile = await fetchDiscordProfile("tok", stubFetch);
    expect(profile.avatarUrl).toBeNull();
  });

  it("throws on non-2xx user fetch", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      ["https://discord.com/api/users/@me", new Response("denied", { status: 401 })],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(fetchDiscordProfile("tok", stubFetch)).rejects.toThrow(/HTTP 401/);
  });

  it("throws when payload lacks id", async () => {
    const responses = new Map<string, Response | (() => Response)>([
      [
        "https://discord.com/api/users/@me",
        jsonResponse({ username: "no-id", email: "x@example.com", verified: true }),
      ],
    ]);
    const { fetch: stubFetch } = makeFetch(responses);
    await expect(fetchDiscordProfile("tok", stubFetch)).rejects.toThrow(/missing id/);
  });
});
