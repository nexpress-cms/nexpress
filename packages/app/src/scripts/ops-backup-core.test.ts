import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOpsBackupJson,
  collectOpsBackupReport,
  createOpsBackupManifest,
  parseBackupManifest,
} from "./ops-backup-core.js";

describe("ops backup core", () => {
  it("treats missing manifests as attention by default", () => {
    const report = buildOpsBackupJson({
      mode: "status",
      backupDir: ".nexpress/backups",
      required: false,
      maxAgeHours: 24,
      manifests: [],
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-backup.v1",
        ok: true,
        status: "attention",
        summary: expect.objectContaining({ manifests: 0, stale: true }),
      }),
    );
  });

  it("blocks release-required backup checks when no manifest exists", () => {
    const report = buildOpsBackupJson({
      mode: "status",
      backupDir: ".nexpress/backups",
      required: true,
      maxAgeHours: 24,
      manifests: [],
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("blocked");
  });

  it("reads a verified manifest from NP_BACKUP_DIR", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));
    mkdirSync(join(dir, "artifacts"));
    writeFileSync(join(dir, "artifacts", "db.dump"), "dump");
    writeFileSync(
      join(dir, "backup.json"),
      JSON.stringify({
        id: "backup-1",
        createdAt: new Date().toISOString(),
        database: { path: "artifacts/db.dump" },
        verification: {
          verifiedAt: new Date().toISOString(),
          restoreVerifiedAt: new Date().toISOString(),
        },
      }),
    );

    const report = await collectOpsBackupReport({
      mode: "verify",
      required: true,
      env: { NP_BACKUP_DIR: dir },
    });

    expect(report.ok).toBe(true);
    expect(report.summary.latestId).toBe("backup-1");
  });

  it("does not verify artifact paths outside NP_BACKUP_DIR", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));
    writeFileSync(
      join(dir, "backup.json"),
      JSON.stringify({
        id: "backup-escape",
        createdAt: new Date().toISOString(),
        database: { path: "../db.dump" },
        verification: { verifiedAt: new Date().toISOString() },
      }),
    );

    const report = await collectOpsBackupReport({
      mode: "verify",
      required: true,
      env: { NP_BACKUP_DIR: dir },
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "backup.artifacts",
          state: "error",
        }),
      ]),
    );
  });

  it("rejects invalid manifests", () => {
    expect(parseBackupManifest({ id: "backup-1" })).toBeNull();
    expect(parseBackupManifest({ id: "backup-1", createdAt: "not-a-date" })).toBeNull();
  });

  it("creates a backup manifest in NP_BACKUP_DIR", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));
    mkdirSync(join(dir, "artifacts"));
    writeFileSync(join(dir, "artifacts", "db.dump"), "dump");

    const report = await createOpsBackupManifest({
      env: { NP_BACKUP_DIR: dir },
      databasePath: "artifacts/db.dump",
      verified: true,
      now: new Date("2026-06-10T00:00:00.000Z"),
      id: "backup-created",
    });

    expect(report.mode).toBe("create");
    expect(report.createdManifest).toEqual(
      expect.objectContaining({
        id: "backup-created",
        verified: true,
      }),
    );
    expect(report.summary.latestId).toBe("backup-created");
  });

  it("rejects created backup artifact paths outside NP_BACKUP_DIR", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));

    await expect(
      createOpsBackupManifest({
        env: { NP_BACKUP_DIR: dir },
        databasePath: "../db.dump",
      }),
    ).rejects.toThrow(`Backup artifact must be inside ${dir}`);
  });

  it("treats restore-verified created manifests as verified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));

    const report = await createOpsBackupManifest({
      env: { NP_BACKUP_DIR: dir },
      restoreVerified: true,
      now: new Date("2026-06-10T00:00:00.000Z"),
      id: "backup-restore-verified",
    });

    expect(report.createdManifest).toEqual(
      expect.objectContaining({
        verified: true,
        restoreVerified: true,
      }),
    );
  });
});
