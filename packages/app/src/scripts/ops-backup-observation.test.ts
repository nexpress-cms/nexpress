import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectOpsBackupReport } from "./ops-backup-core.js";

const directories: string[] = [];
const bounds = { maxManifests: 1, maxManifestBytes: 1024, maxDirectoryEntries: 2 };
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "np-backup-observation-"));
  directories.push(path);
  return { path, env: { NP_BACKUP_DIR: path } };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("reads bounded manifest claims without claiming to verify missing artifacts or restore", async () => {
  const { path, env } = await fixture();
  await writeFile(
    join(path, "backup.json"),
    JSON.stringify({
      id: "retained-backup",
      createdAt: new Date().toISOString(),
      database: { path: "missing.dump" },
      verification: { status: "verified", restoreVerifiedAt: new Date().toISOString() },
    }),
  );
  const report = await collectOpsBackupReport({ mode: "status", env, statusBounds: bounds });
  expect(report.summary.manifests).toBe(1);
  expect(report.manifests[0]).toMatchObject({ verified: true, restoreVerified: true });
  expect(report.checks).toContainEqual(
    expect.objectContaining({
      id: "backup.observation_basis",
      detail: expect.stringContaining("were not verified"),
    }),
  );
  const verified = await collectOpsBackupReport({ mode: "verify", env });
  expect(verified.checks).toContainEqual(
    expect.objectContaining({ id: "backup.artifacts", state: "error" }),
  );
});
it("fails closed at directory, manifest, byte and file-type boundaries with safe errors", async () => {
  const manifest = JSON.stringify({ id: "backup", createdAt: new Date().toISOString() });
  for (const scenario of ["directory", "manifest", "bytes", "symlink", "invalid"] as const) {
    const { path, env } = await fixture();
    if (scenario === "directory") {
      await Promise.all(["a.txt", "b.txt", "c.txt"].map((name) => writeFile(join(path, name), "")));
    } else if (scenario === "manifest") {
      await writeFile(join(path, "a.json"), manifest);
      await writeFile(join(path, "b.json"), manifest);
    } else if (scenario === "symlink") {
      await writeFile(join(path, "private.txt"), manifest);
      await symlink(join(path, "private.txt"), join(path, "a.json"));
    } else {
      await writeFile(
        join(path, "private.json"),
        scenario === "bytes" ? "x".repeat(1025) : "secret invalid JSON",
      );
    }
    await expect(
      collectOpsBackupReport({ mode: "status", env, statusBounds: bounds }),
    ).rejects.toThrow("Backup status observation is unavailable or exceeds its bounds.");
  }
});
it("validates host bounds and preserves default unbounded CLI status behavior", async () => {
  const { path, env } = await fixture();
  await writeFile(join(path, "invalid.json"), "invalid JSON");
  expect((await collectOpsBackupReport({ mode: "status", env })).summary.manifests).toBe(0);
  await expect(
    collectOpsBackupReport({ mode: "verify", env, statusBounds: bounds }),
  ).rejects.toThrow("require status mode");
  await expect(
    collectOpsBackupReport({ mode: "status", env, statusBounds: { ...bounds, maxManifests: 0 } }),
  ).rejects.toThrow("bounds are invalid");
});
