import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ backup: vi.fn(), storage: vi.fn() }));
vi.mock("../../scripts/ops-backup-core", () => ({ collectOpsBackupReport: mocks.backup }));
vi.mock("../system-health-checks", () => ({
  checkSiteUrl: () => ({ id: "site.url", state: "ok", detail: "/private/host" }),
  checkCollectionRuntime: () => ({ id: "collections.runtime", state: "ok" }),
  checkObservabilityAdapters: () => ({ id: "observability.adapters", state: "warn" }),
  checkCacheInvalidation: () => ({ id: "cache.invalidation", state: "ok" }),
  checkStorageAdapter: mocks.storage,
}));
import { npCreateAgentOperatorAppStatusSourceV1 } from "./operator-event-source";
afterEach(() => vi.resetAllMocks());
describe("source-owned Operator status events", () => {
  it("feeds actual retained Doctor and release check IDs into canonical change observation without private diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "np-operator-source-reports-"));
    try {
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
            { id: "jobs.contract", state: "error", label: "private text", detail: "/private/key" },
          ],
        }),
      );
      // Retained evidence must predate the observer's millisecond clock.
      const recordedAt = new Date(Date.now() - 1000);
      await utimes(path, recordedAt, recordedAt);
      mocks.storage.mockResolvedValue({ id: "storage.adapter", state: "ok" });
      const source = npCreateAgentOperatorAppStatusSourceV1({
        reportSources: { doctor: { path } },
      });
      const status = await source();
      expect(status.checks).toContainEqual({ id: "jobs.contract", state: "fail" });
      expect(JSON.stringify(status)).not.toMatch(/private|secret/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("projects bounded owner checks without paths, errors, commands or invented backup failure", async () => {
    mocks.storage.mockResolvedValue({
      id: "storage.adapter",
      state: "ok",
      detail: "/private/secret",
    });
    const source = npCreateAgentOperatorAppStatusSourceV1({
      backupEnv: { NP_BACKUP_DIR: "/private/backups" },
    });
    mocks.backup.mockResolvedValue({
      summary: { latestId: "manifest-1", stale: true },
      checks: [{ id: "backup.observation_basis", state: "ok", detail: "/private/backup" }],
    });
    expect(await source()).toMatchObject({
      backup: { state: "observed", artifactId: "manifest-1", stale: true, failed: false },
    });
    expect(mocks.backup).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "status",
        statusBounds: { maxManifests: 100, maxManifestBytes: 65536, maxDirectoryEntries: 1000 },
      }),
    );
    expect(JSON.stringify(await source())).not.toContain("/private");
  });
  it("keeps absent and unreadable backup evidence unknown", async () => {
    mocks.storage.mockResolvedValue({ id: "storage.adapter", state: "warn" });
    expect((await npCreateAgentOperatorAppStatusSourceV1({})()).backup).toEqual({
      state: "unknown",
      artifactId: null,
      stale: false,
      failed: false,
    });
    expect(mocks.backup).not.toHaveBeenCalled();
    mocks.backup.mockRejectedValue(new Error("/private/key"));
    const result = await npCreateAgentOperatorAppStatusSourceV1({ backupEnv: {} })();
    expect(result.backup).toMatchObject({ state: "unknown", failed: false });
    expect(result.checks).toContainEqual({ id: "backup.observation", state: "unknown" });
    expect(JSON.stringify(result)).not.toContain("/private/key");
  });
});
