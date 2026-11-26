import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentGuardianSecurityObservationServiceV1 } from "../../../packages/core/src/agent/guardian-security-observation.js";
import {
  setGuardianSensitiveObserverV1,
  resetGuardianSensitiveObserverV1,
} from "../../../packages/core/src/agent/guardian-sensitive-observer.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import { replaceStaffPasswordAndInvalidateSessions } from "../../../packages/core/src/auth/session.js";
import {
  createPasswordResetToken,
  consumePasswordResetToken,
} from "../../../packages/core/src/auth/reset-token.js";
import {
  requestMemberPasswordReset,
  consumeMemberPasswordReset,
} from "../../../packages/core/src/auth/member-credentials.js";
import { hashPassword } from "../../../packages/core/src/auth/password.js";
import {
  updatePluginState,
  syncPluginRegistrations,
} from "../../../packages/core/src/plugins/persistence.js";
import { setPluginConfig } from "../../../packages/core/src/plugins/config.js";
import { loadPlugins, resetPlugins } from "../../../packages/core/src/plugins/host.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import {
  npAgentEvents,
  npAgentSignals,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npAuditEvents,
  npMembers,
  npMemberSessions,
} from "../../../packages/core/src/db/schema/community.js";
import {
  npUsers,
  npSessions,
  npSettings,
  npSitePlugins,
} from "../../../packages/core/src/db/schema/system.js";
import { createAgentGatewayServiceV1 } from "../../../packages/core/src/agent/gateway-service.js";
import { createAgentConnectionServiceV1 } from "../../../packages/core/src/agent/connection-service.js";
import { createAgentConnectionAdminServiceV1 } from "../../../packages/core/src/agent/connection-admin-service.js";
import { NpAgentConnectionAuthAdapterRegistryV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import { createAgentFakeProviderAdapterV1 } from "../../../packages/core/src/agent/provider-fake.js";
import { NpAgentVaultAdapterRegistryV1 } from "../../../packages/core/src/agent/vault-runtime.js";
import { createAgentVaultServiceV1 } from "../../../packages/core/src/agent/vault-service.js";
import { createLocalEnvelopeVaultAdapterV1 } from "../../../packages/core/src/agent/vault-local-envelope.js";
import {
  npAgentPrincipals,
  npAgentServiceTokens,
  npAgentConnectionOperations,
  npAgentConnectionSecretVersions,
  npAgentConnections,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  npDigestAgentStudioConnectionDefinitionV1,
  npSerializeAgentStudioConnectionDefinitionV1,
} from "../../../packages/core/src/agent-contract/index.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedActiveMember,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
async function setup() {
  const f = await fixture(),
    state = { failRecord: false, installed: true },
    now = () => new Date(Date.now() + 5000),
    bytes = new Uint8Array(32).fill(119);
  const never = () =>
    Promise.reject(new Error("Sensitive source must not activate Runtime or a provider"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "sensitive-source-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const options = {
    actorKey: { id: "sensitive-source-1", bytes },
    isInstalledSite: async (id: string) =>
      state.installed && (id === siteId || id === "draft-other"),
    authorize: async () => {},
    events: {
      record: async (input: Parameters<typeof events.record>[0]) => {
        const result = await events.record(input);
        if (state.failRecord) throw new Error("Injected source receipt rollback");
        return result;
      },
    },
    now,
  };
  const source = createAgentGuardianSecurityObservationServiceV1(options);
  setGuardianSensitiveObserverV1(source.sensitiveObserver);
  const password = async () => {
    const [row] = await f.db.select().from(npUsers).where(eq(npUsers.id, f.actor.actor.user.id));
    return row;
  };
  return { ...f, state, source, options, password };
}
const gatewaySettings = {
  schemaVersion: "np.agent-gateway-settings.v1" as const,
  stdio: "propose" as const,
  mcpHttp: "disabled" as const,
  agentHttp: "disabled" as const,
};
function gateway() {
  return createAgentGatewayServiceV1({
    tokenHashKeyring: {
      active: { id: "sensitive-gateway-token", key: new Uint8Array(32).fill(45) },
    },
    deploymentGatewaySettings: gatewaySettings,
    resolveSiteGatewaySettings: () => gatewaySettings,
    reauthentication: { verify: () => true },
  });
}
async function gatewayPrincipal(f: Awaited<ReturnType<typeof setup>>, service = gateway()) {
  const result = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.gateway.principals.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      name: "Synthetic source principal",
      description: null,
      scopes: ["site:read"],
    },
  });
  return { service, id: result.resourceId };
}
async function connectionFixture(f: Awaited<ReturnType<typeof setup>>) {
  const registry = new NpAgentVaultAdapterRegistryV1();
  registry.register(
    createLocalEnvelopeVaultAdapterV1({
      environment: "development",
      explicitlyEnabled: true,
      activeKey: { id: "synthetic-sensitive-kek", version: "v1", key: new Uint8Array(32).fill(55) },
      resolveDb: () => f.db,
    }),
    { active: true },
  );
  const vault = createAgentVaultServiceV1({
    registry,
    requestDigestKeyring: {
      active: { id: "synthetic-sensitive-vault", key: new Uint8Array(32).fill(56) },
    },
    resolveDb: () => f.db,
  });
  const provider = createAgentFakeProviderAdapterV1();
  const service = createAgentConnectionServiceV1({
    vault,
    providerRegistry: new NpAgentConnectionAuthAdapterRegistryV1().register(provider),
    resolveDb: () => f.db,
    projectionKeyring: {
      accountSubject: {
        owner: "connection-account-subject",
        id: "synthetic-account",
        bytes: new Uint8Array(32).fill(57),
      },
      destination: {
        owner: "connection-destination",
        id: "synthetic-destination",
        bytes: new Uint8Array(32).fill(58),
      },
    },
    stateHashKeyring: { active: { id: "synthetic-state", key: new Uint8Array(32).fill(59) } },
    resolveOAuthClientConfigDigest: () => `cj1:sha256:${"A".repeat(43)}`,
  });
  const admin = createAgentConnectionAdminServiceV1({
    connections: service,
    reauthentication: { verify: () => true },
    secretRequestDigestKey: { id: "synthetic-admission", key: new Uint8Array(32).fill(60) },
  });
  const definition = {
    schemaVersion: "np.agent-studio-connection-definition.v1" as const,
    name: "Synthetic source connection",
    kind: "model" as const,
    provider: provider.id,
    adapterId: provider.id,
    adapterContractVersion: provider.contractVersion,
    adapterFingerprint: provider.fingerprint,
    authKind: "api_key" as const,
    config: {
      accountId: "source-account",
      connectionKind: "model",
      destination: null,
      modelId: "fake-model",
    },
    dataProcessingCeiling: "public-only" as const,
  };
  const created = await admin.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.connections.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      credential: "fake-api-key",
      definitionJson: npSerializeAgentStudioConnectionDefinitionV1(definition),
      definitionHash: await npDigestAgentStudioConnectionDefinitionV1(definition),
      vaultOperationId: randomUUID(),
    },
  });
  const [operation] = await f.db
    .select()
    .from(npAgentConnectionOperations)
    .where(eq(npAgentConnectionOperations.connectionId, created.resourceId));
  return {
    service,
    admin,
    created,
    operation,
    dispose: async () => {
      service.dispose();
      vault.dispose();
      await registry.shutdown();
    },
  };
}
describe.skipIf(skipIfNoTestDb())("committed credential and plugin Guardian sources", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    resetGuardianSensitiveObserverV1();
    resetPlugins();
    await truncateAll();
    registerTestCollections();
  });
  afterEach(() => {
    resetGuardianSensitiveObserverV1();
    resetPlugins();
  });
  afterAll(closeTestDb);
  it("records actual staff password replacement for every installed site with complete deployment impact and exact replay", async () => {
    const f = await setup(),
      before = await f.password(),
      newHash = await hashPassword("Sensitive-owner-new-password");
    expect(
      await replaceStaffPasswordAndInvalidateSessions(before.id, before.password, newHash, f.db),
    ).toBe(true);
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: "security.credential.changed",
        sourceComponent: "guardian.credential.v1",
        subject: null,
        actor: { kind: "system", component: "auth.password-change" },
        dispatchedAt: row.recordedAt,
        payload: {
          impact: { scope: "deployment", affectedSiteCount: 3 },
          transition: {
            kind: "password-replaced",
            audience: "staff",
            previous: { tokenVersion: before.tokenVersion },
            current: { tokenVersion: before.tokenVersion + 1 },
          },
        },
      });
      await expect(
        f.source.verifyEvent({ db: f.db, siteId: row.siteId, eventId: row.id }),
      ).resolves.toMatchObject({ detectorId: "guardian.credential-changed" });
    }
    const event = await npReadAgentEventRowEvidenceV1(rows[0]);
    if (event.payload.kind !== "security.credential.changed")
      throw new Error("Expected credential fact");
    const transition = event.payload.transition,
      transitionId = event.payload.transitionId;
    await f.db.transaction(async (db) => {
      const scope = { kind: "deployment" } as const;
      await f.source.sensitiveObserver.prepare({ db, scope });
      await f.source.sensitiveObserver.recordCredential({
        db,
        scope,
        actor: { kind: "system", component: "auth.password-change" },
        transitionId,
        occurredAt: new Date(event.occurredAt),
        transition,
      });
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(2);
    expect(await f.db.select().from(npSessions).where(eq(npSessions.userId, before.id))).toEqual(
      [],
    );
    expect(JSON.stringify(rows)).not.toContain(newHash);
    expect(await f.db.select().from(npAgentRuns)).toEqual([]);
  });
  it("rolls password, token version, sessions and all source effects back together on receipt failure", async () => {
    const f = await setup(),
      before = await f.password(),
      sessions = await f.db.select().from(npSessions);
    f.state.failRecord = true;
    await expect(
      replaceStaffPasswordAndInvalidateSessions(
        before.id,
        before.password,
        await hashPassword("Sensitive-owner-rollback"),
        f.db,
      ),
    ).rejects.toThrow();
    expect(await f.password()).toEqual(before);
    expect(await f.db.select().from(npSessions)).toEqual(sessions);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
  });
  it("preserves absent/disabled source behavior and emits no fact for a failed password CAS", async () => {
    const f = await setup(),
      before = await f.password();
    resetGuardianSensitiveObserverV1();
    expect(
      await replaceStaffPasswordAndInvalidateSessions(
        before.id,
        before.password,
        await hashPassword("Sensitive-owner-absent"),
        f.db,
      ),
    ).toBe(true);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    setGuardianSensitiveObserverV1(f.source.sensitiveObserver);
    f.state.installed = false;
    const current = await f.password();
    expect(
      await replaceStaffPasswordAndInvalidateSessions(
        current.id,
        current.password,
        await hashPassword("Sensitive-owner-disabled"),
        f.db,
      ),
    ).toBe(true);
    expect(
      await replaceStaffPasswordAndInvalidateSessions(
        current.id,
        "wrong-private-hash",
        "unused",
        f.db,
      ),
    ).toBe(false);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });
  it("captures invite/reset single-use consumption without attributing the bearer to an authenticated staff actor", async () => {
    const f = await setup(),
      before = await f.password(),
      token = await createPasswordResetToken(f.db, {
        userId: before.id,
        purpose: "invite",
        ttlMs: 60000,
      });
    await consumePasswordResetToken(f.db, {
      token: token.token,
      newPassword: "Sensitive-invite-password",
    });
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actor: { kind: "system", component: "auth.password-reset" },
      payload: { transition: { purpose: "invite-accept" } },
    });
    await expect(
      consumePasswordResetToken(f.db, {
        token: token.token,
        newPassword: "Sensitive-invite-password",
      }),
    ).rejects.toThrow();
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(token.token);
  });
  it("records member reset verification/activation honestly and preserves suspended status", async () => {
    const f = await setup(),
      member = await seedActiveMember();
    await f.db
      .update(npMembers)
      .set({ emailVerified: false, status: "suspended" })
      .where(eq(npMembers.id, member.memberId));
    const [before] = await f.db.select().from(npMembers).where(eq(npMembers.id, member.memberId));
    const token = await requestMemberPasswordReset(f.db, before.email, 60000);
    if (!token.issued) throw new Error("Expected reset token");
    await consumeMemberPasswordReset(f.db, token.issued.token, "Sensitive-member-reset-password");
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      payload: {
        transition: {
          kind: "password-replaced",
          audience: "member",
          memberResetActivation: {
            previous: { emailVerified: false, status: "suspended" },
            current: { emailVerified: true, status: "suspended" },
          },
        },
      },
    });
    expect(
      await f.db.select().from(npMemberSessions).where(eq(npMemberSessions.memberId, before.id)),
    ).toEqual([]);
  });
  it("records actual plugin activation/config commits with no raw config, and no duplicate observations for no-op writes", async () => {
    const f = await setup(),
      pluginId = "guardian-sensitive-fixture";
    await loadPlugins([
      {
        manifest: {
          id: pluginId,
          name: "Synthetic source fixture",
          version: "1.0.0",
          capabilities: ["admin:panel"],
        },
        admin: { settings: { fields: [{ type: "text", name: "apiKey", label: "Key" }] } },
      },
    ]);
    await syncPluginRegistrations(f.db, [pluginId]);
    await updatePluginState(f.db, pluginId, { enabled: false }, siteId);
    await withCurrentSite(siteId, () =>
      setPluginConfig(
        pluginId,
        { apiKey: "private-config-key-marker", enabled: true },
        f.actor.actor.user.id,
      ),
    );
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "security.plugin.changed")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("private-config-key-marker");
    expect(rows[0]).toMatchObject({
      subject: null,
      payload: { impact: { scope: "site", affectedSiteCount: 1 } },
    });
    for (const row of rows)
      await expect(
        f.source.verifyEvent({ db: f.db, siteId, eventId: row.id }),
      ).resolves.toMatchObject({ detectorId: "guardian.plugin-changed" });
    await updatePluginState(f.db, pluginId, { enabled: false }, siteId);
    await withCurrentSite(siteId, () =>
      setPluginConfig(
        pluginId,
        { enabled: true, apiKey: "private-config-key-marker" },
        f.actor.actor.user.id,
      ),
    );
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
  });
  it("rolls plugin state/config writes back when the actual signed source cannot complete", async () => {
    const f = await setup(),
      pluginId = "guardian-sensitive-rollback";
    await loadPlugins([
      {
        manifest: {
          id: pluginId,
          name: "Synthetic rollback fixture",
          version: "1.0.0",
          capabilities: ["admin:panel"],
        },
        admin: { settings: { fields: [{ type: "text", name: "key", label: "Key" }] } },
      },
    ]);
    await syncPluginRegistrations(f.db, [pluginId]);
    f.state.failRecord = true;
    await expect(updatePluginState(f.db, pluginId, { enabled: false }, siteId)).rejects.toThrow();
    expect(
      await f.db.select().from(npSitePlugins).where(eq(npSitePlugins.pluginId, pluginId)),
    ).toEqual([]);
    await expect(
      withCurrentSite(siteId, () =>
        setPluginConfig(pluginId, { key: "private-rollback-marker" }, f.actor.actor.user.id),
      ),
    ).rejects.toThrow();
    expect(
      await f.db
        .select()
        .from(npSettings)
        .where(eq(npSettings.key, `plugin.config:${pluginId}`)),
    ).toEqual([]);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_security.source")),
    ).toEqual([]);
  });
  it("records actual Gateway token issuance, rotation, revocation and principal lifecycle with exact replay", async () => {
    const f = await setup(),
      { service, id } = await gatewayPrincipal(f);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    const command = {
      idempotencyKey: randomUUID(),
      expectedVersion: 1,
      name: "Synthetic token",
      scopes: ["site:read"],
      transport: "stdio",
      exposure: "read",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const token = await service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principal_tokens.create",
      targetId: id,
      command,
    });
    await expect(
      service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.gateway.principal_tokens.create",
        targetId: id,
        command,
      }),
    ).rejects.toMatchObject({ code: "ONE_TIME_VALUE_ALREADY_ISSUED" });
    const rotated = await service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principal_tokens.rotate",
      parentTargetId: id,
      targetId: token.resourceId,
      command: { idempotencyKey: randomUUID(), expectedVersion: 1, overlapSeconds: 300 },
    });
    await service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principal_tokens.revoke",
      parentTargetId: id,
      targetId: rotated.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        reason: "Synthetic source fixture",
      },
    });
    const suspend = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principals.suspend" as const,
      targetId: id,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 2,
        reason: "Synthetic source fixture",
      },
    };
    await service.executeAdmin(suspend);
    await expect(service.executeAdmin(suspend)).resolves.toMatchObject({ replayed: true });
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(5);
    expect(JSON.stringify(rows)).not.toContain(token.oneTimeValue!);
    expect(
      rows.every((row) => row.subject === null && row.sourceComponent === "guardian.credential.v1"),
    ).toBe(true);
    for (const row of rows)
      await expect(
        f.source.verifyEvent({ db: f.db, siteId, eventId: row.id }),
      ).resolves.toMatchObject({ detectorId: "guardian.credential-changed" });
    const [principal] = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.id, id));
    expect(principal).toMatchObject({ status: "suspended", rowVersion: 3, tokenVersion: 1 });
  });
  it("rolls actual Gateway credential writes and admission receipts back when the source fails; absence preserves issuance", async () => {
    const f = await setup(),
      { service, id } = await gatewayPrincipal(f);
    const input = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principal_tokens.create" as const,
      targetId: id,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        name: "Rollback token",
        scopes: ["site:read"],
        transport: "stdio",
        exposure: "read",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    };
    f.state.failRecord = true;
    await expect(service.executeAdmin(input)).rejects.toThrow();
    expect(await f.db.select().from(npAgentServiceTokens)).toEqual([]);
    const [principal] = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.id, id));
    expect(principal.rowVersion).toBe(1);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    resetGuardianSensitiveObserverV1();
    await expect(service.executeAdmin(input)).resolves.toMatchObject({ replayed: false });
    expect(await f.db.select().from(npAgentServiceTokens)).toHaveLength(1);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
  });
  it("records principal scope and global authority-loss facts from committed rows without raw scope catalogs", async () => {
    const f = await setup(),
      { service, id } = await gatewayPrincipal(f);
    const other = await service.executeAdmin({
      siteId: "draft-other",
      actor: f.actor.actor,
      operationId: "agents.gateway.principals.create",
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        name: "Other-site principal",
        description: null,
        scopes: ["site:read"],
      },
    });
    await service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.gateway.principals.update",
      targetId: id,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        name: "Scope changed",
        description: null,
        scopes: ["content:read", "site:read"],
      },
    });
    await service.containUserAuthorityLoss(f.actor.actor.user.id);
    const rows = await f.db.select().from(npAgentEvents);
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain('"content:read"');
    for (const row of rows) {
      expect(row.payload).toMatchObject({
        impact: { scope: "site", affectedSiteCount: 1 },
        transition: { kind: "gateway-principal" },
      });
      await expect(
        f.source.verifyEvent({ db: f.db, siteId: row.siteId, eventId: row.id }),
      ).resolves.toMatchObject({ detectorId: "guardian.credential-changed" });
    }
    expect(rows.filter((row) => row.siteId === "draft-other")).toHaveLength(1);
    const [otherPrincipal] = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.id, other.resourceId));
    expect(otherPrincipal).toMatchObject({
      authorityUserId: null,
      status: "suspended",
      tokenVersion: 2,
    });
    const [principal] = await f.db
      .select()
      .from(npAgentPrincipals)
      .where(eq(npAgentPrincipals.id, id));
    expect(principal).toMatchObject({
      authorityUserId: null,
      rowVersion: 3,
      tokenVersion: 3,
      status: "suspended",
    });
  });
  it("records Connection credential activation only at successful final commit and revocation at the Admin owner", async () => {
    const f = await setup(),
      c = await connectionFixture(f);
    try {
      expect(await f.db.select().from(npAgentEvents)).toEqual([]);
      await expect(
        c.service.processOperation({ siteId, operationId: c.operation.id }),
      ).resolves.toMatchObject({ state: "succeeded" });
      await c.service.processOperation({ siteId, operationId: c.operation.id });
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
      const revoke = {
        siteId,
        actor: f.actor.actor,
        operationId: "agents.connections.revoke" as const,
        targetId: c.created.resourceId,
        command: {
          idempotencyKey: randomUUID(),
          expectedVersion: 1,
          reason: "Synthetic source fixture",
        },
      };
      await c.admin.executeAdmin(revoke);
      await expect(c.admin.executeAdmin(revoke)).resolves.toMatchObject({ replayed: true });
      const rows = await f.db.select().from(npAgentEvents);
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain("fake-api-key");
      expect(JSON.stringify(rows)).not.toContain("activeSecretVersionId");
      for (const row of rows)
        await expect(
          f.source.verifyEvent({ db: f.db, siteId, eventId: row.id }),
        ).resolves.toMatchObject({ detectorId: "guardian.credential-changed" });
      const [connection] = await f.db
        .select()
        .from(npAgentConnections)
        .where(eq(npAgentConnections.id, c.created.resourceId));
      expect(connection).toMatchObject({
        status: "revoked",
        credentialVersion: null,
        activeSecretVersionId: null,
      });
    } finally {
      await c.dispose();
    }
  });
  it("leaves the active credential unset when the signed source fails in the final activation transaction", async () => {
    const f = await setup(),
      c = await connectionFixture(f);
    try {
      f.state.failRecord = true;
      await expect(
        c.service.processOperation({ siteId, operationId: c.operation.id }),
      ).resolves.toMatchObject({ state: "failed" });
      const [connection] = await f.db
        .select()
        .from(npAgentConnections)
        .where(eq(npAgentConnections.id, c.created.resourceId));
      expect(connection).toMatchObject({ activeSecretVersionId: null, credentialVersion: null });
      expect(await f.db.select().from(npAgentEvents)).toEqual([]);
      expect(
        await f.db
          .select()
          .from(npAuditEvents)
          .where(eq(npAuditEvents.action, "agent.guardian_security.source")),
      ).toEqual([]);
    } finally {
      await c.dispose();
    }
  });
  it("rolls Connection revoke source failures back before destructive post-commit cleanup", async () => {
    const f = await setup(),
      c = await connectionFixture(f);
    try {
      await c.service.processOperation({ siteId, operationId: c.operation.id });
      const [before] = await f.db
        .select()
        .from(npAgentConnections)
        .where(eq(npAgentConnections.id, c.created.resourceId));
      f.state.failRecord = true;
      await expect(
        c.admin.executeAdmin({
          siteId,
          actor: f.actor.actor,
          operationId: "agents.connections.revoke",
          targetId: c.created.resourceId,
          command: {
            idempotencyKey: randomUUID(),
            expectedVersion: 1,
            reason: "Synthetic source fixture",
          },
        }),
      ).rejects.toThrow();
      const [after] = await f.db
        .select()
        .from(npAgentConnections)
        .where(eq(npAgentConnections.id, c.created.resourceId));
      expect(after).toEqual(before);
      const [secret] = await f.db
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(eq(npAgentConnectionSecretVersions.id, before.activeSecretVersionId!));
      expect(secret).toMatchObject({ status: "active" });
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    } finally {
      await c.dispose();
    }
  });
  it("rejects tampered or missing-key historical source receipts without reading current account roles", async () => {
    const f = await setup(),
      before = await f.password();
    await replaceStaffPasswordAndInvalidateSessions(
      before.id,
      before.password,
      await hashPassword("Sensitive-proof-password"),
      f.db,
    );
    const [row] = await f.db.select().from(npAgentEvents),
      rotated = createAgentGuardianSecurityObservationServiceV1({
        ...f.options,
        actorKey: { id: "sensitive-source-2", bytes: new Uint8Array(32).fill(120) },
      });
    await expect(
      rotated.verifyEvent({ db: f.db, siteId: row.siteId, eventId: row.id }),
    ).rejects.toThrow();
    const retained = createAgentGuardianSecurityObservationServiceV1({
      ...f.options,
      actorKey: { id: "sensitive-source-2", bytes: new Uint8Array(32).fill(120) },
      resolveActorKey: (id) => (id === "sensitive-source-1" ? f.options.actorKey.bytes : null),
    });
    await expect(
      retained.verifyEvent({ db: f.db, siteId: row.siteId, eventId: row.id }),
    ).resolves.toMatchObject({ eventId: row.id });
    const [receipt] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetId, row.id));
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...receipt.payload, sourceMac: `hmac-sha256:${"A".repeat(43)}` } })
      .where(eq(npAuditEvents.id, receipt.id));
    await expect(
      retained.verifyEvent({ db: f.db, siteId: row.siteId, eventId: row.id }),
    ).rejects.toThrow();
  });
});
