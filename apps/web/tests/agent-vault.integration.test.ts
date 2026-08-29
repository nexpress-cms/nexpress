import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createSite,
  npAgentConnectionConfigVersions,
  npAgentConnections,
  npAgentConnectionSecretVersions,
  npAgentVaultEntries,
  npAgentVaultOperations,
  npDigestAgentVaultAadCanonical,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import {
  NpAgentVaultAdapterRegistryV1,
  NpAgentVaultError,
  createAgentVaultServiceV1,
  createLocalEnvelopeVaultAdapterV1,
  npLocalEnvelopeVaultAdapterFingerprintV1,
  type NpAgentVaultAdapterV1,
  type NpVaultSealResultV1,
} from "../../../packages/core/src/agent/index.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./harness.js";

const siteId = "agent-vault";
const provider = {
  id: "fake-provider",
  contractVersion: 1,
  fingerprint: "sha256:fake-provider-v1",
};

async function seedConnection(site: string) {
  const db = await getTestDb();
  const connectionId = randomUUID();
  const configId = randomUUID();
  await createSite({ id: site, name: `Vault ${site}` });
  await db.transaction(async (tx) => {
    await tx.insert(npAgentConnections).values({
      id: connectionId,
      siteId: site,
      kind: "model",
      provider: provider.id,
      adapterContractVersion: provider.contractVersion,
      name: "Fake model provider",
      authKind: "api_key",
      activeConfigSnapshotId: configId,
      config: {},
      configVersion: 1,
      configHash: "cj1:sha256:fake-config",
      pricingCatalogFingerprint: "cj1:sha256:fake-pricing",
      dataProcessingCeiling: "public-only",
      status: "pending",
    });
    await tx.insert(npAgentConnectionConfigVersions).values({
      id: configId,
      siteId: site,
      connectionId,
      version: 1,
      adapterId: provider.id,
      adapterContractVersion: provider.contractVersion,
      adapterFingerprint: provider.fingerprint,
      config: {},
      configHash: "cj1:sha256:fake-config",
      pricingCatalog: [],
      pricingCatalogFingerprint: "cj1:sha256:fake-pricing",
      dataProcessingCeiling: "public-only",
      state: "active",
      activatedAt: new Date(),
    });
  });
  return connectionId;
}

function requestDigestKeyring() {
  return {
    active: {
      id: "agent-vault-request-v1",
      key: Uint8Array.from({ length: 32 }, (_, index) => index + 11),
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Agent vault runtime", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("seals, leases, rewraps, revokes, and destroys through the local envelope without exposing plaintext", async () => {
    const db = await getTestDb();
    const connectionId = await seedConnection(siteId);
    const key1 = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const key2 = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const adapter = createLocalEnvelopeVaultAdapterV1({
      environment: "development",
      explicitlyEnabled: true,
      activeKey: { id: "development-kek", version: "v1", key: key1 },
      retainedKeys: [{ id: "development-kek", version: "v2", key: key2 }],
      resolveDb: () => db,
    });
    const registry = new NpAgentVaultAdapterRegistryV1();
    registry.register(adapter, { active: true });
    const service = createAgentVaultServiceV1({
      registry,
      requestDigestKeyring: requestDigestKeyring(),
      resolveDb: () => db,
    });
    const operationId = randomUUID();
    const secretVersionId = randomUUID();
    const secretText = "provider-secret-that-must-never-be-projected";

    await expect(
      service.sealSecret({
        operationId,
        secretVersionId,
        siteId,
        connectionId,
        connectionKind: "model",
        purpose: "connection-credential",
        version: 1,
        envelope: {
          schemaVersion: "np.agent-credential-envelope.v1",
          kind: "api_key",
          adapterId: provider.id,
          adapterContractVersion: provider.contractVersion,
          adapterFingerprint: provider.fingerprint,
          secret: new TextEncoder().encode(secretText),
        },
      }),
    ).resolves.toMatchObject({ state: "succeeded", kind: "seal", lastErrorCode: null });

    const [[secret], [entry], [operation]] = await Promise.all([
      db
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(eq(npAgentConnectionSecretVersions.id, secretVersionId))
        .limit(1),
      db
        .select()
        .from(npAgentVaultEntries)
        .where(eq(npAgentVaultEntries.secretVersionId, secretVersionId))
        .limit(1),
      db
        .select()
        .from(npAgentVaultOperations)
        .where(eq(npAgentVaultOperations.id, operationId))
        .limit(1),
    ]);
    expect(secret).toMatchObject({
      status: "pending",
      secretRef: expect.stringMatching(/^local-envelope:/u),
    });
    expect(operation).toMatchObject({ state: "succeeded", secretRef: secret!.secretRef });
    expect(entry).toMatchObject({
      algorithm: "AES-256-GCM",
      kekId: "development-kek",
      kekVersion: "v1",
      aadDigest: secret!.aadDigest,
    });
    expect(Buffer.from(entry!.ciphertext).toString("utf8")).not.toContain(secretText);
    expect(JSON.stringify(service.inspectOperation({ siteId, operationId }))).not.toContain(
      secretText,
    );

    const lease = await service.leaseProviderCredential({
      siteId,
      secretVersionId,
      use: "probe",
    });
    expect(() => JSON.stringify(lease)).toThrowError(
      expect.objectContaining({ code: "VAULT_LEASE_SERIALIZATION_FORBIDDEN" }),
    );
    await expect(
      lease.use(async (credential) => {
        expect(credential.kind).toBe("api_key");
        if (credential.kind !== "api_key") throw new Error("Expected API key");
        return new TextDecoder().decode(credential.secret);
      }),
    ).resolves.toBe(secretText);
    await expect(lease.use(async () => undefined)).rejects.toMatchObject({
      code: "VAULT_LEASE_CONSUMED",
    });

    await expect(
      service.rewrapSecret({
        operationId: randomUUID(),
        siteId,
        secretVersionId,
        targetKeyId: "development-kek",
        targetKeyVersion: "v2",
      }),
    ).resolves.toMatchObject({ state: "succeeded", kind: "rewrap" });
    const [rewrapped] = await db
      .select()
      .from(npAgentVaultEntries)
      .where(eq(npAgentVaultEntries.secretVersionId, secretVersionId))
      .limit(1);
    expect(rewrapped).toMatchObject({ kekId: "development-kek", kekVersion: "v2" });

    await expect(service.revokeSecret({ siteId, secretVersionId })).resolves.toMatchObject({
      status: "revoked",
    });
    await expect(
      service.leaseProviderCredential({ siteId, secretVersionId, use: "probe" }),
    ).rejects.toMatchObject({ code: "VAULT_SECRET_UNAVAILABLE" });
    await expect(
      service.destroySecret({ operationId: randomUUID(), siteId, secretVersionId }),
    ).resolves.toMatchObject({ state: "succeeded", kind: "destroy" });

    const [[destroyedSecret], [destroyedEntry]] = await Promise.all([
      db
        .select()
        .from(npAgentConnectionSecretVersions)
        .where(eq(npAgentConnectionSecretVersions.id, secretVersionId))
        .limit(1),
      db
        .select()
        .from(npAgentVaultEntries)
        .where(eq(npAgentVaultEntries.secretVersionId, secretVersionId))
        .limit(1),
    ]);
    expect(destroyedSecret).toMatchObject({ status: "destroyed", secretRef: null });
    expect(destroyedEntry!.destroyedAt).not.toBeNull();
    expect([...destroyedEntry!.ciphertext]).toEqual([0]);
    service.dispose();
    await registry.shutdown();
  });

  it("recovers an ambiguous external seal only through inspection", async () => {
    const db = await getTestDb();
    const connectionId = await seedConnection("agent-vault-recovery");
    let current = new Date("2026-08-29T00:00:00.000Z");
    const receipts = new Map<string, NpVaultSealResultV1>();
    const fake: NpAgentVaultAdapterV1 = {
      id: "fake-vault",
      contractVersion: 1,
      fingerprint: "sha256:fake-vault-v1",
      kind: "custom:fake-vault",
      algorithm: "custom:fake-vault",
      async seal(input) {
        receipts.set(input.idempotencyKey, {
          schemaVersion: "np.agent-vault-seal-result.v1",
          status: "sealed",
          secretRef: `fake:${input.aad.secretVersionId}`,
          secretVersionId: input.aad.secretVersionId,
          aadDigest: await npDigestAgentVaultAadCanonical(input.aad),
          algorithm: "custom:fake-vault",
          keyId: "fake-kek",
          keyVersion: "v1",
        });
        throw new NpAgentVaultError("VAULT_FAKE_AMBIGUOUS", "Simulated post-effect crash.", true);
      },
      async open() {
        throw new Error("not used");
      },
      async destroy() {
        throw new Error("not used");
      },
      async inspectOperation(input) {
        const receipt = receipts.get(input.idempotencyKey);
        if (!receipt) {
          return {
            schemaVersion: "np.agent-vault-operation-inspect-result.v1",
            kind: input.kind,
            state: "absent",
            sealed: null,
            destroyed: null,
            safeCode: null,
            resultDigest: `cj1:sha256:${"A".repeat(43)}`,
          };
        }
        return {
          schemaVersion: "np.agent-vault-operation-inspect-result.v1",
          kind: "seal",
          state: "succeeded",
          sealed: receipt,
          destroyed: null,
          safeCode: null,
          resultDigest: `cj1:sha256:${"B".repeat(43)}`,
        };
      },
    };
    const registry = new NpAgentVaultAdapterRegistryV1();
    registry.register(fake, { active: true });
    const service = createAgentVaultServiceV1({
      registry,
      requestDigestKeyring: requestDigestKeyring(),
      resolveDb: () => db,
      now: () => current,
    });
    const operationId = randomUUID();
    const secretVersionId = randomUUID();
    const first = await service.sealSecret({
      operationId,
      secretVersionId,
      siteId: "agent-vault-recovery",
      connectionId,
      connectionKind: "model",
      purpose: "connection-credential",
      version: 1,
      envelope: {
        schemaVersion: "np.agent-credential-envelope.v1",
        kind: "api_key",
        adapterId: provider.id,
        adapterContractVersion: provider.contractVersion,
        adapterFingerprint: provider.fingerprint,
        secret: new TextEncoder().encode("ambiguous-secret"),
      },
    });
    expect(first).toMatchObject({ state: "waiting_inspection", attempt: 1 });
    current = new Date(current.getTime() + 5_001);
    await expect(
      service.reconcileOperation({ siteId: "agent-vault-recovery", operationId }),
    ).resolves.toMatchObject({ state: "succeeded", attempt: 2 });
    const [secret] = await db
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, secretVersionId))
      .limit(1);
    expect(secret!.secretRef).toBe(`fake:${secretVersionId}`);
    service.dispose();
  });

  it("never invents or replays plaintext when recovered seal inspection proves absence", async () => {
    const db = await getTestDb();
    const recoverySite = "agent-vault-input-loss";
    const connectionId = await seedConnection(recoverySite);
    let current = new Date("2026-08-29T00:00:00.000Z");
    const fake: NpAgentVaultAdapterV1 = {
      id: "absent-vault",
      contractVersion: 1,
      fingerprint: "sha256:absent-vault-v1",
      kind: "custom:absent-vault",
      algorithm: "custom:absent-vault",
      async seal() {
        throw new NpAgentVaultError("VAULT_FAKE_AMBIGUOUS", "Simulated pre-effect crash.", true);
      },
      async open() {
        throw new Error("not used");
      },
      async destroy() {
        throw new Error("not used");
      },
      async inspectOperation(input) {
        return {
          schemaVersion: "np.agent-vault-operation-inspect-result.v1",
          kind: input.kind,
          state: "absent",
          sealed: null,
          destroyed: null,
          safeCode: null,
          resultDigest: `cj1:sha256:${"C".repeat(43)}`,
        };
      },
    };
    const registry = new NpAgentVaultAdapterRegistryV1();
    registry.register(fake, { active: true });
    const service = createAgentVaultServiceV1({
      registry,
      requestDigestKeyring: requestDigestKeyring(),
      resolveDb: () => db,
      now: () => current,
    });
    const operationId = randomUUID();
    const secretVersionId = randomUUID();
    await expect(
      service.sealSecret({
        operationId,
        secretVersionId,
        siteId: recoverySite,
        connectionId,
        connectionKind: "model",
        purpose: "connection-credential",
        version: 1,
        envelope: {
          schemaVersion: "np.agent-credential-envelope.v1",
          kind: "api_key",
          adapterId: provider.id,
          adapterContractVersion: provider.contractVersion,
          adapterFingerprint: provider.fingerprint,
          secret: new TextEncoder().encode("single-use-input"),
        },
      }),
    ).resolves.toMatchObject({ state: "waiting_inspection" });
    current = new Date(current.getTime() + 5_001);
    await expect(
      service.reconcileOperation({ siteId: recoverySite, operationId }),
    ).resolves.toMatchObject({
      state: "failed",
      lastErrorCode: "VAULT_SEAL_INPUT_LOST",
      attempt: 2,
    });
    const [secret] = await db
      .select()
      .from(npAgentConnectionSecretVersions)
      .where(eq(npAgentConnectionSecretVersions.id, secretVersionId))
      .limit(1);
    expect(secret).toMatchObject({ status: "revoked", secretRef: null });
    service.dispose();
  });

  it("rejects cross-site access and authoritative AAD tampering", async () => {
    const db = await getTestDb();
    const connectionId = await seedConnection("agent-vault-hostile");
    const adapter = createLocalEnvelopeVaultAdapterV1({
      environment: "development",
      explicitlyEnabled: true,
      activeKey: {
        id: "development-kek",
        version: "v1",
        key: Uint8Array.from({ length: 32 }, (_, index) => index + 3),
      },
      resolveDb: () => db,
    });
    const registry = new NpAgentVaultAdapterRegistryV1();
    registry.register(adapter, { active: true });
    const service = createAgentVaultServiceV1({
      registry,
      requestDigestKeyring: requestDigestKeyring(),
      resolveDb: () => db,
    });
    const secretVersionId = randomUUID();
    const operationId = randomUUID();
    await service.sealSecret({
      operationId,
      secretVersionId,
      siteId: "agent-vault-hostile",
      connectionId,
      connectionKind: "model",
      purpose: "connection-credential",
      version: 1,
      envelope: {
        schemaVersion: "np.agent-credential-envelope.v1",
        kind: "api_key",
        adapterId: provider.id,
        adapterContractVersion: 1,
        adapterFingerprint: provider.fingerprint,
        secret: Uint8Array.of(1, 2, 3),
      },
    });
    await db
      .update(npAgentConnectionSecretVersions)
      .set({ aadDigest: `cj1:sha256:${"Z".repeat(43)}` })
      .where(eq(npAgentConnectionSecretVersions.id, secretVersionId));
    await expect(
      service.leaseProviderCredential({
        siteId: "agent-vault-hostile",
        secretVersionId,
        use: "probe",
      }),
    ).rejects.toMatchObject({ code: "VAULT_AAD_MISMATCH" });
    await expect(
      service.inspectOperation({ siteId: "another-site", operationId }),
    ).rejects.toMatchObject({ code: "VAULT_OPERATION_NOT_FOUND" });
    service.dispose();
    await registry.shutdown();
  });

  it("keeps local-envelope structurally fixed and development-only", async () => {
    expect(npLocalEnvelopeVaultAdapterFingerprintV1).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/u);
    expect(() =>
      createLocalEnvelopeVaultAdapterV1({
        environment: "production",
        explicitlyEnabled: true,
        activeKey: { id: "kek", version: "v1", key: new Uint8Array(32) },
      }),
    ).toThrowError(expect.objectContaining({ code: "VAULT_LOCAL_ENVELOPE_FORBIDDEN" }));
    expect(vi.isMockFunction(createLocalEnvelopeVaultAdapterV1)).toBe(false);
  });
});
