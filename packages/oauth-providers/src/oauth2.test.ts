import { describe, expect, it, vi } from "vitest";

import {
  createOAuthAuthorizationUrl,
  createS256CodeChallenge,
  exchangeOAuthAuthorizationCode,
} from "./oauth2.js";

const RFC_7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OAuth 2.0 authorization-code helpers", () => {
  it("derives the RFC 7636 S256 challenge", () => {
    expect(createS256CodeChallenge(RFC_7636_VERIFIER)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds a fully encoded authorization URL with PKCE", () => {
    const url = new URL(
      createOAuthAuthorizationUrl({
        endpoint: "https://accounts.example.test/oauth2/authorize",
        clientId: "client id",
        redirectUri: "https://cms.example.test/api/auth/callback",
        state: "state/value",
        scopes: ["openid", "profile:read"],
        codeVerifier: RFC_7636_VERIFIER,
      }),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.example.test/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client id",
      redirect_uri: "https://cms.example.test/api/auth/callback",
      state: "state/value",
      scope: "openid profile:read",
      code_challenge_method: "S256",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    });
  });

  it("exchanges a code with request-body client authentication", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ access_token: "tok" }));

    await expect(
      exchangeOAuthAuthorizationCode({
        providerId: "example",
        endpoint: "https://accounts.example.test/oauth2/token",
        clientId: "client",
        clientSecret: "secret",
        clientAuthentication: "request-body",
        code: "authorization-code",
        redirectUri: "https://cms.example.test/callback",
        codeVerifier: RFC_7636_VERIFIER,
        fetch: fetchImpl,
      }),
    ).resolves.toBe("tok");

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://accounts.example.test/oauth2/token");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect(init?.body as URLSearchParams).toEqual(
      new URLSearchParams({
        grant_type: "authorization_code",
        code: "authorization-code",
        redirect_uri: "https://cms.example.test/callback",
        code_verifier: RFC_7636_VERIFIER,
        client_id: "client",
        client_secret: "secret",
      }),
    );
  });

  it("uses HTTP Basic client authentication without putting credentials in the body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ access_token: "tok" }));

    await exchangeOAuthAuthorizationCode({
      providerId: "example",
      endpoint: "https://accounts.example.test/oauth2/token",
      clientId: "client",
      clientSecret: "secret",
      clientAuthentication: "basic",
      code: "authorization-code",
      redirectUri: "https://cms.example.test/callback",
      fetch: fetchImpl,
    });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Basic Y2xpZW50OnNlY3JldA==");
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init?.body as URLSearchParams;
    expect(body.has("client_id")).toBe(false);
    expect(body.has("client_secret")).toBe(false);
  });

  it("rejects malformed verifiers before sending a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      exchangeOAuthAuthorizationCode({
        providerId: "example",
        endpoint: "https://accounts.example.test/oauth2/token",
        clientId: "client",
        clientSecret: "secret",
        clientAuthentication: "request-body",
        code: "authorization-code",
        redirectUri: "https://cms.example.test/callback",
        codeVerifier: "too-short",
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/43-128 RFC 7636/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a bounded provider error without exposing its description", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: "invalid_grant",
          error_description: "secret provider diagnostic",
        },
        400,
      ),
    );

    const promise = exchangeOAuthAuthorizationCode({
      providerId: "example",
      endpoint: "https://accounts.example.test/oauth2/token",
      clientId: "client",
      clientSecret: "secret",
      clientAuthentication: "request-body",
      code: "authorization-code",
      redirectUri: "https://cms.example.test/callback",
      fetch: fetchImpl,
    });
    await expect(promise).rejects.toThrow("example OAuth token exchange failed: invalid_grant");
    await expect(promise).rejects.not.toThrow(/secret provider diagnostic/);
  });

  it.each([
    ["invalid JSON", new Response("not json", { status: 200 }), /invalid JSON/],
    ["missing access token", jsonResponse({ token_type: "bearer" }), /no valid access token/],
    ["empty access token", jsonResponse({ access_token: "" }), /no valid access token/],
  ])("rejects %s", async (_label, response, expected) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      exchangeOAuthAuthorizationCode({
        providerId: "example",
        endpoint: "https://accounts.example.test/oauth2/token",
        clientId: "client",
        clientSecret: "secret",
        clientAuthentication: "request-body",
        code: "authorization-code",
        redirectUri: "https://cms.example.test/callback",
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(expected);
  });
});
