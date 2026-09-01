import { describe, expect, it } from "vitest";

import { agentOauthBearerChallenge, oauthError, readExactOauthForm } from "./oauth-http.js";

describe("Agent OAuth HTTP boundaries", () => {
  it("builds the endpoint-specific protected-resource challenge", () => {
    expect(agentOauthBearerChallenge("https://cms.example", "invalid_token")).toBe(
      'Bearer error="invalid_token", resource_metadata="https://cms.example/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it("accepts one exact bounded form value per allowed field", async () => {
    const request = new Request("https://cms.example/api/agent-oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "grant_type=refresh_token&client_id=client&resource=https%3A%2F%2Fcms.example%2Fapi%2Fmcp&refresh_token=nprt1_value",
    });
    await expect(
      readExactOauthForm(
        request,
        ["client_id", "grant_type", "refresh_token", "resource"],
        ["client_id", "grant_type", "resource"],
      ),
    ).resolves.toEqual({
      grant_type: "refresh_token",
      client_id: "client",
      resource: "https://cms.example/api/mcp",
      refresh_token: "nprt1_value",
    });
  });

  it("rejects duplicate, unknown, wrong-media, and oversized form input", async () => {
    for (const request of [
      new Request("https://cms.example/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "client_id=a&client_id=b",
      }),
      new Request("https://cms.example/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "client_id=a&unknown=b",
      }),
      new Request("https://cms.example/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      new Request("https://cms.example/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `client_id=${"a".repeat(16_385)}`,
      }),
    ]) {
      await expect(readExactOauthForm(request, ["client_id"], ["client_id"])).rejects.toThrow(
        "invalid_request",
      );
    }
  });

  it("projects only stable OAuth errors", async () => {
    const stable = oauthError({ code: "invalid_grant", status: 401 });
    expect(stable.status).toBe(401);
    await expect(stable.json()).resolves.toEqual({ error: "invalid_grant" });

    const opaque = oauthError({ code: "DATABASE_URL_LEAK", status: 500 });
    expect(opaque.status).toBe(500);
    await expect(opaque.json()).resolves.toEqual({ error: "invalid_request" });
  });
});
