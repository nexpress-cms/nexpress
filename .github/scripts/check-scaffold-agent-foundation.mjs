#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , scaffoldDirArg] = process.argv;
const scaffoldDir = resolve(scaffoldDirArg ?? process.cwd());
const requireFromScaffold = createRequire(resolve(scaffoldDir, "package.json"));
const pg = requireFromScaffold("pg");
const agentsEntry = requireFromScaffold.resolve("@nexpress/core/agents");
const {
  npAgentDiagnosticsSchemaInventoryV1,
  npCollectAgentHealthSummaryV1,
  createAgentRuntimeStudioServiceV1,
  getOptionalAgentStudioServerRuntimeV1,
  createAgentRuntimeEventServiceV1,
  createAgentRuntimeJobsV1,
  pruneAgentRuntimeEventsV1,
} = await import(pathToFileURL(agentsEntry).href);
const {
  npAgentRuntimeStudioReadRoutesV1,
  npAgentRuntimeAdminOperationIdsV1,
  npGetAgentAdminOperationV1,
  npRequireAgentRuntimeStudioQueryV1,
  npRequireAgentRuntimeOpsResultV1,
  npRequireAgentTriggerV1,
  npCreateAgentRuntimeJobStateV1,
  npBuildAgentPolicySimulationFixtureInputV1,
  npRequireAgentRuntimeAdminInputV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  npSimulateAgentPolicyV1,
  npRequireAgentPolicySimulationReportV1,
} = await import(pathToFileURL(requireFromScaffold.resolve("@nexpress/core/agent-contract")).href);

const DEFERRED_CONSTRAINTS = [
  "np_agents_active_version_fk",
  "np_agents_draft_version_fk",
  "np_agent_runs_causal_event_fk",
  "np_agent_runs_causal_action_fk",
  "np_agent_changeset_rollback_plans_execution_fk",
  "np_agent_changeset_rollback_plans_approval_fk",
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

for (const factory of [
  createAgentRuntimeStudioServiceV1,
  createAgentRuntimeEventServiceV1,
  createAgentRuntimeJobsV1,
  pruneAgentRuntimeEventsV1,
]) {
  if (typeof factory !== "function") fail("packed Runtime operations exports are unavailable");
}
const trigger = npRequireAgentTriggerV1({ type: "manual", id: randomUUID() });
if (
  trigger.type !== "manual" ||
  Object.values(npCreateAgentRuntimeJobStateV1().cursors).some((value) => value !== null)
) {
  fail("packed Runtime trigger or absent cursor contract diverged");
}

// Shipped wrappers reuse one closed shared inventory and never construct a Runtime.
if (getOptionalAgentStudioServerRuntimeV1() !== null) {
  fail("packed Agent Studio must remain absent without explicit host installation");
}
if (npRequireAgentRuntimeStudioQueryV1("configurations", {}).limit !== 25) {
  fail("packed Runtime Studio default page bound diverged");
}
const studioMutations = npAgentRuntimeAdminOperationIdsV1;
const studioInventory = [
  ...npAgentRuntimeStudioReadRoutesV1,
  ...studioMutations.map((id) => {
    const operation = npGetAgentAdminOperationV1(id);
    return { method: operation.method, path: operation.pathTemplate };
  }),
];
if (
  npAgentRuntimeStudioReadRoutesV1.length !== 9 ||
  studioMutations.length !== 15 ||
  new Set(studioInventory.map(({ method, path }) => `${method} ${path}`)).size !== 24
) {
  fail("packed Runtime Studio route inventory diverged");
}
for (const { method, path } of studioInventory) {
  const route = path.replace(/^\/api\//u, "").replaceAll("{id}", "[id]");
  let source;
  try {
    source = readFileSync(resolve(scaffoldDir, "src/app/api", route, "route.ts"), "utf8");
  } catch {
    fail("fresh scaffold is missing a Runtime Studio route wrapper");
  }
  if (
    !source.includes(`from "@nexpress/app/api/${route}/route"`) ||
    !source.includes('dynamic = "force-dynamic"') ||
    !new RegExp(String.raw`export \{[^}]*\b${method}\b[^}]*\} from`, "u").test(source) ||
    /createAgentRuntime|executeAdmin|new |fetch\(/u.test(source)
  ) {
    fail("fresh scaffold Runtime Studio routes must remain thin shared wrappers");
  }
}
// The packed pure evaluator needs no installed Runtime or provider. The HTTP
// wrapper still uses the absent host boundary checked above.
const fixture = await npBuildAgentPolicySimulationFixtureInputV1();
npRequireAgentRuntimeAdminInputV1("agents.policies.simulate", {
  idempotencyKey: randomUUID(),
  expectedVersion: 1,
  configHash: fixture.fixtureHash,
  ...fixture,
});
const simulation = npRequireAgentPolicySimulationReportV1(
  npSimulateAgentPolicyV1({
    policyId: randomUUID(),
    policyVersion: 1,
    policyHash: fixture.fixtureHash,
    fixtureHash: fixture.fixtureHash,
    layers: [npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules],
  }),
);
if (
  simulation.nonAuthorizing !== true ||
  simulation.cases.length !== 4 ||
  getOptionalAgentStudioServerRuntimeV1() !== null
) {
  fail("packed policy simulation must remain bounded and non-authorizing without a Runtime");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required for scaffold Agent verification");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

function runtimeStatus(siteId, withActor) {
  const env = { ...process.env, NP_FIRST_RUN_NUDGE: "off" };
  if (withActor) {
    env.NP_AGENT_DEPLOYMENT_ACTOR_FINGERPRINT = `cj1:sha256:${Buffer.alloc(32, 8).toString("base64url")}`;
  } else {
    delete env.NP_AGENT_DEPLOYMENT_ACTOR_FINGERPRINT;
  }
  const child = spawnSync(
    "pnpm",
    ["exec", "nexpress", "agent", "runtime", "status", "--site", siteId, "--json"],
    { cwd: scaffoldDir, env, encoding: "utf8", timeout: 30_000, maxBuffer: 32_768 },
  );
  let result;
  try {
    result = npRequireAgentRuntimeOpsResultV1(JSON.parse(child.stdout));
  } catch {
    fail("packed runtime CLI must emit one exact safe JSON result");
  }
  if (
    child.error ||
    child.stderr.trim() ||
    result.operation !== "status" ||
    child.status !== (result.outcome === "blocked" ? 1 : 0)
  ) {
    fail("packed runtime CLI violated the bounded output or exit contract");
  }
  return result;
}

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

  // A migration-only scaffold has no site. Create only a temporary ordinary
  // site fixture to distinguish absent authority/site from disabled runtime.
  const runtimeSiteId = `runtime-smoke-${randomUUID()}`;
  const absentActor = runtimeStatus(runtimeSiteId, false);
  const absentSite = runtimeStatus(runtimeSiteId, true);
  if (
    absentActor.errorCode !== "RUNTIME_AUTHORITY_REQUIRED" ||
    absentSite.errorCode !== "RUNTIME_SITE_UNAVAILABLE"
  ) {
    fail("packed runtime CLI must reject absent deployment authority and sites");
  }
  await client.query("INSERT INTO np_sites (id, name) VALUES ($1, $2)", [
    runtimeSiteId,
    "Packed runtime verification",
  ]);
  try {
    const disabled = runtimeStatus(runtimeSiteId, true);
    if (
      disabled.outcome !== "status" ||
      disabled.status?.siteId !== runtimeSiteId ||
      disabled.status.enabled !== false ||
      disabled.status.paused !== false ||
      disabled.status.revision !== 1 ||
      Object.values(disabled.status.readiness).some((state) => state !== "unavailable")
    ) {
      fail("packed runtime CLI must preserve disabled defaults and absent readiness");
    }
    const seeded = await client.query(
      "SELECT count(*)::int AS count FROM np_settings WHERE site_id = $1",
      [runtimeSiteId],
    );
    if (seeded.rows[0]?.count !== 0) fail("runtime status must not persist site settings");
  } finally {
    await client.query("DELETE FROM np_sites WHERE id = $1", [runtimeSiteId]);
  }

  let agentRows = 0;
  for (const table of expectedTables) {
    // The framework-global coordination singleton carries no Agent authority.
    if (table === "np_agent_reference_fence") continue;
    const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
    agentRows += result.rows[0]?.count ?? 0;
  }
  if (agentRows !== 0) fail("fresh scaffold must not seed Agent authority", { agentRows });
  const fence = await client.query("SELECT id, epoch::text FROM np_agent_reference_fence");
  if (
    fence.rows.length !== 1 ||
    fence.rows[0]?.id !== 1 ||
    !/^\d+$/u.test(fence.rows[0]?.epoch ?? "")
  ) {
    fail("fresh scaffold must contain exactly one valid reference coordination fence");
  }

  const settingResult = await client.query(
    `SELECT key
       FROM np_settings
      WHERE key = ANY($1::text[])
      ORDER BY key`,
    [["agents.gateway", "agents.runtime", "agents.runtime.control", "agents.runtime.jobs"]],
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
    `✓ fresh scaffold Agent foundation: ${expectedTables.length.toString()} tables, ${expectedConstraints.length.toString()} critical constraints, ${DEFERRED_CONSTRAINTS.length.toString()} deferred constraints, runtime CLI authority/site/default checks, 24 Studio route projections, bounded non-authorizing simulation, disabled and healthy`,
  );
} finally {
  await client.end();
}
