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
  NpAgentCapabilityRegistryEntryCanonicalV1,
  NpAgentConnectionConfigCanonicalV1,
  NpAgentInvocationRequestCanonicalV1,
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
    ).$type<NpAgentCapabilityRegistryEntryCanonicalV1>(),
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
          ((${table.accountSubjectKeyId} is null and ${table.accountSubjectDigest} is null and ${table.status} = 'pending') or
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
        (${table.status} <> 'destroyed' and (${table.secretRef} is not null or ${table.status} = 'pending'))`,
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
