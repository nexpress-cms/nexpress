import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  npAgentReferenceMigrationSqlV1,
  npEnsureAgentReferenceMigrationV1,
} from "./agent-reference-migration.js";
const directories: string[] = [];
async function folder() {
  const path = await mkdtemp(join(tmpdir(), "np-reference-migration-"));
  directories.push(path);
  return path;
}
const tables = [
  "np_agent_source_releases",
  "np_agent_source_release_edges",
  "np_agent_reference_fence",
];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("leaves pre-expansion migration chains unchanged", async () => {
  const migrationsFolder = await folder(),
    createCustomMigration = vi.fn();
  await npEnsureAgentReferenceMigrationV1({ migrationsFolder, createCustomMigration });
  expect(createCustomMigration).not.toHaveBeenCalled();
});
it("rejects partial source-release schema inventory", async () => {
  const migrationsFolder = await folder();
  await writeFile(join(migrationsFolder, "0000.sql"), `CREATE TABLE "${tables[0]}" ();`);
  await expect(
    npEnsureAgentReferenceMigrationV1({ migrationsFolder, createCustomMigration: vi.fn() }),
  ).rejects.toThrow("incomplete");
});
it("generates one exact reviewed lifecycle migration, replays and rejects tampering", async () => {
  const migrationsFolder = await folder();
  await writeFile(
    join(migrationsFolder, "0000.sql"),
    tables.map((t) => `CREATE TABLE "${t}" ();`).join("\n"),
  );
  const createCustomMigration = vi.fn(async () => {
    await writeFile(join(migrationsFolder, "0001.sql"), "-- generated custom shell\n");
  });
  const options = { migrationsFolder, createCustomMigration };
  await npEnsureAgentReferenceMigrationV1(options);
  expect(await readFile(join(migrationsFolder, "0001.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV1(),
  );
  await npEnsureAgentReferenceMigrationV1(options);
  expect(createCustomMigration).toHaveBeenCalledTimes(1);
  await writeFile(
    join(migrationsFolder, "0001.sql"),
    npAgentReferenceMigrationSqlV1().replace("FOR SHARE", "FOR KEY SHARE"),
  );
  await expect(npEnsureAgentReferenceMigrationV1(options)).rejects.toThrow("differs");
});
