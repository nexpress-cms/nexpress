import {
  npDigestAgentStudioConnectionDefinitionV1,
  npSerializeAgentStudioConnectionDefinitionV1,
} from "../../../packages/core/src/agent-contract/studio-contract.js";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import type {
  NpAgentExternalNotificationChannelV1,
  NpAgentNotificationDeliveryResultV1,
} from "../../../packages/core/src/agent-contract/notification-delivery-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentProviderDataClass,
} from "../../../packages/core/src/agent-contract/types.js";
import {
  createAgentAdminAdmissionV1,
  type NpAgentAdminActorV1,
} from "../../../packages/core/src/agent/admin-admission.js";
import {
  createAgentConnectionServiceV1,
  type NpAgentConnectionOperationProjectionV1,
} from "../../../packages/core/src/agent/connection-service.js";
import {
  NpAgentConnectionAuthAdapterRegistryV1,
  type NpAgentConnectionAuthAdapterV1,
  type NpAgentProviderNotificationFacetV1,
} from "../../../packages/core/src/agent/provider-auth-contract.js";
import { createAgentFakeProviderAdapterV1 } from "../../../packages/core/src/agent/provider-fake.js";
import { createLocalEnvelopeVaultAdapterV1 } from "../../../packages/core/src/agent/vault-local-envelope.js";
import { NpAgentVaultAdapterRegistryV1 } from "../../../packages/core/src/agent/vault-runtime.js";
import { createAgentVaultServiceV1 } from "../../../packages/core/src/agent/vault-service.js";
import { npSessions, npUsers } from "../../../packages/core/src/db/schema/system.js";
import { createSite, getSiteById } from "../../../packages/core/src/sites/registry.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import { getTestDb, seedUser } from "./harness.js";

/** Explicit fake transport over the real Connection/vault lifecycle. Never opens a network socket. */
export async function notificationDeliveryFixture(
  options: {
    siteId?: string;
    channels?: NpAgentExternalNotificationChannelV1[];
    idempotency?: "enforced" | "none";
    result?: NpAgentNotificationDeliveryResultV1;
    dataProcessingCeiling?: NpAgentProviderDataClass;
    now?: () => Date;
  } = {},
) {
  const siteId = options.siteId ?? "default";
  const now = options.now ?? (() => new Date());
  const seeded = await seedUser({ role: "admin" });
  const db = await getTestDb();
  if (!(await getSiteById(siteId)))
    await createSite({ id: siteId, name: "Notification delivery fixture" });
  await grantSiteMembership(siteId, seeded.userId, "admin");
  const [user] = await db.select().from(npUsers).where(eq(npUsers.id, seeded.userId)).limit(1);
  const [session] = await db
    .select()
    .from(npSessions)
    .where(eq(npSessions.userId, seeded.userId))
    .limit(1);
  if (!user || !session) throw new Error("Notification fixture actor is unavailable");
  const actor: NpAgentAdminActorV1 = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    sessionId: session.id,
  };
  const vaultRegistry = new NpAgentVaultAdapterRegistryV1();
  vaultRegistry.register(
    createLocalEnvelopeVaultAdapterV1({
      environment: "development",
      explicitlyEnabled: true,
      activeKey: { id: "notification-test-kek", version: "v1", key: new Uint8Array(32).fill(11) },
      resolveDb: () => db,
      now,
    }),
    { active: true },
  );
  const vault = createAgentVaultServiceV1({
    registry: vaultRegistry,
    requestDigestKeyring: {
      active: { id: "notification-vault-request", key: new Uint8Array(32).fill(23) },
    },
    resolveDb: () => db,
    now,
  });
  const channels: NpAgentExternalNotificationChannelV1[] = options.channels ?? [
    "email",
    "siem",
    "slack",
    "webhook",
  ];
  const idempotency = options.idempotency ?? "enforced";
  const send = vi.fn<NpAgentProviderNotificationFacetV1["send"]>((_request, context) =>
    context.credentialLease.use(() =>
      Promise.resolve(
        options.result ?? { state: "confirmed", providerMessageId: "fake-notification-receipt" },
      ),
    ),
  );
  const base = createAgentFakeProviderAdapterV1({ now });
  const fingerprint = `cj1:sha256:${createHash("sha256")
    .update(JSON.stringify({ purpose: "fake-notification.v1", channels, idempotency }))
    .digest("base64url")}`;
  const provider: NpAgentConnectionAuthAdapterV1 = {
    ...base,
    fingerprint,
    parseConfig(input) {
      return { ...base.parseConfig(input), adapterFingerprint: fingerprint };
    },
    notification: { channels, idempotency, send },
  };
  const registry = new NpAgentConnectionAuthAdapterRegistryV1().register(provider);
  const projectionKeyring = {
    accountSubject: {
      owner: "connection-account-subject" as const,
      id: "notification-account-v1",
      bytes: new Uint8Array(32).fill(31),
    },
    destination: {
      owner: "connection-destination" as const,
      id: "notification-destination-v1",
      bytes: new Uint8Array(32).fill(47),
    },
  };
  const connections = createAgentConnectionServiceV1({
    providerRegistry: registry,
    vault,
    projectionKeyring,
    stateHashKeyring: {
      active: { id: "notification-oauth-state", key: new Uint8Array(32).fill(59) },
    },
    resolveDb: () => db,
    now,
  });
  const connectionConfig: NpAgentJsonObject = {
    accountId: "notification-account",
    connectionKind: "notification",
    destination: "operations-alerts",
    modelId: null,
  };
  const connection = await connections.createConnection({
    siteId,
    kind: "notification",
    provider: provider.id,
    adapterId: provider.id,
    adapterContractVersion: provider.contractVersion,
    adapterFingerprint: provider.fingerprint,
    name: "Fake external notification destination",
    authKind: "api_key",
    config: connectionConfig,
    dataProcessingCeiling: options.dataProcessingCeiling ?? "internal-redacted",
    createdBy: actor.user.id,
  });
  const admit = createAgentAdminAdmissionV1({
    reauthentication: { verify: () => true },
    secretRequestDigestKey: { id: "notification-admin-secret", key: new Uint8Array(32).fill(71) },
    now,
  });
  async function rotateCredential() {
    let operation: NpAgentConnectionOperationProjectionV1 | undefined;
    const current = await connections.getConnection({ siteId, connectionId: connection.id });
    const idempotencyKey = randomUUID(),
      vaultOperationId = randomUUID(),
      credential = "fake-api-key";
    await admit({
      siteId,
      actor,
      operationId: "agents.connections.rotate",
      targetId: connection.id,
      command: {
        idempotencyKey,
        expectedVersion: current.configVersion,
        configHash: current.configHash,
        credential,
        vaultOperationId,
      },
      mutate: async ({ db: transaction, now: admittedAt, invocationId }) => {
        const admitted = await connections.admitApiKey({
          db: transaction,
          admittedAt,
          siteId,
          connectionId: connection.id,
          invocationId,
          idempotencyKey,
          expectedConfigVersion: current.configVersion,
          expectedConfigHash: current.configHash,
          vaultOperationId,
          apiKey: new TextEncoder().encode(credential),
          createdByUserId: actor.user.id,
        });
        return {
          resourceId: connection.id,
          output: { resourceId: connection.id, state: "pending", version: current.configVersion },
          afterCommit: async () => {
            operation = await admitted.afterCommit();
          },
        };
      },
    });
    if (!operation) throw new Error("Notification credential activation was not journaled");
    const completed = await connections.processOperation({ siteId, operationId: operation.id });
    if (completed.state !== "succeeded")
      throw new Error("Notification credential activation failed");
    return completed;
  }
  async function updateConfig(
    config: NpAgentJsonObject,
    configOptions: { dataProcessingCeiling?: NpAgentProviderDataClass; process?: boolean } = {},
  ) {
    const current = await connections.getConnection({ siteId, connectionId: connection.id });
    const dataProcessingCeiling =
      configOptions.dataProcessingCeiling ?? current.dataProcessingCeiling;
    const definition = {
      schemaVersion: "np.agent-studio-connection-definition.v1" as const,
      name: current.name,
      kind: current.kind,
      provider: current.provider,
      adapterId: current.adapterId,
      adapterContractVersion: current.adapterContractVersion,
      adapterFingerprint: current.adapterFingerprint,
      authKind: current.authKind,
      config,
      dataProcessingCeiling,
    };
    const command = {
      idempotencyKey: randomUUID(),
      expectedVersion: current.configVersion,
      configHash: current.configHash,
      definitionJson: npSerializeAgentStudioConnectionDefinitionV1(definition),
      definitionHash: await npDigestAgentStudioConnectionDefinitionV1(definition),
    };
    const updates: Awaited<ReturnType<typeof connections.updateConfig>>[] = [];
    await admit({
      siteId,
      actor,
      operationId: "agents.connections.update",
      targetId: connection.id,
      command,
      mutate: ({ invocationId }) =>
        Promise.resolve({
          resourceId: connection.id,
          output: { resourceId: connection.id, state: "pending", version: current.configVersion },
          afterCommit: async () => {
            updates.push(
              await connections.updateConfig({
                siteId,
                connectionId: connection.id,
                invocationId,
                idempotencyKey: command.idempotencyKey,
                expectedConfigVersion: current.configVersion,
                expectedConfigHash: current.configHash,
                config,
                dataProcessingCeiling,
                createdByUserId: actor.user.id,
              }),
            );
          },
        }),
    });
    const updated = updates[0];
    if (!updated) throw new Error("Notification config owner was not invoked after admission");
    return updated.schemaVersion === "np.agent-connection-operation-status.v1" &&
      configOptions.process !== false
      ? connections.processOperation({ siteId, operationId: updated.id })
      : updated;
  }
  await rotateCredential();
  return {
    db,
    registry,
    connections,
    vault,
    provider,
    connectionId: connection.id,
    siteId,
    actor,
    send,
    projectionKeyring,
    connectionConfig,
    rotateCredential,
    updateConfig,
    async dispose() {
      connections.dispose();
      vault.dispose();
      await vaultRegistry.shutdown();
    },
  };
}
