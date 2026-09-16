import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  NP_AGENT_REFERENCE_FENCE_SQL_V1,
  NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1,
  npAgentReferenceFenceTriggersSqlV1,
  npAgentSiteOwnedTableNamesV1,
} from "@nexpress/core/agents";

const marker = "-- NexPress verified source reference lifecycle v1";
export function npAgentReferenceMigrationSqlV1(): string {
  return (
    marker +
    "\n" +
    [
      "INSERT INTO public.np_agent_reference_fence (id, epoch) VALUES (1, 0);",
      NP_AGENT_REFERENCE_FENCE_SQL_V1,
      ...[...npAgentSiteOwnedTableNamesV1, "np_agent_site_deletion_sagas", "np_audit_events"].map(
        npAgentReferenceFenceTriggersSqlV1,
      ),
      NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1,
    ].join("\n--> statement-breakpoint\n") +
    "\n"
  );
}

/** Generated custom SQL from the same inventory used by guards and Doctor. */
export async function npEnsureAgentReferenceMigrationV1(options: {
  migrationsFolder?: string;
  createCustomMigration: () => Promise<void>;
}): Promise<void> {
  const folder = resolve(options.migrationsFolder ?? "./drizzle");
  const files = (await readdir(folder)).filter((f) => f.endsWith(".sql")).sort();
  const texts = await Promise.all(files.map((f) => readFile(join(folder, f), "utf8")));
  const chain = texts.join("\n");
  const tables = [
    "np_agent_source_releases",
    "np_agent_source_release_edges",
    "np_agent_reference_fence",
  ];
  if (!tables.some((t) => chain.includes(`CREATE TABLE "${t}"`))) return;
  if (!tables.every((t) => chain.includes(`CREATE TABLE "${t}"`)))
    throw new Error("Agent reference migration inventory is incomplete.");
  const expected = npAgentReferenceMigrationSqlV1();
  const existing = texts.filter((t) => t.includes(marker));
  if (existing.length) {
    if (existing.length !== 1 || existing[0] !== expected)
      throw new Error("Agent reference migration differs from its reviewed source.");
    return;
  }
  await options.createCustomMigration();
  const added = (await readdir(folder)).filter((f) => f.endsWith(".sql") && !files.includes(f));
  if (added.length !== 1) throw new Error("Expected one generated Agent reference migration.");
  await writeFile(join(folder, added[0]), expected, "utf8");
}
