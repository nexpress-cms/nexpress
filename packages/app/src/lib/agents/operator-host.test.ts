import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCollection } from "@nexpress/core/collections";
import { createAgentCoreReadCapabilityExecutorsV1 } from "@nexpress/core/agents";
import type { NpAgentOperatorHostContextV1 } from "@nexpress/core/agents";
import { getDb } from "../db";
const mocks = vi.hoisted(() => ({ storage: vi.fn(), cache: vi.fn(), plugins: vi.fn() }));
vi.mock("../system-health", () => ({
  checkStorageAdapter: mocks.storage,
  checkCacheInvalidation: mocks.cache,
  checkCollectionRuntime: () => ({ state: "ok" }),
  checkObservabilityAdapters: () => ({ state: "ok" }),
  checkSiteUrl: () => ({ state: "ok" }),
}));
vi.mock("../ops-plugins-runtime", () => ({ collectRuntimeOpsPluginsStatus: mocks.plugins }));
vi.mock("../db", () => ({ getDb: () => ({}) }));
import { npCreateAgentOperatorAppHostV1 } from "./operator-host";
const uuid = "01900000-0000-7000-8000-000000000010";
const context: NpAgentOperatorHostContextV1 = {
  db: getDb(),
  siteId: "default",
  principal: {
    kind: "service",
    principalId: uuid,
    siteId: "default",
    authority: { kind: "user", userId: uuid },
    credentialId: uuid,
    gatewayExposureCeiling: "read",
    scopes: ["ops:read", "ops:plan", "audit:run"],
  },
  requestedAt: "2026-09-29T00:00:00.000Z",
  invocationId: uuid,
  idempotencyKey: null,
  abortSignal: new AbortController().signal,
};
const directories: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("Operator host owner boundary", () => {
  it("does not inspect deployment state without explicit current permission", async () => {
    const authorize = vi.fn().mockResolvedValue(undefined);
    const host = npCreateAgentOperatorAppHostV1({ authorize });
    const result = await host.status({ families: ["storage", "jobs", "agents"] }, context);
    expect(result.report.status).toBe("attention");
    expect(
      result.report.checks.every((check) => check.detail === "Scoped evidence is unavailable."),
    ).toBe(true);
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("projects real authorized owner state without raw paths, errors or commands", async () => {
    mocks.storage.mockResolvedValue({
      state: "error",
      detail: "/private/credential",
      hint: "execute secret-command",
    });
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(true),
    });
    const result = await host.status({ families: ["storage"] }, context);
    expect(result.report.status).toBe("blocked");
    expect(result.report.nextCommand).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/credential|secret-command/);
    expect(result.digest).toMatch(/^cj1:sha256:[A-Za-z0-9_-]{43}$/);
  });
  it("requires a real selected audit owner and bounded retained evidence", async () => {
    const reader = vi.fn().mockResolvedValue({
      state: "warn",
      evidenceRefs: ["retained-evidence-1", "retained-evidence-2"],
    });
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      auditReaders: { jobs: reader },
    });
    await expect(
      host.audit!({
        ...context,
        auditId: uuid,
        input: { families: ["security"], collections: [], maxTargets: 2 },
      }),
    ).rejects.toThrow("unavailable");
    expect(reader).not.toHaveBeenCalled();
    await expect(
      host.audit!({
        ...context,
        auditId: uuid,
        input: { families: ["jobs"], collections: ["posts"], maxTargets: 1 },
      }),
    ).rejects.toThrow("unavailable");
    const result = await host.audit!({
      ...context,
      auditId: uuid,
      input: { families: ["jobs"], collections: ["posts"], maxTargets: 2 },
    });
    expect(result.checks[0]?.evidenceRefs).toEqual(["retained-evidence-1", "retained-evidence-2"]);
    expect(reader.mock.calls[0]?.[0].input.collections).toEqual(["posts"]);
  });
  it("audits actual collection schema fingerprints with existing schema visibility and target bounds", async () => {
    registerCollection(
      "operator-contracts",
      {},
      {
        slug: "operator-contracts",
        labels: { singular: "Contract", plural: "Contracts" },
        fields: [{ name: "title", type: "text" }],
        access: { read: () => true },
      },
    );
    registerCollection(
      "operator-hidden",
      {},
      {
        slug: "operator-hidden",
        labels: { singular: "Hidden", plural: "Hidden" },
        fields: [],
        access: { read: () => false },
      },
    );
    const readSchema = createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "test-key", key: new Uint8Array(32).fill(7) },
      resolveBlockSchemas: () => [],
      resolveUser: () => ({
        id: uuid,
        email: "operator@example.test",
        name: "Operator",
        role: "editor",
        tokenVersion: 1,
      }),
    })["schema.get"];
    const host = npCreateAgentOperatorAppHostV1({ authorize: async () => {}, readSchema });
    const input = {
      families: ["contracts" as const],
      collections: ["operator-contracts"],
      maxTargets: 1,
    };
    const result = await host.audit!({ ...context, auditId: uuid, input });
    const schema = await readSchema(
      { selector: "collection", slug: "operator-contracts" },
      context,
    );
    expect(result.checks[0]).toMatchObject({
      family: "contracts",
      status: "pass",
      evidenceRefs: [`schema:${schema.digest}`],
    });
    await expect(
      host.audit!({
        ...context,
        auditId: uuid,
        input: { ...input, collections: ["operator-hidden"] },
      }),
    ).rejects.toThrow();
    await expect(
      host.audit!({
        ...context,
        auditId: uuid,
        input: { ...input, collections: ["operator-contracts", "operator-hidden"] },
      }),
    ).rejects.toThrow("unavailable");
  });
  it("imports the actual restore owner artifact only for the explicitly authorized manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "np-operator-backup-"));
    directories.push(directory);
    await mkdir(join(directory, "artifacts"));
    await writeFile(join(directory, "artifacts", "database.dump"), "isolated fixture");
    await writeFile(
      join(directory, "backup-one.json"),
      JSON.stringify({
        id: "backup-one",
        createdAt: "2026-09-29T00:00:00.000Z",
        database: { path: "artifacts/database.dump" },
        verification: { verifiedAt: "2026-09-29T00:00:00.000Z" },
      }),
    );
    const authorize = vi.fn().mockResolvedValue(undefined);
    const host = npCreateAgentOperatorAppHostV1({
      authorize,
      authorizeDeployment: () => Promise.resolve(true),
      backupEnv: { NP_BACKUP_DIR: directory },
    });
    const result = await host.plan!({
      ...context,
      planId: uuid,
      input: { action: "restore.plan", target: { kind: "backup", manifestId: "backup-one" } },
    });
    expect(result.artifact.schemaVersion).toBe("np.ops-backup-restore-plan.v1");
    expect(result.artifact.manifestId).toBe("backup-one");
    expect(result.artifact.backupDir).toBe(directory);
    expect(result.contractId).toBe("ops.backup");
    expect(result.projectCommand).toBe(
      "pnpm --silent run ops:backup -- restore-plan backup-one --json",
    );
    expect(authorize).toHaveBeenCalledTimes(2);
    await expect(
      host.plan!({
        ...context,
        planId: uuid,
        input: { action: "restore.plan", target: { kind: "backup", manifestId: "latest" } },
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      host.plan!({
        ...context,
        planId: uuid,
        input: { action: "restore.plan", target: { kind: "backup", manifestId: "missing" } },
      }),
    ).rejects.toThrow("unavailable");
  });
  it("rejects missing plan owners instead of inventing a status-based plan", async () => {
    const host = npCreateAgentOperatorAppHostV1({ authorize: async () => {} });
    await expect(
      host.plan!({
        ...context,
        planId: uuid,
        input: { action: "migration.plan", target: { kind: "site" } },
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      host.plan!({
        ...context,
        planId: uuid,
        input: { action: "restore.plan", target: { kind: "backup", manifestId: "backup-one" } },
      }),
    ).rejects.toThrow("unavailable");
  });
});
