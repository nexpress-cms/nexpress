import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOpsMigrateJson,
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
    expect(report.nextCommand).toBe("nexpress ops backup status --required --json");
  });

  it("detects destructive SQL in pending migration files", async () => {
    const folder = mkdtempSync(join(tmpdir(), "np-ops-migrate-"));
    mkdirSync(join(folder, "meta"));
    writeFileSync(
      join(folder, "0002_drop_column.sql"),
      "ALTER TABLE posts DROP COLUMN old_title;\n",
    );
    const findings = await scanDestructiveSql(folder, {
      ...migrated,
      pending: [{ index: 2, tag: "0002_drop_column", createdAt: 1_700_000_020_000, hash: "h2" }],
    });

    expect(findings).toEqual<DestructiveSqlFinding[]>([
      expect.objectContaining({
        migration: "0002_drop_column",
        pattern: "drop-column",
        line: 1,
      }) as DestructiveSqlFinding,
    ]);
  });
});
