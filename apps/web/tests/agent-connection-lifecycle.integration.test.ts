import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createSite,
  grantSiteMembership,
  npAgentConnectionAuthRequests,
  npAgentConnectionOperations,
  npAgentConnectionSecretVersions,
  npAgentConnections,
  npAgentInvocations,
  npAgentVaultOperations,
  npSessions,
  npUsers,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import {
  NpAgentConnectionAuthAdapterRegistryV1,
  NpAgentVaultAdapterRegistryV1,
  createAgentAdminAdmissionV1,
  createAgentConnectionAdminServiceV1,
  createAgentConnectionServiceV1,
  createAgentFakeProviderAdapterV1,
  createAgentVaultServiceV1,
  createLocalEnvelopeVaultAdapterV1,
  type NpAgentAdminActorV1,
  type NpAgentConnectionOperationProjectionV1,
} from "../../../packages/core/src/agent/index.js";
// eslint-disable-next-line import-x/no-relative-packages
import {
  npDigestAgentStudioConnectionDefinitionV1,
  npSerializeAgentStudioConnectionDefinitionV1,
} from "../../../packages/core/src/agent-contract/index.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const siteId = "agent-connections";
const digest = `cj1:sha256:${"A".repeat(43)}`;

function vaultDigestKeyring() {
  return {
    active: {
      id: "agent-vault-request-v1",
      key: Uint8Array.from({ length: 32 }, (_, index) => index + 11),
    },
  };
}

async function actorFixture(): Promise<{ actor: NpAgentAdminActorV1; sessionId: string }> {
  const seeded = await seedUser({ role: "admin" });
  await createSite({ id: siteId, name: "Agent connections" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  const db = await getTestDb();
  const [user] = await db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1);
  const [session] = await db
    .select()
    .from(npSessions)
    .where(eq(npSessions.userId, seeded.userId))
    .limit(1);
  if (!user || !session) throw new Error("Failed to seed Agent connection actor.");
  return {
    actor: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      sessionId: session.id,
    },
    sessionId: session.id,
  };
}

async function serviceFixture() {
  const db = await getTestDb();
  const vaultAdapter = createLocalEnvelopeVaultAdapterV1({
    environment: "development",
    explicitlyEnabled: true,
    activeKey: {
      id: "development-kek",
      version: "v1",
      key: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    },
    resolveDb: () => db,
  });
  const vaultRegistry = new NpAgentVaultAdapterRegistryV1();
  vaultRegistry.register(vaultAdapter, { active: true });
  const vault = createAgentVaultServiceV1({
    registry: vaultRegistry,
    requestDigestKeyring: vaultDigestKeyring(),
    resolveDb: () => db,
  });
  const provider = createAgentFakeProviderAdapterV1();
  const providerRegistry = new NpAgentConnectionAuthAdapterRegistryV1().register(provider);
  const service = createAgentConnectionServiceV1({
    providerRegistry,
    vault,
    projectionKeyring: {
      accountSubject: {
        owner: "connection-account-subject",
        id: "account-subject-v1",
        bytes: new Uint8Array(32).fill(31),
      },
      destination: {
        owner: "connection-destination",
        id: "destination-v1",
        bytes: new Uint8Array(32).fill(47),
      },
    },
    stateHashKeyring: {
      active: { id: "provider-state-v1", key: new Uint8Array(32).fill(59) },
    },
    resolveOAuthClientConfigDigest: () => digest,
    resolveDb: () => db,
  });
  return {
    db,
    provider,
    service,
    async dispose() {
      service.dispose();
      vault.dispose();
      await vaultRegistry.shutdown();
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Agent provider connection lifecycle", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("admits create and revoke with one audited transaction and no retained plaintext", async () => {
    const { actor } = await actorFixture();
    const fixture = await serviceFixture();
    const admin = createAgentConnectionAdminServiceV1({
      connections: fixture.service,
      reauthentication: { verify: () => true },
      secretRequestDigestKey: {
        id: "admin-secret-request-v1",
        key: new Uint8Array(32).fill(71),
      },
    });
    const definition = {
      schemaVersion: "np.agent-studio-connection-definition.v1" as const,
      name: "Atomic fake model",
      kind: "model" as const,
      provider: fixture.provider.id,
      adapterId: fixture.provider.id,
      adapterContractVersion: fixture.provider.contractVersion,
      adapterFingerprint: fixture.provider.fingerprint,
      authKind: "api_key" as const,
      config: {
        accountId: "atomic-account",
        connectionKind: "model",
        destination: null,
        modelId: "fake-model",
      },
      dataProcessingCeiling: "public-only" as const,
    };
    const definitionJson = npSerializeAgentStudioConnectionDefinitionV1(definition);
    const created = await admin.executeAdmin({
      siteId,
      actor,
      operationId: "agents.connections.create",
      targetId: null,
      command: {
        idempotencyKey: "connection:atomic:create",
        credential: "fake-api-key",
        definitionJson,
        definitionHash: await npDigestAgentStudioConnectionDefinitionV1(definition),
        vaultOperationId: randomUUID(),
      },
    });
    expect(created).toMatchObject({ replayed: false, output: { status: "pending" } });
    const [operation] = await fixture.db
      .select()
      .from(npAgentConnectionOperations)
      .where(eq(npAgentConnectionOperations.connectionId, created.resourceId))
      .limit(1);
    expect(operation).toMatchObject({ state: "queued", kind: "activate-secret" });
    await fixture.service.processOperation({ siteId, operationId: operation!.id });
    expect(
      await fixture.service.getConnection({ siteId, connectionId: created.resourceId }),
    ).toMatchObject({ status: "ready", credential: { state: "stored", version: 1 } });
    expect(await fixture.service.listConnections(siteId)).toHaveLength(1);

    const [invocation] = await fixture.db
      .select({ requestBody: npAgentInvocations.requestBody })
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.operationId, "agents.connections.create"))
      .limit(1);
    expect(JSON.stringify(invocation?.requestBody)).not.toContain("fake-api-key");
    expect(invocation?.requestBody.input).toMatchObject({
      credentialDigest: expect.stringMatching(
        /^cj1:hmac-sha256:admin-secret-request-v1:[A-Za-z0-9_-]{43}$/u,
      ),
    });

    const revoked = await admin.executeAdmin({
      siteId,
      actor,
      operationId: "agents.connections.revoke",
      targetId: created.resourceId,
      command: {
        idempotencyKey: "connection:atomic:revoke",
        expectedVersion: 1,
        reason: "fixture cleanup",
      },
    });
    expect(revoked.output).toMatchObject({ status: "revoked", credential: { state: "absent" } });
    await fixture.dispose();
  });

  it("activates and rotates API keys without replacing a known-good credential on failed probe", async () => {
    const { actor } = await actorFixture();
    const fixture = await serviceFixture();
    const connection = await fixture.service.createConnection({
      siteId,
      kind: "model",
      provider: fixture.provider.id,
      adapterId: fixture.provider.id,
      adapterContractVersion: fixture.provider.contractVersion,
      adapterFingerprint: fixture.provider.fingerprint,
      name: "Fake model API",
      authKind: "api_key",
      config: {
        accountId: "api-account",
        connectionKind: "model",
        destination: null,
        modelId: "fake-model",
      },
      dataProcessingCeiling: "public-only",
      createdBy: actor.user.id,
    });
    const admit = createAgentAdminAdmissionV1({
      reauthentication: { verify: () => true },
      secretRequestDigestKey: {
        id: "admin-secret-request-v1",
        key: new Uint8Array(32).fill(71),
      },
    });

    async function rotate(
      idempotencyKey: string,
      credential: string,
    ): Promise<NpAgentConnectionOperationProjectionV1> {
      let operation: NpAgentConnectionOperationProjectionV1 | undefined;
      const vaultOperationId = randomUUID();
      await admit({
        siteId,
        actor,
        operationId: "agents.connections.rotate",
        targetId: connection.id,
        command: {
          idempotencyKey,
          expectedVersion: 1,
          configHash: connection.configHash,
          credential,
          vaultOperationId,
        },
        mutate: async ({ db, now, invocationId }) => {
          const admitted = await fixture.service.admitApiKey({
            db,
            admittedAt: now,
            siteId,
            connectionId: connection.id,
            invocationId,
            idempotencyKey,
            expectedConfigVersion: connection.configVersion,
            expectedConfigHash: connection.configHash,
            vaultOperationId,
            apiKey: new TextEncoder().encode(credential),
            createdByUserId: actor.user.id,
          });
          return {
            resourceId: connection.id,
            output: { resourceId: connection.id, state: "pending", version: 1 },
            afterCommit: async () => {
              operation = await admitted.afterCommit();
            },
          };
        },
      });
      if (!operation) throw new Error("API-key operation was not dispatched after commit.");
      expect(operation).toMatchObject({ state: "queued", kind: "activate-secret" });
      return fixture.service.processOperation({ siteId, operationId: operation.id });
    }

    await expect(rotate("connection:api-key:first", "fake-api-key")).resolves.toMatchObject({
      state: "succeeded",
      result: { status: "ready" },
    });
    const ready = await fixture.service.getConnection({
      siteId,
      connectionId: connection.id,
    });
    expect(ready).toMatchObject({
      status: "ready",
      credential: { state: "stored", version: 1 },
      verification: { configVersion: 1, credentialVersion: 1 },
    });
    const [invocation] = await fixture.db
      .select({ requestBody: npAgentInvocations.requestBody })
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.operationId, "agents.connections.rotate"))
      .limit(1);
    expect(JSON.stringify(invocation?.requestBody)).not.toContain("fake-api-key");
    expect(invocation?.requestBody.input).toMatchObject({
      credentialDigest: expect.stringMatching(
        /^cj1:hmac-sha256:admin-secret-request-v1:[A-Za-z0-9_-]{43}$/u,
      ),
    });
    const [firstConnection] = await fixture.db
      .select()
      .from(npAgentConnections)
      .where(eq(npAgentConnections.id, connection.id))
      .limit(1);
    const firstSecretId = firstConnection!.activeSecretVersionId;

    await expect(rotate("connection:api-key:bad", "wrong-api-key")).resolves.toMatchObject({
      state: "failed",
      lastErrorCode: "FAKE_API_KEY_INVALID",
    });
    const [afterFailure] = await fixture.db
      .select()
      .from(npAgentConnections)
      .where(eq(npAgentConnections.id, connection.id))
      .limit(1);
    expect(afterFailure).toMatchObject({
      status: "ready",
      activeSecretVersionId: firstSecretId,
      credentialVersion: 1,
    });
    expect(await fixture.service.getConnection({ siteId, connectionId: connection.id })).toEqual(
      ready,
    );

    await expect(rotate("connection:api-key:rotate", "fake-api-key")).resolves.toMatchObject({
      state: "succeeded",
    });
    const rotated = await fixture.service.getConnection({
      siteId,
      connectionId: connection.id,
    });
    expect(rotated).toMatchObject({
      status: "ready",
      credential: { state: "stored", version: 3 },
      verification: { credentialVersion: 3 },
    });
    const [firstSecret] = await fixture.db
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, firstSecretId!))
      .limit(1);
    expect(firstSecret).toMatchObject({ status: "destroyed", secretRef: null });

    await fixture.service.disableConnection({
      siteId,
      connectionId: connection.id,
      expectedConfigVersion: 1,
    });
    expect(
      await fixture.service.getConnection({ siteId, connectionId: connection.id }),
    ).toMatchObject({ status: "disabled", credential: { state: "stored", version: 3 } });

    let enabled: NpAgentConnectionOperationProjectionV1 | undefined;
    await admit({
      siteId,
      actor,
      operationId: "agents.connections.enable",
      targetId: connection.id,
      command: {
        idempotencyKey: "connection:api-key:enable",
        expectedVersion: 1,
        configHash: connection.configHash,
      },
      mutate: async ({ invocationId }) => ({
        resourceId: connection.id,
        output: { resourceId: connection.id, state: "pending", version: 1 },
        afterCommit: async () => {
          enabled = await fixture.service.enableConnection({
            siteId,
            connectionId: connection.id,
            invocationId,
            idempotencyKey: "connection:api-key:enable",
            expectedConfigVersion: 1,
            expectedConfigHash: connection.configHash,
            createdByUserId: actor.user.id,
          });
        },
      }),
    });
    expect(enabled).toMatchObject({ state: "queued" });
    await expect(
      fixture.service.processOperation({ siteId, operationId: enabled!.id }),
    ).resolves.toMatchObject({ state: "succeeded" });
    expect(
      await fixture.service.getConnection({ siteId, connectionId: connection.id }),
    ).toMatchObject({ status: "ready" });

    await fixture.service.revokeConnection({
      siteId,
      connectionId: connection.id,
      expectedConfigVersion: 1,
    });
    expect(
      await fixture.service.getConnection({ siteId, connectionId: connection.id }),
    ).toMatchObject({ status: "revoked", credential: { state: "absent" } });
    await fixture.dispose();
  });

  it("atomically consumes one OAuth callback, exchanges and refreshes once, then revokes", async () => {
    const { actor, sessionId } = await actorFixture();
    const fixture = await serviceFixture();
    const connection = await fixture.service.createConnection({
      siteId,
      kind: "model",
      provider: fixture.provider.id,
      adapterId: fixture.provider.id,
      adapterContractVersion: fixture.provider.contractVersion,
      adapterFingerprint: fixture.provider.fingerprint,
      name: "Fake model OAuth",
      authKind: "oauth",
      config: {
        accountId: "oauth-account",
        connectionKind: "model",
        destination: null,
        modelId: "fake-model",
      },
      dataProcessingCeiling: "internal-redacted",
      createdBy: actor.user.id,
    });
    const started = await fixture.service.startOAuth({
      siteId,
      connectionId: connection.id,
      staffSessionId: sessionId,
      redirectUri: "https://cms.example/api/admin/agents/oauth/callback",
      requestedPermissions: ["account.read", "model.generate"],
      oauthClientConfigDigest: digest,
      expectedConfigVersion: connection.configVersion,
      expectedConfigHash: connection.configHash,
    });
    const authorizationUrl = new URL(started.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^npps1\.[A-Za-z0-9_-]{43}$/u);

    const queuedExchange = await fixture.service.handleOAuthCallback({
      state: state!,
      staffSessionId: sessionId,
      code: new TextEncoder().encode("fake-authorization-code"),
    });
    expect(queuedExchange).toMatchObject({ state: "queued", kind: "oauth-exchange" });
    const exchanged = await fixture.service.processOperation({
      siteId,
      operationId: queuedExchange.id,
    });
    expect(exchanged).toMatchObject({ state: "succeeded", kind: "oauth-exchange" });
    const ready = await fixture.service.getConnection({
      siteId,
      connectionId: connection.id,
    });
    expect(ready).toMatchObject({
      status: "ready",
      credential: { state: "stored", version: 1 },
    });

    const [authRequest] = await fixture.db
      .select()
      .from(npAgentConnectionAuthRequests)
      .where(eq(npAgentConnectionAuthRequests.id, started.resourceId))
      .limit(1);
    const [exchangeOperation] = await fixture.db
      .select()
      .from(npAgentConnectionOperations)
      .where(eq(npAgentConnectionOperations.id, exchanged.id))
      .limit(1);
    expect(authRequest).toMatchObject({
      status: "consumed",
      codeSecretVersionId: expect.any(String),
      codeVaultOperationId: expect.any(String),
      connectionOperationId: exchanged.id,
    });
    expect(exchangeOperation).toMatchObject({ state: "succeeded", deadlineAt: expect.any(Date) });
    await expect(
      fixture.service.handleOAuthCallback({
        state: state!,
        staffSessionId: sessionId,
        code: new TextEncoder().encode("fake-authorization-code"),
      }),
    ).resolves.toMatchObject({ id: exchanged.id, state: "succeeded" });

    const refreshed = await fixture.service.refreshOAuth({
      siteId,
      connectionId: connection.id,
      runId: randomUUID(),
    });
    expect(refreshed).toMatchObject({ state: "succeeded", kind: "oauth-refresh" });
    expect(
      await fixture.service.getConnection({ siteId, connectionId: connection.id }),
    ).toMatchObject({
      status: "ready",
      credential: { state: "stored", version: 2 },
      verification: { credentialVersion: 2 },
    });

    const beforeDenied = await fixture.service.getConnection({
      siteId,
      connectionId: connection.id,
    });
    const deniedStart = await fixture.service.startOAuth({
      siteId,
      connectionId: connection.id,
      staffSessionId: sessionId,
      redirectUri: "https://cms.example/api/admin/agents/oauth/callback",
      requestedPermissions: ["account.read", "model.generate"],
      oauthClientConfigDigest: digest,
      expectedConfigVersion: connection.configVersion,
      expectedConfigHash: connection.configHash,
      mode: "replace",
    });
    const deniedState = new URL(deniedStart.authorizationUrl).searchParams.get("state")!;
    await expect(
      fixture.service.handleOAuthCallback({
        state: deniedState,
        staffSessionId: randomUUID(),
        error: "access_denied",
      }),
    ).rejects.toMatchObject({ code: "OAUTH_STAFF_SESSION_INVALID" });
    await expect(
      fixture.service.handleOAuthCallback({
        state: deniedState,
        staffSessionId: sessionId,
        error: "access_denied",
      }),
    ).resolves.toEqual({ status: "denied", resourceId: deniedStart.resourceId });
    await expect(
      fixture.service.handleOAuthCallback({
        state: deniedState,
        staffSessionId: sessionId,
        error: "access_denied",
      }),
    ).resolves.toEqual({ status: "denied", resourceId: deniedStart.resourceId });
    const [deniedRequest] = await fixture.db
      .select()
      .from(npAgentConnectionAuthRequests)
      .where(eq(npAgentConnectionAuthRequests.id, deniedStart.resourceId))
      .limit(1);
    const [deniedPkce] = await fixture.db
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, deniedRequest!.pkceSecretVersionId))
      .limit(1);
    const [deniedDestroyJournal] = await fixture.db
      .select()
      .from(npAgentVaultOperations)
      .where(
        and(
          eq(npAgentVaultOperations.secretVersionId, deniedRequest!.pkceSecretVersionId),
          eq(npAgentVaultOperations.kind, "destroy"),
        ),
      )
      .limit(1);
    expect(deniedPkce).toMatchObject({ status: "destroyed", secretRef: null });
    expect(deniedDestroyJournal).toMatchObject({ kind: "destroy", state: "succeeded" });
    expect(await fixture.service.getConnection({ siteId, connectionId: connection.id })).toEqual(
      beforeDenied,
    );

    await fixture.service.revokeConnection({
      siteId,
      connectionId: connection.id,
      expectedConfigVersion: 1,
    });
    const revoked = await fixture.service.getConnection({
      siteId,
      connectionId: connection.id,
    });
    expect(revoked).toMatchObject({ status: "revoked", credential: { state: "absent" } });
    const serialized = JSON.stringify(revoked);
    expect(serialized).not.toContain("fake-access-token");
    expect(serialized).not.toContain("fake-refresh-token");
    expect(serialized).not.toContain("fake-authorization-code");
    expect(serialized).not.toContain("secretRef");
    await fixture.dispose();
  });
});
