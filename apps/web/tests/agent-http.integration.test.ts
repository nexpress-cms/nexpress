import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createSite,
  grantSiteMembership,
  npAgentActions,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentServiceTokens,
  npSessions,
  npSiteMemberships,
  npUsers,
} from "@nexpress/core";
import {
  createAgentCapabilityAdmissionServiceV1,
  createAgentGatewayServiceV1,
  createAgentHttpGatewayV1,
  createAgentOauthServiceV1,
  createAgentReadCapabilityRegistryV1,
  type NpAgentReadCapabilityExecutorsV1,
} from "@nexpress/core/agents";
import type { NpAgentGatewaySettingsV1, NpAgentScope } from "@nexpress/core/agent-contract";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "agent-http-test";
const otherSiteId = "agent-http-other";
const origin = "https://agent-http.example";
const resource = `${origin}/api/agent/v1`;
const digest = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const invocation = {
  schemaVersion: "np.agent-invocation-request.v1" as const,
  capabilityId: "site.inspect" as const,
  arguments: { input: {}, idempotencyKey: null },
};

async function fixture(scopes: NpAgentScope[] = ["site:read"]) {
  const seeded = await seedUser({ role: "admin" });
  await createSite({ id: siteId, name: "Agent HTTP" });
  await createSite({ id: otherSiteId, name: "Other tenant" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  await grantSiteMembership(otherSiteId, seeded.userId, "admin");
  const db = await getTestDb();
  const [[user], [session]] = await Promise.all([
    db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1),
    db.select().from(npSessions).where(eq(npSessions.userId, seeded.userId)).limit(1),
  ]);
  if (!user || !session) throw new Error("Missing staff fixture");
  const actor = { user, sessionId: session.id };
  let clock = new Date();
  const now = () => clock;
  let settings: NpAgentGatewaySettingsV1 = {
    schemaVersion: "np.agent-gateway-settings.v1",
    stdio: "approved-execute",
    mcpHttp: "approved-execute",
    agentHttp: "approved-execute",
  };
  const keyring = { active: { id: "http-test-key", key: new Uint8Array(32).fill(21) } };
  const gateway = createAgentGatewayServiceV1({
    tokenHashKeyring: keyring,
    now,
    deploymentGatewaySettings: settings,
    resolveSiteGatewaySettings: () => settings,
    resolveCanonicalSiteOrigin: (id) => (id === siteId ? origin : "https://other.example"),
    reauthentication: { verify: () => true },
  });
  const principal = await gateway.executeAdmin({
    siteId,
    actor,
    operationId: "agents.gateway.principals.create",
    targetId: null,
    command: { idempotencyKey: "http:principal", name: "HTTP client", description: null, scopes },
  });
  async function token(transport: "stdio" | "mcp-http" | "agent-http") {
    return gateway.executeAdmin({
      siteId,
      actor,
      operationId: "agents.gateway.principal_tokens.create",
      targetId: principal.resourceId,
      command: {
        idempotencyKey: `http:token:${transport}`,
        expectedVersion: (await gateway.getPrincipal(siteId, principal.resourceId))!.rowVersion,
        name: "HTTP fixture",
        scopes,
        transport,
        exposure: "read",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
  }
  const issued = await token("agent-http");
  let calls = 0;
  const executors: NpAgentReadCapabilityExecutorsV1 = {
    "site.inspect": async () => {
      calls++;
      return {
        schemaVersion: "np.agent-site-inspect.v1",
        site: { id: siteId, name: "Agent HTTP", defaultLocale: "en", locales: ["en"] },
        features: { remoteMcp: true, agentHttp: true, runtime: "disabled" },
        counts: { collections: 0, blocks: 0, activePlugins: 0 },
        resourceUris: [],
      };
    },
    "schema.get": async (input) => ({
      schemaVersion: "np.agent-schema-resource.v1",
      selector: input,
      digest,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    }),
    "content.query": async (input) => ({
      schemaVersion: "np.agent-content-query.v1",
      collection: input.collection,
      items: [],
      nextCursor: null,
    }),
  };
  const registry = await createAgentReadCapabilityRegistryV1(executors);
  const admission = createAgentCapabilityAdmissionServiceV1({
    registry,
    now,
    resolveGatewaySettings: () => settings,
  });
  const http = createAgentHttpGatewayV1({ gateway, admission, now });
  const authenticate = (
    credential: unknown = issued.oneTimeValue,
    requestUrl = `${resource}/capabilities`,
  ) =>
    http.authenticate({
      authorization: typeof credential === "string" ? `Bearer ${credential}` : null,
      requestUrl,
    });
  return {
    db,
    seeded,
    actor,
    gateway,
    principal,
    issued,
    http,
    admission,
    keyring,
    token,
    authenticate,
    calls: () => calls,
    advance: () => {
      clock = new Date(clock.getTime() + 2 * 86_400_000);
    },
    setSettings: (next: NpAgentGatewaySettingsV1) => {
      settings = next;
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Agent HTTP PostgreSQL authority boundary", () => {
  beforeAll(ensureMigrated);
  afterEach(truncateAll);
  afterAll(closeTestDb);

  it("selects the tenant from the credential and persists the same inline invocation/action without a run", async () => {
    const f = await fixture();
    const auth = await f.authenticate();
    expect(auth.principal.siteId).toBe(siteId);
    expect(auth.serviceToken.audience).toBe(resource);
    const catalog = await f.http.capabilities(auth);
    expect(JSON.stringify(catalog)).toContain("site.inspect");
    expect(JSON.stringify(catalog)).not.toContain(f.issued.oneTimeValue);
    await expect(f.http.invoke(auth, invocation)).resolves.toMatchObject({
      capabilityId: "site.inspect",
      output: { schemaVersion: "np.agent-site-inspect.v1" },
    });
    expect(f.calls()).toBe(1);
    const [action] = await f.db
      .select({ runId: npAgentActions.runId, state: npAgentActions.state })
      .from(npAgentActions)
      .where(eq(npAgentActions.siteId, siteId));
    expect(action).toEqual({ runId: null, state: "succeeded" });
    const [invoked] = await f.db
      .select({ transport: npAgentInvocations.transport })
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, siteId),
          eq(npAgentInvocations.operationKind, "capability"),
        ),
      );
    expect(invoked?.transport).toBe("agent-api");
    await expect(
      f.authenticate(f.issued.oneTimeValue, "https://other.example/api/agent/v1/capabilities"),
    ).rejects.toThrow();
    await expect(
      f.gateway.authenticateServiceToken({
        siteId: otherSiteId,
        credential: f.issued.oneTimeValue,
        transport: "agent-http",
        audience: resource,
      }),
    ).rejects.toThrow();
  });

  it("rejects MCP/stdio service tokens, cookie-style headers, and cross-origin requests", async () => {
    const f = await fixture();
    for (const transport of ["stdio", "mcp-http"] as const) {
      const issued = await f.token(transport);
      await expect(f.authenticate(issued.oneTimeValue)).rejects.toThrow();
    }
    await expect(
      f.gateway.authenticateStdioServiceToken({ credential: f.issued.oneTimeValue }),
    ).rejects.toThrow();
    for (const authorization of [
      null,
      "Basic dGVzdDp0ZXN0",
      "np-session=test",
      `Bearer ${f.issued.oneTimeValue}, Bearer extra`,
    ]) {
      await expect(
        f.http.authenticate({ authorization, requestUrl: `${resource}/capabilities` }),
      ).rejects.toThrow();
    }
    await expect(
      f.http.authenticate({
        authorization: `Bearer ${f.issued.oneTimeValue}`,
        requestUrl: `${resource}/capabilities`,
        origin: "https://other.example",
      }),
    ).rejects.toThrow();
  });

  it.each(["membership", "principal-version", "revoke", "scope"] as const)(
    "rechecks %s after authentication, before discovery/invocation",
    async (change) => {
      const f = await fixture(["schema:read", "site:read"]);
      const auth = await f.authenticate();
      if (change === "membership")
        await f.db
          .delete(npSiteMemberships)
          .where(
            and(
              eq(npSiteMemberships.siteId, siteId),
              eq(npSiteMemberships.userId, f.seeded.userId),
            ),
          );
      if (change === "principal-version")
        await f.db
          .update(npAgentPrincipals)
          .set({ tokenVersion: sql`${npAgentPrincipals.tokenVersion} + 1` })
          .where(eq(npAgentPrincipals.id, f.principal.resourceId));
      if (change === "revoke")
        await f.gateway.executeAdmin({
          siteId,
          actor: f.actor,
          operationId: "agents.gateway.principals.revoke",
          targetId: f.principal.resourceId,
          command: {
            idempotencyKey: "http:revoke",
            expectedVersion: (await f.gateway.getPrincipal(siteId, f.principal.resourceId))!
              .rowVersion,
            reason: "Authority regression",
          },
        });
      if (change === "scope")
        await f.db
          .update(npAgentServiceTokens)
          .set({ scopes: ["site:read"] })
          .where(eq(npAgentServiceTokens.id, f.issued.resourceId));
      await expect(f.http.capabilities(auth)).rejects.toThrow();
      await expect(f.http.invoke(auth, invocation)).rejects.toThrow();
      expect(f.calls()).toBe(0);
    },
  );

  it("rejects token expiry during the admission principal lock wait", async () => {
    const f = await fixture();
    const auth = await f.authenticate();
    let locked!: (pid: number) => void;
    const acquired = new Promise<number>((resolve) => {
      locked = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = f.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx
        .select()
        .from(npAgentPrincipals)
        .where(eq(npAgentPrincipals.id, f.principal.resourceId))
        .for("update");
      const backend = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked(backend.rows[0]!.pid);
      await gate;
    });
    void holder.catch(() => locked(-1));
    const pid = await acquired;
    expect(pid).toBeGreaterThan(0);
    const attempt = f.http.capabilities(auth);
    const completed = Promise.allSettled([holder, attempt]);
    try {
      await expect
        .poll(
          async () => {
            const blocked = await f.db.execute<{ waiting: boolean }>(
              sql`select exists(select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))) as waiting`,
            );
            return blocked.rows[0]?.waiting;
          },
          { timeout: 5_000 },
        )
        .toBe(true);
      f.advance();
    } finally {
      release();
      await completed;
    }
    expect((await completed).map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.calls()).toBe(0);
  });

  it("cannot invoke a known but unexposed capability or use a disabled surface", async () => {
    const f = await fixture();
    const auth = await f.authenticate();
    expect(JSON.stringify(await f.http.capabilities(auth))).not.toContain('"schema.get"');
    await expect(
      f.http.invoke(auth, {
        ...invocation,
        capabilityId: "schema.get",
        arguments: { input: { selector: "catalog" }, idempotencyKey: null },
      }),
    ).rejects.toThrow();
    f.setSettings({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "read",
      mcpHttp: "read",
      agentHttp: "disabled",
    });
    await expect(f.http.capabilities(auth)).rejects.toThrow();
    await expect(f.authenticate()).rejects.toThrow();
    expect(f.calls()).toBe(0);
  });

  it("returns the same unavailable error for run/artifact reads without injected facades", async () => {
    const f = await fixture();
    const auth = await f.authenticate();
    const failure = (promise: Promise<unknown>) =>
      promise.then(
        () => "unexpected success",
        (error: unknown) => {
          const e = error as { code: string; status: number; message: string };
          return { code: e.code, status: e.status, message: e.message };
        },
      );
    const missing = await failure(f.http.getRun(auth, randomUUID()));
    expect(missing).toMatchObject({ status: 404 });
    expect(await failure(f.http.getRun(auth, randomUUID()))).toEqual(missing);
    const artifact = await failure(f.http.readArtifact(auth, randomUUID(), randomUUID()));
    expect(artifact).toMatchObject({ status: 404 });
    expect(await failure(f.http.readArtifact(auth, randomUUID(), randomUUID()))).toEqual(artifact);
  });

  it("rejects a genuine MCP OAuth access token and refuses Agent HTTP service tokens at MCP OAuth", async () => {
    const f = await fixture();
    const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const oauth = createAgentOauthServiceV1({
      gateway: f.gateway,
      tokenHashKeyring: f.keyring,
      signingKeyring: {
        active: {
          kid: "http-oauth-test",
          privateKey: signing.privateKey,
          publicKey: signing.publicKey,
        },
      },
      reauthentication: { verify: () => true },
    });
    const client = await oauth.executeAdmin({
      siteId,
      actor: f.actor,
      operationId: "agents.gateway.oauth_clients.create",
      targetId: null,
      command: {
        idempotencyKey: "http:oauth-client",
        name: "MCP client",
        redirectUris: ["http://127.0.0.1:43110/callback"],
        transports: ["mcp-http"],
      },
    });
    const clientId = String(client.output.clientId);
    const verifier = "v".repeat(43);
    const authorization = await oauth.startAuthorization({
      siteId,
      actor: f.actor,
      request: {
        responseType: "code",
        clientId,
        redirectUri: "http://127.0.0.1:43110/callback",
        state: "http-cross-token-test",
        scope: "site:read",
        resource: `${origin}/api/mcp`,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        codeChallengeMethod: "S256",
        gatewayMode: "read",
      },
    });
    const redirect = await oauth.decideAuthorization({
      siteId,
      actor: f.actor,
      consentChallenge: authorization.consentChallenge,
      approve: true,
      scopes: ["site:read"],
      gatewayMode: "read",
    });
    const tokens = await oauth.exchangeAuthorizationCode({
      siteId,
      clientId,
      code: new URL(redirect.redirectUri).searchParams.get("code"),
      redirectUri: "http://127.0.0.1:43110/callback",
      codeVerifier: verifier,
      resource: `${origin}/api/mcp`,
    });
    await expect(
      oauth.authenticateRemoteBearer({ siteId, authorization: `Bearer ${tokens.access_token}` }),
    ).resolves.toMatchObject({ kind: "oauth" });
    await expect(f.authenticate(tokens.access_token)).rejects.toThrow();
    await expect(
      oauth.authenticateRemoteBearer({ siteId, authorization: `Bearer ${f.issued.oneTimeValue}` }),
    ).rejects.toThrow();
  });
});
