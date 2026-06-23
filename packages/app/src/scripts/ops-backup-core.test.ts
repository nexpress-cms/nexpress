import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOpsBackupJson,
  collectOpsBackupReport,
  collectOpsBackupRestorePlan,
  createOpsBackupManifest,
  parseBackupManifest,
  renderBriefOpsBackupReport,
  renderBriefOpsBackupRestorePlan,
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
        summary: expect.objectContaining({
          manifests: 0,
          stale: true,
          backupRequired: false,
        }),
      }),
    );
    expect(report.nextCommand).toBe(
      "nexpress ops backup create --database artifacts/db.dump --verified --json",
    );
    expect(report.plan.nextCommands).toEqual([]);
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
    expect(report.summary).toEqual(
      expect.objectContaining({
        backupRequired: true,
        verificationRequired: false,
        restoreDrillRecommended: false,
      }),
    );
    expect(report.nextCommand).toBe(
      "nexpress ops backup create --database artifacts/db.dump --verified --json",
    );
    expect(report.plan.nextCommands).toEqual([
      "nexpress ops backup create --database artifacts/db.dump --verified --json",
      "nexpress ops backup verify latest --json",
    ]);
    expect(report.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "backup.record_manifest",
          phase: "record",
          projectCommand:
            "pnpm --silent run ops:backup -- create --database artifacts/db.dump --verified --json",
        }),
        expect.objectContaining({
          id: "backup.verify_artifacts",
          blockedBy: ["backup.record_manifest"],
        }),
      ]),
    );
  });

  it("renders action notes in backup brief output", () => {
    const report = buildOpsBackupJson({
      mode: "status",
      backupDir: ".nexpress/backups",
      required: true,
      maxAgeHours: 24,
      manifests: [],
    });

    const output = renderBriefOpsBackupReport(report, { color: false });

    expect(output).toContain(
      "note: Capture a provider or pg_dump backup first, place artifacts under NP_BACKUP_DIR, then record the manifest.",
    );
    expect(output).toContain(
      "note: Verify declared database and media artifacts exist before release promotion.",
    );
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
    expect(report.plan.nextCommands).toEqual([]);
  });

  it("turns unverified manifests into verify and record handoff actions", () => {
    const report = buildOpsBackupJson({
      mode: "status",
      backupDir: ".nexpress/backups",
      required: true,
      maxAgeHours: 24,
      manifests: [
        {
          id: "backup-unverified",
          createdAt: new Date().toISOString(),
          verified: false,
          restoreVerified: false,
          databasePath: "artifacts/db.dump",
          mediaPath: null,
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.summary.verificationRequired).toBe(true);
    expect(report.nextCommand).toBe("nexpress ops backup verify backup-unverified --json");
    expect(report.plan.nextCommands).toEqual([
      "nexpress ops backup verify backup-unverified --json",
      "nexpress ops backup create --database artifacts/db.dump --verified --json",
    ]);
    expect(report.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "backup.verify_artifacts",
          required: true,
        }),
        expect.objectContaining({
          id: "backup.record_verified_manifest",
          blockedBy: ["backup.verify_artifacts"],
        }),
      ]),
    );
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

  it("rejects created backup artifact paths that do not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));

    await expect(
      createOpsBackupManifest({
        env: { NP_BACKUP_DIR: dir },
        databasePath: "artifacts/missing.dump",
      }),
    ).rejects.toThrow(`Backup artifact does not exist inside ${dir}: artifacts/missing.dump`);
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

  it("builds a ready restore plan for a verified manifest with artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));
    mkdirSync(join(dir, "artifacts"));
    writeFileSync(join(dir, "artifacts", "db.dump"), "dump");
    mkdirSync(join(dir, "artifacts", "uploads"));
    writeFileSync(join(dir, "artifacts", "uploads", "image.jpg"), "image");
    writeFileSync(
      join(dir, "backup.json"),
      JSON.stringify({
        id: "backup-ready",
        createdAt: new Date().toISOString(),
        database: { path: "artifacts/db.dump" },
        media: { path: "artifacts/uploads" },
        verification: {
          verifiedAt: new Date().toISOString(),
          restoreVerifiedAt: new Date().toISOString(),
        },
      }),
    );

    const plan = await collectOpsBackupRestorePlan({
      env: { NP_BACKUP_DIR: dir },
      manifestId: "backup-ready",
    });

    expect(plan).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-backup-restore-plan.v1",
        ok: true,
        status: "ready",
        manifestId: "backup-ready",
        summary: expect.objectContaining({
          selected: true,
          databaseArtifact: true,
          mediaArtifact: true,
        }),
      }),
    );
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "restore.database",
          requiresApproval: true,
        }),
        expect.objectContaining({
          id: "restore.record",
          command:
            "nexpress ops backup create --database artifacts/db.dump --restore-verified --json",
          projectCommand:
            "pnpm --silent run ops:backup -- create --database artifacts/db.dump --restore-verified --json",
        }),
      ]),
    );
    expect(plan.projectNextCommand).toBe("createdb nexpress_restore_drill");
    expect(plan.plan.nextCommands).toEqual([
      "nexpress ops backup verify backup-ready --json",
      "createdb nexpress_restore_drill",
      'pg_restore --dbname="$RESTORE_DATABASE_URL" --jobs=4 --no-owner --no-privileges artifacts/db.dump',
      'rsync -a --delete artifacts/uploads/ "$RESTORE_STORAGE_DIR"/',
      "SITE_URL=$RESTORE_SITE_URL nexpress ops health --url $RESTORE_SITE_URL --json",
      "nexpress ops backup create --database artifacts/db.dump --restore-verified --json",
    ]);
    expect(plan.plan.projectNextCommands).toContain(
      "pnpm --silent run ops:backup -- verify backup-ready --json",
    );
  });

  it("blocks restore plans when no manifest exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));

    const plan = await collectOpsBackupRestorePlan({ env: { NP_BACKUP_DIR: dir } });

    expect(plan.ok).toBe(false);
    expect(plan.status).toBe("blocked");
    expect(plan.nextCommand).toBe("nexpress ops backup status --required --json");
    expect(plan.projectNextCommand).toBe(
      "pnpm --silent run ops:backup -- status --required --json",
    );
    expect(plan.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "backup.manifest", state: "error" })]),
    );
    expect(renderBriefOpsBackupRestorePlan(plan, { color: false })).toContain(
      "note: Record a backup manifest before planning a restore drill.",
    );
  });

  it("verifies a requested manifest id instead of always using latest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-backups-"));
    mkdirSync(join(dir, "artifacts"));
    writeFileSync(join(dir, "artifacts", "latest.dump"), "dump");
    writeFileSync(
      join(dir, "latest.json"),
      JSON.stringify({
        id: "latest",
        createdAt: new Date("2026-06-11T00:00:00.000Z").toISOString(),
        database: { path: "artifacts/latest.dump" },
        verification: { verifiedAt: new Date().toISOString() },
      }),
    );
    writeFileSync(
      join(dir, "older.json"),
      JSON.stringify({
        id: "older",
        createdAt: new Date("2026-06-10T00:00:00.000Z").toISOString(),
        database: { path: "artifacts/missing.dump" },
        verification: { verifiedAt: new Date().toISOString() },
      }),
    );

    const report = await collectOpsBackupReport({
      mode: "verify",
      required: true,
      env: { NP_BACKUP_DIR: dir, NP_BACKUP_MAX_AGE_HOURS: "100000" },
      manifestId: "older",
    });

    expect(report.ok).toBe(false);
    expect(report.nextCommand).toBe("nexpress ops backup verify older --json");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "backup.artifacts",
          detail: "missing artifacts/missing.dump",
        }),
      ]),
    );
  });
});
