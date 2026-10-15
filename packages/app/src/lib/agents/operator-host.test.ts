import type * as WorkerObservationModule from "./operator-worker-observation";
import type * as ProgressObservationModule from "./operator-progress-observation";
import type * as JobsModule from "@nexpress/core/jobs";
import type * as MediaModule from "@nexpress/core/media";
import type * as CacheModule from "@nexpress/core/cache";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCollection } from "@nexpress/core/collections";
import { createAgentCoreReadCapabilityExecutorsV1 } from "@nexpress/core/agents";
import type { NpAgentOperatorHostContextV1 } from "@nexpress/core/agents";
import { getDb } from "../db";
const mocks = vi.hoisted(() => ({
  storage: vi.fn(),
  cache: vi.fn(),
  plugins: vi.fn(),
  invalidate: vi.fn(),
  adapter: vi.fn(),
  jobs: vi.fn(),
  media: vi.fn(),
  worker: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("./operator-worker-observation", async (original) => ({
  ...(await original<typeof WorkerObservationModule>()),
  collectOperatorWorkerObservation: mocks.worker,
}));
vi.mock("./operator-progress-observation", async (original) => ({
  ...(await original<typeof ProgressObservationModule>()),
  collectOperatorProgressObservation: mocks.progress,
}));
vi.mock("@nexpress/core/jobs", async (original) => ({
  ...(await original<typeof JobsModule>()),
  npCollectOperatorJobsObservationV1: mocks.jobs,
}));
vi.mock("@nexpress/core/media", async (original) => ({
  ...(await original<typeof MediaModule>()),
  npObserveMediaStorageV1: mocks.media,
}));
vi.mock("@nexpress/core/cache", async (original) => ({
  ...(await original<typeof CacheModule>()),
  npInvalidateCache: mocks.invalidate,
  getOptionalCacheInvalidationAdapter: mocks.adapter,
}));
vi.mock("../system-health-checks", () => ({
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
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("Operator host owner boundary", () => {
  it("withholds retained Doctor evidence when deployment authority is absent or lost during the read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "np-operator-doctor-"));
    directories.push(directory);
    const path = join(directory, "doctor.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: "np.doctor.v1",
        ok: false,
        blocksDeploy: true,
        mode: "dev",
        target: null,
        summary: { total: 1, errors: 1, warnings: 0 },
        checks: [
          {
            id: "jobs.contract",
            state: "error",
            label: "private label",
            detail: "/private/password",
          },
        ],
      }),
    );
    let allowed = true;
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(allowed),
      reportSources: { doctor: { path } },
    });
    const result = await host.status({ families: ["readiness"] }, context);
    expect(result.report.checks).toContainEqual(
      expect.objectContaining({ id: "jobs.contract", state: "error" }),
    );
    expect(JSON.stringify(result)).not.toMatch(/password|private label/);
    allowed = false;
    expect(
      (await host.status({ families: ["readiness"] }, context)).report.checks,
    ).not.toContainEqual(expect.objectContaining({ id: "jobs.contract" }));
    let grants = 0;
    const revoked = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(++grants < 3),
      reportSources: { doctor: { path } },
    });
    expect(
      (await revoked.status({ families: ["readiness"] }, context)).report.checks,
    ).not.toContainEqual(expect.objectContaining({ id: "jobs.contract" }));
  });
  it("preflights the deployment mutation gate and rechecks it at dispatch without touching cache", async () => {
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "0");
    const host = npCreateAgentOperatorAppHostV1({ authorize: async () => {} });
    const input = { action: "cache.revalidate" as const, target: { kind: "site" as const } };
    await expect(host.preflightExecution!({ ...context, input })).rejects.toThrow("unavailable");
    await expect(
      host.execute!({
        ...context,
        input,
        artifact: {},
        contractId: "cache.invalidation",
        executionId: uuid,
      }),
    ).rejects.toThrow("unavailable");
    expect(mocks.invalidate).not.toHaveBeenCalled();
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "1");
    await expect(host.preflightExecution!({ ...context, input })).resolves.toBeUndefined();
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "0");
    await expect(host.preflightExecution!({ ...context, input })).rejects.toThrow("unavailable");
  });
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
    expect(result.checks.map((check) => check.id)).toEqual(
      (result.artifact.checks as Array<{ id: string }>).map((check) => check.id),
    );
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
  it("executes only the frozen site-owned cache targets and projects the actual adapter outcome", async () => {
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "1");
    mocks.adapter.mockReturnValue({ kind: "test-cache" });
    mocks.invalidate.mockResolvedValue({
      status: "applied",
      paths: { requested: 0, succeeded: 0, failed: 0 },
      tags: { requested: 1, succeeded: 1, failed: 0 },
      cdn: { status: "not-configured", adapterKind: null },
    });
    const authorize = vi.fn().mockResolvedValue(undefined);
    const cacheTargets = vi
      .fn()
      .mockResolvedValue({ source: "site", siteId: "default", tags: ["np:site:default"] });
    const host = npCreateAgentOperatorAppHostV1({ authorize, cacheTargets });
    const input = { action: "cache.revalidate" as const, target: { kind: "site" as const } };
    const plan = await host.plan!({ ...context, input, planId: uuid });
    expect(mocks.invalidate).not.toHaveBeenCalled();
    const executed = await host.execute!({
      ...context,
      input,
      artifact: plan.artifact,
      contractId: plan.contractId,
      executionId: uuid,
    });
    expect(executed.state).toBe("succeeded");
    expect(executed.evidence).toMatchObject({
      status: "applied",
      tags: { requested: 1, succeeded: 1, failed: 0 },
    });
    expect(JSON.stringify(executed)).not.toContain("np:site:default");
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    cacheTargets.mockResolvedValue({
      source: "site",
      siteId: "default",
      tags: ["np:site:changed"],
    });
    await expect(
      host.execute!({
        ...context,
        input,
        artifact: plan.artifact,
        contractId: plan.contractId,
        executionId: uuid,
      }),
    ).rejects.toThrow("unavailable");
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    cacheTargets.mockResolvedValue({ source: "site", siteId: "other", tags: ["np:site:other"] });
    await expect(host.plan!({ ...context, input, planId: uuid })).rejects.toThrow("unavailable");
  });
  it("retains partial cache failure and requires independent approver authority", async () => {
    vi.stubEnv("NP_REMOTE_OPS_MUTATIONS", "1");
    mocks.adapter.mockReturnValue({ kind: "test-cache" });
    mocks.invalidate.mockResolvedValue({
      status: "partial",
      paths: { requested: 1, succeeded: 0, failed: 1 },
      tags: { requested: 1, succeeded: 1, failed: 0 },
      cdn: { status: "not-configured", adapterKind: null },
    });
    const input = {
      action: "cache.revalidate" as const,
      target: { kind: "navigation" as const, location: "header" },
    };
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      cacheTargets: () =>
        Promise.resolve({
          source: "navigation",
          siteId: "default",
          navigationLocation: "header",
          paths: ["/default"],
          tags: ["nx:nav:default:header"],
        }),
    });
    const plan = await host.plan!({ ...context, input, planId: uuid });
    const result = await host.execute!({
      ...context,
      input,
      artifact: plan.artifact,
      contractId: plan.contractId,
      executionId: uuid,
    });
    expect(result.state).toBe("failed");
    expect(result.evidence.status).toBe("partial");
    await expect(
      host.assertApprovalAccess!({
        db: context.db,
        siteId: "default",
        staffUser: {
          id: uuid,
          email: "approver@example.test",
          name: "Approver",
          role: "admin",
          tokenVersion: 1,
        },
        input,
        artifact: plan.artifact,
        contractId: plan.contractId,
      }),
    ).rejects.toThrow("unavailable");
    const unavailable = npCreateAgentOperatorAppHostV1({ authorize: async () => {} });
    await expect(unavailable.plan!({ ...context, input, planId: uuid })).rejects.toThrow(
      "unavailable",
    );
    await expect(
      unavailable.plan!({
        ...context,
        input: { action: "agent.run.cancel", target: { kind: "run", runId: uuid } },
        planId: uuid,
      }),
    ).rejects.toThrow("unavailable");
  });
});

describe("Operator measured observation projection", () => {
  const jobs = {
    state: "observed",
    siteId: "default",
    source: "pg-boss",
    generatedAt: "2026-09-30T00:00:00.000Z",
    windowStart: "2026-09-29T00:00:00.000Z",
    complete: true,
    inspectedCount: 1,
    created: 0,
    active: 0,
    retry: 0,
    completed: 0,
    failed: 1,
    cancelled: 0,
    oldestReadyAgeSeconds: null,
    coveredQueues: ["agent.runExecute"],
  };
  it("retains bounded aggregate facts independently of receipt string count and rechecks authority", async () => {
    mocks.jobs.mockResolvedValue(jobs);
    const authorize = vi.fn(async () => {});
    const host = npCreateAgentOperatorAppHostV1({
      authorize,
      observationOwners: { jobs: "pg-boss" },
    });
    const input = { families: ["jobs" as const], collections: [], maxTargets: 1 };
    const output = await host.audit!({ ...context, auditId: uuid, input });
    expect(output.checks[0]).toMatchObject({ family: "jobs", status: "fail" });
    expect(output.checks[0]?.evidenceRefs).toEqual(
      expect.arrayContaining([
        "fact:failed:1",
        "fact:inspectedCount:1",
        "coverage:framework-site-payload",
        "complete:true",
      ]),
    );
    expect(mocks.jobs).toHaveBeenCalledWith({ siteId: "default", maxTargets: 1 });
    expect(authorize).toHaveBeenCalledTimes(2);
    mocks.jobs.mockResolvedValue({
      ...jobs,
      state: "unavailable",
      complete: false,
      inspectedCount: null,
      failed: null,
    });
    const status = await host.status({ families: ["jobs"] }, context);
    expect(status.report.checks[0]).toMatchObject({ state: "warn" });
    expect(status.report.checks[0]?.detail).toContain("unknown");
    expect(status.report.checks[0]?.detail).toContain("Excludes custom");
    mocks.jobs.mockImplementation(() => {
      authorize.mockRejectedValue(new Error("revoked"));
      return Promise.resolve(jobs);
    });
    await expect(host.audit!({ ...context, auditId: uuid, input })).rejects.toThrow("revoked");
  });
  it("passes selected collection scope and remaining probe budget to the authorized media owner", async () => {
    mocks.jobs.mockResolvedValue(jobs);
    mocks.media.mockResolvedValue({
      status: "truncated",
      attemptedTargets: 1,
      checkedTargets: 1,
      presentTargets: 0,
      missingTargets: 1,
      unavailableObservations: 0,
      evidenceDigest: "discarded-private-snapshot",
    });
    const selectMedia = vi.fn(() => Promise.resolve([uuid]));
    const authorizeMedia = vi.fn(async () => {});
    const adapter = {
      kind: "test",
      upload: vi.fn(),
      delete: vi.fn(),
      getUrl: vi.fn(),
      exists: vi.fn(),
      getStream: vi.fn(),
    };
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      observationOwners: { jobs: "pg-boss", storage: { adapter, selectMedia, authorizeMedia } },
    });
    const result = await host.audit!({
      ...context,
      auditId: uuid,
      input: { families: ["jobs", "storage"], collections: ["posts"], maxTargets: 2 },
    });
    expect(selectMedia).toHaveBeenCalledWith(expect.objectContaining({ siteId: "default" }), 1, [
      "posts",
    ]);
    const call = mocks.media.mock.calls[0]?.[0];
    expect(call).toMatchObject({ siteId: "default", mediaIds: [uuid], maxTargets: 1, adapter });
    await call.authorizeMedia({ siteId: "default", mediaId: uuid });
    expect(authorizeMedia).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: "default" }),
      uuid,
    );
    expect(result.checks[1]).toMatchObject({
      status: "fail",
      evidenceRefs: expect.arrayContaining(["state:truncated", "fact:missing:1"]),
    });
    expect(JSON.stringify(result)).not.toContain("discarded-private-snapshot");
    mocks.media.mockResolvedValue({
      status: "complete",
      attemptedTargets: 2,
      checkedTargets: 2,
      presentTargets: 2,
      missingTargets: 0,
      unavailableObservations: 0,
    });
    await expect(
      host.audit!({
        ...context,
        auditId: uuid,
        input: { families: ["storage"], collections: [], maxTargets: 1 },
      }),
    ).rejects.toThrow("unavailable");
  });
  it("labels readiness and backup claims even when manifests claim verification for missing artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "np-operator-observation-"));
    directories.push(directory);
    const timestamp = new Date().toISOString();
    await writeFile(
      join(directory, "record.json"),
      JSON.stringify({
        id: "record",
        createdAt: timestamp,
        database: { path: "does-not-exist.dump" },
        verification: { verifiedAt: timestamp },
      }),
    );
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(true),
      backupEnv: { NP_BACKUP_DIR: directory },
    });
    const result = await host.status({ families: ["backup", "readiness"] }, context);
    expect(result.report.checks[0]?.detail).toContain("manifest claim");
    expect(result.report.checks[0]?.detail).toContain("were not verified");
    expect(result.report.checks[1]?.detail).toContain("no database, queue, network");
    expect(JSON.stringify(result)).not.toContain(directory);
    expect(JSON.stringify(result)).not.toContain("does-not-exist.dump");
  });
});

describe("Operator recipe worker deployment boundary", () => {
  it("keeps site observations separate and uses admitted thresholds for an opted-in worker owner", async () => {
    mocks.worker.mockImplementation(async (input) => {
      await input.authorize();
      return {
        checks: [
          {
            id: "operator.worker",
            label: "Agent worker observation",
            state: "warn",
            detail: "Authorized deployment facts",
          },
        ],
      };
    });
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(true),
      workerDiagnostics: "pg-boss",
      scopedReaders: { jobs: () => Promise.resolve({ state: "ok", evidenceRefs: [] }) },
    });
    const result = await host.status(
      { families: ["jobs"] },
      {
        ...context,
        runtimeRecipeSettings: {
          recipeId: "operator.worker-not-draining",
          recipeVersion: 1,
          staleAfterSeconds: 600,
          minimumPendingJobs: 10,
          checkIds: ["operator.worker"],
        },
      },
    );
    expect(result.report.checks.map((check) => check.id)).toEqual([
      "operator.jobs",
      "operator.worker",
    ]);
    expect(mocks.worker).toHaveBeenCalledWith(
      expect.objectContaining({ staleAfterSeconds: 600, minimumPendingJobs: 10 }),
    );
  });
  it("never reads deployment workers without explicit access and redacts revoked access after reading", async () => {
    let allowed = false;
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(allowed),
      workerDiagnostics: "pg-boss",
      scopedReaders: { jobs: () => Promise.resolve({ state: "ok", evidenceRefs: [] }) },
    });
    const absent = await host.status({ families: ["jobs"] }, context);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(absent.report.checks[1]?.detail).toContain("unknown");
    allowed = true;
    mocks.worker.mockImplementation(() => {
      allowed = false;
      return Promise.resolve({
        checks: [
          {
            id: "operator.worker",
            label: "Agent worker observation",
            state: "ok",
            detail: "secret facts",
          },
        ],
      });
    });
    const revoked = await host.status({ families: ["jobs"] }, context);
    expect(revoked.report.checks[0]?.state).toBe("ok");
    expect(revoked.report.checks[1]?.detail).toContain("unknown");
    expect(JSON.stringify(revoked)).not.toContain("secret facts");
  });
  it("keeps site transitions visible without deployment permission and requires explicit source selection", async () => {
    mocks.jobs.mockResolvedValue({
      state: "observed",
      complete: true,
      inspectedCount: 0,
      failed: 0,
      coveredQueues: [],
    });
    mocks.progress.mockResolvedValue({
      check: {
        id: "operator.jobs.progress",
        state: "ok",
        label: "Site transitions",
        detail: "Site evidence only",
      },
      targetCount: 1,
      evidenceRefs: ["progress:observed"],
    });
    const options = {
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(false),
      observationOwners: { jobs: "pg-boss" as const },
    };
    await npCreateAgentOperatorAppHostV1(options).status({ families: ["jobs"] }, context);
    expect(mocks.progress).not.toHaveBeenCalled();
    const result = await npCreateAgentOperatorAppHostV1({
      ...options,
      progressDiagnostics: "pg-boss",
      workerDiagnostics: "pg-boss",
    }).status({ families: ["jobs"] }, context);
    expect(result.report.checks.map((check) => check.id)).toEqual([
      "operator.jobs",
      "operator.jobs.progress",
      "operator.worker",
    ]);
    expect(result.report.checks[1]?.detail).toBe("Site evidence only");
    expect(mocks.progress).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scope: { kind: "site", siteId: "default" } }),
    );
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("withholds deployment transition evidence when deployment authority is revoked", async () => {
    let allowed = true;
    mocks.worker.mockResolvedValue({
      checks: [{ id: "operator.worker", state: "ok", label: "Workers" }],
    });
    mocks.progress.mockImplementation(() => {
      allowed = false;
      return Promise.resolve({
        check: {
          id: "operator.worker.progress",
          state: "ok",
          label: "Transitions",
          detail: "private-deployment-evidence",
        },
        targetCount: 1,
        evidenceRefs: ["progress:observed"],
      });
    });
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      authorizeDeployment: () => Promise.resolve(allowed),
      workerDiagnostics: "pg-boss",
      progressDiagnostics: "pg-boss",
      scopedReaders: { jobs: () => Promise.resolve({ state: "ok", evidenceRefs: [] }) },
    });
    const result = await host.status({ families: ["jobs"] }, context);
    expect(mocks.progress).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scope: { kind: "deployment" } }),
    );
    expect(JSON.stringify(result)).not.toContain("private-deployment-evidence");
    expect(result.report.checks.map((check) => check.id)).toEqual([
      "operator.jobs",
      "operator.worker",
    ]);
  });
  it("retains transition facts in a separate audit check and charges both samples against the shared target bound", async () => {
    mocks.jobs.mockImplementation(({ maxTargets }: { maxTargets: number }) =>
      Promise.resolve({
        state: "observed",
        complete: true,
        inspectedCount: maxTargets,
        failed: 0,
        coveredQueues: [],
      }),
    );
    mocks.progress.mockResolvedValue({
      check: { id: "operator.jobs.progress", state: "ok", label: "Transitions" },
      targetCount: 2,
      evidenceRefs: ["observation:job-progress:v1", "progress:observed", "fact:completed:2"],
    });
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      observationOwners: { jobs: "pg-boss" },
      progressDiagnostics: "pg-boss",
    });
    const request = {
      ...context,
      input: { families: ["jobs" as const], collections: [], maxTargets: 6 },
      auditId: uuid,
    };
    const audit = host.audit?.bind(host);
    if (!audit) throw new Error("Expected the explicit audit owner");
    const result = await audit(request);
    expect(mocks.jobs).toHaveBeenCalledWith({ siteId: "default", maxTargets: 3 });
    expect(mocks.progress).toHaveBeenCalledWith(
      expect.objectContaining({ maxTargets: 3, scope: { kind: "site", siteId: "default" } }),
    );
    expect(result.checks[1]).toMatchObject({
      id: "operator.jobs.progress",
      family: "jobs",
      status: "pass",
      evidenceRefs: expect.arrayContaining(["fact:completed:2"]),
    });
    mocks.progress.mockClear();
    const bounded = await audit({ ...request, input: { ...request.input, maxTargets: 1 } });
    expect(mocks.progress).not.toHaveBeenCalled();
    expect(bounded.checks[1]).toMatchObject({
      status: "unknown",
      evidenceRefs: expect.arrayContaining(["progress:unknown"]),
    });
    mocks.progress.mockResolvedValueOnce({
      check: { id: "operator.jobs.progress", state: "ok", label: "Transitions" },
      targetCount: 4,
      evidenceRefs: ["progress:observed"],
    });
    await expect(audit(request)).rejects.toMatchObject({ code: "OPERATOR_UNAVAILABLE" });
  });
  it("reserves an unknown snapshot's allocation before attempting progress without inventing inspected facts", async () => {
    mocks.jobs.mockResolvedValue({
      state: "unavailable",
      complete: false,
      inspectedCount: null,
      failed: null,
      coveredQueues: [],
    });
    mocks.progress.mockImplementation(({ maxTargets }: { maxTargets: number }) =>
      Promise.resolve({
        check: { id: "operator.jobs.progress", state: "warn", label: "Unknown transitions" },
        targetCount: 0,
        consumedTargets: maxTargets,
        evidenceRefs: ["progress:unknown", "fact:inspectedCount:unknown"],
      }),
    );
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      observationOwners: { jobs: "pg-boss" },
      progressDiagnostics: "pg-boss",
    });
    const audit = host.audit?.bind(host);
    if (!audit) throw new Error("Expected the explicit audit owner");
    const result = await audit({
      ...context,
      input: { families: ["jobs"], collections: [], maxTargets: 6 },
      auditId: uuid,
    });
    expect(mocks.jobs).toHaveBeenCalledExactlyOnceWith({ siteId: "default", maxTargets: 3 });
    expect(mocks.progress).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ maxTargets: 3 }),
    );
    expect(result.checks[0]?.evidenceRefs).toContain("fact:inspectedCount:unknown");
    expect(result.checks[1]).toMatchObject({
      status: "unknown",
      evidenceRefs: expect.arrayContaining(["fact:inspectedCount:unknown"]),
    });
  });
  it("does not reuse an unknown snapshot's attempted budget for later audit families", async () => {
    mocks.jobs.mockResolvedValue({
      state: "unavailable",
      complete: false,
      inspectedCount: null,
      failed: null,
      coveredQueues: [],
    });
    const storage = vi.fn(() =>
      Promise.resolve({
        state: "ok" as const,
        targetCount: 1,
        evidenceRefs: ["storage:observed"],
      }),
    );
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      observationOwners: { jobs: "pg-boss" },
      auditReaders: { storage },
    });
    const audit = host.audit?.bind(host);
    if (!audit) throw new Error("Expected the explicit audit owner");
    await expect(
      audit({
        ...context,
        input: { families: ["jobs", "storage"], collections: [], maxTargets: 6 },
        auditId: uuid,
      }),
    ).rejects.toMatchObject({ code: "OPERATOR_UNAVAILABLE" });
    expect(mocks.jobs).toHaveBeenCalledExactlyOnceWith({ siteId: "default", maxTargets: 6 });
    expect(storage).not.toHaveBeenCalled();
  });
  it("reserves unknown progress inspection before considering a later family", async () => {
    mocks.jobs.mockResolvedValue({
      state: "observed",
      complete: true,
      inspectedCount: 2,
      failed: 0,
      coveredQueues: [],
    });
    mocks.progress.mockImplementation(({ maxTargets }: { maxTargets: number }) =>
      Promise.resolve({
        check: { id: "operator.jobs.progress", state: "warn", label: "Unknown transitions" },
        targetCount: 0,
        consumedTargets: maxTargets,
        evidenceRefs: ["progress:unknown"],
      }),
    );
    const storage = vi.fn(() =>
      Promise.resolve({
        state: "ok" as const,
        targetCount: 1,
        evidenceRefs: ["storage:observed"],
      }),
    );
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      observationOwners: { jobs: "pg-boss" },
      progressDiagnostics: "pg-boss",
      auditReaders: { storage },
    });
    const audit = host.audit?.bind(host);
    if (!audit) throw new Error("Expected the explicit audit owner");
    await expect(
      audit({
        ...context,
        input: { families: ["jobs", "storage"], collections: [], maxTargets: 6 },
        auditId: uuid,
      }),
    ).rejects.toMatchObject({ code: "OPERATOR_UNAVAILABLE" });
    expect(mocks.progress).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ maxTargets: 4 }),
    );
    expect(storage).not.toHaveBeenCalled();
  });
  it("preserves explicitly installed custom readers' measured target contract and precedence", async () => {
    const jobs = vi.fn(() =>
      Promise.resolve({
        state: "warn" as const,
        targetCount: 0,
        evidenceRefs: ["jobs:unavailable"],
      }),
    );
    const storage = vi.fn(() =>
      Promise.resolve({
        state: "ok" as const,
        targetCount: 1,
        evidenceRefs: ["storage:observed"],
      }),
    );
    const host = npCreateAgentOperatorAppHostV1({
      authorize: async () => {},
      observationOwners: { jobs: "pg-boss" },
      progressDiagnostics: "pg-boss",
      auditReaders: { jobs, storage },
    });
    const audit = host.audit?.bind(host);
    if (!audit) throw new Error("Expected the explicit audit owner");
    const result = await audit({
      ...context,
      input: { families: ["jobs", "storage"], collections: [], maxTargets: 6 },
      auditId: uuid,
    });
    expect(result.checks.map((check) => check.id)).toEqual(["operator.jobs", "operator.storage"]);
    expect(storage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ input: expect.objectContaining({ maxTargets: 6 }) }),
    );
    expect(mocks.jobs).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
});
