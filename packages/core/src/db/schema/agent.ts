import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  NpAgentAuthorizationContextCanonicalV1,
  NpAgentPreviewContractCanonicalV1,
  NpAgentPreviewRouteCanonicalV1,
  NpAgentPreviewArtifactViewportV1,
  NpAgentStaffSiteAuthorizationCanonicalV1,
  NpAgentInvocationAuthorityRefV1,
  NpAgentChangeSetPlanCanonicalV1,
  NpAgentChangeSetOperationInput,
  NpAgentChangeSetResourceKeyV1,
  NpAgentChangeSetSnapshotCanonicalV1,
  NpAgentVersionBaseV1,
  NpAgentRiskSummary,
  NpAgentApprovalStatementCanonicalV1,
  NpAgentApprovalDecisionCanonicalV1,
  NpAgentApprovalRevocationCanonicalV1,
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentActionTargetVersionFactV1,
  NpAgentConnectionConfigCanonicalV1,
  NpAgentInvocationRequestCanonicalV1,
  NpAgentMcpStoredTerminalResultV1,
  NpAgentJsonObject,
  NpAgentRunLimitsV1,
  NpAgentScope,
  NpAgentTargetRef,
  NpAgentSiteDeletionPlanCanonicalV1,
  NpAgentVaultAadCanonicalV1,
} from "../../agent-contract/types.js";
import { npAuditEvents } from "./community.js";
import { npSessions, npSites, npUsers } from "./system.js";

const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

/**
 * R1 Agent persistence foundation. These tables intentionally expose no
 * service or adapter behavior: they freeze the tenant, lifecycle, credential,
 * idempotency, and deletion graph that later R1 packages must use.
 *
 * Composite pointers that close connection/config/auth/vault lifecycle cycles
 * target tables declared later in this module. Migration 0032 installs those
 * same-site links as DEFERRABLE INITIALLY DEFERRED foreign keys; keep its
 * PostgreSQL catalog test and the AP-103 deletion order aligned with changes.
 */
export const npAgentPrincipals = pgTable(
  "np_agent_principals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    scopes: text("scopes").array().notNull(),
    authorityKind: text("authority_kind").notNull(),
    authorityUserId: uuid("authority_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    authorityPolicyId: text("authority_policy_id"),
    authorityFingerprint: text("authority_fingerprint").notNull(),
    authorityDeletedAt: timestamp("authority_deleted_at", { withTimezone: true, mode: "date" }),
    rowVersion: integer("row_version").default(1).notNull(),
    tokenVersion: integer("token_version").default(1).notNull(),
    ownerUserId: uuid("owner_user_id").references(() => npUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_principals_site_id_id_unique").on(table.siteId, table.id),
    index("np_agent_principals_site_status_idx").on(table.siteId, table.status, table.createdAt),
    index("np_agent_principals_authority_user_idx").on(table.authorityUserId),
    check("np_agent_principals_kind_check", sql`${table.kind} in ('runtime', 'external')`),
    check(
      "np_agent_principals_status_check",
      sql`${table.status} in ('active', 'suspended', 'revoked')`,
    ),
    check(
      "np_agent_principals_authority_kind_check",
      sql`${table.authorityKind} in ('user', 'deployment')`,
    ),
    check(
      "np_agent_principals_versions_check",
      sql`${table.rowVersion} > 0 and ${table.tokenVersion} > 0`,
    ),
    check(
      "np_agent_principals_name_check",
      sql`char_length(${table.name}) between 1 and 120 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      "np_agent_principals_description_check",
      sql`${table.description} is null or char_length(${table.description}) <= 4096`,
    ),
    check(
      "np_agent_principals_scopes_check",
      sql`cardinality(${table.scopes}) between 1 and 64 and array_position(${table.scopes}, null) is null`,
    ),
    check(
      "np_agent_principals_active_scope_check",
      sql`${table.status} <> 'active' or ${table.scopes} @> array['site:read']::text[]`,
    ),
    check(
      "np_agent_principals_revocation_check",
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
    check(
      "np_agent_principals_authority_check",
      sql`(
        (${table.authorityKind} = 'user' and ${table.authorityPolicyId} is null and
          ((${table.authorityUserId} is not null and ${table.authorityDeletedAt} is null) or
           (${table.authorityUserId} is null and ${table.authorityDeletedAt} is not null)))
        or
        (${table.authorityKind} = 'deployment' and ${table.authorityUserId} is null and
          ${table.authorityDeletedAt} is null and ${table.authorityPolicyId} is not null)
      )`,
    ),
    check(
      "np_agent_principals_active_authority_check",
      sql`${table.status} <> 'active' or (${table.authorityKind} = 'deployment' or ${table.authorityUserId} is not null)`,
    ),
  ],
);

export const npAgentServiceTokens = pgTable(
  "np_agent_service_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    principalId: uuid("principal_id").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    hashKeyId: text("hash_key_id").notNull(),
    rotationFamilyId: uuid("rotation_family_id").notNull(),
    familyAuthorityVersion: integer("family_authority_version").default(1).notNull(),
    familyGeneration: integer("family_generation").default(1).notNull(),
    principalTokenVersion: integer("principal_token_version").notNull(),
    replacesTokenId: uuid("replaces_token_id"),
    rowVersion: integer("row_version").default(1).notNull(),
    status: text("status").notNull(),
    scopes: text("scopes").array().notNull(),
    transport: text("transport").notNull(),
    exposureMode: text("exposure_mode").notNull(),
    audience: text("audience").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by").references(() => npUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    overlapExpiresAt: timestamp("overlap_expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_service_tokens_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_service_tokens_prefix_unique").on(table.prefix),
    unique("np_agent_service_tokens_token_hash_unique").on(table.tokenHash),
    unique("np_agent_service_tokens_replaces_unique").on(table.replacesTokenId),
    unique("np_agent_service_tokens_family_generation_unique").on(
      table.siteId,
      table.rotationFamilyId,
      table.familyGeneration,
    ),
    uniqueIndex("np_agent_service_tokens_active_head_uidx")
      .on(table.siteId, table.rotationFamilyId)
      .where(sql`${table.status} = 'active_head'`),
    index("np_agent_service_tokens_principal_idx").on(table.siteId, table.principalId),
    index("np_agent_service_tokens_expiry_idx").on(table.siteId, table.expiresAt),
    foreignKey({
      name: "np_agent_service_tokens_principal_fk",
      columns: [table.siteId, table.principalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_service_tokens_replaces_fk",
      columns: [table.siteId, table.replacesTokenId],
      foreignColumns: [table.siteId, table.id],
    }).onDelete("restrict"),
    check(
      "np_agent_service_tokens_status_check",
      sql`${table.status} in ('active_head', 'overlap', 'revoked', 'expired')`,
    ),
    check(
      "np_agent_service_tokens_transport_check",
      sql`${table.transport} in ('stdio', 'mcp-http', 'agent-http')`,
    ),
    check(
      "np_agent_service_tokens_exposure_check",
      sql`${table.exposureMode} in ('read', 'propose', 'approved-execute')`,
    ),
    check(
      "np_agent_service_tokens_versions_check",
      sql`${table.familyAuthorityVersion} > 0 and ${table.familyGeneration} > 0 and ${table.principalTokenVersion} > 0 and ${table.rowVersion} > 0`,
    ),
    check(
      "np_agent_service_tokens_prefix_check",
      sql`${table.prefix} = 'npst1_' || ${table.id}::text`,
    ),
    check(
      "np_agent_service_tokens_scopes_check",
      sql`cardinality(${table.scopes}) between 1 and 64 and ${table.scopes} @> array['site:read']::text[] and array_position(${table.scopes}, null) is null`,
    ),
    check(
      "np_agent_service_tokens_time_check",
      sql`${table.expiresAt} > ${table.createdAt} and (${table.lastUsedAt} is null or ${table.lastUsedAt} >= ${table.createdAt})`,
    ),
    check(
      "np_agent_service_tokens_state_time_check",
      sql`(
        (${table.status} = 'active_head' and ${table.overlapExpiresAt} is null and ${table.revokedAt} is null)
        or (${table.status} = 'overlap' and ${table.overlapExpiresAt} is not null and ${table.revokedAt} is null and ${table.overlapExpiresAt} <= ${table.expiresAt})
        or (${table.status} in ('revoked', 'expired') and ${table.revokedAt} is not null)
      )`,
    ),
  ],
);

export const npAgentOauthClients = pgTable(
  "np_agent_oauth_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    registrationSource: text("registration_source").notNull(),
    status: text("status").notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_oauth_clients_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_oauth_clients_site_client_id_unique").on(table.siteId, table.clientId),
    index("np_agent_oauth_clients_site_status_idx").on(table.siteId, table.status),
    check("np_agent_oauth_clients_status_check", sql`${table.status} in ('active', 'revoked')`),
    check("np_agent_oauth_clients_version_check", sql`${table.rowVersion} > 0`),
    check(
      "np_agent_oauth_clients_source_check",
      sql`${table.registrationSource} in ('admin', 'dynamic')`,
    ),
    check(
      "np_agent_oauth_clients_redirects_check",
      sql`cardinality(${table.redirectUris}) between 1 and 32 and array_position(${table.redirectUris}, null) is null`,
    ),
    check(
      "np_agent_oauth_clients_revocation_check",
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
  ],
);

export const npAgentOauthRequests = pgTable(
  "np_agent_oauth_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").notNull(),
    staffUserId: uuid("staff_user_id").references(() => npUsers.id, { onDelete: "set null" }),
    staffSessionId: uuid("staff_session_id").references(() => npSessions.id, {
      onDelete: "restrict",
    }),
    redirectUri: text("redirect_uri").notNull(),
    clientState: text("client_state").notNull(),
    requestedScopes: text("requested_scopes").array().notNull(),
    resource: text("resource").notNull(),
    exposureMode: text("exposure_mode").notNull(),
    pkceMethod: text("pkce_method").notNull(),
    pkceChallenge: text("pkce_challenge").notNull(),
    consentChallengeHash: text("consent_challenge_hash").notNull(),
    consentHashKeyId: text("consent_hash_key_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true, mode: "date" }),
    deniedAt: timestamp("denied_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_oauth_requests_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_oauth_requests_consent_hash_unique").on(table.consentChallengeHash),
    index("np_agent_oauth_requests_expiry_idx").on(table.siteId, table.status, table.expiresAt),
    foreignKey({
      name: "np_agent_oauth_requests_client_fk",
      columns: [table.siteId, table.clientId],
      foreignColumns: [npAgentOauthClients.siteId, npAgentOauthClients.id],
    }).onDelete("restrict"),
    check(
      "np_agent_oauth_requests_status_check",
      sql`${table.status} in ('pending', 'authorized', 'denied', 'consumed', 'expired')`,
    ),
    check(
      "np_agent_oauth_requests_exposure_check",
      sql`${table.exposureMode} in ('read', 'propose', 'approved-execute')`,
    ),
    check("np_agent_oauth_requests_pkce_check", sql`${table.pkceMethod} = 'S256'`),
    check(
      "np_agent_oauth_requests_scopes_check",
      sql`cardinality(${table.requestedScopes}) between 1 and 64 and ${table.requestedScopes} @> array['site:read']::text[] and array_position(${table.requestedScopes}, null) is null`,
    ),
    check(
      "np_agent_oauth_requests_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'`,
    ),
    check(
      "np_agent_oauth_requests_state_time_check",
      sql`(
        (${table.status} = 'pending' and ${table.authorizedAt} is null and ${table.deniedAt} is null and ${table.consumedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'authorized' and ${table.authorizedAt} is not null and ${table.deniedAt} is null and ${table.consumedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'denied' and ${table.deniedAt} is not null and ${table.authorizedAt} is null and ${table.consumedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'consumed' and ${table.authorizedAt} is not null and ${table.consumedAt} is not null and ${table.deniedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'expired' and ${table.expiredAt} is not null and ${table.deniedAt} is null and ${table.consumedAt} is null)
      )`,
    ),
  ],
);

export const npAgentOauthGrants = pgTable(
  "np_agent_oauth_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").notNull(),
    staffUserId: uuid("staff_user_id").references(() => npUsers.id, { onDelete: "set null" }),
    principalId: uuid("principal_id").notNull(),
    scopes: text("scopes").array().notNull(),
    scopeHash: text("scope_hash").notNull(),
    exposureMode: text("exposure_mode").notNull(),
    resource: text("resource").notNull(),
    audience: text("audience").notNull(),
    tokenVersion: integer("token_version").default(1).notNull(),
    consentGeneration: integer("consent_generation").default(1).notNull(),
    authorityVersion: integer("authority_version").default(1).notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_oauth_grants_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_oauth_grants_generation_unique").on(
      table.siteId,
      table.clientId,
      table.staffUserId,
      table.resource,
      table.scopeHash,
      table.exposureMode,
      table.consentGeneration,
    ),
    uniqueIndex("np_agent_oauth_grants_active_uidx")
      .on(
        table.siteId,
        table.clientId,
        table.staffUserId,
        table.resource,
        table.scopeHash,
        table.exposureMode,
      )
      .where(sql`${table.status} = 'active'`),
    index("np_agent_oauth_grants_principal_idx").on(table.siteId, table.principalId),
    index("np_agent_oauth_grants_expiry_idx").on(table.siteId, table.status, table.expiresAt),
    foreignKey({
      name: "np_agent_oauth_grants_client_fk",
      columns: [table.siteId, table.clientId],
      foreignColumns: [npAgentOauthClients.siteId, npAgentOauthClients.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_oauth_grants_principal_fk",
      columns: [table.siteId, table.principalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    check(
      "np_agent_oauth_grants_status_check",
      sql`${table.status} in ('active', 'revoked', 'expired')`,
    ),
    check(
      "np_agent_oauth_grants_exposure_check",
      sql`${table.exposureMode} in ('read', 'propose', 'approved-execute')`,
    ),
    check(
      "np_agent_oauth_grants_versions_check",
      sql`${table.tokenVersion} > 0 and ${table.consentGeneration} > 0 and ${table.authorityVersion} > 0`,
    ),
    check(
      "np_agent_oauth_grants_scopes_check",
      sql`cardinality(${table.scopes}) between 1 and 64 and ${table.scopes} @> array['site:read']::text[] and array_position(${table.scopes}, null) is null`,
    ),
    check("np_agent_oauth_grants_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "np_agent_oauth_grants_state_time_check",
      sql`(
        (${table.status} = 'active' and ${table.staffUserId} is not null and ${table.revokedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.expiredAt} is null)
        or (${table.status} = 'expired' and ${table.expiredAt} is not null and ${table.revokedAt} is null)
      )`,
    ),
  ],
);

export const npAgentOauthRefreshTokens = pgTable(
  "np_agent_oauth_refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    grantId: uuid("grant_id").notNull(),
    familyId: uuid("family_id").notNull(),
    tokenId: uuid("token_id").notNull(),
    parentTokenId: uuid("parent_token_id"),
    replacementTokenId: uuid("replacement_token_id"),
    tokenHash: text("token_hash").notNull(),
    hashKeyId: text("hash_key_id").notNull(),
    grantAuthorityVersion: integer("grant_authority_version").notNull(),
    familyGeneration: integer("family_generation").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_oauth_refresh_tokens_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_oauth_refresh_tokens_token_id_unique").on(table.tokenId),
    unique("np_agent_oauth_refresh_tokens_site_token_id_unique").on(table.siteId, table.tokenId),
    unique("np_agent_oauth_refresh_tokens_hash_unique").on(table.tokenHash),
    unique("np_agent_oauth_refresh_tokens_parent_unique").on(table.parentTokenId),
    unique("np_agent_oauth_refresh_tokens_replacement_unique").on(table.replacementTokenId),
    unique("np_agent_oauth_refresh_tokens_family_generation_unique").on(
      table.siteId,
      table.familyId,
      table.familyGeneration,
    ),
    uniqueIndex("np_agent_oauth_refresh_tokens_active_leaf_uidx")
      .on(table.siteId, table.familyId)
      .where(sql`${table.status} = 'active'`),
    index("np_agent_oauth_refresh_tokens_expiry_idx").on(
      table.siteId,
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      name: "np_agent_oauth_refresh_tokens_grant_fk",
      columns: [table.siteId, table.grantId],
      foreignColumns: [npAgentOauthGrants.siteId, npAgentOauthGrants.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_oauth_refresh_tokens_parent_fk",
      columns: [table.siteId, table.parentTokenId],
      foreignColumns: [table.siteId, table.tokenId],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_oauth_refresh_tokens_replacement_fk",
      columns: [table.siteId, table.replacementTokenId],
      foreignColumns: [table.siteId, table.tokenId],
    }).onDelete("restrict"),
    check(
      "np_agent_oauth_refresh_tokens_status_check",
      sql`${table.status} in ('active', 'consumed', 'revoked', 'expired')`,
    ),
    check(
      "np_agent_oauth_refresh_tokens_versions_check",
      sql`${table.grantAuthorityVersion} > 0 and ${table.familyGeneration} > 0`,
    ),
    check(
      "np_agent_oauth_refresh_tokens_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "np_agent_oauth_refresh_tokens_state_time_check",
      sql`(
        (${table.status} = 'active' and ${table.consumedAt} is null and ${table.revokedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'consumed' and ${table.consumedAt} is not null and ${table.revokedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.expiredAt} is null)
        or (${table.status} = 'expired' and ${table.expiredAt} is not null and ${table.revokedAt} is null)
      )`,
    ),
  ],
);

export const npAgentOauthCodes = pgTable(
  "np_agent_oauth_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    staffSessionId: uuid("staff_session_id").references(() => npSessions.id, {
      onDelete: "restrict",
    }),
    clientId: uuid("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").array().notNull(),
    exposureMode: text("exposure_mode").notNull(),
    resource: text("resource").notNull(),
    pkceMethod: text("pkce_method").notNull(),
    pkceChallenge: text("pkce_challenge").notNull(),
    codeHash: text("code_hash").notNull(),
    hashKeyId: text("hash_key_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_oauth_codes_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_oauth_codes_request_unique").on(table.requestId),
    unique("np_agent_oauth_codes_hash_unique").on(table.codeHash),
    index("np_agent_oauth_codes_expiry_idx").on(table.siteId, table.status, table.expiresAt),
    foreignKey({
      name: "np_agent_oauth_codes_request_fk",
      columns: [table.siteId, table.requestId],
      foreignColumns: [npAgentOauthRequests.siteId, npAgentOauthRequests.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_oauth_codes_grant_fk",
      columns: [table.siteId, table.grantId],
      foreignColumns: [npAgentOauthGrants.siteId, npAgentOauthGrants.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_oauth_codes_client_fk",
      columns: [table.siteId, table.clientId],
      foreignColumns: [npAgentOauthClients.siteId, npAgentOauthClients.id],
    }).onDelete("restrict"),
    check(
      "np_agent_oauth_codes_status_check",
      sql`${table.status} in ('active', 'consumed', 'revoked', 'expired')`,
    ),
    check(
      "np_agent_oauth_codes_exposure_check",
      sql`${table.exposureMode} in ('read', 'propose', 'approved-execute')`,
    ),
    check("np_agent_oauth_codes_pkce_check", sql`${table.pkceMethod} = 'S256'`),
    check(
      "np_agent_oauth_codes_scopes_check",
      sql`cardinality(${table.scopes}) between 1 and 64 and ${table.scopes} @> array['site:read']::text[] and array_position(${table.scopes}, null) is null`,
    ),
    check("np_agent_oauth_codes_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "np_agent_oauth_codes_state_time_check",
      sql`(
        (${table.status} = 'active' and ${table.consumedAt} is null and ${table.revokedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'consumed' and ${table.consumedAt} is not null and ${table.revokedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.expiredAt} is null)
        or (${table.status} = 'expired' and ${table.expiredAt} is not null and ${table.revokedAt} is null)
      )`,
    ),
  ],
);

export const npAgentConnections = pgTable(
  "np_agent_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    adapterContractVersion: integer("adapter_contract_version").notNull(),
    name: text("name").notNull(),
    authKind: text("auth_kind").notNull(),
    activeSecretVersionId: uuid("active_secret_version_id"),
    activeConfigSnapshotId: uuid("active_config_snapshot_id").notNull(),
    credentialVersion: integer("credential_version"),
    activeAccountSubjectKeyId: text("active_account_subject_key_id"),
    activeAccountSubjectDigest: text("active_account_subject_digest"),
    activeDestinationKeyId: text("active_destination_key_id"),
    activeDestinationDescriptor: jsonb("active_destination_descriptor").$type<
      Record<string, unknown>
    >(),
    activeDestinationFingerprint: text("active_destination_fingerprint"),
    config: jsonb("config").$type<NpAgentConnectionConfigCanonicalV1["config"]>().notNull(),
    configVersion: integer("config_version").notNull(),
    configHash: text("config_hash").notNull(),
    pricingCatalogFingerprint: text("pricing_catalog_fingerprint").notNull(),
    dataProcessingCeiling: text("data_processing_ceiling").notNull(),
    status: text("status").notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "date" }),
    lastVerifiedConfigVersion: integer("last_verified_config_version"),
    lastVerifiedCredentialVersion: integer("last_verified_credential_version"),
    lastProbeResultDigest: text("last_probe_result_digest"),
    lastErrorCode: text("last_error_code"),
    createdBy: uuid("created_by").references(() => npUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("np_agent_connections_site_id_id_unique").on(table.siteId, table.id),
    index("np_agent_connections_site_status_idx").on(table.siteId, table.status, table.createdAt),
    index("np_agent_connections_active_secret_idx").on(table.activeSecretVersionId),
    check("np_agent_connections_kind_check", sql`${table.kind} in ('model', 'notification')`),
    check("np_agent_connections_auth_kind_check", sql`${table.authKind} in ('api_key', 'oauth')`),
    check(
      "np_agent_connections_status_check",
      sql`${table.status} in ('pending', 'ready', 'error', 'disabled', 'revoked')`,
    ),
    check(
      "np_agent_connections_data_class_check",
      sql`${table.dataProcessingCeiling} in ('public-only', 'internal-redacted', 'sensitive-approved')`,
    ),
    check(
      "np_agent_connections_versions_check",
      sql`${table.adapterContractVersion} > 0 and ${table.configVersion} > 0 and (${table.credentialVersion} is null or ${table.credentialVersion} > 0)`,
    ),
    check(
      "np_agent_connections_name_check",
      sql`char_length(${table.name}) between 1 and 120 and ${table.name} = btrim(${table.name})`,
    ),
    check(
      "np_agent_connections_credential_tuple_check",
      sql`(
        ${table.activeSecretVersionId} is null and ${table.credentialVersion} is null and
        ${table.activeAccountSubjectKeyId} is null and ${table.activeAccountSubjectDigest} is null
      ) or (
        ${table.activeSecretVersionId} is not null and ${table.credentialVersion} is not null and
        ${table.activeAccountSubjectKeyId} is not null and ${table.activeAccountSubjectDigest} is not null
      )`,
    ),
    check(
      "np_agent_connections_destination_check",
      sql`(
        ${table.kind} = 'notification' and (
          (${table.activeSecretVersionId} is null and ${table.activeDestinationKeyId} is null and
            ${table.activeDestinationDescriptor} is null and ${table.activeDestinationFingerprint} is null)
          or
          (${table.activeSecretVersionId} is not null and ${table.activeDestinationKeyId} is not null and
            ${table.activeDestinationDescriptor} is not null and ${table.activeDestinationFingerprint} is not null)
        )
      ) or (
        ${table.kind} = 'model' and ${table.activeDestinationKeyId} is null and
        ${table.activeDestinationDescriptor} is null and ${table.activeDestinationFingerprint} is null
      )`,
    ),
    check(
      "np_agent_connections_probe_tuple_check",
      sql`(
        ${table.lastVerifiedAt} is null and ${table.lastVerifiedConfigVersion} is null and
        ${table.lastVerifiedCredentialVersion} is null and ${table.lastProbeResultDigest} is null
      ) or (
        ${table.lastVerifiedAt} is not null and ${table.lastVerifiedConfigVersion} is not null and
        ${table.lastVerifiedCredentialVersion} is not null and ${table.lastProbeResultDigest} is not null
      )`,
    ),
    check(
      "np_agent_connections_state_matrix_check",
      sql`(
        (${table.status} = 'pending' and ${table.activeSecretVersionId} is null and ${table.lastVerifiedAt} is null and ${table.lastErrorCode} is null)
        or (${table.status} = 'ready' and ${table.activeSecretVersionId} is not null and ${table.lastVerifiedAt} is not null and
          ${table.lastVerifiedConfigVersion} = ${table.configVersion} and ${table.lastVerifiedCredentialVersion} = ${table.credentialVersion} and ${table.lastErrorCode} is null)
        or (${table.status} = 'disabled' and ${table.activeSecretVersionId} is not null and ${table.lastVerifiedAt} is not null and
          ${table.lastVerifiedConfigVersion} = ${table.configVersion} and ${table.lastVerifiedCredentialVersion} = ${table.credentialVersion} and ${table.lastErrorCode} is null)
        or (${table.status} = 'error' and ${table.lastErrorCode} is not null and
          ((${table.activeSecretVersionId} is null and ${table.lastVerifiedAt} is null) or
           (${table.activeSecretVersionId} is not null and ${table.lastVerifiedAt} is not null)))
        or (${table.status} = 'revoked' and ${table.activeSecretVersionId} is null)
      )`,
    ),
  ],
);

export const npAgentConnectionConfigVersions = pgTable(
  "np_agent_connection_config_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    version: integer("version").notNull(),
    adapterId: text("adapter_id").notNull(),
    adapterContractVersion: integer("adapter_contract_version").notNull(),
    adapterFingerprint: text("adapter_fingerprint").notNull(),
    config: jsonb("config").$type<NpAgentConnectionConfigCanonicalV1["config"]>().notNull(),
    configHash: text("config_hash").notNull(),
    pricingCatalog: jsonb("pricing_catalog")
      .$type<NpAgentConnectionConfigCanonicalV1["pricingCatalog"]>()
      .notNull(),
    pricingCatalogFingerprint: text("pricing_catalog_fingerprint").notNull(),
    dataProcessingCeiling: text("data_processing_ceiling").notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_connection_config_versions_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_connection_config_versions_number_unique").on(
      table.siteId,
      table.connectionId,
      table.version,
    ),
    uniqueIndex("np_agent_connection_config_versions_active_uidx")
      .on(table.siteId, table.connectionId)
      .where(sql`${table.state} = 'active'`),
    index("np_agent_connection_config_versions_connection_idx").on(
      table.siteId,
      table.connectionId,
      table.createdAt,
    ),
    foreignKey({
      name: "np_agent_connection_config_versions_connection_fk",
      columns: [table.siteId, table.connectionId],
      foreignColumns: [npAgentConnections.siteId, npAgentConnections.id],
    }).onDelete("restrict"),
    check("np_agent_connection_config_versions_version_check", sql`${table.version} > 0`),
    check(
      "np_agent_connection_config_versions_adapter_version_check",
      sql`${table.adapterContractVersion} > 0`,
    ),
    check(
      "np_agent_connection_config_versions_data_class_check",
      sql`${table.dataProcessingCeiling} in ('public-only', 'internal-redacted', 'sensitive-approved')`,
    ),
    check(
      "np_agent_connection_config_versions_state_check",
      sql`${table.state} in ('candidate', 'active', 'retired', 'rejected')`,
    ),
    check(
      "np_agent_connection_config_versions_state_time_check",
      sql`(
        (${table.state} = 'candidate' and ${table.activatedAt} is null and ${table.retiredAt} is null and ${table.rejectedAt} is null)
        or (${table.state} = 'active' and ${table.activatedAt} is not null and ${table.retiredAt} is null and ${table.rejectedAt} is null)
        or (${table.state} = 'retired' and ${table.activatedAt} is not null and ${table.retiredAt} is not null and ${table.rejectedAt} is null)
        or (${table.state} = 'rejected' and ${table.activatedAt} is null and ${table.retiredAt} is null and ${table.rejectedAt} is not null)
      )`,
    ),
  ],
);

export const npAgentInvocations = pgTable(
  "np_agent_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    actorKind: text("actor_kind").notNull(),
    principalId: uuid("principal_id"),
    staffUserId: uuid("staff_user_id").references(() => npUsers.id, { onDelete: "set null" }),
    actorFingerprint: text("actor_fingerprint").notNull(),
    authorizationContextBody: jsonb("authorization_context_body")
      .$type<NpAgentAuthorizationContextCanonicalV1>()
      .notNull(),
    authorizationContextFingerprint: text("authorization_context_fingerprint").notNull(),
    authorityRef: jsonb("authority_ref").$type<Record<string, unknown>>().notNull(),
    actorDeletedAt: timestamp("actor_deleted_at", { withTimezone: true, mode: "date" }),
    operationKind: text("operation_kind").notNull(),
    operationId: text("operation_id").notNull(),
    contractVersion: integer("contract_version").notNull(),
    contractFingerprint: text("contract_fingerprint").notNull(),
    capabilityDefinitionBody: jsonb(
      "capability_definition_body",
    ).$type<NpAgentCapabilityRegistryCanonicalV1>(),
    effectProfileId: text("effect_profile_id"),
    effectContractVersion: integer("effect_contract_version"),
    transport: text("transport").notNull(),
    mcpExecutionMode: text("mcp_execution_mode"),
    mcpRequestedTaskTtlMs: bigint("mcp_requested_task_ttl_ms", { mode: "number" }),
    idempotencyKey: text("idempotency_key"),
    requestBody: jsonb("request_body").$type<NpAgentInvocationRequestCanonicalV1>().notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state").notNull(),
    runId: uuid("run_id"),
    resultKind: text("result_kind"),
    resultId: uuid("result_id"),
    outputRedacted: jsonb("output_redacted").$type<Record<string, unknown>>(),
    outputHash: text("output_hash"),
    oneTimeValueIssued: boolean("one_time_value_issued").default(false).notNull(),
    oneTimeResourceId: uuid("one_time_resource_id"),
    oneTimeRecoveryOperationId: text("one_time_recovery_operation_id"),
    auditEventId: uuid("audit_event_id")
      .notNull()
      .references(() => npAuditEvents.id, { onDelete: "restrict" }),
    errorCode: text("error_code"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    unique("np_agent_invocations_site_id_id_unique").on(table.siteId, table.id),
    uniqueIndex("np_agent_invocations_idempotency_uidx")
      .on(
        table.siteId,
        table.actorKind,
        table.actorFingerprint,
        table.authorizationContextFingerprint,
        table.operationKind,
        table.operationId,
        table.idempotencyKey,
      )
      .where(sql`${table.idempotencyKey} is not null`),
    index("np_agent_invocations_site_state_idx").on(table.siteId, table.state, table.requestedAt),
    index("np_agent_invocations_principal_idx").on(table.siteId, table.principalId),
    index("np_agent_invocations_expiry_idx").on(table.siteId, table.expiresAt),
    foreignKey({
      name: "np_agent_invocations_principal_fk",
      columns: [table.siteId, table.principalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    check(
      "np_agent_invocations_actor_kind_check",
      sql`${table.actorKind} in ('principal', 'staff')`,
    ),
    check(
      "np_agent_invocations_operation_kind_check",
      sql`${table.operationKind} in ('capability', 'admin')`,
    ),
    check(
      "np_agent_invocations_transport_check",
      sql`${table.transport} in ('mcp-oauth', 'mcp-service', 'stdio', 'agent-api', 'runtime', 'admin')`,
    ),
    check(
      "np_agent_invocations_state_check",
      sql`${table.state} in ('started', 'accepted', 'approval_required', 'completed', 'failed')`,
    ),
    check(
      "np_agent_invocations_result_kind_check",
      sql`${table.resultKind} is null or ${table.resultKind} in ('action', 'changeset', 'approval', 'admin_resource')`,
    ),
    check("np_agent_invocations_contract_version_check", sql`${table.contractVersion} > 0`),
    check(
      "np_agent_invocations_actor_check",
      sql`(
        (${table.actorKind} = 'principal' and ${table.principalId} is not null and ${table.staffUserId} is null and ${table.actorDeletedAt} is null)
        or (${table.actorKind} = 'staff' and ${table.principalId} is null and
          ((${table.staffUserId} is not null and ${table.actorDeletedAt} is null) or
           (${table.staffUserId} is null and ${table.actorDeletedAt} is not null)))
      )`,
    ),
    check(
      "np_agent_invocations_operation_contract_check",
      sql`(
        (${table.operationKind} = 'capability' and ${table.capabilityDefinitionBody} is not null and
          ${table.effectProfileId} is not null and ${table.effectContractVersion} is not null and ${table.effectContractVersion} > 0)
        or (${table.operationKind} = 'admin' and ${table.capabilityDefinitionBody} is null and
          ${table.effectProfileId} is null and ${table.effectContractVersion} is null)
      )`,
    ),
    check(
      "np_agent_invocations_admin_transport_check",
      sql`(${table.operationKind} = 'admin') = (${table.transport} = 'admin')`,
    ),
    check(
      "np_agent_invocations_mcp_mode_check",
      sql`(
        (${table.transport} in ('mcp-oauth', 'mcp-service') and ${table.mcpExecutionMode} in ('normal', 'task') and
          ((${table.mcpExecutionMode} = 'task' and ${table.mcpRequestedTaskTtlMs} is not null and ${table.mcpRequestedTaskTtlMs} > 0) or
           (${table.mcpExecutionMode} = 'normal' and ${table.mcpRequestedTaskTtlMs} is null)))
        or (${table.transport} not in ('mcp-oauth', 'mcp-service') and ${table.mcpExecutionMode} is null and ${table.mcpRequestedTaskTtlMs} is null)
      )`,
    ),
    check(
      "np_agent_invocations_result_pair_check",
      sql`(${table.resultKind} is null) = (${table.resultId} is null)`,
    ),
    check(
      "np_agent_invocations_output_pair_check",
      sql`(${table.outputRedacted} is null) = (${table.outputHash} is null)`,
    ),
    check(
      "np_agent_invocations_one_time_check",
      sql`(
        (${table.oneTimeValueIssued} = false and ${table.oneTimeResourceId} is null and ${table.oneTimeRecoveryOperationId} is null)
        or (${table.oneTimeValueIssued} = true and ${table.oneTimeResourceId} is not null and ${table.oneTimeRecoveryOperationId} is not null and ${table.outputRedacted} is null)
      )`,
    ),
    check(
      "np_agent_invocations_state_time_check",
      sql`(
        (${table.state} in ('started', 'accepted', 'approval_required') and ${table.completedAt} is null and ${table.errorCode} is null)
        or (${table.state} = 'completed' and ${table.completedAt} is not null and ${table.errorCode} is null)
        or (${table.state} = 'failed' and ${table.completedAt} is not null and ${table.errorCode} is not null)
      ) and ${table.expiresAt} > ${table.requestedAt}`,
    ),
  ],
);

/**
 * Generalized execution attribution. AP-203 creates Gateway rows only; the
 * nullable Runtime columns are reserved for the R5 migration that installs
 * Agent/version/trigger/provider owners.
 */
export const npAgentRuns = pgTable(
  "np_agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    agentId: uuid("agent_id"),
    agentVersionId: uuid("agent_version_id"),
    agentConfigHash: text("agent_config_hash"),
    principalId: uuid("principal_id").notNull(),
    invocationId: uuid("invocation_id"),
    admissionFingerprint: text("admission_fingerprint").notNull(),
    triggerId: uuid("trigger_id"),
    rootRunId: uuid("root_run_id").notNull(),
    parentRunId: uuid("parent_run_id"),
    causalDepth: integer("causal_depth").notNull(),
    causalEventId: uuid("causal_event_id"),
    causalActionId: uuid("causal_action_id"),
    recipeId: text("recipe_id"),
    recipeVersion: integer("recipe_version"),
    recipeFingerprint: text("recipe_fingerprint"),
    instructionTemplateId: text("instruction_template_id"),
    instructionTemplateVersion: integer("instruction_template_version"),
    instructionDigest: text("instruction_digest"),
    responseSchemaDigest: text("response_schema_digest"),
    manualInputSchemaDigest: text("manual_input_schema_digest"),
    state: text("state").notNull(),
    goal: text("goal").notNull(),
    eventRef: jsonb("event_ref").$type<NpAgentJsonObject>(),
    policyRefs: jsonb("policy_refs").$type<NpAgentJsonObject[]>().notNull(),
    runLimits: jsonb("run_limits").$type<NpAgentRunLimitsV1>().notNull(),
    runLimitsHash: text("run_limits_hash").notNull(),
    budgetSnapshot: jsonb("budget_snapshot").$type<NpAgentJsonObject>().notNull(),
    budgetSnapshotHash: text("budget_snapshot_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attempt: integer("attempt").notNull(),
    providerRequestId: text("provider_request_id"),
    connectionId: uuid("connection_id"),
    connectionConfigSnapshotId: uuid("connection_config_snapshot_id"),
    connectionConfigVersion: integer("connection_config_version"),
    connectionConfigHash: text("connection_config_hash"),
    providerDataClassCeiling: text("provider_data_class_ceiling"),
    pricingId: text("pricing_id"),
    pricingVersion: integer("pricing_version"),
    pricingFingerprint: text("pricing_fingerprint"),
    pricingEffectiveAt: timestamp("pricing_effective_at", { withTimezone: true, mode: "date" }),
    usage: jsonb("usage").$type<NpAgentJsonObject>().notNull(),
    result: jsonb("result").$type<NpAgentJsonObject>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true, mode: "date" }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_runs_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_runs_invocation_unique").on(table.invocationId),
    unique("np_agent_runs_admission_unique").on(
      table.siteId,
      table.origin,
      table.principalId,
      table.admissionFingerprint,
    ),
    index("np_agent_runs_site_state_idx").on(table.siteId, table.state, table.queuedAt),
    index("np_agent_runs_principal_idx").on(table.siteId, table.principalId, table.queuedAt),
    index("np_agent_runs_deadline_idx").on(table.siteId, table.deadlineAt),
    foreignKey({
      name: "np_agent_runs_principal_fk",
      columns: [table.siteId, table.principalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_runs_invocation_fk",
      columns: [table.siteId, table.invocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_runs_root_fk",
      columns: [table.siteId, table.rootRunId],
      foreignColumns: [table.siteId, table.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_runs_parent_fk",
      columns: [table.siteId, table.parentRunId],
      foreignColumns: [table.siteId, table.id],
    }).onDelete("restrict"),
    check("np_agent_runs_origin_check", sql`${table.origin} in ('gateway', 'runtime')`),
    check(
      "np_agent_runs_state_check",
      sql`${table.state} in ('queued', 'running', 'waiting_approval', 'waiting_retry', 'verifying', 'succeeded', 'failed', 'cancelled', 'policy_blocked', 'budget_blocked')`,
    ),
    check(
      "np_agent_runs_gateway_shape_check",
      sql`${table.origin} <> 'gateway' or (
        ${table.agentId} is null and ${table.agentVersionId} is null and ${table.agentConfigHash} is null and
        ${table.invocationId} is not null and ${table.triggerId} is null and ${table.recipeId} is null and
        ${table.recipeVersion} is null and ${table.recipeFingerprint} is null and
        ${table.instructionTemplateId} is null and ${table.instructionTemplateVersion} is null and
        ${table.instructionDigest} is null and ${table.responseSchemaDigest} is null and
        ${table.manualInputSchemaDigest} is null and ${table.connectionId} is null and
        ${table.connectionConfigSnapshotId} is null and ${table.connectionConfigVersion} is null and
        ${table.connectionConfigHash} is null and ${table.providerDataClassCeiling} is null and
        ${table.providerRequestId} is null and
        ${table.pricingId} is null and ${table.pricingVersion} is null and
        ${table.pricingFingerprint} is null and ${table.pricingEffectiveAt} is null
      )`,
    ),
    check(
      "np_agent_runs_lineage_check",
      sql`(${table.parentRunId} is null and ${table.rootRunId} = ${table.id} and ${table.causalDepth} = 0 and ${table.causalActionId} is null)
        or (${table.parentRunId} is not null and ${table.parentRunId} <> ${table.id} and ${table.rootRunId} <> ${table.id} and ${table.causalDepth} between 1 and 4)`,
    ),
    check("np_agent_runs_attempt_check", sql`${table.attempt} > 0`),
    check("np_agent_runs_deadline_check", sql`${table.deadlineAt} > ${table.queuedAt}`),
    check(
      "np_agent_runs_terminal_check",
      sql`((${table.state} in ('succeeded', 'failed', 'cancelled', 'policy_blocked', 'budget_blocked')) = (${table.finishedAt} is not null)) and
        (${table.errorCode} is null) = (${table.errorMessage} is null)`,
    ),
  ],
);

/** One exact capability proposal/execution record. AP-203 writes read rows. */
export const npAgentActions = pgTable(
  "np_agent_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    runId: uuid("run_id"),
    runFingerprint: text("run_fingerprint"),
    invocationId: uuid("invocation_id"),
    invocationFingerprint: text("invocation_fingerprint").notNull(),
    executionInvocationId: uuid("execution_invocation_id"),
    executionInvocationFingerprint: text("execution_invocation_fingerprint"),
    sequence: integer("sequence").notNull(),
    capabilityId: text("capability_id").notNull(),
    capabilityContractVersion: integer("capability_contract_version").notNull(),
    capabilityFingerprint: text("capability_fingerprint").notNull(),
    capabilityDefinitionBody: jsonb("capability_definition_body")
      .$type<NpAgentCapabilityRegistryCanonicalV1>()
      .notNull(),
    effectProfileId: text("effect_profile_id").notNull(),
    effectContractVersion: integer("effect_contract_version").notNull(),
    risk: text("risk").notNull(),
    state: text("state").notNull(),
    idempotencyKey: text("idempotency_key"),
    inputRedacted: jsonb("input_redacted").$type<NpAgentJsonObject>().notNull(),
    inputCanonical: jsonb("input_canonical").$type<NpAgentJsonObject>().notNull(),
    requiredScopes: text("required_scopes").array().$type<NpAgentScope[]>().notNull(),
    targetRefs: jsonb("target_refs").$type<NpAgentTargetRef[]>().notNull(),
    targetVersionFacts: jsonb("target_version_facts")
      .$type<NpAgentActionTargetVersionFactV1[]>()
      .notNull(),
    inputHash: text("input_hash").notNull(),
    outputRedacted: jsonb("output_redacted").$type<NpAgentJsonObject>(),
    outputHash: text("output_hash"),
    effectDigest: text("effect_digest"),
    targetVersionDigest: text("target_version_digest"),
    verifierId: text("verifier_id"),
    verificationState: text("verification_state"),
    verificationResultDigest: text("verification_result_digest"),
    verificationEvidence: jsonb("verification_evidence").$type<NpAgentJsonObject[]>(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    undoRef: jsonb("undo_ref").$type<NpAgentJsonObject>(),
    compensatorId: text("compensator_id"),
    compensationResultDigest: text("compensation_result_digest"),
    compensationEvidence: jsonb("compensation_evidence").$type<NpAgentJsonObject[]>(),
    compensatedAt: timestamp("compensated_at", { withTimezone: true, mode: "date" }),
    errorCode: text("error_code"),
    approvalId: uuid("approval_id"),
    containmentId: uuid("containment_id"),
    enforcementAdapterId: text("enforcement_adapter_id"),
    enforcementAdapterContractVersion: integer("enforcement_adapter_contract_version"),
    enforcementAdapterFingerprint: text("enforcement_adapter_fingerprint"),
    compensatesActionId: uuid("compensates_action_id"),
    auditEventId: uuid("audit_event_id").references(() => npAuditEvents.id, {
      onDelete: "restrict",
    }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("np_agent_actions_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_actions_invocation_sequence_unique").on(table.invocationId, table.sequence),
    index("np_agent_actions_site_state_idx").on(table.siteId, table.state, table.createdAt),
    index("np_agent_actions_run_idx").on(table.siteId, table.runId, table.sequence),
    foreignKey({
      name: "np_agent_actions_run_fk",
      columns: [table.siteId, table.runId],
      foreignColumns: [npAgentRuns.siteId, npAgentRuns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_actions_invocation_fk",
      columns: [table.siteId, table.invocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_actions_execution_invocation_fk",
      columns: [table.siteId, table.executionInvocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_actions_compensates_fk",
      columns: [table.siteId, table.compensatesActionId],
      foreignColumns: [table.siteId, table.id],
    }).onDelete("restrict"),
    check("np_agent_actions_sequence_check", sql`${table.sequence} > 0`),
    check(
      "np_agent_actions_contract_check",
      sql`${table.capabilityContractVersion} > 0 and ${table.effectContractVersion} > 0`,
    ),
    check(
      "np_agent_actions_risk_check",
      sql`${table.risk} in ('read', 'reversible', 'sensitive', 'destructive')`,
    ),
    check(
      "np_agent_actions_state_check",
      sql`${table.state} in ('proposed', 'policy_blocked', 'approval_pending', 'approved', 'executing', 'succeeded', 'failed', 'compensated')`,
    ),
    check(
      "np_agent_actions_attribution_check",
      sql`(${table.runId} is null) = (${table.runFingerprint} is null) and
        (${table.executionInvocationId} is null) = (${table.executionInvocationFingerprint} is null)`,
    ),
    check(
      "np_agent_actions_output_check",
      sql`(${table.outputRedacted} is null) = (${table.outputHash} is null)`,
    ),
    check(
      "np_agent_actions_read_effect_check",
      sql`${table.effectProfileId} <> 'domain.read' or (
        ${table.risk} = 'read' and ${table.verifierId} is null and ${table.verificationState} is null and
        ${table.verificationResultDigest} is null and ${table.verificationEvidence} is null and
        ${table.verifiedAt} is null and ${table.effectDigest} is null and ${table.targetVersionDigest} is null and
        ${table.undoRef} is null and ${table.compensatorId} is null and
        ${table.compensationResultDigest} is null and ${table.compensationEvidence} is null and
        ${table.compensatedAt} is null and ${table.approvalId} is null and ${table.containmentId} is null and
        ${table.enforcementAdapterId} is null and ${table.enforcementAdapterContractVersion} is null and
        ${table.enforcementAdapterFingerprint} is null and ${table.compensatesActionId} is null
      )`,
    ),
    check(
      "np_agent_actions_terminal_check",
      sql`((${table.state} in ('policy_blocked', 'succeeded', 'failed', 'compensated')) = (${table.finishedAt} is not null)) and
        ((${table.state} in ('policy_blocked', 'failed')) = (${table.errorCode} is not null))`,
    ),
  ],
);

/** Durable MCP 2025-11-25 task projection of one admitted invocation. */
export const npAgentMcpTasks = pgTable(
  "np_agent_mcp_tasks",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    invocationId: uuid("invocation_id").notNull(),
    runId: uuid("run_id"),
    principalId: uuid("principal_id").notNull(),
    authorizationContextBody: jsonb("authorization_context_body")
      .$type<NpAgentAuthorizationContextCanonicalV1>()
      .notNull(),
    authorizationContextFingerprint: text("authorization_context_fingerprint").notNull(),
    authorityRef: jsonb("authority_ref").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    requestedTtlMs: bigint("requested_ttl_ms", { mode: "number" }),
    ttlMs: bigint("ttl_ms", { mode: "number" }).notNull(),
    pollIntervalMs: integer("poll_interval_ms").notNull(),
    terminalResult: jsonb("terminal_result").$type<NpAgentMcpStoredTerminalResultV1>(),
    terminalResultDigest: text("terminal_result_digest"),
    safeStatusCode: text("safe_status_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_mcp_tasks_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_mcp_tasks_invocation_unique").on(table.invocationId),
    index("np_agent_mcp_tasks_site_status_idx").on(table.siteId, table.status, table.expiresAt),
    index("np_agent_mcp_tasks_authorization_idx").on(
      table.siteId,
      table.principalId,
      table.authorizationContextFingerprint,
      table.createdAt,
    ),
    foreignKey({
      name: "np_agent_mcp_tasks_invocation_fk",
      columns: [table.siteId, table.invocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_mcp_tasks_run_fk",
      columns: [table.siteId, table.runId],
      foreignColumns: [npAgentRuns.siteId, npAgentRuns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_mcp_tasks_principal_fk",
      columns: [table.siteId, table.principalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    check(
      "np_agent_mcp_tasks_id_check",
      sql`${table.id} ~ '^npt1_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "np_agent_mcp_tasks_status_check",
      sql`${table.status} in ('working', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "np_agent_mcp_tasks_ttl_check",
      sql`${table.ttlMs} between 60000 and 86400000 and
        (${table.requestedTtlMs} is null or ${table.requestedTtlMs} between 60000 and 86400000) and
        ${table.ttlMs} <= coalesce(${table.requestedTtlMs}, 3600000) and
        ${table.pollIntervalMs} between 1000 and 10000`,
    ),
    check(
      "np_agent_mcp_tasks_result_check",
      sql`(
        ${table.status} = 'working' and ${table.terminalResult} is null and
          ${table.terminalResultDigest} is null and ${table.safeStatusCode} is null and
          ${table.cancelledAt} is null
      ) or (
        ${table.status} in ('completed', 'failed') and ${table.terminalResult} is not null and
          ${table.terminalResultDigest} is not null and ${table.cancelledAt} is null
      ) or (
        ${table.status} = 'cancelled' and ${table.terminalResult} is not null and
          ${table.terminalResultDigest} is not null and ${table.safeStatusCode} is not null and
          ${table.cancelledAt} is not null
      )`,
    ),
    check(
      "np_agent_mcp_tasks_time_check",
      sql`${table.lastUpdatedAt} >= ${table.createdAt} and
        ${table.lastUpdatedAt} <= ${table.expiresAt} and
        ${table.expiresAt} = ${table.createdAt} + (${table.ttlMs}::text || ' milliseconds')::interval`,
    ),
  ],
);

export const npAgentConnectionAuthRequests = pgTable(
  "np_agent_connection_auth_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    mode: text("mode").notNull(),
    expectedConnectionStatus: text("expected_connection_status").notNull(),
    provider: text("provider").notNull(),
    adapterContractVersion: integer("adapter_contract_version").notNull(),
    adapterContractFingerprint: text("adapter_contract_fingerprint").notNull(),
    oauthClientConfigDigest: text("oauth_client_config_digest").notNull(),
    connectionConfigVersion: integer("connection_config_version").notNull(),
    connectionConfigHash: text("connection_config_hash").notNull(),
    configSnapshotId: uuid("config_snapshot_id").notNull(),
    expectedSecretVersionId: uuid("expected_secret_version_id"),
    expectedCredentialVersion: integer("expected_credential_version"),
    expectedAccountSubjectKeyId: text("expected_account_subject_key_id"),
    expectedAccountSubjectDigest: text("expected_account_subject_digest"),
    staffSessionId: uuid("staff_session_id")
      .notNull()
      .references(() => npSessions.id, { onDelete: "restrict" }),
    redirectUri: text("redirect_uri").notNull(),
    stateHash: text("state_hash").notNull(),
    hashKeyId: text("hash_key_id").notNull(),
    pkceSecretVersionId: uuid("pkce_secret_version_id").notNull(),
    codeSecretVersionId: uuid("code_secret_version_id"),
    codeVaultOperationId: uuid("code_vault_operation_id"),
    connectionOperationId: uuid("connection_operation_id"),
    requestedPermissions: text("requested_permissions").array().notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    deniedAt: timestamp("denied_at", { withTimezone: true, mode: "date" }),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    unique("np_agent_connection_auth_requests_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_connection_auth_requests_state_hash_unique").on(table.stateHash),
    unique("np_agent_connection_auth_requests_code_secret_unique").on(table.codeSecretVersionId),
    unique("np_agent_connection_auth_requests_code_vault_operation_unique").on(
      table.codeVaultOperationId,
    ),
    unique("np_agent_connection_auth_requests_operation_unique").on(table.connectionOperationId),
    uniqueIndex("np_agent_connection_auth_requests_pending_uidx")
      .on(table.siteId, table.connectionId)
      .where(sql`${table.status} = 'pending'`),
    index("np_agent_connection_auth_requests_expiry_idx").on(
      table.siteId,
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      name: "np_agent_connection_auth_requests_connection_fk",
      columns: [table.siteId, table.connectionId],
      foreignColumns: [npAgentConnections.siteId, npAgentConnections.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_connection_auth_requests_config_fk",
      columns: [table.siteId, table.configSnapshotId],
      foreignColumns: [npAgentConnectionConfigVersions.siteId, npAgentConnectionConfigVersions.id],
    }).onDelete("restrict"),
    check(
      "np_agent_connection_auth_requests_mode_check",
      sql`${table.mode} in ('initial', 'replace')`,
    ),
    check(
      "np_agent_connection_auth_requests_expected_status_check",
      sql`${table.expectedConnectionStatus} in ('pending', 'ready', 'error', 'disabled')`,
    ),
    check(
      "np_agent_connection_auth_requests_status_check",
      sql`${table.status} in ('pending', 'consumed', 'denied', 'failed', 'expired', 'revoked')`,
    ),
    check(
      "np_agent_connection_auth_requests_versions_check",
      sql`${table.adapterContractVersion} > 0 and ${table.connectionConfigVersion} > 0 and
        (${table.expectedCredentialVersion} is null or ${table.expectedCredentialVersion} > 0)`,
    ),
    check(
      "np_agent_connection_auth_requests_expected_secret_check",
      sql`(
        ${table.mode} = 'initial' and ${table.expectedSecretVersionId} is null and ${table.expectedCredentialVersion} is null and
          ${table.expectedAccountSubjectKeyId} is null and ${table.expectedAccountSubjectDigest} is null
      ) or (
        ${table.mode} = 'replace' and ${table.expectedSecretVersionId} is not null and ${table.expectedCredentialVersion} is not null and
          ${table.expectedAccountSubjectKeyId} is not null and ${table.expectedAccountSubjectDigest} is not null
      )`,
    ),
    check(
      "np_agent_connection_auth_requests_permissions_check",
      sql`cardinality(${table.requestedPermissions}) between 1 and 128 and array_position(${table.requestedPermissions}, null) is null`,
    ),
    check(
      "np_agent_connection_auth_requests_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'`,
    ),
    check(
      "np_agent_connection_auth_requests_callback_links_check",
      sql`(
        ${table.status} = 'consumed' and ${table.consumedAt} is not null and ${table.deniedAt} is null and
          ${table.codeSecretVersionId} is not null and ${table.codeVaultOperationId} is not null and ${table.connectionOperationId} is not null
      ) or (
        ${table.status} = 'denied' and ${table.deniedAt} is not null and ${table.consumedAt} is null and
          ${table.codeSecretVersionId} is null and ${table.codeVaultOperationId} is null and ${table.connectionOperationId} is null and
          ${table.lastErrorCode} = 'AUTHORIZATION_DENIED'
      ) or (
        ${table.status} in ('pending', 'failed', 'expired', 'revoked') and ${table.consumedAt} is null and ${table.deniedAt} is null and
          ${table.codeSecretVersionId} is null and ${table.codeVaultOperationId} is null and ${table.connectionOperationId} is null
      )`,
    ),
  ],
);

export const npAgentConnectionOperations = pgTable(
  "np_agent_connection_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    source: text("source").notNull(),
    invocationId: uuid("invocation_id"),
    runId: uuid("run_id"),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    expectedConfigVersion: integer("expected_config_version").notNull(),
    expectedConfigHash: text("expected_config_hash").notNull(),
    configSnapshotId: uuid("config_snapshot_id").notNull(),
    adapterContractVersion: integer("adapter_contract_version").notNull(),
    adapterFingerprint: text("adapter_fingerprint").notNull(),
    authRequestId: uuid("auth_request_id"),
    inputSecretVersionIds: uuid("input_secret_version_ids").array().notNull(),
    expectedSecretVersionId: uuid("expected_secret_version_id"),
    expectedCredentialVersion: integer("expected_credential_version"),
    expectedRefreshGeneration: integer("expected_refresh_generation"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    resultRedacted: jsonb("result_redacted").$type<Record<string, unknown>>(),
    resultDigest: text("result_digest"),
    lastErrorCode: text("last_error_code"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    createdByUserId: uuid("created_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_connection_operations_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_connection_operations_invocation_unique").on(table.invocationId),
    unique("np_agent_connection_operations_auth_request_unique").on(table.authRequestId),
    unique("np_agent_connection_operations_idempotency_unique").on(
      table.siteId,
      table.connectionId,
      table.idempotencyKey,
    ),
    index("np_agent_connection_operations_claim_idx").on(
      table.siteId,
      table.state,
      table.leaseUntil,
    ),
    foreignKey({
      name: "np_agent_connection_operations_connection_fk",
      columns: [table.siteId, table.connectionId],
      foreignColumns: [npAgentConnections.siteId, npAgentConnections.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_connection_operations_config_fk",
      columns: [table.siteId, table.configSnapshotId],
      foreignColumns: [npAgentConnectionConfigVersions.siteId, npAgentConnectionConfigVersions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_connection_operations_invocation_fk",
      columns: [table.siteId, table.invocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_connection_operations_auth_request_fk",
      columns: [table.siteId, table.authRequestId],
      foreignColumns: [npAgentConnectionAuthRequests.siteId, npAgentConnectionAuthRequests.id],
    }).onDelete("restrict"),
    check(
      "np_agent_connection_operations_source_check",
      sql`${table.source} in ('admin-invocation', 'oauth-setup', 'runtime-refresh')`,
    ),
    check(
      "np_agent_connection_operations_kind_check",
      sql`${table.kind} in ('probe', 'activate-secret', 'activate-config', 'oauth-exchange', 'oauth-refresh', 'destroy-secret')`,
    ),
    check(
      "np_agent_connection_operations_state_check",
      sql`${table.state} in ('awaiting_secret', 'queued', 'running', 'succeeded', 'failed', 'ambiguous', 'cancelled')`,
    ),
    check(
      "np_agent_connection_operations_versions_check",
      sql`${table.expectedConfigVersion} > 0 and ${table.adapterContractVersion} > 0 and ${table.attempt} between 1 and 65535 and
        (${table.expectedCredentialVersion} is null or ${table.expectedCredentialVersion} > 0) and
        (${table.expectedRefreshGeneration} is null or ${table.expectedRefreshGeneration} > 0)`,
    ),
    check(
      "np_agent_connection_operations_source_authority_check",
      sql`(
        (${table.source} = 'admin-invocation' and ${table.invocationId} is not null and ${table.authRequestId} is null and ${table.runId} is null)
        or (${table.source} = 'oauth-setup' and ${table.invocationId} is null and ${table.authRequestId} is not null and ${table.runId} is null)
        or (${table.source} = 'runtime-refresh' and ${table.invocationId} is null and ${table.authRequestId} is null and ${table.runId} is not null)
      )`,
    ),
    check(
      "np_agent_connection_operations_refresh_check",
      sql`(
        ${table.kind} = 'oauth-refresh' and ${table.expectedSecretVersionId} is not null and
          ${table.expectedCredentialVersion} is not null and ${table.expectedRefreshGeneration} is not null
      ) or (
        ${table.kind} <> 'oauth-refresh' and ${table.expectedRefreshGeneration} is null
      )`,
    ),
    check(
      "np_agent_connection_operations_result_pair_check",
      sql`(${table.resultRedacted} is null) = (${table.resultDigest} is null)`,
    ),
    check(
      "np_agent_connection_operations_state_time_check",
      sql`(
        (${table.state} = 'awaiting_secret' and ${table.source} = 'oauth-setup' and ${table.kind} = 'oauth-exchange' and
          ${table.deadlineAt} is null and ${table.leaseUntil} is null and ${table.startedAt} is null and ${table.finishedAt} is null)
        or (${table.state} = 'queued' and ${table.deadlineAt} is not null and ${table.leaseUntil} is null and ${table.startedAt} is null and ${table.finishedAt} is null)
        or (${table.state} = 'running' and ${table.deadlineAt} is not null and ${table.leaseUntil} is not null and ${table.startedAt} is not null and ${table.finishedAt} is null)
        or (${table.state} = 'succeeded' and ${table.deadlineAt} is not null and ${table.finishedAt} is not null and ${table.lastErrorCode} is null and ${table.resultDigest} is not null)
        or (${table.state} in ('failed', 'ambiguous', 'cancelled') and ${table.finishedAt} is not null and ${table.lastErrorCode} is not null)
      )`,
    ),
  ],
);

export const npAgentConnectionSecretVersions = pgTable(
  "np_agent_connection_secret_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    purpose: text("purpose").notNull(),
    vaultAdapter: text("vault_adapter").notNull(),
    vaultAdapterContractVersion: integer("vault_adapter_contract_version").notNull(),
    vaultAdapterFingerprint: text("vault_adapter_fingerprint").notNull(),
    sealOperationId: uuid("seal_operation_id").notNull(),
    secretRef: text("secret_ref"),
    materialKind: text("material_kind").notNull(),
    credentialEnvelopeVersion: integer("credential_envelope_version").notNull(),
    vaultAlgorithm: text("vault_algorithm").notNull(),
    aadBody: jsonb("aad_body").$type<NpAgentVaultAadCanonicalV1>().notNull(),
    aadDigest: text("aad_digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true, mode: "date" }),
    refreshTokenPresent: boolean("refresh_token_present"),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true, mode: "date" }),
    refreshGeneration: integer("refresh_generation"),
    permissionDigest: text("permission_digest"),
    accountSubjectKeyId: text("account_subject_key_id"),
    accountSubjectDigest: text("account_subject_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_connection_secret_versions_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_connection_secret_versions_number_unique").on(
      table.siteId,
      table.connectionId,
      table.purpose,
      table.version,
    ),
    unique("np_agent_connection_secret_versions_seal_operation_unique").on(table.sealOperationId),
    uniqueIndex("np_agent_connection_secret_versions_active_uidx")
      .on(table.siteId, table.connectionId)
      .where(sql`${table.status} = 'active' and ${table.purpose} = 'connection-credential'`),
    index("np_agent_connection_secret_versions_connection_idx").on(
      table.siteId,
      table.connectionId,
      table.status,
    ),
    index("np_agent_connection_secret_versions_expiry_idx").on(table.siteId, table.expiresAt),
    foreignKey({
      name: "np_agent_connection_secret_versions_connection_fk",
      columns: [table.siteId, table.connectionId],
      foreignColumns: [npAgentConnections.siteId, npAgentConnections.id],
    }).onDelete("restrict"),
    check("np_agent_connection_secret_versions_version_check", sql`${table.version} > 0`),
    check(
      "np_agent_connection_secret_versions_status_check",
      sql`${table.status} in ('pending', 'active', 'retiring', 'revoked', 'destroyed')`,
    ),
    check(
      "np_agent_connection_secret_versions_purpose_check",
      sql`${table.purpose} in ('connection-credential', 'provider-oauth-pkce', 'provider-oauth-code')`,
    ),
    check(
      "np_agent_connection_secret_versions_material_check",
      sql`${table.materialKind} in ('api_key', 'oauth', 'provider_oauth_pkce', 'provider_oauth_code')`,
    ),
    check(
      "np_agent_connection_secret_versions_envelope_check",
      sql`${table.vaultAdapterContractVersion} > 0 and ${table.credentialEnvelopeVersion} = 1`,
    ),
    check(
      "np_agent_connection_secret_versions_purpose_material_check",
      sql`(
        ${table.purpose} = 'connection-credential' and ${table.materialKind} in ('api_key', 'oauth')
      ) or (
        ${table.purpose} = 'provider-oauth-pkce' and ${table.materialKind} = 'provider_oauth_pkce'
      ) or (
        ${table.purpose} = 'provider-oauth-code' and ${table.materialKind} = 'provider_oauth_code'
      )`,
    ),
    check(
      "np_agent_connection_secret_versions_temporary_expiry_check",
      sql`(
        ${table.purpose} = 'connection-credential' and ${table.expiresAt} is null
      ) or (
        ${table.purpose} in ('provider-oauth-pkce', 'provider-oauth-code') and ${table.expiresAt} is not null and
        ${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'
      )`,
    ),
    check(
      "np_agent_connection_secret_versions_subject_check",
      sql`(
        ${table.purpose} = 'connection-credential' and
          ((${table.accountSubjectKeyId} is null and ${table.accountSubjectDigest} is null and
             ${table.status} in ('pending', 'revoked', 'destroyed') and ${table.activatedAt} is null) or
           (${table.accountSubjectKeyId} is not null and ${table.accountSubjectDigest} is not null))
      ) or (
        ${table.purpose} <> 'connection-credential' and ${table.accountSubjectKeyId} is null and ${table.accountSubjectDigest} is null
      )`,
    ),
    check(
      "np_agent_connection_secret_versions_oauth_metadata_check",
      sql`(
        ${table.materialKind} = 'oauth' and ${table.accessExpiresAt} is not null and
          ${table.refreshTokenPresent} is not null and ${table.refreshGeneration} is not null and ${table.refreshGeneration} > 0 and
          ${table.permissionDigest} is not null and (${table.refreshTokenPresent} = true or ${table.refreshExpiresAt} is null)
      ) or (
        ${table.materialKind} <> 'oauth' and ${table.accessExpiresAt} is null and ${table.refreshTokenPresent} is null and
          ${table.refreshExpiresAt} is null and ${table.refreshGeneration} is null and ${table.permissionDigest} is null
      )`,
    ),
    check(
      "np_agent_connection_secret_versions_locator_check",
      sql`(${table.status} = 'destroyed' and ${table.secretRef} is null) or
        (${table.status} <> 'destroyed' and
          (${table.secretRef} is not null or ${table.status} in ('pending', 'revoked')))`,
    ),
    check(
      "np_agent_connection_secret_versions_state_time_check",
      sql`(
        (${table.status} = 'pending' and ${table.activatedAt} is null and ${table.retiredAt} is null and ${table.destroyedAt} is null)
        or (${table.status} = 'active' and ${table.purpose} = 'connection-credential' and ${table.activatedAt} is not null and ${table.retiredAt} is null and ${table.destroyedAt} is null)
        or (${table.status} = 'retiring' and ${table.purpose} = 'connection-credential' and ${table.activatedAt} is not null and ${table.retiredAt} is not null and ${table.destroyedAt} is null)
        or (${table.status} = 'revoked' and ${table.destroyedAt} is null and
          ((${table.purpose} = 'connection-credential') or (${table.activatedAt} is null and ${table.retiredAt} is null)))
        or (${table.status} = 'destroyed' and ${table.destroyedAt} is not null)
      )`,
    ),
  ],
);

export const npAgentVaultOperations = pgTable(
  "np_agent_vault_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    secretVersionId: uuid("secret_version_id").notNull(),
    vaultAdapter: text("vault_adapter").notNull(),
    vaultAdapterContractVersion: integer("vault_adapter_contract_version").notNull(),
    vaultAdapterFingerprint: text("vault_adapter_fingerprint").notNull(),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigestKeyId: text("request_digest_key_id").notNull(),
    requestDigest: text("request_digest").notNull(),
    state: text("state").notNull(),
    secretRef: text("secret_ref"),
    resultDigest: text("result_digest"),
    lastErrorCode: text("last_error_code"),
    targetKeyId: text("target_key_id"),
    targetKeyVersion: text("target_key_version"),
    attempt: integer("attempt").default(1).notNull(),
    rowVersion: integer("row_version").default(1).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_vault_operations_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_vault_operations_adapter_idempotency_unique").on(
      table.vaultAdapter,
      table.idempotencyKey,
    ),
    index("np_agent_vault_operations_claim_idx").on(table.siteId, table.state, table.leaseUntil),
    foreignKey({
      name: "np_agent_vault_operations_connection_fk",
      columns: [table.siteId, table.connectionId],
      foreignColumns: [npAgentConnections.siteId, npAgentConnections.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_vault_operations_secret_fk",
      columns: [table.siteId, table.secretVersionId],
      foreignColumns: [npAgentConnectionSecretVersions.siteId, npAgentConnectionSecretVersions.id],
    }).onDelete("restrict"),
    check(
      "np_agent_vault_operations_kind_check",
      sql`${table.kind} in ('seal', 'rewrap', 'destroy')`,
    ),
    check(
      "np_agent_vault_operations_state_check",
      sql`${table.state} in ('queued', 'running', 'waiting_inspection', 'succeeded', 'failed')`,
    ),
    check(
      "np_agent_vault_operations_versions_check",
      sql`${table.vaultAdapterContractVersion} > 0 and ${table.attempt} between 1 and 65535 and ${table.rowVersion} > 0`,
    ),
    check(
      "np_agent_vault_operations_rewrap_target_check",
      sql`(${table.kind} = 'rewrap' and ${table.targetKeyId} is not null and ${table.targetKeyVersion} is not null) or
        (${table.kind} <> 'rewrap' and ${table.targetKeyId} is null and ${table.targetKeyVersion} is null)`,
    ),
    check(
      "np_agent_vault_operations_state_time_check",
      sql`(
        (${table.state} = 'queued' and ${table.leaseUntil} is null and ${table.finishedAt} is null and ${table.resultDigest} is null and ${table.lastErrorCode} is null)
        or (${table.state} in ('running', 'waiting_inspection') and ${table.finishedAt} is null and ${table.resultDigest} is null)
        or (${table.state} = 'succeeded' and ${table.finishedAt} is not null and ${table.resultDigest} is not null and ${table.lastErrorCode} is null)
        or (${table.state} = 'failed' and ${table.finishedAt} is not null and ${table.resultDigest} is not null and ${table.lastErrorCode} is not null)
      )`,
    ),
  ],
);

export const npAgentVaultEntries = pgTable(
  "np_agent_vault_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    secretVersionId: uuid("secret_version_id").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    wrappedDataKey: bytea("wrapped_data_key").notNull(),
    nonce: bytea("nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    algorithm: text("algorithm").notNull(),
    kekId: text("kek_id").notNull(),
    kekVersion: text("kek_version").notNull(),
    aadDigest: text("aad_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_vault_entries_site_id_id_unique").on(table.siteId, table.id),
    unique("np_agent_vault_entries_secret_unique").on(table.secretVersionId),
    index("np_agent_vault_entries_site_idx").on(table.siteId, table.createdAt),
    foreignKey({
      name: "np_agent_vault_entries_secret_fk",
      columns: [table.siteId, table.secretVersionId],
      foreignColumns: [npAgentConnectionSecretVersions.siteId, npAgentConnectionSecretVersions.id],
    }).onDelete("restrict"),
    check(
      "np_agent_vault_entries_bytes_check",
      sql`octet_length(${table.ciphertext}) > 0 and octet_length(${table.wrappedDataKey}) > 0 and
        octet_length(${table.nonce}) > 0 and octet_length(${table.authTag}) > 0`,
    ),
  ],
);

export const npAgentSiteDeletionSagas = pgTable(
  "np_agent_site_deletion_sagas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    planBody: jsonb("plan_body").$type<NpAgentSiteDeletionPlanCanonicalV1>().notNull(),
    planHash: text("plan_hash").notNull(),
    siteVersionDigest: text("site_version_digest").notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true, mode: "date" }).notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull(),
    requestedByUserId: uuid("requested_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    requesterFingerprint: text("requester_fingerprint").notNull(),
    lastErrorCode: text("last_error_code"),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    cleanupCompletedAt: timestamp("cleanup_completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("np_agent_site_deletion_sagas_site_unique").on(table.siteId),
    index("np_agent_site_deletion_sagas_state_idx").on(table.state, table.leaseUntil),
    check(
      "np_agent_site_deletion_sagas_state_check",
      sql`${table.state} in ('prepared', 'cleaning', 'ready_to_commit', 'failed', 'committing')`,
    ),
    check(
      "np_agent_site_deletion_sagas_completion_check",
      sql`(${table.state} in ('ready_to_commit', 'committing')) = (${table.cleanupCompletedAt} is not null)`,
    ),
  ],
);

/** AP-301/302 durable drafts. Validation/execution/preview storage is installed separately. */
export const npAgentChangesets = pgTable(
  "np_agent_changesets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    creatorKind: text("creator_kind").notNull(),
    principalId: uuid("principal_id"),
    createdByUserId: uuid("created_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    actorDeletedAt: timestamp("actor_deleted_at", { withTimezone: true, mode: "date" }),
    actorFingerprint: text("actor_fingerprint").notNull(),
    sourceOperationId: text("source_operation_id").notNull(),
    sourceInputHash: text("source_input_hash").notNull(),
    sourceIdempotencyFingerprint: text("source_idempotency_fingerprint").notNull(),
    agentId: uuid("agent_id"),
    agentVersionId: uuid("agent_version_id"),
    agentConfigHash: text("agent_config_hash"),
    runId: uuid("run_id"),
    runFingerprint: text("run_fingerprint"),
    invocationId: uuid("invocation_id"),
    invocationFingerprint: text("invocation_fingerprint"),
    title: text("title").notNull(),
    summary: text("summary"),
    state: text("state").notNull().default("draft"),
    draftVersion: integer("draft_version").notNull().default(1),
    draftHash: text("draft_hash").notNull(),
    validationGeneration: integer("validation_generation").notNull().default(0),
    baseFingerprint: text("base_fingerprint"),
    planHash: text("plan_hash"),
    sealedPlanBody: jsonb("sealed_plan_body").$type<NpAgentChangeSetPlanCanonicalV1>(),
    riskSummary: jsonb("risk_summary").$type<NpAgentRiskSummary>(),
    policyRefs: jsonb("policy_refs").$type<NpAgentJsonObject[]>().notNull().default([]),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    rollbackWindowSeconds: integer("rollback_window_seconds"),
    rollbackEligibleUntil: timestamp("rollback_eligible_until", {
      withTimezone: true,
      mode: "date",
    }),
    cancellationCode: text("cancellation_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("np_agent_changesets_site_id_id_unique").on(t.siteId, t.id),
    unique("np_agent_changesets_source_unique").on(
      t.siteId,
      t.actorFingerprint,
      t.sourceOperationId,
      t.sourceIdempotencyFingerprint,
    ),
    index("np_agent_changesets_site_state_idx").on(t.siteId, t.state, t.createdAt),
    index("np_agent_changesets_principal_idx").on(t.siteId, t.principalId, t.createdAt),
    index("np_agent_changesets_expiry_idx").on(t.siteId, t.state, t.expiresAt),
    foreignKey({
      name: "np_agent_changesets_principal_fk",
      columns: [t.siteId, t.principalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_changesets_run_fk",
      columns: [t.siteId, t.runId],
      foreignColumns: [npAgentRuns.siteId, npAgentRuns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_changesets_invocation_fk",
      columns: [t.siteId, t.invocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    check(
      "np_agent_changesets_state_check",
      sql`(${t.state} in ('draft','validating','invalid','ready','approval_pending','approved','scheduled','applying','applied','verifying','verified','rejected','cancelled','apply_failed','verification_failed','rolling_back','rolled_back','rollback_failed')) is true`,
    ),
    check(
      "np_agent_changesets_version_check",
      sql`(${t.draftVersion}>0 and ${t.validationGeneration}>=0) is true`,
    ),
    check(
      "np_agent_changesets_actor_check",
      sql`((
 (${t.creatorKind}='staff' and ${t.principalId} is null and ((${t.createdByUserId} is not null and ${t.actorDeletedAt} is null) or (${t.createdByUserId} is null and ${t.actorDeletedAt} is not null))) or
 (${t.creatorKind} in ('external','runtime') and ${t.principalId} is not null and ${t.createdByUserId} is null and ${t.actorDeletedAt} is null)) and
 ((${t.creatorKind}='runtime' and ${t.agentId} is not null and ${t.agentVersionId} is not null and ${t.agentConfigHash} is not null) or
 (${t.creatorKind}<>'runtime' and ${t.agentId} is null and ${t.agentVersionId} is null and ${t.agentConfigHash} is null))) is true`,
    ),
    check(
      "np_agent_changesets_attribution_check",
      sql`((${t.runId} is null or ${t.runFingerprint} is not null) and (${t.invocationId} is null or ${t.invocationFingerprint} is not null)) is true`,
    ),
    check(
      "np_agent_changesets_text_check",
      sql`(char_length(${t.title}) between 1 and 4000 and ${t.title}=btrim(${t.title}) and (${t.summary} is null or char_length(${t.summary})<=4000) and char_length(${t.sourceOperationId}) between 1 and 128) is true`,
    ),
    check(
      "np_agent_changesets_hash_check",
      sql`(${t.actorFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.sourceInputHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.sourceIdempotencyFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.draftHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and (${t.planHash} is null or ${t.planHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')) is true`,
    ),
    check(
      "np_agent_changesets_sealed_check",
      sql`((
 (${t.sealedPlanBody} is null and ${t.planHash} is null and ${t.rollbackWindowSeconds} is null) or
 (${t.sealedPlanBody} is not null and ${t.planHash} is not null and ${t.rollbackWindowSeconds} between 60 and 7776000 and ${t.validationGeneration}>0 and
 jsonb_typeof(${t.sealedPlanBody})='object' and ${t.sealedPlanBody}->>'schemaVersion'='np.agent-changeset-plan.v1' and ${t.sealedPlanBody}->>'planKind'='changeset' and
 ${t.sealedPlanBody}->>'siteId'=${t.siteId} and ${t.sealedPlanBody}->>'changeSetId'=${t.id}::text and
 ${t.sealedPlanBody}->'body'->>'rollbackWindowSeconds'=${t.rollbackWindowSeconds}::text)) and
 (${t.state} not in ('draft','validating','invalid') or ${t.sealedPlanBody} is null) and
 (${t.state} in ('draft','validating','invalid','cancelled','rejected') or ${t.sealedPlanBody} is not null)) is true`,
    ),
    check(
      "np_agent_changesets_time_check",
      sql`(${t.updatedAt}>=${t.createdAt} and ${t.expiresAt}>${t.createdAt} and ${t.expiresAt}<=${t.createdAt}+interval '90 days' and
 (${t.scheduledFor} is null or (${t.scheduledFor}>=${t.createdAt} and ${t.scheduledFor}<${t.expiresAt})) and
 (${t.appliedAt} is null or ${t.appliedAt}>=${t.createdAt}) and (${t.verifiedAt} is null or (${t.appliedAt} is not null and ${t.verifiedAt}>=${t.appliedAt})) and
 (${t.rolledBackAt} is null or (${t.appliedAt} is not null and ${t.rolledBackAt}>=${t.appliedAt})) and
 ((${t.rollbackEligibleUntil} is null and ${t.appliedAt} is null) or (${t.appliedAt} is not null and ${t.rollbackWindowSeconds} is not null and ${t.rollbackEligibleUntil}=${t.appliedAt}+make_interval(secs=>${t.rollbackWindowSeconds})))) is true`,
    ),
    check(
      "np_agent_changesets_cancel_check",
      sql`((${t.state}='cancelled')=(${t.cancellationCode} is not null)) is true`,
    ),
  ],
);

export const npAgentChangesetOperations = pgTable(
  "np_agent_changeset_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    changesetId: uuid("changeset_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    clientOperationId: text("client_operation_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceKey: jsonb("resource_key").$type<NpAgentChangeSetResourceKeyV1>().notNull(),
    operation: text("operation").notNull(),
    input: jsonb("input").$type<NpAgentChangeSetOperationInput>().notNull(),
    baseVersion: jsonb("base_version").$type<NpAgentVersionBaseV1>(),
    beforeHash: text("before_hash"),
    beforeSnapshot: jsonb("before_snapshot").$type<NpAgentChangeSetSnapshotCanonicalV1>(),
    snapshotHash: text("snapshot_hash"),
    afterHash: text("after_hash"),
    state: text("state").notNull().default("draft"),
    issues: jsonb("issues").$type<NpAgentJsonObject[]>().notNull().default([]),
    resultDigest: text("result_digest"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("np_agent_changeset_operations_site_id_id_unique").on(t.siteId, t.id),
    unique("np_agent_changeset_operations_ordinal_unique").on(t.siteId, t.changesetId, t.ordinal),
    unique("np_agent_changeset_operations_client_id_unique").on(
      t.siteId,
      t.changesetId,
      t.clientOperationId,
    ),
    foreignKey({
      name: "np_agent_changeset_operations_changeset_fk",
      columns: [t.siteId, t.changesetId],
      foreignColumns: [npAgentChangesets.siteId, npAgentChangesets.id],
    }).onDelete("restrict"),
    check(
      "np_agent_changeset_operations_ordinal_check",
      sql`(${t.ordinal} between 1 and 500 and char_length(${t.clientOperationId}) between 1 and 128) is true`,
    ),
    check(
      "np_agent_changeset_operations_kind_check",
      sql`((${t.resourceKind}='document' and ${t.operation} in ('create','update','publish','schedule','archive')) or (${t.resourceKind} in ('navigation','theme_tokens') and ${t.operation}='replace') or (${t.resourceKind}='setting' and ${t.operation} in ('replace','remove')) or (${t.resourceKind}='media_ref' and ${t.operation} in ('attach','detach'))) is true`,
    ),
    check(
      "np_agent_changeset_operations_body_check",
      sql`(jsonb_typeof(${t.resourceKey})='object' and ${t.resourceKey}->>'kind'=${t.resourceKind} and jsonb_typeof(${t.input})='object' and ${t.input}->>'kind'=${t.resourceKind} and ${t.input}->>'operation'=${t.operation} and ${t.input}->>'clientOperationId'=${t.clientOperationId}) is true`,
    ),
    check(
      "np_agent_changeset_operations_state_check",
      sql`(${t.state} in ('draft','valid','invalid','applied','verified','failed')) is true`,
    ),
    check(
      "np_agent_changeset_operations_snapshot_check",
      sql`((${t.beforeSnapshot} is null and ${t.snapshotHash} is null) or (${t.beforeSnapshot} is not null and ${t.snapshotHash} is not null and ${t.snapshotHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof(${t.beforeSnapshot})='object' and ${t.beforeSnapshot}->>'schemaVersion'='np.agent-changeset-snapshot.v1' and ${t.beforeSnapshot}->>'siteId'=${t.siteId} and ${t.beforeSnapshot}->>'changeSetId'=${t.changesetId}::text and ${t.beforeSnapshot}->>'operationOrdinal'=${t.ordinal}::text and ${t.beforeSnapshot}->'canonicalResourceKey'=${t.resourceKey})) is true`,
    ),
    check(
      "np_agent_changeset_operations_time_check",
      sql`(${t.updatedAt}>=${t.createdAt}) is true`,
    ),
  ],
);

/** Integrity evidence only in AP-301. No challenge, decision or execution API is installed. */
export const npAgentApprovals = pgTable(
  "np_agent_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    targetKind: text("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    targetChangesetId: uuid("target_changeset_id"),
    targetActionId: uuid("target_action_id"),
    generation: integer("generation").notNull(),
    version: integer("version").notNull().default(1),
    planHash: text("plan_hash").notNull(),
    capabilityId: text("capability_id").notNull(),
    capabilityContractVersion: integer("capability_contract_version").notNull(),
    capabilityFingerprint: text("capability_fingerprint").notNull(),
    requiredScopes: text("required_scopes").array().$type<NpAgentScope[]>().notNull(),
    requiredHumanCapabilities: text("required_human_capabilities").array().notNull(),
    requiredHumanPredicates: text("required_human_predicates").array().notNull(),
    policyHashes: text("policy_hashes").array().notNull(),
    requiresLivePreview: boolean("requires_live_preview").notNull(),
    previewId: uuid("preview_id"),
    previewDigest: text("preview_digest"),
    requiredReauthMode: text("required_reauth_mode").notNull(),
    requiredReauthMaxAgeSeconds: integer("required_reauth_max_age_seconds"),
    statementBody: jsonb("statement_body").$type<NpAgentApprovalStatementCanonicalV1>().notNull(),
    statementHash: text("statement_hash").notNull(),
    statementMac: text("statement_mac").notNull(),
    integrityKeyId: text("integrity_key_id").notNull(),
    challengeGeneration: integer("challenge_generation").notNull().default(0),
    challengePurpose: text("challenge_purpose"),
    challengeHash: text("challenge_hash"),
    challengeHashKeyId: text("challenge_hash_key_id"),
    challengeIssuedToUserId: uuid("challenge_issued_to_user_id").references(() => npUsers.id, {
      onDelete: "restrict",
    }),
    challengeSessionFingerprint: text("challenge_session_fingerprint"),
    challengeExpiresAt: timestamp("challenge_expires_at", { withTimezone: true, mode: "date" }),
    challengeConsumedAt: timestamp("challenge_consumed_at", { withTimezone: true, mode: "date" }),
    state: text("state").notNull().default("pending"),
    risk: text("risk").notNull(),
    requesterKind: text("requester_kind").notNull(),
    requestedByPrincipalId: uuid("requested_by_principal_id"),
    requestedByUserId: uuid("requested_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    requesterFingerprint: text("requester_fingerprint").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    deciderFingerprint: text("decider_fingerprint"),
    decisionBody: jsonb("decision_body").$type<NpAgentApprovalDecisionCanonicalV1>(),
    decisionHash: text("decision_hash"),
    decisionMac: text("decision_mac"),
    decisionReauthFingerprint: text("decision_reauth_fingerprint"),
    decisionReauthenticatedAt: timestamp("decision_reauthenticated_at", {
      withTimezone: true,
      mode: "date",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    revocationKind: text("revocation_kind"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => npUsers.id, {
      onDelete: "set null",
    }),
    revokerFingerprint: text("revoker_fingerprint"),
    revocationCode: text("revocation_code"),
    revocationReason: text("revocation_reason"),
    revocationBody: jsonb("revocation_body").$type<NpAgentApprovalRevocationCanonicalV1>(),
    revocationHash: text("revocation_hash"),
    revocationMac: text("revocation_mac"),
    revocationIntegrityKeyId: text("revocation_integrity_key_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("np_agent_approvals_site_id_id_unique").on(t.siteId, t.id),
    unique("np_agent_approvals_generation_unique").on(
      t.siteId,
      t.targetKind,
      t.targetId,
      t.planHash,
      t.generation,
    ),
    uniqueIndex("np_agent_approvals_live_statement_uidx")
      .on(t.siteId, t.targetKind, t.targetId, t.planHash)
      .where(sql`${t.state} in ('pending','approved')`),
    index("np_agent_approvals_expiry_idx").on(t.siteId, t.state, t.expiresAt),
    foreignKey({
      name: "np_agent_approvals_changeset_fk",
      columns: [t.siteId, t.targetChangesetId],
      foreignColumns: [npAgentChangesets.siteId, npAgentChangesets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_approvals_action_fk",
      columns: [t.siteId, t.targetActionId],
      foreignColumns: [npAgentActions.siteId, npAgentActions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_approvals_requester_fk",
      columns: [t.siteId, t.requestedByPrincipalId],
      foreignColumns: [npAgentPrincipals.siteId, npAgentPrincipals.id],
    }).onDelete("restrict"),
    // Rollback targets remain rejected until their actual storage and same-site FK exist.
    check(
      "np_agent_approvals_target_check",
      sql`((${t.targetKind}='changeset' and ${t.targetChangesetId}=${t.targetId} and ${t.targetActionId} is null) or (${t.targetKind}='action' and ${t.targetActionId}=${t.targetId} and ${t.targetChangesetId} is null)) is true`,
    ),
    check(
      "np_agent_approvals_version_check",
      sql`(${t.generation}>0 and ${t.version}>0 and ${t.capabilityContractVersion}>0 and ${t.challengeGeneration}>=0) is true`,
    ),
    check(
      "np_agent_approvals_state_check",
      sql`(${t.state} in ('pending','approved','rejected','expired','consumed','revoked') and ${t.risk} in ('reversible','sensitive','destructive')) is true`,
    ),
    check(
      "np_agent_approvals_requester_check",
      sql`((${t.requesterKind}='staff' and ${t.requestedByPrincipalId} is null) or (${t.requesterKind}='principal' and ${t.requestedByPrincipalId} is not null and ${t.requestedByUserId} is null)) is true`,
    ),
    check(
      "np_agent_approvals_scope_check",
      sql`(cardinality(${t.requiredScopes}) between 1 and 64 and array_position(${t.requiredScopes},null) is null and cardinality(${t.requiredHumanCapabilities}) between 1 and 5 and ${t.requiredHumanCapabilities}<@array['site.access','content.author','content.publish','community.moderate','admin.manage']::text[] and array_position(${t.requiredHumanCapabilities},null) is null and ${t.requiredHumanPredicates}<@array['is-super-admin']::text[] and array_position(${t.requiredHumanPredicates},null) is null) is true`,
    ),
    check(
      "np_agent_approvals_preview_check",
      sql`((${t.requiresLivePreview} and ${t.previewId} is not null and ${t.previewDigest} is not null) or (not ${t.requiresLivePreview} and ${t.previewId} is null and ${t.previewDigest} is null)) is true`,
    ),
    check(
      "np_agent_approvals_reauth_check",
      sql`((${t.requiredReauthMode}='none' and ${t.requiredReauthMaxAgeSeconds} is null) or (${t.requiredReauthMode}='recent-staff-primary' and ${t.requiredReauthMaxAgeSeconds} between 1 and 300)) is true`,
    ),
    check(
      "np_agent_approvals_statement_check",
      sql`(jsonb_typeof(${t.statementBody})='object' and ${t.statementBody}->>'version'='np.agent-approval-statement.v1' and ${t.statementBody}->>'siteId'=${t.siteId} and ${t.statementBody}->>'approvalId'=${t.id}::text and ${t.statementBody}->>'capabilityId'=${t.capabilityId} and ${t.statementBody}->>'capabilityContractVersion'=${t.capabilityContractVersion}::text and ${t.statementBody}->>'capabilityFingerprint'=${t.capabilityFingerprint} and ${t.statementBody}->'target'->>'kind'=${t.targetKind} and
 ((${t.targetKind}='changeset' and ${t.statementBody}->'target'->>'changeSetId'=${t.targetId}::text and ${t.statementBody}->'target'->>'planHash'=${t.planHash}) or (${t.targetKind}='action' and ${t.statementBody}->'target'->>'actionId'=${t.targetId}::text and ${t.statementBody}->'target'->>'proposalHash'=${t.planHash}))) is true`,
    ),
    check(
      "np_agent_approvals_challenge_check",
      sql`((${t.challengeHash} is null and ${t.challengePurpose} is null and ${t.challengeHashKeyId} is null and ${t.challengeIssuedToUserId} is null and ${t.challengeSessionFingerprint} is null and ${t.challengeExpiresAt} is null) or
 (${t.challengeGeneration}>0 and ${t.challengeHash} is not null and ${t.challengePurpose} in ('approve','reject','revoke') and ${t.challengeHashKeyId} is not null and ${t.challengeIssuedToUserId} is not null and ${t.challengeSessionFingerprint} is not null and ${t.challengeExpiresAt} is not null and ${t.challengeExpiresAt}<=${t.expiresAt})) is true`,
    ),
    check(
      "np_agent_approvals_decision_check",
      sql`((
 (${t.decisionBody} is null and ${t.decisionHash} is null and ${t.decisionMac} is null and ${t.deciderFingerprint} is null and ${t.decidedByUserId} is null and ${t.decidedAt} is null and ${t.decisionReauthFingerprint} is null and ${t.decisionReauthenticatedAt} is null) or
 (${t.decisionBody} is not null and ${t.decisionHash} is not null and ${t.decisionMac} is not null and ${t.deciderFingerprint} is not null and ${t.decidedAt} is not null and
 ${t.decisionBody}->>'schemaVersion'='np.agent-approval-decision.v1' and ${t.decisionBody}->>'siteId'=${t.siteId} and ${t.decisionBody}->>'approvalId'=${t.id}::text and ${t.decisionBody}->>'approvalGeneration'=${t.generation}::text and ${t.decisionBody}->>'statementHash'=${t.statementHash} and
 ((${t.requiredReauthMode}='none' and ${t.decisionReauthFingerprint} is null and ${t.decisionReauthenticatedAt} is null) or (${t.requiredReauthMode}='recent-staff-primary' and ${t.decisionReauthFingerprint} is not null and ${t.decisionReauthenticatedAt} is not null)))) and
 (${t.state} not in ('approved','rejected','consumed') or ${t.decisionBody} is not null) and (${t.state}<>'pending' or ${t.decisionBody} is null) and
 (${t.state} not in ('approved','consumed') or ${t.decisionBody}->>'decision'='approve') and (${t.state}<>'rejected' or ${t.decisionBody}->>'decision'='reject')) is true`,
    ),
    check(
      "np_agent_approvals_revocation_check",
      sql`((${t.state}='revoked' and ${t.revocationKind} in ('human','authority_loss','site_deleting','integrity_key_retired','target_invalidated') and ${t.revokerFingerprint} is not null and ${t.revocationCode} is not null and ${t.revocationBody} is not null and ${t.revocationHash} is not null and ${t.revocationMac} is not null and ${t.revocationIntegrityKeyId} is not null and ${t.revokedAt} is not null and ${t.revocationBody}->>'schemaVersion'='np.agent-approval-revocation.v1' and ${t.revocationBody}->>'siteId'=${t.siteId} and ${t.revocationBody}->>'approvalId'=${t.id}::text and ${t.revocationBody}->>'approvalGeneration'=${t.generation}::text and ${t.revocationBody}->>'statementHash'=${t.statementHash} and (${t.revocationKind}='human' or (${t.revokedByUserId} is null and ${t.revocationReason} is null))) or
 (${t.state}<>'revoked' and ${t.revocationKind} is null and ${t.revokedByUserId} is null and ${t.revokerFingerprint} is null and ${t.revocationCode} is null and ${t.revocationReason} is null and ${t.revocationBody} is null and ${t.revocationHash} is null and ${t.revocationMac} is null and ${t.revocationIntegrityKeyId} is null and ${t.revokedAt} is null)) is true`,
    ),
    check(
      "np_agent_approvals_time_check",
      sql`(${t.expiresAt}>${t.requestedAt} and ${t.expiresAt}<=${t.requestedAt}+interval '7 days' and (${t.decidedAt} is null or (${t.decidedAt}>=${t.requestedAt} and ${t.decidedAt}<${t.expiresAt})) and (${t.revokedAt} is null or ${t.revokedAt}>=${t.requestedAt}) and ((${t.state}='consumed')=(${t.consumedAt} is not null)) and (${t.consumedAt} is null or (${t.consumedAt}>=${t.decidedAt} and ${t.consumedAt}<${t.expiresAt})) and (${t.reason} is null or char_length(${t.reason})<=4000) and (${t.revocationReason} is null or char_length(${t.revocationReason})<=4000)) is true`,
    ),
    check(
      "np_agent_approvals_hash_check",
      sql`(${t.planHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.capabilityFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.statementHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.requesterFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and char_length(${t.statementMac}) between 1 and 256 and char_length(${t.integrityKeyId}) between 1 and 128) is true`,
    ),
  ],
);

/** Durable requester-bound validation generations; no execution or preview authority. */
export const npAgentChangesetValidationAttempts = pgTable(
  "np_agent_changeset_validation_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    changesetId: uuid("changeset_id").notNull(),
    generation: integer("generation").notNull(),
    draftVersion: integer("draft_version").notNull(),
    draftHash: text("draft_hash").notNull(),
    admittingInvocationId: uuid("admitting_invocation_id").notNull(),
    authorizationContextBody: jsonb("authorization_context_body")
      .$type<NpAgentAuthorizationContextCanonicalV1>()
      .notNull(),
    authorizationContextFingerprint: text("authorization_context_fingerprint").notNull(),
    authorityRef: jsonb("authority_ref").$type<NpAgentInvocationAuthorityRefV1>().notNull(),
    requesterKind: text("requester_kind").notNull(),
    // Immutable attribution survives user/session deletion; current authority is re-resolved.
    requesterId: uuid("requester_id").notNull(),
    requesterFingerprint: text("requester_fingerprint").notNull(),
    state: text("state").notNull().default("queued"),
    issues: jsonb("issues").$type<NpAgentJsonObject[]>().notNull().default([]),
    riskSummary: jsonb("risk_summary").$type<NpAgentRiskSummary>(),
    resultDigest: text("result_digest"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    unique("np_agent_changeset_validation_attempts_site_id_id_unique").on(t.siteId, t.id),
    unique("np_agent_changeset_validation_attempts_generation_unique").on(
      t.siteId,
      t.changesetId,
      t.generation,
    ),
    unique("np_agent_changeset_validation_attempts_invocation_unique").on(
      t.siteId,
      t.admittingInvocationId,
    ),
    uniqueIndex("np_agent_changeset_validation_attempts_active_unique")
      .on(t.siteId, t.changesetId)
      .where(sql`${t.state} in ('queued','validating')`),
    index("np_agent_changeset_validation_attempts_expiry_idx").on(t.siteId, t.state, t.expiresAt),
    foreignKey({
      name: "np_agent_changeset_validation_attempts_changeset_fk",
      columns: [t.siteId, t.changesetId],
      foreignColumns: [npAgentChangesets.siteId, npAgentChangesets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_changeset_validation_attempts_invocation_fk",
      columns: [t.siteId, t.admittingInvocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    check(
      "np_agent_changeset_validation_attempts_version_check",
      sql`${t.generation}>0 and ${t.draftVersion}>0`,
    ),
    check(
      "np_agent_changeset_validation_attempts_state_check",
      sql`${t.state} in ('queued','validating','ready','invalid','failed')`,
    ),
    check(
      "np_agent_changeset_validation_attempts_hash_check",
      sql`${t.draftHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.authorizationContextFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.requesterFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and (${t.resultDigest} is null or ${t.resultDigest} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')`,
    ),
    check(
      "np_agent_changeset_validation_attempts_authority_check",
      sql`(jsonb_typeof(${t.authorizationContextBody})='object' and ${t.authorizationContextBody}->>'schemaVersion'='np.agent-authorization-context.v1' and ${t.authorizationContextBody}->>'siteId'=${t.siteId} and ${t.authorizationContextBody}->'authorityRef'=${t.authorityRef} and ${t.authorizationContextBody}->'actor'->>'kind'=${t.requesterKind} and ${t.authorizationContextBody}->'actor'->>'actorFingerprint'=${t.requesterFingerprint} and ((${t.requesterKind}='staff' and ${t.authorizationContextBody}->'actor'->>'userId'=${t.requesterId}::text and ${t.authorityRef}->>'kind'='staff-session' and ${t.authorityRef}->>'userId'=${t.requesterId}::text) or (${t.requesterKind}='principal' and ${t.authorizationContextBody}->'actor'->>'principalId'=${t.requesterId}::text and ${t.authorityRef}->>'kind' in ('service-family','oauth-grant','runtime-run') and ${t.authorityRef}->>'principalId'=${t.requesterId}::text))) is true`,
    ),
    check(
      "np_agent_changeset_validation_attempts_result_check",
      sql`(jsonb_typeof(${t.issues})='array' and jsonb_array_length(${t.issues})<=1000 and octet_length(${t.issues}::text)<=262144 and (${t.riskSummary} is null or (jsonb_typeof(${t.riskSummary})='object' and octet_length(${t.riskSummary}::text)<=65536)) and (${t.errorCode} is null or ${t.errorCode} ~ '^[A-Z][A-Z0-9_]{0,63}$')) is true`,
    ),
    check(
      "np_agent_changeset_validation_attempts_time_check",
      sql`${t.expiresAt}>=${t.createdAt}+interval '60 seconds' and ${t.expiresAt}<=${t.createdAt}+interval '24 hours' and (${t.startedAt} is null or ${t.startedAt}>=${t.createdAt}) and (${t.finishedAt} is null or (${t.finishedAt}>=${t.createdAt} and (${t.startedAt} is null or ${t.finishedAt}>=${t.startedAt})))`,
    ),
    check(
      "np_agent_changeset_validation_attempts_terminal_check",
      sql`(
      (${t.state}='queued' and ${t.startedAt} is null and ${t.finishedAt} is null and ${t.resultDigest} is null and ${t.riskSummary} is null and ${t.errorCode} is null and ${t.issues}='[]'::jsonb) or
      (${t.state}='validating' and ${t.startedAt} is not null and ${t.finishedAt} is null and ${t.resultDigest} is null and ${t.riskSummary} is null and ${t.errorCode} is null and ${t.issues}='[]'::jsonb) or
      (${t.state}='ready' and ${t.startedAt} is not null and ${t.finishedAt} is not null and ${t.resultDigest} is not null and ${t.riskSummary} is not null and ${t.errorCode} is null) or
      (${t.state}='invalid' and ${t.startedAt} is not null and ${t.finishedAt} is not null and ${t.resultDigest} is not null and ${t.errorCode} is null) or
      (${t.state}='failed' and ${t.finishedAt} is not null and ${t.errorCode} is not null and ${t.riskSummary} is null)
    )`,
    ),
  ],
);

export const npAgentChangesetPreviews = pgTable(
  "np_agent_changeset_previews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => npSites.id, { onDelete: "restrict" }),
    changesetId: uuid("changeset_id").notNull(),
    planHash: text("plan_hash").notNull(),
    generation: integer("generation").notNull(),
    previewContractBody: jsonb("preview_contract_body")
      .$type<NpAgentPreviewContractCanonicalV1>()
      .notNull(),
    previewContractFingerprint: text("preview_contract_fingerprint").notNull(),
    admittingInvocationId: uuid("admitting_invocation_id").notNull(),
    authorizationContextBody: jsonb("authorization_context_body")
      .$type<NpAgentAuthorizationContextCanonicalV1>()
      .notNull(),
    authorizationContextFingerprint: text("authorization_context_fingerprint").notNull(),
    authorityRef: jsonb("authority_ref").$type<NpAgentInvocationAuthorityRefV1>().notNull(),
    requesterKind: text("requester_kind").notNull(),
    requesterId: uuid("requester_id").notNull(),
    requesterFingerprint: text("requester_fingerprint").notNull(),
    state: text("state").notNull().default("queued"),
    diffSummary: jsonb("diff_summary").$type<NpAgentJsonObject>(),
    checkSummary: jsonb("check_summary").$type<NpAgentJsonObject>(),
    riskSummary: jsonb("risk_summary").$type<NpAgentRiskSummary>(),
    allowedRoutes: jsonb("allowed_routes").$type<NpAgentPreviewRouteCanonicalV1[]>().notNull(),
    allowedRoutesDigest: text("allowed_routes_digest").notNull(),
    digest: text("digest"),
    expectedArtifactCount: integer("expected_artifact_count"),
    uploadSetDigest: text("upload_set_digest"),
    artifactReservedAt: timestamp("artifact_reserved_at", { withTimezone: true, mode: "date" }),
    renderBootstrapJti: uuid("render_bootstrap_jti"),
    renderAttemptId: uuid("render_attempt_id"),
    renderSessionId: uuid("render_session_id"),
    renderBootstrapIssuedAt: timestamp("render_bootstrap_issued_at", {
      withTimezone: true,
      mode: "date",
    }),
    renderBootstrapExpiresAt: timestamp("render_bootstrap_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    renderBootstrapConsumedAt: timestamp("render_bootstrap_consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
    runId: uuid("run_id"),
    jobId: uuid("job_id"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    renderingStartedAt: timestamp("rendering_started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("np_agent_changeset_previews_site_id_id_unique").on(t.siteId, t.id),
    unique("np_agent_changeset_previews_contract_unique").on(
      t.siteId,
      t.id,
      t.previewContractFingerprint,
    ),
    unique("np_agent_changeset_previews_generation_unique").on(
      t.siteId,
      t.changesetId,
      t.planHash,
      t.generation,
    ),
    unique("np_agent_changeset_previews_invocation_unique").on(t.siteId, t.admittingInvocationId),
    unique("np_agent_changeset_previews_render_reservation_unique").on(
      t.siteId,
      t.id,
      t.renderSessionId,
      t.renderAttemptId,
    ),
    index("np_agent_changeset_previews_state_idx").on(t.siteId, t.state, t.createdAt),
    foreignKey({
      name: "np_agent_changeset_previews_changeset_fk",
      columns: [t.siteId, t.changesetId],
      foreignColumns: [npAgentChangesets.siteId, npAgentChangesets.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_changeset_previews_invocation_fk",
      columns: [t.siteId, t.admittingInvocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_changeset_previews_run_fk",
      columns: [t.siteId, t.runId],
      foreignColumns: [npAgentRuns.siteId, npAgentRuns.id],
    }).onDelete("restrict"),
    check(
      "np_agent_changeset_previews_state_check",
      sql`${t.state} in ('queued','rendering','ready','failed','expired') and ${t.generation}>0`,
    ),
    check(
      "np_agent_changeset_previews_hash_check",
      sql`${t.planHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.previewContractFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.authorizationContextFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.requesterFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.allowedRoutesDigest} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and (${t.digest} is null or ${t.digest} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')`,
    ),
    check(
      "np_agent_changeset_previews_authority_check",
      sql`(${t.authorizationContextBody}->>'siteId'=${t.siteId} and ${t.authorizationContextBody}->>'schemaVersion'='np.agent-authorization-context.v1' and ${t.authorizationContextBody}->'authorityRef'=${t.authorityRef} and ${t.authorizationContextBody}->'actor'->>'kind'=${t.requesterKind} and ${t.authorizationContextBody}->'actor'->>'actorFingerprint'=${t.requesterFingerprint} and ((${t.requesterKind}='staff' and ${t.authorizationContextBody}->'actor'->>'userId'=${t.requesterId}::text and ${t.authorityRef}->>'kind'='staff-session' and ${t.authorityRef}->>'userId'=${t.requesterId}::text) or (${t.requesterKind}='principal' and ${t.authorizationContextBody}->'actor'->>'principalId'=${t.requesterId}::text and ${t.authorityRef}->>'principalId'=${t.requesterId}::text and ${t.authorityRef}->>'kind' in ('service-family','oauth-grant','runtime-run')))) is true`,
    ),
    check(
      "np_agent_changeset_previews_contract_check",
      sql`(${t.previewContractBody}->>'schemaVersion'='np.agent-preview-contract.v1' and octet_length(${t.previewContractBody}::text)<=65536 and jsonb_typeof(${t.allowedRoutes})='array' and octet_length(${t.allowedRoutes}::text)<=262144) is true`,
    ),
    check(
      "np_agent_changeset_previews_reservation_check",
      sql`((${t.expectedArtifactCount} is null and ${t.uploadSetDigest} is null and ${t.artifactReservedAt} is null) or (${t.expectedArtifactCount} between 0 and 24 and ${t.uploadSetDigest} ~ '^aus1:sha256:[A-Za-z0-9_-]{43}$' and ${t.artifactReservedAt} is not null)) is true`,
    ),
    check(
      "np_agent_changeset_previews_bootstrap_check",
      sql`((${t.renderBootstrapJti} is null and ${t.renderAttemptId} is null and ${t.renderSessionId} is null and ${t.renderBootstrapIssuedAt} is null and ${t.renderBootstrapExpiresAt} is null and ${t.renderBootstrapConsumedAt} is null) or (${t.renderBootstrapJti} is not null and ${t.renderAttemptId} is not null and ${t.renderSessionId} is not null and ${t.renderBootstrapIssuedAt} is not null and ${t.renderBootstrapExpiresAt}>${t.renderBootstrapIssuedAt} and ${t.renderBootstrapExpiresAt}<=${t.renderBootstrapIssuedAt}+interval '120 seconds' and (${t.renderBootstrapConsumedAt} is null or ${t.renderBootstrapConsumedAt}>=${t.renderBootstrapIssuedAt}))) is true`,
    ),
    check(
      "np_agent_changeset_previews_started_check",
      sql`(${t.state}<>'queued' or ${t.renderingStartedAt} is null) and (${t.state} not in ('rendering','ready') or ${t.renderingStartedAt} is not null) and (${t.renderingStartedAt} is null or ${t.renderingStartedAt}>=${t.createdAt})`,
    ),
    check(
      "np_agent_changeset_previews_terminal_check",
      sql`((${t.state} in ('queued','rendering') and ${t.completedAt} is null and ${t.expiresAt} is null and ${t.digest} is null) or (${t.state}='ready' and ${t.completedAt} is not null and ${t.expiresAt}>${t.completedAt} and ${t.expiresAt}<=${t.completedAt}+interval '7 days' and ${t.digest} is not null and ${t.expectedArtifactCount} is not null and ${t.errorCode} is null) or (${t.state}='failed' and ${t.completedAt} is not null and ${t.expiresAt} is null and ${t.digest} is null and ${t.errorCode} is not null) or (${t.state}='expired' and ${t.completedAt} is not null and ((${t.expiresAt} is null and ${t.digest} is null) or (${t.expiresAt} is not null and ${t.digest} is not null)))) is true`,
    ),
  ],
);

export const npAgentPreviewArtifacts = pgTable(
  "np_agent_preview_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").notNull(),
    previewId: uuid("preview_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    previewContractFingerprint: text("preview_contract_fingerprint").notNull(),
    route: text("route"),
    locale: text("locale"),
    viewport: jsonb("viewport").$type<NpAgentPreviewArtifactViewportV1>(),
    reportPart: integer("report_part"),
    reportTotalParts: integer("report_total_parts"),
    storageKey: text("storage_key").notNull(),
    contentDigest: text("content_digest").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    storageAdapterId: text("storage_adapter_id").notNull(),
    storageAdapterContractVersion: integer("storage_adapter_contract_version").notNull(),
    storageAdapterFingerprint: text("storage_adapter_fingerprint").notNull(),
    objectState: text("object_state").notNull().default("absent"),
    objectExpiresAt: timestamp("object_expires_at", { withTimezone: true, mode: "date" }),
    metadataPruneAt: timestamp("metadata_prune_at", { withTimezone: true, mode: "date" }).notNull(),
    deleteAttempt: integer("delete_attempt").notNull().default(0),
    deleteReceiptDigest: text("delete_receipt_digest"),
    deleteStatus: text("delete_status"),
    deleteErrorCode: text("delete_error_code"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("np_agent_preview_artifacts_site_preview_id_unique").on(t.siteId, t.previewId, t.id),
    unique("np_agent_preview_artifacts_site_id_unique").on(t.siteId, t.id),
    unique("np_agent_preview_artifacts_ordinal_unique").on(t.previewId, t.ordinal),
    unique("np_agent_preview_artifacts_storage_key_unique").on(t.storageAdapterId, t.storageKey),
    uniqueIndex("np_agent_preview_artifacts_capture_unique").on(
      t.previewId,
      t.kind,
      sql`coalesce(${t.route},'')`,
      sql`coalesce(${t.locale},'')`,
      sql`coalesce(${t.viewport}->>'name','')`,
      sql`coalesce(${t.reportPart},0)`,
    ),
    index("np_agent_preview_artifacts_cleanup_idx").on(t.siteId, t.objectState, t.metadataPruneAt),
    foreignKey({
      name: "np_agent_preview_artifacts_preview_fk",
      columns: [t.siteId, t.previewId, t.previewContractFingerprint],
      foreignColumns: [
        npAgentChangesetPreviews.siteId,
        npAgentChangesetPreviews.id,
        npAgentChangesetPreviews.previewContractFingerprint,
      ],
    }).onDelete("restrict"),
    check(
      "np_agent_preview_artifacts_metadata_check",
      sql`(${t.ordinal} between 1 and 24 and ${t.bytes} between 0 and 2097152 and ${t.storageAdapterContractVersion}>0 and ${t.rowVersion}>0 and ${t.deleteAttempt} between 0 and 255 and char_length(${t.storageKey}) between 1 and 2048 and char_length(${t.storageAdapterId}) between 1 and 128 and ${t.contentDigest} ~ '^ac1:sha256:[A-Za-z0-9_-]{43}$' and ${t.storageAdapterFingerprint} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') is true`,
    ),
    check(
      "np_agent_preview_artifacts_kind_check",
      sql`((${t.kind}='screenshot' and ${t.mime} in ('image/png','image/webp') and ${t.route} is not null and ${t.viewport}->>'name' in ('desktop','mobile') and ${t.reportPart} is null and ${t.reportTotalParts} is null) or (${t.kind}='report' and ${t.mime}='application/json' and ${t.bytes}<=524288 and ${t.route} is null and ${t.locale} is null and ${t.viewport} is null and ${t.reportPart} between 1 and 4 and ${t.reportTotalParts} between ${t.reportPart} and 4)) is true`,
    ),
    check(
      "np_agent_preview_artifacts_state_check",
      sql`${t.objectState} in ('ready','delete_pending','absent') and (${t.objectState}<>'ready' or ${t.objectExpiresAt} is not null) and (${t.objectState}='absent' or ${t.deletedAt} is null)`,
    ),
    check(
      "np_agent_preview_artifacts_delete_check",
      sql`((${t.deleteReceiptDigest} is null and ${t.deleteStatus} is null and ${t.deletedAt} is null) or (${t.deleteReceiptDigest} ~ '^adr1:sha256:[A-Za-z0-9_-]{43}$' and ${t.deleteStatus} in ('deleted','already_absent') and ${t.deletedAt} is not null and ${t.objectState}='absent' and ${t.deleteAttempt}>0)) is true`,
    ),
    check(
      "np_agent_preview_artifacts_retention_check",
      sql`${t.metadataPruneAt}>=${t.createdAt}+interval '365 days' and (${t.objectExpiresAt} is null or ${t.objectExpiresAt}>${t.createdAt})`,
    ),
  ],
);

export const npAgentPreviewArtifactUploads = pgTable(
  "np_agent_preview_artifact_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").notNull(),
    previewId: uuid("preview_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    uploadSetDigest: text("upload_set_digest").notNull(),
    uploadRequestDigest: text("upload_request_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    rowVersion: integer("row_version").notNull().default(1),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    callDeadlineAt: timestamp("call_deadline_at", { withTimezone: true, mode: "date" }),
    adapterOperationStatus: text("adapter_operation_status").notNull().default("not_dispatched"),
    adapterOperationRef: text("adapter_operation_ref"),
    adapterOperationReceiptDigest: text("adapter_operation_receipt_digest"),
    adapterOperationResolvedAt: timestamp("adapter_operation_resolved_at", {
      withTimezone: true,
      mode: "date",
    }),
    observedObjectState: text("observed_object_state").notNull().default("unknown"),
    everObservedPresent: boolean("ever_observed_present").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    pruneAt: timestamp("prune_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    unique("np_agent_preview_artifact_uploads_artifact_unique").on(t.artifactId),
    unique("np_agent_preview_artifact_uploads_idempotency_unique").on(t.idempotencyKey),
    index("np_agent_preview_artifact_uploads_state_idx").on(t.siteId, t.state, t.createdAt),
    foreignKey({
      name: "np_agent_preview_artifact_uploads_preview_fk",
      columns: [t.siteId, t.previewId],
      foreignColumns: [npAgentChangesetPreviews.siteId, npAgentChangesetPreviews.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_preview_artifact_uploads_artifact_fk",
      columns: [t.siteId, t.previewId, t.artifactId],
      foreignColumns: [
        npAgentPreviewArtifacts.siteId,
        npAgentPreviewArtifacts.previewId,
        npAgentPreviewArtifacts.id,
      ],
    }).onDelete("restrict"),
    check(
      "np_agent_preview_artifact_uploads_bounds_check",
      sql`${t.attempt} between 0 and 255 and ${t.rowVersion}>0 and ${t.pruneAt}>=${t.createdAt}+interval '365 days' and (${t.adapterOperationRef} is null or char_length(${t.adapterOperationRef}) between 1 and 512) and ${t.uploadSetDigest} ~ '^aus1:sha256:[A-Za-z0-9_-]{43}$' and ${t.uploadRequestDigest} ~ '^aur1:sha256:[A-Za-z0-9_-]{43}$' and ${t.idempotencyKey} ~ '^npau1_[A-Za-z0-9_-]{43}$'`,
    ),
    check(
      "np_agent_preview_artifact_uploads_state_check",
      sql`${t.state} in ('queued','running','waiting_inspection','succeeded','failed','cancelled') and ${t.adapterOperationStatus} in ('not_dispatched','pending','unknown','not_started','committed','failed_no_effect') and ${t.observedObjectState} in ('unknown','present','absent') and (${t.observedObjectState}<>'present' or ${t.everObservedPresent})`,
    ),
    check(
      "np_agent_preview_artifact_uploads_receipt_check",
      sql`((${t.adapterOperationStatus} in ('not_dispatched','pending','unknown') and ${t.adapterOperationReceiptDigest} is null and ${t.adapterOperationResolvedAt} is null) or (${t.adapterOperationStatus} in ('not_started','committed','failed_no_effect') and ${t.adapterOperationReceiptDigest} ~ '^auo1:sha256:[A-Za-z0-9_-]{43}$' and ${t.adapterOperationResolvedAt} is not null)) is true`,
    ),
    check(
      "np_agent_preview_artifact_uploads_lifecycle_check",
      sql`(
    (${t.state}='queued' and ${t.attempt}=0 and ${t.adapterOperationStatus}='not_dispatched' and not ${t.everObservedPresent} and ${t.observedObjectState}='unknown' and ${t.startedAt} is null and ${t.leaseUntil} is null and ${t.callDeadlineAt} is null and ${t.finishedAt} is null and ${t.verifiedAt} is null) or
    (${t.state}='running' and ${t.attempt}>0 and ${t.startedAt} is not null and ${t.leaseUntil} is not null and ${t.callDeadlineAt} is not null and ${t.finishedAt} is null and ${t.verifiedAt} is null) or
    (${t.state}='waiting_inspection' and ${t.attempt}>0 and ${t.startedAt} is not null and ${t.leaseUntil} is null and ${t.callDeadlineAt} is not null and ${t.finishedAt} is null and ${t.verifiedAt} is null) or
    (${t.state}='succeeded' and ${t.attempt}>0 and ${t.startedAt} is not null and ${t.leaseUntil} is null and ${t.callDeadlineAt} is not null and ${t.finishedAt} is not null and ${t.adapterOperationStatus}='committed' and ${t.observedObjectState}='present' and ${t.everObservedPresent} and ${t.verifiedAt} is not null) or
    (${t.state} in ('failed','cancelled') and ${t.leaseUntil} is null and ${t.finishedAt} is not null and ${t.verifiedAt} is null and ((${t.adapterOperationStatus} in ('not_started','failed_no_effect') and ${t.observedObjectState}='absent') or (${t.adapterOperationStatus}='committed' and ${t.observedObjectState} in ('present','absent')) or (${t.state}='cancelled' and ${t.attempt}=0 and ${t.adapterOperationStatus}='not_dispatched' and ${t.startedAt} is null and ${t.callDeadlineAt} is null and not ${t.everObservedPresent} and ${t.observedObjectState}='absent')))
  ) is true`,
    ),
    check(
      "np_agent_preview_artifact_uploads_time_check",
      sql`(${t.startedAt} is null or ${t.startedAt}>=${t.createdAt}) and (${t.callDeadlineAt} is null or (${t.callDeadlineAt}>${t.startedAt} and ${t.callDeadlineAt}<=${t.startedAt}+interval '60 seconds')) and (${t.finishedAt} is null or ${t.finishedAt}>=${t.createdAt})`,
    ),
  ],
);

export const npAgentPreviewViewerLaunches = pgTable(
  "np_agent_preview_viewer_launches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: text("site_id").notNull(),
    previewId: uuid("preview_id").notNull(),
    staffUserId: uuid("staff_user_id").notNull(),
    staffSessionId: uuid("staff_session_id").notNull(),
    sessionFingerprint: text("session_fingerprint").notNull(),
    sessionFingerprintKeyId: text("session_fingerprint_key_id").notNull(),
    generation: integer("generation").notNull(),
    admittingInvocationId: uuid("admitting_invocation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    signingKid: text("signing_kid").notNull(),
    allowedRoutesDigest: text("allowed_routes_digest").notNull(),
    siteAuthorizationBody: jsonb("site_authorization_body")
      .$type<NpAgentStaffSiteAuthorizationCanonicalV1>()
      .notNull(),
    siteAuthorizationDigest: text("site_authorization_digest").notNull(),
    iat: integer("iat").notNull(),
    exp: integer("exp").notNull(),
    launchPath: text("launch_path").notNull(),
    exchangeVerifier: text("exchange_verifier").notNull(),
    exchangeKeyId: text("exchange_key_id").notNull(),
    exchangeExpiresAt: timestamp("exchange_expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    exchangeConsumedAt: timestamp("exchange_consumed_at", { withTimezone: true, mode: "date" }),
    oneTimeValueIssued: boolean("one_time_value_issued").notNull().default(true),
    state: text("state").notNull().default("exchange_pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
    expiredAt: timestamp("expired_at", { withTimezone: true, mode: "date" }),
    terminalReason: text("terminal_reason"),
  },
  (t) => [
    unique("np_agent_preview_viewer_launches_generation_unique").on(
      t.previewId,
      t.staffSessionId,
      t.generation,
    ),
    unique("np_agent_preview_viewer_launches_invocation_unique").on(
      t.siteId,
      t.admittingInvocationId,
    ),
    uniqueIndex("np_agent_preview_viewer_launches_active_unique")
      .on(t.previewId, t.staffSessionId)
      .where(sql`${t.state} in ('exchange_pending','active')`),
    index("np_agent_preview_viewer_launches_site_state_idx").on(t.siteId, t.state, t.createdAt),
    foreignKey({
      name: "np_agent_preview_viewer_launches_preview_fk",
      columns: [t.siteId, t.previewId],
      foreignColumns: [npAgentChangesetPreviews.siteId, npAgentChangesetPreviews.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_preview_viewer_launches_invocation_fk",
      columns: [t.siteId, t.admittingInvocationId],
      foreignColumns: [npAgentInvocations.siteId, npAgentInvocations.id],
    }).onDelete("restrict"),
    check(
      "np_agent_preview_viewer_launches_claims_check",
      sql`(${t.generation}>0 and ${t.iat}>=0 and ${t.exp}>${t.iat} and ${t.exp}<=${t.iat}+300 and ${t.oneTimeValueIssued} and ${t.siteAuthorizationBody}->>'siteId'=${t.siteId} and ${t.siteAuthorizationBody}->>'userId'=${t.staffUserId}::text and ${t.siteAuthorizationBody}->>'schemaVersion'='np.agent-staff-site-authorization.v1' and ${t.sessionFingerprint} ~ '^psf1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$' and split_part(${t.sessionFingerprint},':',3)=${t.sessionFingerprintKeyId} and ${t.siteAuthorizationDigest} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.allowedRoutesDigest} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.requestHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.exchangeVerifier} ~ '^lxv1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$' and split_part(${t.exchangeVerifier},':',3)=${t.exchangeKeyId} and ${t.exchangeExpiresAt}>${t.createdAt} and ${t.exchangeExpiresAt}<=${t.createdAt}+interval '30 seconds') is true`,
    ),
    check(
      "np_agent_preview_viewer_launches_state_check",
      sql`((${t.state}='exchange_pending' and ${t.activatedAt} is null and ${t.exchangeConsumedAt} is null and ${t.supersededAt} is null and ${t.expiredAt} is null and ${t.terminalReason} is null) or (${t.state}='active' and ${t.activatedAt} is not null and ${t.exchangeConsumedAt} is not null and ${t.supersededAt} is null and ${t.expiredAt} is null and ${t.terminalReason} is null) or (${t.state}='superseded' and ${t.supersededAt} is not null and ${t.expiredAt} is null and ${t.terminalReason} in ('REPLACED','SESSION_REVOKED','PREVIEW_INVALIDATED','SITE_DELETING')) or (${t.state}='expired' and ${t.expiredAt} is not null and ${t.supersededAt} is null and ${t.terminalReason} in ('REPLACED','SESSION_REVOKED','PREVIEW_INVALIDATED','SITE_DELETING'))) is true`,
    ),
  ],
);

export const npAgentPreviewRenderSessions = pgTable(
  "np_agent_preview_render_sessions",
  {
    id: uuid("id").primaryKey(),
    siteId: text("site_id").notNull(),
    previewId: uuid("preview_id").notNull(),
    generation: integer("generation").notNull(),
    planHash: text("plan_hash").notNull(),
    renderAttemptId: uuid("render_attempt_id").notNull(),
    allowedRoutesDigest: text("allowed_routes_digest").notNull(),
    previewContractFingerprint: text("preview_contract_fingerprint").notNull(),
    state: text("state").notNull().default("active"),
    cookieVerifier: text("cookie_verifier").notNull(),
    cookieVerifierKeyId: text("cookie_verifier_key_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    closeReason: text("close_reason"),
    capturePlan: jsonb("capture_plan")
      .$type<
        Array<{
          ordinal: number;
          route: string;
          locale: string | null;
          audience: "public";
          viewportName: "desktop" | "mobile";
          width: number;
          height: number;
          deviceScaleFactor: 1 | 2;
          captureTicketDigest: string;
          captureTicketKeyId: string;
        }>
      >()
      .notNull(),
    consumedOrdinals: jsonb("consumed_ordinals").$type<boolean[]>().notNull(),
  },
  (t) => [
    unique("np_agent_preview_render_sessions_attempt_unique").on(
      t.previewId,
      t.generation,
      t.renderAttemptId,
    ),
    index("np_agent_preview_render_sessions_expiry_idx").on(t.siteId, t.state, t.expiresAt),
    foreignKey({
      name: "np_agent_preview_render_sessions_preview_fk",
      columns: [t.siteId, t.previewId, t.previewContractFingerprint],
      foreignColumns: [
        npAgentChangesetPreviews.siteId,
        npAgentChangesetPreviews.id,
        npAgentChangesetPreviews.previewContractFingerprint,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "np_agent_preview_render_sessions_reservation_fk",
      columns: [t.siteId, t.previewId, t.id, t.renderAttemptId],
      foreignColumns: [
        npAgentChangesetPreviews.siteId,
        npAgentChangesetPreviews.id,
        npAgentChangesetPreviews.renderSessionId,
        npAgentChangesetPreviews.renderAttemptId,
      ],
    }).onDelete("restrict"),
    check(
      "np_agent_preview_render_sessions_claims_check",
      sql`(${t.generation}>0 and ${t.expiresAt}>${t.issuedAt} and ${t.expiresAt}<=${t.issuedAt}+interval '120 seconds' and ${t.cookieVerifier} ~ '^rcv1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$' and split_part(${t.cookieVerifier},':',3)=${t.cookieVerifierKeyId} and ${t.planHash} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ${t.allowedRoutesDigest} ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof(${t.capturePlan})='array' and jsonb_array_length(${t.capturePlan}) between 1 and 20 and jsonb_typeof(${t.consumedOrdinals})='array' and jsonb_array_length(${t.capturePlan})=jsonb_array_length(${t.consumedOrdinals}) and octet_length(${t.capturePlan}::text)<=65536) is true`,
    ),
    check(
      "np_agent_preview_render_sessions_state_check",
      sql`((${t.state}='active' and ${t.closedAt} is null and ${t.closeReason} is null) or (${t.state}='completed' and ${t.closedAt} is not null and ${t.closeReason} is null and not ${t.consumedOrdinals} @> '[false]'::jsonb) or (${t.state} in ('failed','cancelled','expired') and ${t.closedAt} is not null and ${t.closeReason} in ('CAPTURE_FAILED','PREVIEW_INVALIDATED','SITE_DELETING','SESSION_EXPIRED'))) is true`,
    ),
  ],
);
