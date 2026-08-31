#!/usr/bin/env node

import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , scaffoldDirArg] = process.argv;
const scaffoldDir = resolve(scaffoldDirArg ?? process.cwd());
const requireFromScaffold = createRequire(resolve(scaffoldDir, "package.json"));
const pg = requireFromScaffold("pg");
const agentsEntry = requireFromScaffold.resolve("@nexpress/core/agents");
const { npAgentDiagnosticsSchemaInventoryV1, npCollectAgentHealthSummaryV1 } = await import(
  pathToFileURL(agentsEntry).href
);

const DEFERRED_CONSTRAINTS = [
  "np_agent_connections_active_config_fk",
  "np_agent_connections_active_secret_fk",
  "np_agent_connection_auth_requests_expected_secret_fk",
  "np_agent_connection_auth_requests_pkce_secret_fk",
  "np_agent_connection_auth_requests_code_secret_fk",
  "np_agent_connection_auth_requests_code_vault_operation_fk",
  "np_agent_connection_auth_requests_connection_operation_fk",
  "np_agent_connection_operations_expected_secret_fk",
  "np_agent_connection_secret_versions_seal_operation_fk",
];

function fail(message, detail) {
  console.error(`::error::${message}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  process.exitCode = 1;
  throw new Error(message);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required for scaffold Agent verification");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const expectedTables = [...npAgentDiagnosticsSchemaInventoryV1.tables];
  const tableResult = await client.query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY tablename`,
    [expectedTables],
  );
  const actualTables = tableResult.rows.map((row) => row.tablename);
  if (JSON.stringify(actualTables) !== JSON.stringify([...expectedTables].sort())) {
    fail(
      `fresh scaffold does not contain the exact ${expectedTables.length.toString()}-table Agent inventory`,
      actualTables,
    );
  }

  const expectedConstraints = [...npAgentDiagnosticsSchemaInventoryV1.constraints].sort();
  const criticalConstraintResult = await client.query(
    `SELECT conname
       FROM pg_constraint
      WHERE conname = ANY($1::text[])
      ORDER BY conname`,
    [expectedConstraints],
  );
  const actualConstraints = criticalConstraintResult.rows.map((row) => row.conname);
  if (JSON.stringify(actualConstraints) !== JSON.stringify(expectedConstraints)) {
    fail("fresh scaffold is missing critical Agent constraints", actualConstraints);
  }

  const constraintResult = await client.query(
    `SELECT c.conname, c.condeferrable, c.condeferred, c.confdeltype
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.contype = 'f'
        AND c.conname = ANY($1::text[])
      ORDER BY c.conname`,
    [DEFERRED_CONSTRAINTS],
  );
  if (constraintResult.rows.length !== DEFERRED_CONSTRAINTS.length) {
    fail(
      "fresh scaffold is missing reviewed Agent deferred lifecycle constraints",
      constraintResult.rows,
    );
  }
  for (const row of constraintResult.rows) {
    if (row.condeferrable !== true || row.condeferred !== true || row.confdeltype !== "a") {
      fail("Agent lifecycle constraint lost NO ACTION / deferred semantics", row);
    }
  }

  let agentRows = 0;
  for (const table of expectedTables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
    agentRows += result.rows[0]?.count ?? 0;
  }
  if (agentRows !== 0) fail("fresh scaffold must not seed Agent authority", { agentRows });

  const settingResult = await client.query(
    `SELECT key
       FROM np_settings
      WHERE key = ANY($1::text[])
      ORDER BY key`,
    [["agents.gateway", "agents.runtime"]],
  );
  if (settingResult.rows.length !== 0) {
    fail("fresh scaffold must not seed Agent Gateway or runtime settings", settingResult.rows);
  }

  const health = await npCollectAgentHealthSummaryV1({ client });
  if (
    health.state !== "ok" ||
    health.issueCount !== 0 ||
    health.readiness.providers.state !== "not-required" ||
    health.readiness.vault.state !== "not-required"
  ) {
    fail("fresh disabled Agent diagnostics must be healthy and not-required", health);
  }

  console.log(
    `✓ fresh scaffold Agent foundation: ${expectedTables.length.toString()} tables, ${expectedConstraints.length.toString()} critical constraints, ${DEFERRED_CONSTRAINTS.length.toString()} deferred constraints, disabled and healthy`,
  );
} finally {
  await client.end();
}
