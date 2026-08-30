import { createHash } from "node:crypto";

import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import type { NpAgentSiteDeletionRowInventoryCanonicalV1 } from "../agent-contract/types.js";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import type { getDb } from "../db/runtime.js";
import {
  npAgentConnectionAuthRequests,
  npAgentConnectionConfigVersions,
  npAgentConnectionOperations,
  npAgentConnectionSecretVersions,
  npAgentConnections,
  npAgentActions,
  npAgentInvocations,
  npAgentOauthClients,
  npAgentOauthCodes,
  npAgentOauthGrants,
  npAgentOauthRefreshTokens,
  npAgentOauthRequests,
  npAgentPrincipals,
  npAgentRuns,
  npAgentServiceTokens,
  npAgentSiteDeletionSagas,
  npAgentVaultEntries,
  npAgentVaultOperations,
} from "../db/schema/agent.js";

type NpAgentDb = ReturnType<typeof getDb>;

interface NpAgentSiteOwnedTableDescriptor {
  readonly tableName: NpAgentSiteOwnedTableName;
  readonly table: PgTable;
  readonly id: AnyPgColumn;
  readonly siteId: AnyPgColumn;
}

const descriptors = {
  np_agent_actions: {
    table: npAgentActions,
    id: npAgentActions.id,
    siteId: npAgentActions.siteId,
  },
  np_agent_connection_auth_requests: {
    table: npAgentConnectionAuthRequests,
    id: npAgentConnectionAuthRequests.id,
    siteId: npAgentConnectionAuthRequests.siteId,
  },
  np_agent_connection_config_versions: {
    table: npAgentConnectionConfigVersions,
    id: npAgentConnectionConfigVersions.id,
    siteId: npAgentConnectionConfigVersions.siteId,
  },
  np_agent_connection_operations: {
    table: npAgentConnectionOperations,
    id: npAgentConnectionOperations.id,
    siteId: npAgentConnectionOperations.siteId,
  },
  np_agent_connection_secret_versions: {
    table: npAgentConnectionSecretVersions,
    id: npAgentConnectionSecretVersions.id,
    siteId: npAgentConnectionSecretVersions.siteId,
  },
  np_agent_connections: {
    table: npAgentConnections,
    id: npAgentConnections.id,
    siteId: npAgentConnections.siteId,
  },
  np_agent_invocations: {
    table: npAgentInvocations,
    id: npAgentInvocations.id,
    siteId: npAgentInvocations.siteId,
  },
  np_agent_oauth_clients: {
    table: npAgentOauthClients,
    id: npAgentOauthClients.id,
    siteId: npAgentOauthClients.siteId,
  },
  np_agent_oauth_codes: {
    table: npAgentOauthCodes,
    id: npAgentOauthCodes.id,
    siteId: npAgentOauthCodes.siteId,
  },
  np_agent_oauth_grants: {
    table: npAgentOauthGrants,
    id: npAgentOauthGrants.id,
    siteId: npAgentOauthGrants.siteId,
  },
  np_agent_oauth_refresh_tokens: {
    table: npAgentOauthRefreshTokens,
    id: npAgentOauthRefreshTokens.id,
    siteId: npAgentOauthRefreshTokens.siteId,
  },
  np_agent_oauth_requests: {
    table: npAgentOauthRequests,
    id: npAgentOauthRequests.id,
    siteId: npAgentOauthRequests.siteId,
  },
  np_agent_principals: {
    table: npAgentPrincipals,
    id: npAgentPrincipals.id,
    siteId: npAgentPrincipals.siteId,
  },
  np_agent_runs: {
    table: npAgentRuns,
    id: npAgentRuns.id,
    siteId: npAgentRuns.siteId,
  },
  np_agent_service_tokens: {
    table: npAgentServiceTokens,
    id: npAgentServiceTokens.id,
    siteId: npAgentServiceTokens.siteId,
  },
  np_agent_vault_entries: {
    table: npAgentVaultEntries,
    id: npAgentVaultEntries.id,
    siteId: npAgentVaultEntries.siteId,
  },
  np_agent_vault_operations: {
    table: npAgentVaultOperations,
    id: npAgentVaultOperations.id,
    siteId: npAgentVaultOperations.siteId,
  },
} as const;

export type NpAgentSiteOwnedTableName = keyof typeof descriptors;

/** Canonical row-inventory order required by np.agent-site-deletion-plan.v1. */
export const npAgentSiteOwnedTableNamesV1 = Object.freeze(
  Object.keys(descriptors).sort() as NpAgentSiteOwnedTableName[],
);

/**
 * Dependency-safe ordinary-row deletion order. The saga marker is excluded
 * from the frozen inventory and is handled only by the future saga commit.
 */
export const npAgentSiteDeletionOrderV1 = Object.freeze([
  "np_agent_actions",
  "np_agent_runs",
  "np_agent_vault_entries",
  "np_agent_connection_operations",
  "np_agent_connection_auth_requests",
  "np_agent_vault_operations",
  "np_agent_connection_secret_versions",
  "np_agent_connection_config_versions",
  "np_agent_connections",
  "np_agent_oauth_codes",
  "np_agent_oauth_refresh_tokens",
  "np_agent_oauth_grants",
  "np_agent_oauth_requests",
  "np_agent_oauth_clients",
  "np_agent_service_tokens",
  "np_agent_invocations",
  "np_agent_principals",
] as const satisfies readonly NpAgentSiteOwnedTableName[]);

export const NP_AGENT_SITE_DELETION_MARKER_TABLE = "np_agent_site_deletion_sagas" as const;

const uuidPattern = new RegExp(npAuthUuidPattern, "u");
const encoder = new TextEncoder();
const NP_AGENT_SITE_DELETION_ID_BATCH_SIZE = 1_000;

function u32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Agent site-deletion row count must be a non-negative safe integer.");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function startRowIdentityHash(tableName: NpAgentSiteOwnedTableName, count: number) {
  const domain = encoder.encode("np.agent-site-deletion-row-inventory.v1\0");
  const tableBytes = encoder.encode(tableName);
  const hash = createHash("sha256");
  hash.update(domain);
  hash.update(u32be(tableBytes.byteLength));
  hash.update(tableBytes);
  hash.update(u64be(count));
  return hash;
}

function appendRowIdentity(
  hash: ReturnType<typeof createHash>,
  tableName: NpAgentSiteOwnedTableName,
  id: string,
  previous: string | null,
): string {
  if (!uuidPattern.test(id) || (previous !== null && id <= previous)) {
    throw new Error(`Agent site-deletion ids for ${tableName} must be canonical sorted UUIDs.`);
  }
  const bytes = encoder.encode(id);
  hash.update(u32be(bytes.byteLength));
  hash.update(bytes);
  return id;
}

export function npBuildAgentSiteDeletionRowIdentityDigest(
  tableName: NpAgentSiteOwnedTableName,
  ids: readonly string[],
): string {
  if (!(tableName in descriptors)) {
    throw new Error(`Unknown Agent site-owned table ${JSON.stringify(tableName)}.`);
  }
  const hash = startRowIdentityHash(tableName, ids.length);
  let previous: string | null = null;
  for (const id of ids) previous = appendRowIdentity(hash, tableName, id, previous);
  return `sdri1:sha256:${hash.digest("base64url")}`;
}

function descriptor(tableName: NpAgentSiteOwnedTableName): NpAgentSiteOwnedTableDescriptor {
  return { tableName, ...descriptors[tableName] };
}

async function inspectTable(
  db: NpAgentDb,
  tableName: NpAgentSiteOwnedTableName,
  siteId: string,
): Promise<NpAgentSiteDeletionRowInventoryCanonicalV1> {
  const item = descriptor(tableName);
  const [countRow] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(item.table)
    .where(eq(item.siteId as never, siteId));
  const count = Number(countRow?.count ?? "0");
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid Agent site-deletion row count for ${tableName}.`);
  }

  const hash = startRowIdentityHash(tableName, count);
  let previous: string | null = null;
  let observed = 0;
  while (observed < count) {
    const rows = (await db
      .select({ id: sql<string>`${item.id}::text` })
      .from(item.table)
      .where(
        previous === null
          ? eq(item.siteId as never, siteId)
          : and(eq(item.siteId as never, siteId), gt(item.id as never, previous)),
      )
      .orderBy(asc(item.id))
      .limit(NP_AGENT_SITE_DELETION_ID_BATCH_SIZE)) as Array<{ id: string }>;
    for (const row of rows) previous = appendRowIdentity(hash, tableName, row.id, previous);
    observed += rows.length;
    if (rows.length < NP_AGENT_SITE_DELETION_ID_BATCH_SIZE) break;
  }
  if (observed !== count) {
    throw new Error(`Agent site-deletion row inventory changed while reading ${tableName}.`);
  }
  return {
    table: tableName,
    count,
    identityDigest: `sdri1:sha256:${hash.digest("base64url")}`,
  };
}

export async function npInspectAgentSiteDeletionRows(
  db: NpAgentDb,
  siteId: string,
): Promise<NpAgentSiteDeletionRowInventoryCanonicalV1[]> {
  const inventory: NpAgentSiteDeletionRowInventoryCanonicalV1[] = [];
  for (const tableName of npAgentSiteOwnedTableNamesV1) {
    inventory.push(await inspectTable(db, tableName, siteId));
  }
  return inventory;
}

export async function npCountAgentSiteRows(db: NpAgentDb, siteId: string): Promise<number> {
  const inventory = await npInspectAgentSiteDeletionRows(db, siteId);
  return inventory.reduce((total, row) => total + row.count, 0);
}

export async function npDeleteAgentSiteRows(db: NpAgentDb, siteId: string): Promise<void> {
  for (const tableName of npAgentSiteDeletionOrderV1) {
    const item = descriptor(tableName);
    await db.delete(item.table).where(eq(item.siteId as never, siteId));
  }
}

export async function npCountAgentSiteDeletionMarkers(
  db: NpAgentDb,
  siteId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(npAgentSiteDeletionSagas)
    .where(eq(npAgentSiteDeletionSagas.siteId, siteId));
  return row?.count ?? 0;
}
