import { describe, expect, it, vi } from "vitest";

import { fromArctic, type ArcticLikeTokens } from "./oauth-arctic.js";

function tokens(accessToken: string): ArcticLikeTokens {
  return { accessToken: () => accessToken };
}

describe("fromArctic deprecated compatibility adapter", () => {
  it("preserves the PKCE provider call shape without importing Arctic", async () => {
    const createAuthorizationURL = vi.fn(() => new URL("https://provider.test/authorize"));
    const validateAuthorizationCode = vi.fn(() => Promise.resolve(tokens("access-token")));
    const factory = vi.fn(() => ({ createAuthorizationURL, validateAuthorizationCode }));
    const fetchProfile = vi.fn((accessToken: string) =>
      Promise.resolve({ providerUserId: accessToken }),
    );
    const provider = fromArctic(factory, {
      id: "legacy-pkce",
      scopes: ["openid"],
      fetchProfile,
    });

    expect(
      provider.authorize({
        state: "state",
        redirectUri: "https://cms.test/callback",
        codeVerifier: "verifier",
      }),
    ).toBe("https://provider.test/authorize");
    expect(createAuthorizationURL).toHaveBeenCalledWith("state", "verifier", ["openid"]);

    await expect(
      provider.exchange({
        code: "code",
        state: "state",
        redirectUri: "https://cms.test/callback",
        codeVerifier: "verifier",
      }),
    ).resolves.toEqual({ providerUserId: "access-token" });
    expect(validateAuthorizationCode).toHaveBeenCalledWith("code", "verifier");
    expect(fetchProfile).toHaveBeenCalledWith("access-token", expect.any(Object));
  });

  it("preserves the legacy non-PKCE provider call shape", async () => {
    const createAuthorizationURL = vi.fn(() => new URL("https://provider.test/authorize"));
    const validateAuthorizationCode = vi.fn(() => Promise.resolve(tokens("access-token")));
    const provider = fromArctic(() => ({ createAuthorizationURL, validateAuthorizationCode }), {
      id: "legacy-no-pkce",
      pkce: false,
      scopes: ["profile"],
      fetchProfile: (accessToken) => Promise.resolve({ providerUserId: accessToken }),
    });

    await provider.authorize({
      state: "state",
      redirectUri: "https://cms.test/callback",
      codeVerifier: "unused",
    });
    expect(createAuthorizationURL).toHaveBeenCalledWith("state", ["profile"]);

    await provider.exchange({
      code: "code",
      state: "state",
      redirectUri: "https://cms.test/callback",
      codeVerifier: "unused",
    });
    expect(validateAuthorizationCode).toHaveBeenCalledWith("code");
  });
});
