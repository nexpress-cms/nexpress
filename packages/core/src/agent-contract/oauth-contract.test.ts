import { describe, expect, it } from "vitest";

import {
  npAgentOauthAuthorizationServerMetadataV1,
  npAgentOauthProtectedResourceMetadataV1,
  npAgentScopes,
  npAnalyzeAgentOauthClientV1,
  npRequireAgentOauthClientV1,
} from "./index.js";

describe("Agent OAuth client and discovery contract v1", () => {
  it("derives exact same-origin protected-resource and authorization metadata", () => {
    expect(npAgentOauthProtectedResourceMetadataV1("https://cms.example")).toEqual({
      resource: "https://cms.example/api/mcp",
      authorization_servers: ["https://cms.example"],
      scopes_supported: npAgentScopes,
      bearer_methods_supported: ["header"],
    });
    expect(npAgentOauthAuthorizationServerMetadataV1("https://cms.example")).toMatchObject({
      issuer: "https://cms.example",
      authorization_endpoint: "https://cms.example/api/agent-oauth/authorize",
      token_endpoint: "https://cms.example/api/agent-oauth/token",
      revocation_endpoint: "https://cms.example/api/agent-oauth/revoke",
      jwks_uri: "https://cms.example/api/agent-oauth/jwks",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
      nexpress_gateway_modes_supported: ["read", "propose", "approved-execute"],
    });
    expect(() => npAgentOauthProtectedResourceMetadataV1("http://cms.example")).toThrow(
      "canonical HTTPS origin",
    );
  });

  it("keeps OAuth client projections exact and credential-free", () => {
    const client = {
      schemaVersion: "np.agent-oauth-client.v1",
      id: "11111111-1111-4111-8111-111111111111",
      siteId: "default",
      clientId: "desktop-client",
      name: "Desktop client",
      redirectUris: ["http://127.0.0.1:43110/callback"],
      transports: ["mcp-http"],
      status: "active",
      rowVersion: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      revokedAt: null,
    };
    expect(npRequireAgentOauthClientV1(client)).toEqual(client);
    expect(
      npAnalyzeAgentOauthClientV1({ ...client, clientSecret: "must-not-exist" }),
    ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });
    expect(
      npAnalyzeAgentOauthClientV1({ ...client, status: "revoked", revokedAt: null }),
    ).toMatchObject({ ok: false, issues: [{ path: expect.stringContaining("revokedAt") }] });
    expect(
      npAnalyzeAgentOauthClientV1({
        ...client,
        redirectUris: ["https://client.example/callback#fragment"],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: expect.stringContaining("redirectUris") }] });
    expect(
      npAnalyzeAgentOauthClientV1({
        ...client,
        redirectUris: ["http://client.example/callback"],
      }),
    ).toMatchObject({ ok: false, issues: [{ path: expect.stringContaining("redirectUris") }] });
  });
});
