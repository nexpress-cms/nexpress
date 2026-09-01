import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  NpValidationError,
  createSite,
  deleteSite,
  getSiteById,
  npAgentConnectionConfigVersions,
  npAgentConnections,
  npAgentPrincipals,
  npAgentServiceTokens,
  npAgentSiteDeletionSagas,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import {
  npBuildAgentSiteDeletionRowIdentityDigest,
  npInspectAgentSiteDeletionRows,
} from "../../../packages/core/src/agent/site-deletion.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./harness.js";

const PRINCIPAL_A = "00000000-0000-4000-8000-000000000101";
const PRINCIPAL_B = "00000000-0000-4000-8000-000000000102";

function principal(siteId: string, id: string) {
  return {
    id,
    siteId,
    kind: "external",
    name: `${siteId} external agent`,
    status: "active",
    scopes: ["site:read"],
    authorityKind: "deployment",
    authorityPolicyId: "deployment-default",
    authorityFingerprint: `authority:${siteId}`,
    tokenVersion: 1,
  };
}

function serviceToken(siteId: string, principalId: string, id = randomUUID()) {
  return {
    id,
    siteId,
    principalId,
    name: "Automation token",
    prefix: `npst1_${id}`,
    tokenHash: `ov1:hmac-sha256:${randomUUID()}`,
    hashKeyId: "agent-token-hash-v1",
    rotationFamilyId: randomUUID(),
    principalTokenVersion: 1,
    status: "active_head",
    scopes: ["site:read"],
    transport: "stdio",
    exposureMode: "read",
    audience: "urn:nexpress:agent-gateway:stdio",
    expiresAt: new Date(Date.now() + 60_000),
  };
}

async function seedPendingNotificationConnection(siteId: string) {
  const db = await getTestDb();
  const connectionId = randomUUID();
  const configId = randomUUID();
  const activatedAt = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(npAgentConnections).values({
      id: connectionId,
      siteId,
      kind: "notification",
      provider: "fake-notification",
      adapterContractVersion: 1,
      name: "Pending notification",
      authKind: "api_key",
      activeConfigSnapshotId: configId,
      config: {},
      configVersion: 1,
      configHash: "cfg1:sha256:test",
      pricingCatalogFingerprint: "pc1:sha256:test",
      dataProcessingCeiling: "public-only",
      status: "pending",
    });
    await tx.insert(npAgentConnectionConfigVersions).values({
      id: configId,
      siteId,
      connectionId,
      version: 1,
      adapterId: "fake-notification",
      adapterContractVersion: 1,
      adapterFingerprint: "adapter1:sha256:test",
      config: {},
      configHash: "cfg1:sha256:test",
      pricingCatalog: [],
      pricingCatalogFingerprint: "pc1:sha256:test",
      dataProcessingCeiling: "public-only",
      state: "active",
      activatedAt,
    });
  });
}

describe.skipIf(skipIfNoTestDb())("Agent persistence and site deletion foundation", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("installs every reviewed same-site lifecycle pointer as a deferred foreign key", async () => {
    const db = await getTestDb();
    const expected = [
      "np_agent_connection_auth_requests_code_secret_fk",
      "np_agent_connection_auth_requests_code_vault_operation_fk",
      "np_agent_connection_auth_requests_connection_operation_fk",
      "np_agent_connection_auth_requests_expected_secret_fk",
      "np_agent_connection_auth_requests_pkce_secret_fk",
      "np_agent_connection_operations_expected_secret_fk",
      "np_agent_connection_secret_versions_seal_operation_fk",
      "np_agent_connections_active_config_fk",
      "np_agent_connections_active_secret_fk",
    ];
    const result = await db.execute<{
      conname: string;
      deferrable: boolean;
      deferred: boolean;
      deleteAction: string;
    }>(sql`
      select conname, condeferrable as deferrable, condeferred as deferred,
             confdeltype as "deleteAction"
        from pg_constraint
       where conname in (
         'np_agent_connection_auth_requests_code_secret_fk',
         'np_agent_connection_auth_requests_code_vault_operation_fk',
         'np_agent_connection_auth_requests_connection_operation_fk',
         'np_agent_connection_auth_requests_expected_secret_fk',
         'np_agent_connection_auth_requests_pkce_secret_fk',
         'np_agent_connection_operations_expected_secret_fk',
         'np_agent_connection_secret_versions_seal_operation_fk',
         'np_agent_connections_active_config_fk',
         'np_agent_connections_active_secret_fk'
       )
       order by conname
    `);

    expect(result.rows.map((row) => row.conname)).toEqual(expected);
    expect(result.rows.every((row) => row.deferrable && row.deferred)).toBe(true);
    expect(result.rows.every((row) => row.deleteAction === "a")).toBe(true);
  });

  it("installs the generalized run and action attribution constraints", async () => {
    const db = await getTestDb();
    const expected = [
      "np_agent_actions_attribution_check",
      "np_agent_actions_contract_check",
      "np_agent_actions_invocation_fk",
      "np_agent_actions_read_effect_check",
      "np_agent_actions_run_fk",
      "np_agent_actions_state_check",
      "np_agent_actions_terminal_check",
      "np_agent_runs_gateway_shape_check",
      "np_agent_runs_invocation_fk",
      "np_agent_runs_lineage_check",
      "np_agent_runs_principal_fk",
      "np_agent_runs_state_check",
      "np_agent_runs_terminal_check",
    ];
    const result = await db.execute<{ conname: string }>(sql`
      select conname
        from pg_constraint
       where conname in (
         'np_agent_actions_attribution_check',
         'np_agent_actions_contract_check',
         'np_agent_actions_invocation_fk',
         'np_agent_actions_read_effect_check',
         'np_agent_actions_run_fk',
         'np_agent_actions_state_check',
         'np_agent_actions_terminal_check',
         'np_agent_runs_gateway_shape_check',
         'np_agent_runs_invocation_fk',
         'np_agent_runs_lineage_check',
         'np_agent_runs_principal_fk',
         'np_agent_runs_state_check',
         'np_agent_runs_terminal_check'
       )
       order by conname
    `);
    expect(result.rows.map((row) => row.conname)).toEqual(expected);
  });

  it("installs the durable MCP task authority, lifecycle, and bounded TTL constraints", async () => {
    const db = await getTestDb();
    const expected = [
      "np_agent_mcp_tasks_invocation_fk",
      "np_agent_mcp_tasks_principal_fk",
      "np_agent_mcp_tasks_result_check",
      "np_agent_mcp_tasks_run_fk",
      "np_agent_mcp_tasks_status_check",
      "np_agent_mcp_tasks_time_check",
      "np_agent_mcp_tasks_ttl_check",
    ];
    const result = await db.execute<{ conname: string; definition: string }>(sql`
      select conname, pg_get_constraintdef(oid) as definition
        from pg_constraint
       where conname in (
         'np_agent_mcp_tasks_invocation_fk',
         'np_agent_mcp_tasks_principal_fk',
         'np_agent_mcp_tasks_result_check',
         'np_agent_mcp_tasks_run_fk',
         'np_agent_mcp_tasks_status_check',
         'np_agent_mcp_tasks_time_check',
         'np_agent_mcp_tasks_ttl_check'
       )
       order by conname
    `);
    expect(result.rows.map((row) => row.conname)).toEqual(expected);
    expect(
      result.rows.find((row) => row.conname === "np_agent_mcp_tasks_ttl_check")?.definition,
    ).toContain("COALESCE(requested_ttl_ms, (3600000)::bigint)");
  });

  it("fails closed on malformed authority and cross-site token references", async () => {
    const db = await getTestDb();
    await createSite({ id: "agent-a", name: "Agent A" });
    await createSite({ id: "agent-b", name: "Agent B" });

    await expect(
      db.insert(npAgentPrincipals).values({
        ...principal("agent-a", randomUUID()),
        scopes: ["content:read"],
      }),
    ).rejects.toThrow();

    await db
      .insert(npAgentPrincipals)
      .values([principal("agent-a", PRINCIPAL_A), principal("agent-b", PRINCIPAL_B)]);
    await expect(
      db.insert(npAgentServiceTokens).values(serviceToken("agent-a", PRINCIPAL_B)),
    ).rejects.toThrow();
  });

  it("freezes exact inventory and deletes one site's cyclic graph without touching another", async () => {
    const db = await getTestDb();
    await createSite({ id: "agent-a", name: "Agent A" });
    await createSite({ id: "agent-b", name: "Agent B" });
    await db
      .insert(npAgentPrincipals)
      .values([principal("agent-a", PRINCIPAL_A), principal("agent-b", PRINCIPAL_B)]);
    await db.insert(npAgentServiceTokens).values(serviceToken("agent-a", PRINCIPAL_A));
    await seedPendingNotificationConnection("agent-a");

    const inventory = await npInspectAgentSiteDeletionRows(db, "agent-a");
    expect(inventory).toHaveLength(18);
    expect(inventory.map((row) => row.table)).toEqual(
      [...inventory.map((row) => row.table)].sort(),
    );
    expect(inventory.find((row) => row.table === "np_agent_principals")).toEqual({
      table: "np_agent_principals",
      count: 1,
      identityDigest: npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", [
        PRINCIPAL_A,
      ]),
    });
    expect(inventory.reduce((total, row) => total + row.count, 0)).toBe(4);

    await expect(deleteSite("agent-a")).rejects.toBeInstanceOf(NpValidationError);
    await deleteSite("agent-a", { cascade: true });

    expect(await getSiteById("agent-a")).toBeNull();
    expect(await getSiteById("agent-b")).not.toBeNull();
    expect(
      await db
        .select({ id: npAgentPrincipals.id })
        .from(npAgentPrincipals)
        .where(eq(npAgentPrincipals.siteId, "agent-b")),
    ).toEqual([{ id: PRINCIPAL_B }]);
  });

  it("streams identity hashing across more than one keyset page", async () => {
    const db = await getTestDb();
    await createSite({ id: "agent-large", name: "Agent Large" });
    const ids = Array.from(
      { length: 1_001 },
      (_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    );
    await db.insert(npAgentPrincipals).values(ids.map((id) => principal("agent-large", id)));

    const inventory = await npInspectAgentSiteDeletionRows(db, "agent-large");
    expect(inventory.find((row) => row.table === "np_agent_principals")).toEqual({
      table: "np_agent_principals",
      count: ids.length,
      identityDigest: npBuildAgentSiteDeletionRowIdentityDigest("np_agent_principals", ids),
    });
  });

  it("excludes the saga marker from inventory and blocks the legacy delete path", async () => {
    const db = await getTestDb();
    await createSite({ id: "agent-saga", name: "Agent Saga" });
    await db.insert(npAgentSiteDeletionSagas).values({
      siteId: "agent-saga",
      state: "prepared",
      planBody: {} as never,
      planHash: "cj1:sha256:test",
      siteVersionDigest: "sdsv1:sha256:test",
      preparedAt: new Date(),
      cursor: {},
      requesterFingerprint: "staff:test",
    });

    expect(await npInspectAgentSiteDeletionRows(db, "agent-saga")).toHaveLength(18);
    await expect(deleteSite("agent-saga", { cascade: true })).rejects.toMatchObject({
      errors: [
        {
          field: "id",
          message: expect.stringContaining("already has an Agent deletion saga"),
        },
      ],
    });
    expect(await getSiteById("agent-saga")).not.toBeNull();
  });
});
