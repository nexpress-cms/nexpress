import { randomUUID } from "node:crypto";
import { Client } from "pg";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createSite,
  npAgentConnectionConfigVersions,
  npAgentConnectionOperations,
  npAgentConnections,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/index.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  getTestDatabaseUrl,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function seedPendingConnection(siteId: string, suffix: string) {
  const db = await getTestDb();
  const connectionId = randomUUID();
  const configId = randomUUID();
  const adapterId = `fake-${suffix}`;
  const adapterFingerprint = `cj1:sha256:${suffix.padEnd(43, "A").slice(0, 43)}`;
  const configHash = `cj1:sha256:${suffix.padEnd(43, "B").slice(0, 43)}`;
  const pricingFingerprint = `pc1:sha256:${suffix.padEnd(43, "C").slice(0, 43)}`;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(npAgentConnections).values({
      id: connectionId,
      siteId,
      kind: "model",
      provider: adapterId,
      adapterContractVersion: 1,
      name: `Diagnostic ${suffix}`,
      authKind: "api_key",
      activeConfigSnapshotId: configId,
      config: { model: "fake-model" },
      configVersion: 1,
      configHash,
      pricingCatalogFingerprint: pricingFingerprint,
      dataProcessingCeiling: "public-only",
      status: "pending",
    });
    await tx.insert(npAgentConnectionConfigVersions).values({
      id: configId,
      siteId,
      connectionId,
      version: 1,
      adapterId,
      adapterContractVersion: 1,
      adapterFingerprint,
      config: { model: "fake-model" },
      configHash,
      pricingCatalog: [],
      pricingCatalogFingerprint: pricingFingerprint,
      dataProcessingCeiling: "public-only",
      state: "active",
      activatedAt: now,
    });
  });
  return { connectionId, configId, adapterFingerprint, configHash };
}

describe.skipIf(skipIfNoTestDb())("Agent contract Doctor and Admin Health diagnostics", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("reports the empty disabled-by-default R1 surface as healthy", async () => {
    const summary = await npCollectAgentHealthSummaryV1();
    expect(summary).toEqual({
      schemaVersion: "np.agent-health-summary.v1",
      generatedAt: expect.any(String),
      state: "ok",
      issueCount: 0,
      issues: [],
      states: [],
      readiness: {
        providers: { state: "not-required", requiredCount: 0, availableCount: 0 },
        vault: { state: "not-required", requiredCount: 0, availableCount: 0 },
      },
    });
  });

  it.each([
    "ALTER TABLE public.np_audit_events DISABLE TRIGGER np_agent_reference_row_v1",
    "DELETE FROM public.np_agent_reference_fence",
    "DROP INDEX public.np_agent_source_releases_key_unique",
  ])("fails Doctor readiness for lifecycle guard tampering: %s", async (mutation) => {
    const databaseUrl = getTestDatabaseUrl();
    if (!databaseUrl) throw new Error("Missing integration database URL.");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(mutation);
      const summary = await npCollectAgentHealthSummaryV1({ client });
      expect(summary.state).toBe("error");
      expect(summary.issues).toContainEqual({
        code: "AGENT_SCHEMA_CONSTRAINT_MISSING",
        count: 1,
        oldestAgeSeconds: null,
      });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
    expect((await npCollectAgentHealthSummaryV1()).state).toBe("ok");
  });

  it("returns cross-site aggregate counts without frozen identities or config evidence", async () => {
    await createSite({ id: "agent-diagnostics-a", name: "Agent diagnostics A" });
    await createSite({ id: "agent-diagnostics-b", name: "Agent diagnostics B" });
    const first = await seedPendingConnection("agent-diagnostics-a", "alpha");
    const second = await seedPendingConnection("agent-diagnostics-b", "beta");

    const summary = await npCollectAgentHealthSummaryV1();
    expect(summary).toMatchObject({
      state: "warn",
      issueCount: 0,
      readiness: {
        providers: { state: "unknown", requiredCount: 2, availableCount: 0 },
      },
    });
    expect(summary.states).toEqual(
      expect.arrayContaining([
        { entity: "connection", state: "pending", count: 2, oldestAgeSeconds: expect.any(Number) },
        {
          entity: "connection-config",
          state: "active",
          count: 2,
          oldestAgeSeconds: expect.any(Number),
        },
      ]),
    );
    const encoded = JSON.stringify(summary);
    for (const excluded of [
      "agent-diagnostics-a",
      "agent-diagnostics-b",
      first.connectionId,
      second.connectionId,
      first.configId,
      second.configId,
      first.adapterFingerprint,
      second.adapterFingerprint,
      first.configHash,
      second.configHash,
    ]) {
      expect(encoded).not.toContain(excluded);
    }
  });

  it("fails closed on one expired connection-operation deadline using only a stable code", async () => {
    await createSite({ id: "agent-diagnostics-stale", name: "Agent diagnostics stale" });
    const connection = await seedPendingConnection("agent-diagnostics-stale", "stale");
    const operationId = randomUUID();
    const runId = randomUUID();
    const createdAt = new Date(Date.now() - 120_000);
    await (await getTestDb()).insert(npAgentConnectionOperations).values({
      id: operationId,
      siteId: "agent-diagnostics-stale",
      connectionId: connection.connectionId,
      source: "runtime-refresh",
      runId,
      kind: "probe",
      state: "queued",
      expectedConfigVersion: 1,
      expectedConfigHash: connection.configHash,
      configSnapshotId: connection.configId,
      adapterContractVersion: 1,
      adapterFingerprint: connection.adapterFingerprint,
      inputSecretVersionIds: [],
      idempotencyKey: "diagnostic:stale:probe",
      requestHash: `cj1:sha256:${"D".repeat(43)}`,
      deadlineAt: new Date(createdAt.getTime() + 60_000),
      createdAt,
    });

    const summary = await npCollectAgentHealthSummaryV1();
    expect(summary).toMatchObject({
      state: "error",
      issues: [
        {
          code: "AGENT_STALE_CONNECTION_OPERATION",
          count: 1,
          oldestAgeSeconds: expect.any(Number),
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain(operationId);
    expect(JSON.stringify(summary)).not.toContain(runId);
  });

  it("feeds the same aggregate collector into the single Doctor check", async () => {
    const databaseUrl = getTestDatabaseUrl();
    if (!databaseUrl) throw new Error("Missing integration database URL.");
    const { collectDoctorChecks } = await import("@nexpress/app/scripts/doctor-core");
    const checks = await collectDoctorChecks({
      env: { DATABASE_URL: databaseUrl },
      nodeVersion: "24.11.1",
    });
    expect(checks.filter((check) => check.id === "agents.contract")).toEqual([
      expect.objectContaining({
        state: "ok",
        detail: expect.stringContaining("Providers: not-required · required 0 · available 0"),
      }),
    ]);
    const detail = checks.find((check) => check.id === "agents.contract")?.detail;
    expect(detail).toContain("Vault: not-required · required 0 · available 0");
    expect(detail).toContain(
      "No state counts returned. This does not establish runtime availability.",
    );
    expect(detail).toContain("Worker heartbeat and queue consumer liveness are not measured");
  });
});
