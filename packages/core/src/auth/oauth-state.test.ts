import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { issueOAuthState, verifyOAuthState } from "./oauth-state.js";

const secret = "oauth-state-test-secret-at-least-32-characters";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("OAuth state contract", () => {
  it("uses one exact TTL for the signed payload and cookie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    vi.stubEnv("NP_OAUTH_STATE_TTL_SECONDS", "900");

    const issued = issueOAuthState("github", secret);

    expect(issued.expiresInSeconds).toBe(900);
    expect(verifyOAuthState(issued.token, "github", secret)).toEqual({
      ok: true,
      payload: expect.objectContaining({
        providerId: "github",
        expSeconds: Math.floor(Date.now() / 1000) + 900,
        codeVerifier: issued.codeVerifier,
      }),
    });
  });

  it("fails closed for malformed TTL configuration", () => {
    vi.stubEnv("NP_OAUTH_STATE_TTL_SECONDS", "10m");
    expect(() => issueOAuthState("github", secret)).toThrow("positive integer");
  });

  it("rejects non-exact serialized state tokens", () => {
    const issued = issueOAuthState("github", secret);
    expect(verifyOAuthState(`${issued.token}.extra`, "github", secret)).toEqual({
      ok: false,
      reason: "format",
    });

    const [encoded] = issued.token.split(".") as [string, string];
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    payload.extra = true;
    const alteredPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const alteredSignature = createHmac("sha256", secret)
      .update(alteredPayload)
      .digest("base64url");
    const altered = `${alteredPayload}.${alteredSignature}`;
    expect(verifyOAuthState(altered, "github", secret)).toEqual({
      ok: false,
      reason: "format",
    });
  });
});
