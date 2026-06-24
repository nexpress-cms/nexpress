import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOpsMigrateRollbackPlanJson,
  buildOpsMigrateJson,
  collectOpsMigrateReport,
  renderBriefOpsMigrateApply,
  runOpsMigrateApply,
  scanDestructiveSql,
  type DestructiveSqlFinding,
} from "./ops-migrate-core.js";
import type { MigrationStatus } from "./migration-status.js";

const migrated: MigrationStatus = {
  local: [
    { index: 0, tag: "0000_init", createdAt: 1_700_000_000_000, hash: "h0" },
    { index: 1, tag: "0001_posts", createdAt: 1_700_000_010_000, hash: "h1" },
  ],
  applied: [
    { id: 1, createdAt: 1_700_000_000_000, hash: "h0" },
    { id: 2, createdAt: 1_700_000_010_000, hash: "h1" },
  ],
  latestApplied: { id: 2, createdAt: 1_700_000_010_000, hash: "h1" },
  pending: [],
  drifted: [],
  unknownApplied: [],
};

describe("ops migrate core", () => {
  it("builds a ready migration status report", () => {
    expect(
      buildOpsMigrateJson({
        mode: "status",
        migrationsFolder: "./drizzle",
        status: migrated,
        destructiveFindings: [],
      }),
    ).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-migrate.v1",
        ok: true,
        status: "ready",
        summary: expect.objectContaining({ pending: 0, destructiveFindings: 0 }),
      }),
    );
  });

  it("blocks migration plans when pending migrations exist", () => {
    const report = buildOpsMigrateJson({
      mode: "plan",
      migrationsFolder: "./drizzle",
      status: {
        ...migrated,
        pending: [{ index: 2, tag: "0002_comments", createdAt: 1_700_000_020_000, hash: "h2" }],
      },
      destructiveFindings: [],
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("blocked");
    expect(report.summary).toEqual(
      expect.objectContaining({
        inspectionBlocked: false,
        backupRequired: true,
        manualReviewRequired: false,
        canApplyAfterBackup: true,
      }),
    );
    expect(report.nextCommand).toBe("nexpress ops backup status --required --json");
    expect(report.projectNextCommand).toBe(
      "pnpm --silent run ops:backup -- status --required --json",
    );
    expect(report.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "backup.required",
          projectCommand: "pnpm --silent run ops:backup -- status --required --json",
        }),
        expect.objectContaining({
          id: "migrate.apply_pending",
          command: "pnpm db:migrate",
          requiresApproval: true,
          blockedBy: ["backup.required"],
        }),
        expect.objectContaining({
          id: "release.verify",
          projectCommand: "pnpm --silent run ops:release -- verify --json",
        }),
      ]),
    );
  });

  it("does not suggest migration apply when database inspection failed", () => {
    const report = buildOpsMigrateJson({
      mode: "plan",
      migrationsFolder: "./drizzle",
      status: {
        ...migrated,
        applied: [],
        latestApplied: null,
        pending: migrated.local,
      },
      destructiveFindings: [],
      checks: [
        {
          id: "migrate.database",
          state: "error",
          label: "Database connection",
          detail: "connection refused",
        },
      ],
    });

    expect(report.status).toBe("blocked");
    expect(report.summary.inspectionBlocked).toBe(true);
    expect(report.summary.backupRequired).toBe(false);
    expect(report.summary.canApplyAfterBackup).toBe(false);
    expect(report.nextCommand).toBe("nexpress ops migrate status --json");
    expect(report.actions).toEqual([]);
  });

  it("returns a blocked JSON report when local Drizzle metadata is missing", async () => {
    const folder = mkdtempSync(join(tmpdir(), "np-ops-migrate-missing-meta-"));

    const report = await collectOpsMigrateReport({
      mode: "plan",
      migrationsFolder: folder,
      env: {
        DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.1:55432/ci_unreachable",
      },
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-migrate.v1",
        ok: false,
        status: "blocked",
        nextCommand: "pnpm db:generate",
        projectNextCommand: "pnpm db:generate",
        actions: [],
      }),
    );
    expect(report.summary).toEqual(
      expect.objectContaining({
        local: 0,
        inspectionBlocked: true,
        backupRequired: false,
        canApplyAfterBackup: false,
      }),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "migrate.local_migrations",
          state: "error",
          detail: expect.stringContaining("_journal.json"),
        }),
      ]),
    );
  });

  it("returns a blocked apply report when --safe is missing", async () => {
    const folder = mkdtempSync(join(tmpdir(), "np-ops-migrate-apply-"));

    const report = await runOpsMigrateApply({
      migrationsFolder: folder,
      env: {
        DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.1:55432/ci_unreachable",
      },
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-migrate-apply.v1",
        ok: false,
        mode: "apply",
        mutation: expect.objectContaining({
          action: "migrate.apply-safe",
          mode: "dry-run",
          applied: false,
        }),
      }),
    );
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "migrate.apply.safe_flag",
          state: "error",
        }),
      ]),
    );
    expect(renderBriefOpsMigrateApply(report, { color: false })).toContain(
      "mutation: migrate.apply-safe applied=false",
    );
  });

  it("detects destructive SQL in pending migration files", async () => {
    const folder = mkdtempSync(join(tmpdir(), "np-ops-migrate-"));
    mkdirSync(join(folder, "meta"));
    writeFileSync(
      join(folder, "0002_drop_column.sql"),
      "ALTER TABLE posts DROP COLUMN old_title;\n",
    );
    writeFileSync(join(folder, "0003_drop_index.sql"), "DROP INDEX posts_title_idx;\n");
    writeFileSync(
      join(folder, "0004_set_not_null.sql"),
      "ALTER TABLE posts ALTER COLUMN title SET NOT NULL;\n",
    );
    const findings = await scanDestructiveSql(folder, {
      ...migrated,
      pending: [
        { index: 2, tag: "0002_drop_column", createdAt: 1_700_000_020_000, hash: "h2" },
        { index: 3, tag: "0003_drop_index", createdAt: 1_700_000_030_000, hash: "h3" },
        { index: 4, tag: "0004_set_not_null", createdAt: 1_700_000_040_000, hash: "h4" },
      ],
    });

    expect(findings).toEqual<DestructiveSqlFinding[]>(
      expect.arrayContaining([
        expect.objectContaining({
          migration: "0002_drop_column",
          pattern: "drop-column",
          line: 1,
        }) as DestructiveSqlFinding,
        expect.objectContaining({
          migration: "0003_drop_index",
          pattern: "drop-index",
          line: 1,
        }) as DestructiveSqlFinding,
        expect.objectContaining({
          migration: "0004_set_not_null",
          pattern: "set-not-null",
          line: 1,
        }) as DestructiveSqlFinding,
      ]),
    );
  });

  it("builds a rollback plan for pending migrations", () => {
    const report = buildOpsMigrateRollbackPlanJson({
      migrationsFolder: "./drizzle",
      status: {
        ...migrated,
        pending: [{ index: 2, tag: "0002_comments", createdAt: 1_700_000_020_000, hash: "h2" }],
      },
      destructiveFindings: [],
    });

    expect(report).toEqual(
      expect.objectContaining({
        schemaVersion: "np.ops-migrate-rollback-plan.v1",
        ok: false,
        status: "blocked",
        summary: expect.objectContaining({
          pending: 1,
          commands: 7,
          safeToPlan: false,
        }),
        nextCommand: "nexpress ops backup status --required --json",
        projectNextCommand: "pnpm --silent run ops:backup -- status --required --json",
      }),
    );
    expect(report.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "backup.restore-plan",
          command: "nexpress ops backup restore-plan latest --json",
          projectCommand: "pnpm --silent run ops:backup -- restore-plan latest --json",
        }),
        expect.objectContaining({
          id: "rollback.database",
          requiresApproval: true,
        }),
      ]),
    );
  });

  it("requires manual approval when rollback planning sees destructive SQL", () => {
    const destructiveFindings = [
      {
        migration: "0002_drop",
        pattern: "drop-column",
        line: 1,
        sql: "ALTER TABLE posts DROP COLUMN old_title",
      },
    ];
    const status: MigrationStatus = {
      ...migrated,
      pending: [{ index: 2, tag: "0002_drop", createdAt: 1_700_000_020_000, hash: "h2" }],
    };
    const plan = buildOpsMigrateJson({
      mode: "plan",
      migrationsFolder: "./drizzle",
      status,
      destructiveFindings,
    });
    const report = buildOpsMigrateRollbackPlanJson({
      migrationsFolder: "./drizzle",
      status,
      destructiveFindings,
    });

    expect(plan.summary.manualReviewRequired).toBe(true);
    expect(plan.summary.canApplyAfterBackup).toBe(false);
    expect(plan.nextCommand).toBe("nexpress ops backup status --required --json");
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "migrate.review_destructive_sql",
          requiresApproval: true,
        }),
      ]),
    );
    expect(report.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "migrate.destructive-review",
          requiresApproval: true,
        }),
      ]),
    );
    expect(report.nextCommand).toBe("nexpress ops backup status --required --json");
  });

  it("does not suggest rollback approval when there is no migration risk", () => {
    const report = buildOpsMigrateRollbackPlanJson({
      migrationsFolder: "./drizzle",
      status: migrated,
      destructiveFindings: [],
    });

    expect(report.status).toBe("attention");
    expect(report.nextCommand).toBeNull();
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "migrate.rollback_plan.noop",
          state: "warn",
        }),
      ]),
    );
  });
});
