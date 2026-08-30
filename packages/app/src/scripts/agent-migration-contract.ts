import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const npAgentR1TableNamesV1 = Object.freeze([
  "np_agent_connection_auth_requests",
  "np_agent_connection_config_versions",
  "np_agent_connection_operations",
  "np_agent_connection_secret_versions",
  "np_agent_connections",
  "np_agent_invocations",
  "np_agent_oauth_clients",
  "np_agent_oauth_codes",
  "np_agent_oauth_grants",
  "np_agent_oauth_refresh_tokens",
  "np_agent_oauth_requests",
  "np_agent_principals",
  "np_agent_service_tokens",
  "np_agent_site_deletion_sagas",
  "np_agent_vault_entries",
  "np_agent_vault_operations",
] as const);

export const npAgentR1DeferredLifecycleConstraintNamesV1 = Object.freeze([
  "np_agent_connections_active_config_fk",
  "np_agent_connections_active_secret_fk",
  "np_agent_connection_auth_requests_expected_secret_fk",
  "np_agent_connection_auth_requests_pkce_secret_fk",
  "np_agent_connection_auth_requests_code_secret_fk",
  "np_agent_connection_auth_requests_code_vault_operation_fk",
  "np_agent_connection_auth_requests_connection_operation_fk",
  "np_agent_connection_operations_expected_secret_fk",
  "np_agent_connection_secret_versions_seal_operation_fk",
] as const);

const STATEMENT_BREAK = "--> statement-breakpoint";

const DEFERRED_LIFECYCLE_STATEMENTS = [
  'ALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_active_config_fk" FOREIGN KEY ("site_id","active_config_snapshot_id") REFERENCES "public"."np_agent_connection_config_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_active_secret_fk" FOREIGN KEY ("site_id","active_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_expected_secret_fk" FOREIGN KEY ("site_id","expected_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_pkce_secret_fk" FOREIGN KEY ("site_id","pkce_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_code_secret_fk" FOREIGN KEY ("site_id","code_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_code_vault_operation_fk" FOREIGN KEY ("site_id","code_vault_operation_id") REFERENCES "public"."np_agent_vault_operations"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_connection_operation_fk" FOREIGN KEY ("site_id","connection_operation_id") REFERENCES "public"."np_agent_connection_operations"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_expected_secret_fk" FOREIGN KEY ("site_id","expected_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_seal_operation_fk" FOREIGN KEY ("site_id","seal_operation_id") REFERENCES "public"."np_agent_vault_operations"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
] as const;

/**
 * Drizzle cannot emit these circular lifecycle references from the table graph.
 * Keep this reviewed SQL byte-stable and place it in a dedicated custom
 * migration so an existing migration's recorded hash is never rewritten.
 */
export const npAgentR1DeferredLifecycleConstraintsSqlV1 = `${DEFERRED_LIFECYCLE_STATEMENTS.join(`\n${STATEMENT_BREAK}\n`)}\n`;

export interface NpAgentMigrationInspectionV1 {
  missingTables: string[];
  presentDeferredConstraints: string[];
  missingDeferredConstraints: string[];
  mismatchedDeferredConstraints: string[];
}

export interface NpEnsureAgentLifecycleMigrationOptionsV1 {
  migrationsFolder?: string;
  createCustomMigration: () => Promise<void>;
}

export interface NpEnsureAgentLifecycleMigrationResultV1 {
  state: "already-complete" | "created";
  migrationFile: string | null;
}

export function npInspectAgentMigrationSqlV1(sql: string): NpAgentMigrationInspectionV1 {
  const missingTables = npAgentR1TableNamesV1.filter(
    (table) => !sql.includes(`CREATE TABLE "${table}"`),
  );
  const presentDeferredConstraints = npAgentR1DeferredLifecycleConstraintNamesV1.filter(
    (_constraint, index) => sql.includes(DEFERRED_LIFECYCLE_STATEMENTS[index] ?? "\0"),
  );
  const present = new Set(presentDeferredConstraints);
  const mismatchedDeferredConstraints = npAgentR1DeferredLifecycleConstraintNamesV1.filter(
    (constraint, index) =>
      sql.includes(`CONSTRAINT "${constraint}"`) &&
      !sql.includes(DEFERRED_LIFECYCLE_STATEMENTS[index] ?? "\0"),
  );
  return {
    missingTables: [...missingTables],
    presentDeferredConstraints: [...presentDeferredConstraints],
    missingDeferredConstraints: npAgentR1DeferredLifecycleConstraintNamesV1.filter(
      (constraint) => !present.has(constraint),
    ),
    mismatchedDeferredConstraints: [...mismatchedDeferredConstraints],
  };
}

async function sqlFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function readMigrationChain(folder: string, files: readonly string[]): Promise<string> {
  return (await Promise.all(files.map((file) => readFile(join(folder, file), "utf8")))).join("\n");
}

function assertReadyForLifecycleCompletion(inspection: NpAgentMigrationInspectionV1): void {
  if (inspection.missingTables.length > 0) {
    throw new Error(
      `Agent migration inventory is incomplete: missing ${inspection.missingTables.length.toString()} of ${npAgentR1TableNamesV1.length.toString()} required tables.`,
    );
  }
  if (inspection.mismatchedDeferredConstraints.length > 0) {
    throw new Error(
      `Agent deferred lifecycle constraints do not match the reviewed SQL: ${inspection.mismatchedDeferredConstraints.length.toString()} mismatched. Review the migration chain before continuing.`,
    );
  }
  if (
    inspection.presentDeferredConstraints.length > 0 &&
    inspection.missingDeferredConstraints.length > 0
  ) {
    throw new Error(
      `Agent deferred lifecycle constraint inventory is partial: found ${inspection.presentDeferredConstraints.length.toString()} of ${npAgentR1DeferredLifecycleConstraintNamesV1.length.toString()}. Review the migration chain before continuing.`,
    );
  }
}

export async function npEnsureAgentLifecycleConstraintMigrationV1(
  options: NpEnsureAgentLifecycleMigrationOptionsV1,
): Promise<NpEnsureAgentLifecycleMigrationResultV1> {
  const folder = resolve(options.migrationsFolder ?? "./drizzle");
  const beforeFiles = await sqlFiles(folder);
  const beforeInspection = npInspectAgentMigrationSqlV1(
    await readMigrationChain(folder, beforeFiles),
  );
  assertReadyForLifecycleCompletion(beforeInspection);

  if (beforeInspection.missingDeferredConstraints.length === 0) {
    return { state: "already-complete", migrationFile: null };
  }

  await options.createCustomMigration();
  const afterFiles = await sqlFiles(folder);
  const previous = new Set(beforeFiles);
  const createdFiles = afterFiles.filter((file) => !previous.has(file));
  if (createdFiles.length !== 1) {
    throw new Error(
      `Expected one new custom Agent migration, but found ${createdFiles.length.toString()}.`,
    );
  }

  const migrationFile = createdFiles[0];
  if (!migrationFile) throw new Error("Custom Agent migration filename is unavailable.");
  await writeFile(join(folder, migrationFile), npAgentR1DeferredLifecycleConstraintsSqlV1, "utf8");

  const completed = npInspectAgentMigrationSqlV1(
    await readMigrationChain(folder, await sqlFiles(folder)),
  );
  assertReadyForLifecycleCompletion(completed);
  if (completed.missingDeferredConstraints.length > 0) {
    throw new Error(
      "Agent deferred lifecycle constraint migration did not complete the inventory.",
    );
  }
  return { state: "created", migrationFile };
}
