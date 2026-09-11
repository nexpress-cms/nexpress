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

export const npAgentRollbackTableNamesV1 = Object.freeze([
  "np_agent_changeset_rollback_plans",
  "np_agent_changeset_rollback_operations",
  "np_agent_changeset_executions",
  "np_agent_approvals",
] as const);
export const npAgentRollbackDeferredLifecycleConstraintNamesV1 = Object.freeze([
  "np_agent_changeset_rollback_plans_execution_fk",
  "np_agent_changeset_rollback_plans_approval_fk",
] as const);
const ROLLBACK_STATEMENTS = [
  'ALTER TABLE "np_agent_changeset_rollback_plans" ADD CONSTRAINT "np_agent_changeset_rollback_plans_execution_fk" FOREIGN KEY ("site_id","compensates_execution_id") REFERENCES "public"."np_agent_changeset_executions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_changeset_rollback_plans" ADD CONSTRAINT "np_agent_changeset_rollback_plans_approval_fk" FOREIGN KEY ("site_id","approval_id") REFERENCES "public"."np_agent_approvals"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
] as const;
export const npAgentRollbackDeferredLifecycleConstraintsSqlV1 = `${ROLLBACK_STATEMENTS.join(`\n${STATEMENT_BREAK}\n`)}\n`;
export const npAgentRuntimeTableNamesV1 = Object.freeze([
  "np_agents",
  "np_agent_versions",
  "np_agent_policies",
  "np_agent_triggers",
  "np_agent_provider_calls",
  "np_agent_usage_reservations",
  "np_agent_usage_daily",
  "np_agent_circuit_breakers",
  "np_agent_runs",
  "np_agent_events",
  "np_agent_actions",
] as const);
export const npAgentRuntimeDeferredLifecycleConstraintNamesV1 = Object.freeze([
  "np_agents_active_version_fk",
  "np_agents_draft_version_fk",
  "np_agent_runs_causal_event_fk",
  "np_agent_runs_causal_action_fk",
] as const);
const RUNTIME_STATEMENTS = [
  'ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_active_version_fk" FOREIGN KEY ("site_id","id","active_version_id") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_draft_version_fk" FOREIGN KEY ("site_id","id","draft_version_id") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_causal_event_fk" FOREIGN KEY ("site_id","causal_event_id") REFERENCES "public"."np_agent_events"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
  'ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_causal_action_fk" FOREIGN KEY ("site_id","causal_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;',
] as const;
export const npAgentRuntimeDeferredLifecycleConstraintsSqlV1 = `${RUNTIME_STATEMENTS.join(`\n${STATEMENT_BREAK}\n`)}\n`;
type Inventory = "r1" | "rollback" | "runtime";
function inventoryDefinition(inventory: Inventory) {
  if (inventory === "runtime")
    return {
      tables: npAgentRuntimeTableNamesV1,
      names: npAgentRuntimeDeferredLifecycleConstraintNamesV1,
      statements: RUNTIME_STATEMENTS,
      sql: npAgentRuntimeDeferredLifecycleConstraintsSqlV1,
    };
  return inventory === "r1"
    ? {
        tables: npAgentR1TableNamesV1,
        names: npAgentR1DeferredLifecycleConstraintNamesV1,
        statements: DEFERRED_LIFECYCLE_STATEMENTS,
        sql: npAgentR1DeferredLifecycleConstraintsSqlV1,
      }
    : {
        tables: npAgentRollbackTableNamesV1,
        names: npAgentRollbackDeferredLifecycleConstraintNamesV1,
        statements: ROLLBACK_STATEMENTS,
        sql: npAgentRollbackDeferredLifecycleConstraintsSqlV1,
      };
}

export interface NpAgentMigrationInspectionV1 {
  missingTables: string[];
  presentDeferredConstraints: string[];
  missingDeferredConstraints: string[];
  mismatchedDeferredConstraints: string[];
}

export interface NpEnsureAgentLifecycleMigrationOptionsV1 {
  migrationsFolder?: string;
  inventory?: Inventory;
  createCustomMigration: () => Promise<void>;
}

export interface NpEnsureAgentLifecycleMigrationResultV1 {
  state: "already-complete" | "created";
  migrationFile: string | null;
}

export function npInspectAgentMigrationSqlV1(
  sql: string,
  inventory: Inventory = "r1",
): NpAgentMigrationInspectionV1 {
  const definition = inventoryDefinition(inventory);
  const missingTables = definition.tables.filter(
    (table) => !sql.includes(`CREATE TABLE "${table}"`),
  );
  const presentDeferredConstraints = definition.names.filter((_constraint, index) =>
    sql.includes(definition.statements[index] ?? "\0"),
  );
  const present = new Set<string>(presentDeferredConstraints);
  const mismatchedDeferredConstraints = definition.names.filter(
    (constraint, index) =>
      sql.includes(`CONSTRAINT "${constraint}"`) &&
      !sql.includes(definition.statements[index] ?? "\0"),
  );
  return {
    missingTables: [...missingTables],
    presentDeferredConstraints: [...presentDeferredConstraints],
    missingDeferredConstraints: definition.names.filter((constraint) => !present.has(constraint)),
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

function assertReadyForLifecycleCompletion(
  inspection: NpAgentMigrationInspectionV1,
  inventory: Inventory,
): void {
  const definition = inventoryDefinition(inventory);
  if (inspection.missingTables.length > 0) {
    throw new Error(
      `Agent migration inventory is incomplete: missing ${inspection.missingTables.length.toString()} of ${definition.tables.length.toString()} required tables.`,
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
      `Agent deferred lifecycle constraint inventory is partial: found ${inspection.presentDeferredConstraints.length.toString()} of ${definition.names.length.toString()}. Review the migration chain before continuing.`,
    );
  }
}

export async function npEnsureAgentLifecycleConstraintMigrationV1(
  options: NpEnsureAgentLifecycleMigrationOptionsV1,
): Promise<NpEnsureAgentLifecycleMigrationResultV1> {
  const inventory = options.inventory ?? "r1";
  const definition = inventoryDefinition(inventory);
  const folder = resolve(options.migrationsFolder ?? "./drizzle");
  const beforeFiles = await sqlFiles(folder);
  const chain = await readMigrationChain(folder, beforeFiles);
  if (
    inventory === "runtime" &&
    !npAgentRuntimeTableNamesV1
      .filter((table) => table !== "np_agent_runs" && table !== "np_agent_actions")
      .some((table) => chain.includes(`CREATE TABLE "${table}"`))
  )
    return { state: "already-complete", migrationFile: null };
  if (
    inventory === "rollback" &&
    !["np_agent_changeset_rollback_plans", "np_agent_changeset_rollback_operations"].some((table) =>
      chain.includes(`CREATE TABLE "${table}"`),
    )
  ) {
    return { state: "already-complete", migrationFile: null };
  }
  const beforeInspection = npInspectAgentMigrationSqlV1(chain, inventory);
  assertReadyForLifecycleCompletion(beforeInspection, inventory);

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
  await writeFile(join(folder, migrationFile), definition.sql, "utf8");

  const completed = npInspectAgentMigrationSqlV1(
    await readMigrationChain(folder, await sqlFiles(folder)),
    inventory,
  );
  assertReadyForLifecycleCompletion(completed, inventory);
  if (completed.missingDeferredConstraints.length > 0) {
    throw new Error(
      "Agent deferred lifecycle constraint migration did not complete the inventory.",
    );
  }
  return { state: "created", migrationFile };
}
