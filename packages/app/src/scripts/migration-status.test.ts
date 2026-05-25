import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildMigrationStatus,
  buildMigrationStatusJson,
  readLocalMigrationEntries,
  renderMigrationStatus,
  type AppliedMigrationEntry,
  type LocalMigrationEntry,
} from "./migration-status.js";

const local: LocalMigrationEntry[] = [
  { index: 0, tag: "0000_init", createdAt: 1_700_000_000_000, hash: "hash-init" },
  { index: 1, tag: "0001_posts", createdAt: 1_700_000_100_000, hash: "hash-posts" },
  { index: 2, tag: "0002_comments", createdAt: 1_700_000_200_000, hash: "hash-comments" },
];

describe("migration status", () => {
  it("marks every local migration pending when the tracking table is empty", () => {
    const status = buildMigrationStatus(local, []);

    expect(status.latestApplied).toBeNull();
    expect(status.pending.map((migration) => migration.tag)).toEqual([
      "0000_init",
      "0001_posts",
      "0002_comments",
    ]);
    expect(status.drifted).toEqual([]);
    expect(status.unknownApplied).toEqual([]);
  });

  it("reads local migration tags and hashes through drizzle metadata", () => {
    const folder = mkdtempSync(join(tmpdir(), "np-migrations-"));
    mkdirSync(join(folder, "meta"));
    writeFileSync(join(folder, "0000_init.sql"), "CREATE TABLE np_example (id integer);\n");
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 0,
            version: "7",
            when: 1_700_000_000_000,
            tag: "0000_init",
            breakpoints: true,
          },
        ],
      }),
    );

    expect(readLocalMigrationEntries(folder)).toEqual([
      {
        index: 0,
        tag: "0000_init",
        createdAt: 1_700_000_000_000,
        hash: expect.any(String),
      },
    ]);
  });

  it("matches drizzle migrator semantics by pending only after latest applied timestamp", () => {
    const applied: AppliedMigrationEntry[] = [
      { id: 1, createdAt: 1_700_000_000_000, hash: "hash-init" },
      { id: 2, createdAt: 1_700_000_100_000, hash: "hash-posts" },
    ];

    const status = buildMigrationStatus(local, applied);

    expect(status.latestApplied).toEqual(applied[1]);
    expect(status.pending.map((migration) => migration.tag)).toEqual(["0002_comments"]);
  });

  it("reports hash drift for applied migrations that no longer match local SQL", () => {
    const status = buildMigrationStatus(local, [
      { id: 1, createdAt: 1_700_000_000_000, hash: "hash-init" },
      { id: 2, createdAt: 1_700_000_100_000, hash: "different-hash" },
    ]);

    expect(status.drifted).toEqual([
      {
        tag: "0001_posts",
        createdAt: 1_700_000_100_000,
        localHash: "hash-posts",
        appliedHash: "different-hash",
      },
    ]);
  });

  it("reports applied migrations that are not present in local files", () => {
    const status = buildMigrationStatus(local, [
      { id: 1, createdAt: 1_700_000_000_000, hash: "hash-init" },
      { id: 2, createdAt: 1_700_000_999_000, hash: "hash-from-another-codebase" },
    ]);

    expect(status.pending).toEqual([]);
    expect(status.unknownApplied).toEqual([
      { id: 2, createdAt: 1_700_000_999_000, hash: "hash-from-another-codebase" },
    ]);
  });

  it("builds a stable JSON status report", () => {
    const status = buildMigrationStatus(local, [
      { id: 1, createdAt: 1_700_000_000_000, hash: "hash-init" },
      { id: 2, createdAt: 1_700_000_100_000, hash: "hash-posts" },
    ]);

    expect(buildMigrationStatusJson(status)).toEqual({
      schemaVersion: "np.migrations.v1",
      ok: true,
      migrationsFolder: "./drizzle",
      migrationTable: "drizzle.__drizzle_migrations",
      localCount: 3,
      appliedCount: 2,
      pendingCount: 1,
      driftedCount: 0,
      unknownAppliedCount: 0,
      latestApplied: {
        id: 2,
        createdAt: 1_700_000_100_000,
        hash: "hash-posts",
      },
      pending: [
        {
          index: 2,
          tag: "0002_comments",
          createdAt: 1_700_000_200_000,
          hash: "hash-comments",
        },
      ],
      drifted: [],
      unknownApplied: [],
    });
  });

  it("renders an actionable human status report", () => {
    const status = buildMigrationStatus(local, [
      { id: 1, createdAt: 1_700_000_000_000, hash: "hash-init" },
      { id: 2, createdAt: 1_700_000_100_000, hash: "hash-posts" },
    ]);

    const output = renderMigrationStatus(status);

    expect(output).toContain("NexPress migration status");
    expect(output).toContain("Applied migrations: 2");
    expect(output).toContain("Pending migrations: 1");
    expect(output).toContain("0002_comments");
    expect(output).toContain("Run `pnpm db:migrate` to apply pending migrations.");
  });
});
