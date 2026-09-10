import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  npAgentR1DeferredLifecycleConstraintNamesV1,
  npAgentR1DeferredLifecycleConstraintsSqlV1,
  npAgentR1TableNamesV1,
  npAgentRollbackTableNamesV1,
  npAgentRollbackDeferredLifecycleConstraintsSqlV1,
  npEnsureAgentLifecycleConstraintMigrationV1,
  npInspectAgentMigrationSqlV1,
} from "./agent-migration-contract.js";

const tempFolders: string[] = [];

async function tempMigrationFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nexpress-agent-migration-"));
  tempFolders.push(root);
  const folder = join(root, "drizzle");
  await mkdir(folder);
  return folder;
}

function tableSql(): string {
  return npAgentR1TableNamesV1.map((table) => `CREATE TABLE "${table}" ();`).join("\n");
}

afterEach(async () => {
  await Promise.all(tempFolders.splice(0).map((folder) => rm(folder, { recursive: true })));
});

describe("Agent migration contract", () => {
  it("keeps the reviewed custom SQL exact and complete", () => {
    const inspection = npInspectAgentMigrationSqlV1(
      `${tableSql()}\n${npAgentR1DeferredLifecycleConstraintsSqlV1}`,
    );
    expect(inspection).toEqual({
      missingTables: [],
      presentDeferredConstraints: [...npAgentR1DeferredLifecycleConstraintNamesV1],
      missingDeferredConstraints: [],
      mismatchedDeferredConstraints: [],
    });
    expect(
      npAgentR1DeferredLifecycleConstraintsSqlV1.match(/DEFERRABLE INITIALLY DEFERRED/gu),
    ).toHaveLength(9);
    expect(npAgentR1DeferredLifecycleConstraintsSqlV1.match(/ON DELETE no action/gu)).toHaveLength(
      9,
    );
  });

  it("creates one dedicated migration and becomes an idempotent no-op", async () => {
    const folder = await tempMigrationFolder();
    await writeFile(join(folder, "0000_agent_tables.sql"), tableSql());
    let createCalls = 0;
    const createCustomMigration = async (): Promise<void> => {
      createCalls += 1;
      await writeFile(join(folder, "0001_agent-r1-lifecycle-constraints.sql"), "-- custom\n");
    };

    await expect(
      npEnsureAgentLifecycleConstraintMigrationV1({
        migrationsFolder: folder,
        createCustomMigration,
      }),
    ).resolves.toEqual({
      state: "created",
      migrationFile: "0001_agent-r1-lifecycle-constraints.sql",
    });
    expect(await readFile(join(folder, "0001_agent-r1-lifecycle-constraints.sql"), "utf8")).toBe(
      npAgentR1DeferredLifecycleConstraintsSqlV1,
    );

    await expect(
      npEnsureAgentLifecycleConstraintMigrationV1({
        migrationsFolder: folder,
        createCustomMigration,
      }),
    ).resolves.toEqual({ state: "already-complete", migrationFile: null });
    expect(createCalls).toBe(1);
  });

  it("fails closed for missing tables or a partial deferred inventory", async () => {
    const missingTables = await tempMigrationFolder();
    await writeFile(join(missingTables, "0000_empty.sql"), "-- empty\n");
    await expect(
      npEnsureAgentLifecycleConstraintMigrationV1({
        migrationsFolder: missingTables,
        createCustomMigration: async () => {},
      }),
    ).rejects.toThrow(/missing 16 of 16 required tables/u);

    const partial = await tempMigrationFolder();
    await writeFile(
      join(partial, "0000_partial.sql"),
      `${tableSql()}\nALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_active_config_fk" CHECK (true);`,
    );
    await expect(
      npEnsureAgentLifecycleConstraintMigrationV1({
        migrationsFolder: partial,
        createCustomMigration: async () => {},
      }),
    ).rejects.toThrow(/do not match the reviewed SQL: 1 mismatched/u);
  });

  it("refuses an ambiguous custom generator result", async () => {
    const folder = await tempMigrationFolder();
    await writeFile(join(folder, "0000_agent_tables.sql"), tableSql());

    await expect(
      npEnsureAgentLifecycleConstraintMigrationV1({
        migrationsFolder: folder,
        createCustomMigration: async () => {},
      }),
    ).rejects.toThrow(/Expected one new custom Agent migration, but found 0/u);
  });
});

describe("rollback deferred lifecycle migrations", () => {
  it("adds exactly two reviewed constraints and preserves prior SQL", async () => {
    const folder = await tempMigrationFolder();
    const base = npAgentRollbackTableNamesV1.map((name) => `CREATE TABLE "${name}" ();`).join("\n");
    await writeFile(join(folder, "0043_schema.sql"), base);
    const createCustomMigration = async () => {
      await writeFile(join(folder, "0044_rollback.sql"), "-- generated custom");
    };
    expect(
      await npEnsureAgentLifecycleConstraintMigrationV1({
        inventory: "rollback",
        migrationsFolder: folder,
        createCustomMigration,
      }),
    ).toMatchObject({ state: "created" });
    expect(await readFile(join(folder, "0043_schema.sql"), "utf8")).toBe(base);
    expect(await readFile(join(folder, "0044_rollback.sql"), "utf8")).toBe(
      npAgentRollbackDeferredLifecycleConstraintsSqlV1,
    );
    expect(
      npAgentRollbackDeferredLifecycleConstraintsSqlV1.match(/DEFERRABLE INITIALLY DEFERRED/gu),
    ).toHaveLength(2);
    expect(
      await npEnsureAgentLifecycleConstraintMigrationV1({
        inventory: "rollback",
        migrationsFolder: folder,
        createCustomMigration: () => Promise.reject(new Error("no rewrite")),
      }),
    ).toMatchObject({ state: "already-complete" });
  });
  it("leaves old projects unchanged but rejects partial rollback table chains", async () => {
    const folder = await tempMigrationFolder();
    const options = {
      inventory: "rollback" as const,
      migrationsFolder: folder,
      createCustomMigration: () => Promise.reject(new Error("must not generate")),
    };
    expect(await npEnsureAgentLifecycleConstraintMigrationV1(options)).toMatchObject({
      state: "already-complete",
    });
    await writeFile(
      join(folder, "0043_partial.sql"),
      'CREATE TABLE "np_agent_changeset_rollback_plans" ();',
    );
    await expect(npEnsureAgentLifecycleConstraintMigrationV1(options)).rejects.toThrow(
      "missing 3 of 4",
    );
  });
});
