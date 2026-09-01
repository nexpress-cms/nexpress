import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createSite,
  grantSiteMembership,
  npAgentInvocations,
  npAgentOauthCodes,
  npAgentOauthRefreshTokens,
  npSessions,
  npUsers,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentCapabilityAdmissionServiceV1,
  createAgentGatewayServiceV1,
  createAgentOauthServiceV1,
  createAgentReadCapabilityRegistryV1,
  type NpAgentReadCapabilityExecutorsV1,
} from "../../../packages/core/src/agent/index.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "agent-oauth";
const origin = "https://agent.example";
const resource = `${origin}/api/mcp`;
const gatewaySettings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "read" as const,
  mcpHttp: "approved-execute" as const,
  agentHttp: "disabled" as const,
};
const schemaDigest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function executors(): NpAgentReadCapabilityExecutorsV1 {
  return {
    "site.inspect": async () => ({
      schemaVersion: "np.agent-site-inspect.v1",
      site: { id: siteId, name: "Agent OAuth", defaultLocale: "en", locales: ["en"] },
      features: { remoteMcp: true, agentHttp: false, runtime: "ready" },
      counts: { collections: 0, blocks: 0, activePlugins: 0 },
      resourceUris: [],
    }),
    "schema.get": async (input) => ({
      schemaVersion: "np.agent-schema-resource.v1",
      selector: input,
      digest: schemaDigest,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    }),
    "content.query": async (input) => ({
      schemaVersion: "np.agent-content-query.v1",
      collection: input.collection,
      items: [],
      nextCursor: null,
    }),
  };
}

function decodeJwtPart(token: string, index: 0 | 1): Record<string, unknown> {
  const part = token.split(".")[index];
  if (!part) throw new Error("Invalid compact JWT fixture.");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function signAccessToken(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: "agent-oauth-signing-v1", typ: "at+jwt" }),
    "utf8",
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const input = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    Buffer.from(input, "ascii"),
  );
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

describe.skipIf(skipIfNoTestDb())("Agent Gateway OAuth authorization lifecycle", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("registers, consents, exchanges once, rotates refresh tokens, and contains replay", async () => {
    const seeded = await seedUser({ role: "admin" });
    await createSite({ id: siteId, name: "Agent OAuth" });
    await grantSiteMembership(siteId, seeded.userId, "admin");
    const db = await getTestDb();
    const [[user], [session]] = await Promise.all([
      db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1),
      db.select().from(npSessions).where(eq(npSessions.userId, seeded.userId)).limit(1),
    ]);
    expect(user).toBeDefined();
    expect(session).toBeDefined();
    const actor = {
      user: {
        id: user!.id,
        email: user!.email,
        name: user!.name,
        role: user!.role,
        tokenVersion: user!.tokenVersion,
      },
      sessionId: session!.id,
    };
    const gateway = createAgentGatewayServiceV1({
      tokenHashKeyring: {
        active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(19) },
      },
      deploymentGatewaySettings: gatewaySettings,
      resolveSiteGatewaySettings: () => gatewaySettings,
      resolveCanonicalSiteOrigin: () => origin,
      reauthentication: { verify: () => true },
    });
    const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const oauth = createAgentOauthServiceV1({
      gateway,
      tokenHashKeyring: {
        active: { id: "agent-token-hash-v1", key: new Uint8Array(32).fill(19) },
      },
      signingKeyring: {
        active: {
          kid: "agent-oauth-signing-v1",
          privateKey: signing.privateKey,
          publicKey: signing.publicKey,
        },
      },
      reauthentication: { verify: () => true },
    });

    const registered = await oauth.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.oauth_clients.create",
      targetId: null,
      command: {
        idempotencyKey: "agent:oauth:client:create",
        name: "Desktop MCP",
        redirectUris: ["http://127.0.0.1:43110/callback"],
        transports: ["mcp-http"],
      },
    });
    expect(registered.output).toMatchObject({
      status: "active",
      rowVersion: 1,
      transports: ["mcp-http"],
    });
    const clientId = String(registered.output.clientId);
    const verifier = "v".repeat(43);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const authorization = await oauth.startAuthorization({
      siteId,
      actor,
      request: {
        responseType: "code",
        clientId,
        redirectUri: "http://127.0.0.1:43110/callback",
        state: "client-state-value",
        scope: "content:read site:read",
        resource,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        gatewayMode: "read",
      },
    });
    expect(authorization).toMatchObject({
      siteId,
      requestedScopes: ["content:read", "site:read"],
      gatewayMode: "read",
      resource,
    });
    const redirect = await oauth.decideAuthorization({
      siteId,
      actor,
      consentChallenge: authorization.consentChallenge,
      approve: true,
      scopes: ["content:read", "site:read"],
      gatewayMode: "read",
    });
    const redirected = new URL(redirect.redirectUri);
    const code = redirected.searchParams.get("code");
    expect(code).toMatch(/^npac1_/u);
    expect(redirected.searchParams.get("iss")).toBe(origin);
    expect(redirected.searchParams.get("state")).toBe("client-state-value");

    await expect(
      oauth.exchangeAuthorizationCode({
        siteId,
        clientId,
        code,
        redirectUri: "http://127.0.0.1:43110/callback",
        codeVerifier: "wrong".repeat(9),
        resource,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    const tokens = await oauth.exchangeAuthorizationCode({
      siteId,
      clientId,
      code,
      redirectUri: "http://127.0.0.1:43110/callback",
      codeVerifier: verifier,
      resource,
    });
    expect(tokens.refresh_token).toMatch(/^nprt1_/u);
    expect(decodeJwtPart(tokens.access_token, 0)).toEqual({
      alg: "ES256",
      kid: "agent-oauth-signing-v1",
      typ: "at+jwt",
    });
    expect(decodeJwtPart(tokens.access_token, 1)).toMatchObject({
      aud: resource,
      client_id: clientId,
      gateway_mode: "read",
      grant_version: 1,
      principal_version: 1,
      scope: "content:read site:read",
      site_id: siteId,
    });
    await expect(
      oauth.exchangeAuthorizationCode({
        siteId,
        clientId,
        code,
        redirectUri: "http://127.0.0.1:43110/callback",
        codeVerifier: verifier,
        resource,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    const remoteAuthentication = await oauth.authenticateRemoteBearer({
      siteId,
      authorization: `Bearer ${tokens.access_token}`,
    });
    expect(remoteAuthentication).toMatchObject({
      kind: "oauth",
      scopes: ["content:read", "site:read"],
      authorizationContext: {
        transport: "mcp-oauth",
        authorityRef: { kind: "oauth-grant", clientId, grantVersion: 1 },
      },
    });
    const registry = await createAgentReadCapabilityRegistryV1(executors());
    const admission = createAgentCapabilityAdmissionServiceV1({
      registry,
      resolveGatewaySettings: () => gatewaySettings,
    });
    expect(
      (await admission.project({ authentication: remoteAuthentication })).entries.map(
        (entry) => entry.definition.descriptor.id,
      ),
    ).toEqual(["content.query", "site.inspect"]);
    await expect(
      admission.invoke({
        authentication: remoteAuthentication,
        request: {
          schemaVersion: "np.agent-invocation-request.v1",
          capabilityId: "site.inspect",
          arguments: { input: {}, idempotencyKey: null },
        },
      }),
    ).resolves.toMatchObject({ capabilityId: "site.inspect" });
    await expect(
      db
        .select({
          transport: npAgentInvocations.transport,
          mode: npAgentInvocations.mcpExecutionMode,
        })
        .from(npAgentInvocations)
        .where(
          and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.transport, "mcp-oauth")),
        ),
    ).resolves.toEqual([{ transport: "mcp-oauth", mode: "normal" }]);
    const claims = decodeJwtPart(tokens.access_token, 1);
    const futureIssuedAt = Math.floor(Date.now() / 1_000) + 3_600;
    await expect(
      oauth.authenticateOauthAccessToken({
        siteId,
        token: await signAccessToken(signing.privateKey, {
          ...claims,
          iat: futureIssuedAt,
          exp: futureIssuedAt + 600,
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(
      oauth.authenticateOauthAccessToken({
        siteId,
        token: await signAccessToken(signing.privateKey, {
          ...claims,
          scope: "site:read unknown:scope",
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });

    const rotated = await oauth.exchangeRefreshToken({
      siteId,
      clientId,
      refreshToken: tokens.refresh_token,
      resource,
    });
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    const invalidConsumedRefresh = `${tokens.refresh_token.slice(0, -1)}${tokens.refresh_token.endsWith("A") ? "B" : "A"}`;
    await expect(
      oauth.exchangeRefreshToken({
        siteId,
        clientId,
        refreshToken: invalidConsumedRefresh,
        resource,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(
      oauth.authenticateOauthAccessToken({ siteId, token: rotated.access_token }),
    ).resolves.toMatchObject({ kind: "oauth", grantId: expect.any(String) });
    await expect(
      oauth.exchangeRefreshToken({
        siteId,
        clientId,
        refreshToken: tokens.refresh_token,
        resource,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(
      oauth.authenticateOauthAccessToken({ siteId, token: rotated.access_token }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 401 });

    const jwks = await oauth.getJwks(siteId);
    expect(jwks.keys).toMatchObject([
      { alg: "ES256", crv: "P-256", kid: "agent-oauth-signing-v1", kty: "EC", use: "sig" },
    ]);
    const codeRows = await db.select().from(npAgentOauthCodes);
    const refreshRows = await db.select().from(npAgentOauthRefreshTokens);
    expect(codeRows).toHaveLength(1);
    expect(refreshRows).toHaveLength(2);
    const evidence = JSON.stringify({ codeRows, refreshRows });
    expect(evidence).not.toContain(code);
    expect(evidence).not.toContain(tokens.refresh_token);
    expect(evidence).not.toContain(rotated.refresh_token);

    const revoked = await oauth.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.oauth_clients.revoke",
      targetId: registered.resourceId,
      command: {
        idempotencyKey: "agent:oauth:client:revoke",
        expectedVersion: 1,
        reason: "Integration cleanup",
      },
    });
    expect(revoked.output).toMatchObject({ status: "revoked", rowVersion: 2 });
  });
});
