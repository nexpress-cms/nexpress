import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  npAgentReferenceMigrationSqlV1,
  npEnsureAgentReferenceMigrationV1,
  npEnsureAgentReferenceMigrationV2,
  npAgentReferenceMigrationSqlV2,
  npEnsureAgentReferenceMigrationV3,
  npAgentReferenceMigrationSqlV3,
  npEnsureAgentReferenceMigrationV4,
  npAgentReferenceMigrationSqlV4,
  npEnsureAgentReferenceMigrationV5,
  npAgentReferenceMigrationSqlV5,
  npAgentReferenceMigrationSqlV6,
  npEnsureAgentReferenceMigrationV6,
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

it("appends the Studio guard upgrade without rewriting the original migration", async () => {
  const migrationsFolder = await folder();
  const original = npAgentReferenceMigrationSqlV1();
  await writeFile(join(migrationsFolder, "0001.sql"), original);
  const createCustomMigration = vi.fn(async () => {
    await writeFile(join(migrationsFolder, "0002.sql"), "-- generated shell\n");
  });
  const options = { migrationsFolder, createCustomMigration };
  await npEnsureAgentReferenceMigrationV2(options);
  expect(await readFile(join(migrationsFolder, "0001.sql"), "utf8")).toBe(original);
  expect(await readFile(join(migrationsFolder, "0002.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV2(),
  );
  await npEnsureAgentReferenceMigrationV2(options);
  expect(createCustomMigration).toHaveBeenCalledTimes(1);
  await writeFile(
    join(migrationsFolder, "0002.sql"),
    npAgentReferenceMigrationSqlV2().replace("FOR SHARE", "FOR KEY SHARE"),
  );
  await expect(npEnsureAgentReferenceMigrationV2(options)).rejects.toThrow("differs");
});

it("preserves the already shipped reference migration bytes", async () => {
  const shipped = await readFile(
    new URL(
      "../../../../apps/web/drizzle/0050_agent-source-reference-lifecycle.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(npAgentReferenceMigrationSqlV1()).toBe(shipped);
});

it("appends cancelled ChangeSet guards while preserving both installed generations", async () => {
  const migrationsFolder = await folder();
  await writeFile(join(migrationsFolder, "0001.sql"), npAgentReferenceMigrationSqlV1());
  await writeFile(join(migrationsFolder, "0002.sql"), npAgentReferenceMigrationSqlV2());
  const createCustomMigration = vi.fn(async () => {
    await writeFile(join(migrationsFolder, "0003.sql"), "-- generated shell\n");
  });
  const options = { migrationsFolder, createCustomMigration };
  await npEnsureAgentReferenceMigrationV3(options);
  expect(await readFile(join(migrationsFolder, "0001.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV1(),
  );
  expect(await readFile(join(migrationsFolder, "0002.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV2(),
  );
  expect(await readFile(join(migrationsFolder, "0003.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV3(),
  );
  await npEnsureAgentReferenceMigrationV3(options);
  expect(createCustomMigration).toHaveBeenCalledTimes(1);
  await writeFile(
    join(migrationsFolder, "0003.sql"),
    npAgentReferenceMigrationSqlV3().replace("FOR SHARE", "FOR KEY SHARE"),
  );
  await expect(npEnsureAgentReferenceMigrationV3(options)).rejects.toThrow("differs");
});

it("preserves the shipped Studio reference migration bytes", async () => {
  const shipped = await readFile(
    new URL(
      "../../../../apps/web/drizzle/0053_agent-studio-source-reference-lifecycle.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(npAgentReferenceMigrationSqlV2()).toBe(shipped);
});

it("preserves the shipped cancelled ChangeSet reference migration bytes", async () => {
  const shipped = await readFile(
    new URL(
      "../../../../apps/web/drizzle/0055_agent-cancelled-changeset-source-reference-lifecycle.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(npAgentReferenceMigrationSqlV3()).toBe(shipped);
});

it("appends validated evidence guards while preserving all installed generations", async () => {
  const migrationsFolder = await folder();
  const previous = [
    npAgentReferenceMigrationSqlV1(),
    npAgentReferenceMigrationSqlV2(),
    npAgentReferenceMigrationSqlV3(),
  ];
  for (const [index, body] of previous.entries())
    await writeFile(join(migrationsFolder, `000${index + 1}.sql`), body);
  const createCustomMigration = vi.fn(async () => {
    await writeFile(join(migrationsFolder, "0004.sql"), "-- generated shell\n");
  });
  const options = { migrationsFolder, createCustomMigration };
  await npEnsureAgentReferenceMigrationV4(options);
  for (const [index, body] of previous.entries())
    expect(await readFile(join(migrationsFolder, `000${index + 1}.sql`), "utf8")).toBe(body);
  expect(await readFile(join(migrationsFolder, "0004.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV4(),
  );
  await npEnsureAgentReferenceMigrationV4(options);
  expect(createCustomMigration).toHaveBeenCalledTimes(1);
  await writeFile(
    join(migrationsFolder, "0004.sql"),
    npAgentReferenceMigrationSqlV4().replace("FOR SHARE", "FOR KEY SHARE"),
  );
  await expect(npEnsureAgentReferenceMigrationV4(options)).rejects.toThrow("differs");
});

it("appends closed approval evidence guards while preserving all installed generations", async () => {
  const migrationsFolder = await folder();
  const previous = [
    npAgentReferenceMigrationSqlV1(),
    npAgentReferenceMigrationSqlV2(),
    npAgentReferenceMigrationSqlV3(),
    npAgentReferenceMigrationSqlV4(),
  ];
  for (const [index, body] of previous.entries())
    await writeFile(join(migrationsFolder, `000${index + 1}.sql`), body);
  const createCustomMigration = vi.fn(async () => {
    await writeFile(join(migrationsFolder, "0005.sql"), "-- generated shell\n");
  });
  const options = { migrationsFolder, createCustomMigration };
  await npEnsureAgentReferenceMigrationV5(options);
  for (const [index, body] of previous.entries())
    expect(await readFile(join(migrationsFolder, `000${index + 1}.sql`), "utf8")).toBe(body);
  expect(await readFile(join(migrationsFolder, "0005.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV5(),
  );
  await npEnsureAgentReferenceMigrationV5(options);
  expect(createCustomMigration).toHaveBeenCalledTimes(1);
  await writeFile(
    join(migrationsFolder, "0005.sql"),
    npAgentReferenceMigrationSqlV5().replace("FOR SHARE", "FOR KEY SHARE"),
  );
  await expect(npEnsureAgentReferenceMigrationV5(options)).rejects.toThrow("differs");
});

it("preserves the shipped validated ChangeSet reference migration bytes", async () => {
  const shipped = await readFile(
    new URL(
      "../../../../apps/web/drizzle/0057_agent-validated-changeset-source-reference-lifecycle.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(npAgentReferenceMigrationSqlV4()).toBe(shipped);
});

it("preserves V1 bytes and appends Incident trigger coverage only after complete tables", async () => {
  expect(npAgentReferenceMigrationSqlV1()).toBe(
    await readFile(
      new URL(
        "../../../../apps/web/drizzle/0050_agent-source-reference-lifecycle.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const migrationsFolder = await folder();
  const createCustomMigration = vi.fn(async () => {
    await writeFile(join(migrationsFolder, "0002.sql"), "-- generated shell\n");
  });
  const options = { migrationsFolder, createCustomMigration };
  await npEnsureAgentReferenceMigrationV6(options);
  expect(createCustomMigration).not.toHaveBeenCalled();
  await writeFile(join(migrationsFolder, "0000.sql"), npAgentReferenceMigrationSqlV1());
  await writeFile(join(migrationsFolder, "0001.sql"), 'CREATE TABLE "np_agent_signals" ();');
  await expect(npEnsureAgentReferenceMigrationV6(options)).rejects.toThrow("incomplete");
  await writeFile(
    join(migrationsFolder, "0001.sql"),
    [
      "np_agent_feedback",
      "np_agent_incident_signals",
      "np_agent_incident_timeline",
      "np_agent_incidents",
      "np_agent_notifications",
      "np_agent_signals",
    ]
      .map((table) => `CREATE TABLE "${table}" ();`)
      .join("\n"),
  );
  await npEnsureAgentReferenceMigrationV6(options);
  expect(await readFile(join(migrationsFolder, "0002.sql"), "utf8")).toBe(
    npAgentReferenceMigrationSqlV6(),
  );
  await npEnsureAgentReferenceMigrationV6(options);
  expect(createCustomMigration).toHaveBeenCalledTimes(1);
  await writeFile(
    join(migrationsFolder, "0002.sql"),
    npAgentReferenceMigrationSqlV6() + "-- tampered",
  );
  await expect(npEnsureAgentReferenceMigrationV6(options)).rejects.toThrow("differs");
});
