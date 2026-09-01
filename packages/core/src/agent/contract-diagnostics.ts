import {
  npAgentContractDiagnosticIssueCodesV1,
  npAgentDiagnosticEntitiesV1,
  npAgentDiagnosticStatesV1,
  npRequireAgentHealthSummaryV1,
  type NpAgentAdapterReadinessV1,
  type NpAgentContractDiagnosticIssueCodeV1,
  type NpAgentContractDiagnosticIssueV1,
  type NpAgentDiagnosticEntityV1,
  type NpAgentDiagnosticStateCountV1,
  type NpAgentDiagnosticStateV1,
  type NpAgentHealthSummaryV1,
} from "../agent-contract/index.js";
import { getDb } from "../db/runtime.js";
import type { NpAgentConnectionAuthAdapterRegistryV1 } from "./provider-auth-contract.js";
import type { NpAgentVaultAdapterRegistryV1 } from "./vault-runtime.js";

const AGENT_TABLES = [
  "np_agent_actions",
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
  "np_agent_runs",
  "np_agent_service_tokens",
  "np_agent_site_deletion_sagas",
  "np_agent_vault_entries",
  "np_agent_vault_operations",
] as const;

/** Critical state and same-site constraints whose absence weakens fail-closed diagnostics. */
const AGENT_CONSTRAINTS = [
  "np_agent_actions_invocation_fk",
  "np_agent_actions_read_effect_check",
  "np_agent_actions_run_fk",
  "np_agent_actions_state_check",
  "np_agent_actions_terminal_check",
  "np_agent_connection_auth_requests_callback_links_check",
  "np_agent_connection_auth_requests_config_fk",
  "np_agent_connection_auth_requests_connection_fk",
  "np_agent_connection_auth_requests_expected_secret_fk",
  "np_agent_connection_auth_requests_pkce_secret_fk",
  "np_agent_connection_auth_requests_code_secret_fk",
  "np_agent_connection_auth_requests_code_vault_operation_fk",
  "np_agent_connection_auth_requests_connection_operation_fk",
  "np_agent_connection_auth_requests_status_check",
  "np_agent_connection_config_versions_connection_fk",
  "np_agent_connection_config_versions_state_check",
  "np_agent_connection_config_versions_state_time_check",
  "np_agent_connection_operations_auth_request_fk",
  "np_agent_connection_operations_config_fk",
  "np_agent_connection_operations_connection_fk",
  "np_agent_connection_operations_expected_secret_fk",
  "np_agent_connection_operations_invocation_fk",
  "np_agent_connection_operations_state_check",
  "np_agent_connection_operations_state_time_check",
  "np_agent_connection_secret_versions_connection_fk",
  "np_agent_connection_secret_versions_seal_operation_fk",
  "np_agent_connection_secret_versions_state_time_check",
  "np_agent_connection_secret_versions_status_check",
  "np_agent_connections_active_config_fk",
  "np_agent_connections_active_secret_fk",
  "np_agent_connections_state_matrix_check",
  "np_agent_connections_status_check",
  "np_agent_invocations_principal_fk",
  "np_agent_invocations_state_check",
  "np_agent_invocations_state_time_check",
  "np_agent_oauth_clients_status_check",
  "np_agent_oauth_clients_version_check",
  "np_agent_oauth_codes_client_fk",
  "np_agent_oauth_codes_grant_fk",
  "np_agent_oauth_codes_request_fk",
  "np_agent_oauth_codes_status_check",
  "np_agent_oauth_grants_client_fk",
  "np_agent_oauth_grants_principal_fk",
  "np_agent_oauth_grants_status_check",
  "np_agent_oauth_refresh_tokens_grant_fk",
  "np_agent_oauth_refresh_tokens_parent_fk",
  "np_agent_oauth_refresh_tokens_replacement_fk",
  "np_agent_oauth_refresh_tokens_status_check",
  "np_agent_oauth_requests_client_fk",
  "np_agent_oauth_requests_status_check",
  "np_agent_principals_status_check",
  "np_agent_runs_invocation_fk",
  "np_agent_runs_principal_fk",
  "np_agent_runs_state_check",
  "np_agent_runs_terminal_check",
  "np_agent_service_tokens_principal_fk",
  "np_agent_service_tokens_replaces_fk",
  "np_agent_service_tokens_status_check",
  "np_agent_site_deletion_sagas_state_check",
  "np_agent_vault_entries_secret_fk",
  "np_agent_vault_operations_connection_fk",
  "np_agent_vault_operations_secret_fk",
  "np_agent_vault_operations_state_check",
  "np_agent_vault_operations_state_time_check",
] as const;

const ISSUE_CODES = new Set<string>(npAgentContractDiagnosticIssueCodesV1);
const ENTITIES = new Set<string>(npAgentDiagnosticEntitiesV1);
const STATES = new Set<string>(npAgentDiagnosticStatesV1);

export interface NpAgentDiagnosticsQueryClientV1 {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

interface RawIssueRow extends Record<string, unknown> {
  code: unknown;
  count: unknown;
  oldest_age_seconds: unknown;
}

interface RawStateRow extends Record<string, unknown> {
  entity: unknown;
  state: unknown;
  count: unknown;
  oldest_age_seconds: unknown;
}

interface RawRequiredAdapterRow extends Record<string, unknown> {
  adapter_id: unknown;
  contract_version: unknown;
  fingerprint: unknown;
}

export interface NpAgentDiagnosticsOptionsV1 {
  client?: NpAgentDiagnosticsQueryClientV1;
  providerRegistry?: NpAgentConnectionAuthAdapterRegistryV1;
  vaultRegistry?: NpAgentVaultAdapterRegistryV1;
  now?: Date;
}

const STATE_SUMMARY_SQL = `
  with state_rows(entity, state, occurred_at) as (
    select 'action', state, created_at from public.np_agent_actions
    union all select 'run', state, queued_at from public.np_agent_runs
    union all select 'principal', status, created_at from public.np_agent_principals
    union all select 'service-token', status, created_at from public.np_agent_service_tokens
    union all select 'oauth-client', status, created_at from public.np_agent_oauth_clients
    union all select 'oauth-request', status, created_at from public.np_agent_oauth_requests
    union all select 'oauth-grant', status, created_at from public.np_agent_oauth_grants
    union all select 'oauth-refresh-token', status, created_at from public.np_agent_oauth_refresh_tokens
    union all select 'oauth-code', status, created_at from public.np_agent_oauth_codes
    union all select 'connection', status, created_at from public.np_agent_connections
    union all select 'connection-config', state, created_at from public.np_agent_connection_config_versions
    union all select 'invocation', state, requested_at from public.np_agent_invocations
    union all select 'connection-auth-request', status, created_at from public.np_agent_connection_auth_requests
    union all select 'connection-operation', state, created_at from public.np_agent_connection_operations
    union all select 'connection-secret', status, created_at from public.np_agent_connection_secret_versions
    union all select 'vault-operation', state, created_at from public.np_agent_vault_operations
    union all
      select 'vault-entry', case when destroyed_at is null then 'active' else 'destroyed' end, created_at
        from public.np_agent_vault_entries
    union all select 'site-deletion-saga', state, created_at from public.np_agent_site_deletion_sagas
  )
  select entity, state, count(*)::text as count,
         greatest(0, floor(extract(epoch from ($1::timestamptz - min(occurred_at)))))::text
           as oldest_age_seconds
    from state_rows
   group by entity, state
   order by entity, state
`;

const ISSUE_SUMMARY_SQL = `
  with violations(code, occurred_at) as (
    select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_actions
     where state not in ('proposed', 'policy_blocked', 'approval_pending', 'approved', 'executing', 'succeeded', 'failed', 'compensated')
    union all select 'AGENT_ROW_STATE_INVALID', queued_at from public.np_agent_runs
     where state not in ('queued', 'running', 'waiting_approval', 'waiting_retry', 'verifying', 'succeeded', 'failed', 'cancelled', 'policy_blocked', 'budget_blocked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_principals
     where status not in ('active', 'suspended', 'revoked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_service_tokens
     where status not in ('active_head', 'overlap', 'revoked', 'expired')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_oauth_clients
     where status not in ('active', 'revoked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_oauth_requests
     where status not in ('pending', 'authorized', 'denied', 'consumed', 'expired')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_oauth_grants
     where status not in ('active', 'revoked', 'expired')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_oauth_refresh_tokens
     where status not in ('active', 'consumed', 'revoked', 'expired')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_oauth_codes
     where status not in ('active', 'consumed', 'revoked', 'expired')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connections
     where status not in ('pending', 'ready', 'error', 'disabled', 'revoked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connection_config_versions
     where state not in ('candidate', 'active', 'retired', 'rejected')
    union all select 'AGENT_ROW_STATE_INVALID', requested_at from public.np_agent_invocations
     where state not in ('started', 'accepted', 'approval_required', 'completed', 'failed')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connection_auth_requests
     where status not in ('pending', 'consumed', 'denied', 'failed', 'expired', 'revoked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connection_operations
     where state not in ('awaiting_secret', 'queued', 'running', 'succeeded', 'failed', 'ambiguous', 'cancelled')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connection_secret_versions
     where status not in ('pending', 'active', 'retiring', 'revoked', 'destroyed')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_vault_operations
     where state not in ('queued', 'running', 'waiting_inspection', 'succeeded', 'failed')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_site_deletion_sagas
     where state not in ('prepared', 'cleaning', 'ready_to_commit', 'failed', 'committing')

    union all
      select 'AGENT_CONNECTION_POINTER_DIVERGED', c.created_at
        from public.np_agent_connections c
        left join public.np_agent_connection_config_versions cfg on cfg.id = c.active_config_snapshot_id
       where cfg.id is null or cfg.site_id <> c.site_id or cfg.connection_id <> c.id
          or cfg.version <> c.config_version or cfg.config_hash <> c.config_hash
          or cfg.adapter_contract_version <> c.adapter_contract_version
          or cfg.pricing_catalog_fingerprint <> c.pricing_catalog_fingerprint
          or cfg.data_processing_ceiling <> c.data_processing_ceiling or cfg.state <> 'active'
    union all
      select 'AGENT_CONNECTION_POINTER_DIVERGED', c.created_at
        from public.np_agent_connections c
        left join public.np_agent_connection_secret_versions sec on sec.id = c.active_secret_version_id
       where c.active_secret_version_id is not null and
             (sec.id is null or sec.site_id <> c.site_id or sec.connection_id <> c.id
              or sec.purpose <> 'connection-credential' or sec.status <> 'active'
              or sec.version <> c.credential_version)
    union all
      select 'AGENT_CONNECTION_CONFIG_DIVERGED', cfg.created_at
        from public.np_agent_connection_config_versions cfg
        join public.np_agent_connections c on c.id = cfg.connection_id
       where c.site_id <> cfg.site_id or c.provider <> cfg.adapter_id
          or (cfg.state = 'active' and c.active_config_snapshot_id <> cfg.id)

    union all
      select 'AGENT_AUTH_REQUEST_DIVERGED', ar.created_at
        from public.np_agent_connection_auth_requests ar
        left join public.np_agent_connections c on c.id = ar.connection_id
        left join public.np_agent_connection_config_versions cfg on cfg.id = ar.config_snapshot_id
       where c.id is null or c.site_id <> ar.site_id or cfg.id is null or cfg.site_id <> ar.site_id
          or cfg.connection_id <> ar.connection_id
          or cfg.version <> ar.connection_config_version
          or cfg.config_hash <> ar.connection_config_hash
          or cfg.adapter_contract_version <> ar.adapter_contract_version
          or cfg.adapter_fingerprint <> ar.adapter_contract_fingerprint
    union all
      select 'AGENT_AUTH_REQUEST_DIVERGED', ar.created_at
        from public.np_agent_connection_auth_requests ar
        left join public.np_agent_connection_secret_versions pkce on pkce.id = ar.pkce_secret_version_id
        left join public.np_agent_connection_secret_versions code on code.id = ar.code_secret_version_id
        left join public.np_agent_vault_operations vault_op on vault_op.id = ar.code_vault_operation_id
        left join public.np_agent_connection_operations conn_op on conn_op.id = ar.connection_operation_id
       where pkce.id is null or pkce.site_id <> ar.site_id or pkce.connection_id <> ar.connection_id
          or pkce.purpose <> 'provider-oauth-pkce'
          or (ar.code_secret_version_id is not null and
              (code.id is null or code.site_id <> ar.site_id or code.connection_id <> ar.connection_id
               or code.purpose <> 'provider-oauth-code'))
          or (ar.code_vault_operation_id is not null and
              (vault_op.id is null or vault_op.site_id <> ar.site_id
               or vault_op.secret_version_id <> ar.code_secret_version_id))
          or (ar.connection_operation_id is not null and
              (conn_op.id is null or conn_op.site_id <> ar.site_id or conn_op.auth_request_id <> ar.id))

    union all
      select 'AGENT_CONNECTION_OPERATION_DIVERGED', op.created_at
        from public.np_agent_connection_operations op
        left join public.np_agent_connections c on c.id = op.connection_id
        left join public.np_agent_connection_config_versions cfg on cfg.id = op.config_snapshot_id
       where c.id is null or c.site_id <> op.site_id or cfg.id is null or cfg.site_id <> op.site_id
          or cfg.connection_id <> op.connection_id or cfg.version <> op.expected_config_version
          or cfg.config_hash <> op.expected_config_hash
          or cfg.adapter_contract_version <> op.adapter_contract_version
          or cfg.adapter_fingerprint <> op.adapter_fingerprint
    union all
      select 'AGENT_CONNECTION_OPERATION_DIVERGED', op.created_at
        from public.np_agent_connection_operations op
        join lateral unnest(op.input_secret_version_ids) secret_id on true
        left join public.np_agent_connection_secret_versions sec on sec.id = secret_id
       where sec.id is null or sec.site_id <> op.site_id or sec.connection_id <> op.connection_id

    union all
      select 'AGENT_VAULT_OPERATION_DIVERGED', op.created_at
        from public.np_agent_vault_operations op
        left join public.np_agent_connection_secret_versions sec on sec.id = op.secret_version_id
        left join public.np_agent_connections c on c.id = op.connection_id
       where sec.id is null or sec.site_id <> op.site_id or sec.connection_id <> op.connection_id
          or c.id is null or c.site_id <> op.site_id
          or sec.vault_adapter <> op.vault_adapter
          or sec.vault_adapter_contract_version <> op.vault_adapter_contract_version
          or sec.vault_adapter_fingerprint <> op.vault_adapter_fingerprint
          or (op.kind = 'seal' and sec.seal_operation_id <> op.id)
    union all
      select 'AGENT_VAULT_ENTRY_DIVERGED', entry.created_at
        from public.np_agent_vault_entries entry
        left join public.np_agent_connection_secret_versions sec on sec.id = entry.secret_version_id
       where sec.id is null or sec.site_id <> entry.site_id or sec.vault_adapter <> 'local-envelope'
          or sec.aad_digest <> entry.aad_digest
          or sec.secret_ref is distinct from ('local-envelope:' || entry.id::text)
          or (entry.destroyed_at is null) <> (sec.status <> 'destroyed')

    union all
      select 'AGENT_RELATION_ORPHANED', edge.occurred_at from (
        select a.created_at as occurred_at from public.np_agent_actions a
          left join public.np_agent_invocations i on i.id = a.invocation_id
          where a.invocation_id is not null and i.id is null
        union all select a.created_at from public.np_agent_actions a
          left join public.np_agent_runs r on r.id = a.run_id
          where a.run_id is not null and r.id is null
        union all select r.queued_at from public.np_agent_runs r
          left join public.np_agent_principals p on p.id = r.principal_id where p.id is null
        union all select r.queued_at from public.np_agent_runs r
          left join public.np_agent_invocations i on i.id = r.invocation_id
          where r.invocation_id is not null and i.id is null
        union all select st.created_at as occurred_at from public.np_agent_service_tokens st
          left join public.np_agent_principals p on p.id = st.principal_id where p.id is null
        union all select req.created_at from public.np_agent_oauth_requests req
          left join public.np_agent_oauth_clients c on c.id = req.client_id where c.id is null
        union all select g.created_at from public.np_agent_oauth_grants g
          left join public.np_agent_oauth_clients c on c.id = g.client_id where c.id is null
        union all select g.created_at from public.np_agent_oauth_grants g
          left join public.np_agent_principals p on p.id = g.principal_id where p.id is null
        union all select token.created_at from public.np_agent_oauth_refresh_tokens token
          left join public.np_agent_oauth_grants g on g.id = token.grant_id where g.id is null
        union all select code.created_at from public.np_agent_oauth_codes code
          left join public.np_agent_oauth_requests req on req.id = code.request_id where req.id is null
        union all select code.created_at from public.np_agent_oauth_codes code
          left join public.np_agent_oauth_grants g on g.id = code.grant_id where g.id is null
        union all select code.created_at from public.np_agent_oauth_codes code
          left join public.np_agent_oauth_clients c on c.id = code.client_id where c.id is null
        union all select cfg.created_at from public.np_agent_connection_config_versions cfg
          left join public.np_agent_connections c on c.id = cfg.connection_id where c.id is null
        union all select op.created_at from public.np_agent_vault_operations op
          left join public.np_agent_connection_secret_versions sec on sec.id = op.secret_version_id
          where sec.id is null
        union all select entry.created_at from public.np_agent_vault_entries entry
          left join public.np_agent_connection_secret_versions sec on sec.id = entry.secret_version_id
          where sec.id is null
      ) edge

    union all
      select 'AGENT_RELATION_CROSS_SITE', edge.occurred_at from (
        select a.created_at as occurred_at from public.np_agent_actions a
          join public.np_agent_invocations i on i.id = a.invocation_id
          where i.site_id <> a.site_id
        union all select a.created_at from public.np_agent_actions a
          join public.np_agent_runs r on r.id = a.run_id where r.site_id <> a.site_id
        union all select r.queued_at from public.np_agent_runs r
          join public.np_agent_principals p on p.id = r.principal_id where p.site_id <> r.site_id
        union all select r.queued_at from public.np_agent_runs r
          join public.np_agent_invocations i on i.id = r.invocation_id where i.site_id <> r.site_id
        union all select st.created_at as occurred_at from public.np_agent_service_tokens st
          join public.np_agent_principals p on p.id = st.principal_id where p.site_id <> st.site_id
        union all select req.created_at from public.np_agent_oauth_requests req
          join public.np_agent_oauth_clients c on c.id = req.client_id where c.site_id <> req.site_id
        union all select g.created_at from public.np_agent_oauth_grants g
          join public.np_agent_oauth_clients c on c.id = g.client_id where c.site_id <> g.site_id
        union all select g.created_at from public.np_agent_oauth_grants g
          join public.np_agent_principals p on p.id = g.principal_id where p.site_id <> g.site_id
        union all select token.created_at from public.np_agent_oauth_refresh_tokens token
          join public.np_agent_oauth_grants g on g.id = token.grant_id where g.site_id <> token.site_id
        union all select cfg.created_at from public.np_agent_connection_config_versions cfg
          join public.np_agent_connections c on c.id = cfg.connection_id where c.site_id <> cfg.site_id
        union all select op.created_at from public.np_agent_vault_operations op
          join public.np_agent_connection_secret_versions sec on sec.id = op.secret_version_id
          where sec.site_id <> op.site_id
        union all select entry.created_at from public.np_agent_vault_entries entry
          join public.np_agent_connection_secret_versions sec on sec.id = entry.secret_version_id
          where sec.site_id <> entry.site_id
      ) edge

    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_service_tokens
      where status in ('active_head', 'overlap') and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_oauth_requests
      where status in ('pending', 'authorized') and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_oauth_grants
      where status = 'active' and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_oauth_refresh_tokens
      where status = 'active' and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_oauth_codes
      where status = 'active' and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_connection_auth_requests
      where status = 'pending' and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', created_at from public.np_agent_connection_secret_versions
      where status = 'pending' and expires_at is not null and expires_at <= $1::timestamptz

    union all select 'AGENT_STALE_INVOCATION', requested_at from public.np_agent_invocations
      where state in ('started', 'accepted', 'approval_required') and expires_at <= $1::timestamptz
    union all select 'AGENT_STALE_CONNECTION_OPERATION', created_at
      from public.np_agent_connection_operations
     where (state = 'awaiting_secret' and created_at <= $1::timestamptz - interval '10 minutes')
        or (state = 'queued' and deadline_at <= $1::timestamptz)
        or (state = 'running' and (lease_until <= $1::timestamptz or deadline_at <= $1::timestamptz))
    union all select 'AGENT_STALE_VAULT_OPERATION', created_at from public.np_agent_vault_operations
      where state in ('running', 'waiting_inspection') and lease_until <= $1::timestamptz

    union all select 'AGENT_DELETION_SAGA_DIVERGED', created_at
      from public.np_agent_site_deletion_sagas
     where ((state in ('ready_to_commit', 'committing')) <> (cleanup_completed_at is not null))
        or (state = 'cleaning' and lease_until is not null and lease_until <= $1::timestamptz)
  )
  select code, count(*)::text as count,
         greatest(0, floor(extract(epoch from ($1::timestamptz - min(occurred_at)))))::text
           as oldest_age_seconds
    from violations
   group by code
   order by code
`;

const REQUIRED_PROVIDER_ADAPTERS_SQL = `
  select distinct cfg.adapter_id, cfg.adapter_contract_version::text as contract_version,
         cfg.adapter_fingerprint as fingerprint
    from public.np_agent_connections c
    join public.np_agent_connection_config_versions cfg on cfg.id = c.active_config_snapshot_id
   where c.status <> 'revoked'
   order by adapter_id, contract_version, fingerprint
`;

const REQUIRED_VAULT_ADAPTERS_SQL = `
  select distinct sec.vault_adapter as adapter_id,
         sec.vault_adapter_contract_version::text as contract_version,
         sec.vault_adapter_fingerprint as fingerprint
    from public.np_agent_connection_secret_versions sec
   where sec.status <> 'destroyed'
   order by adapter_id, contract_version, fingerprint
`;

function resolveClient(client?: NpAgentDiagnosticsQueryClientV1): NpAgentDiagnosticsQueryClientV1 {
  if (client) return client;
  return (getDb() as unknown as { $client: NpAgentDiagnosticsQueryClientV1 }).$client;
}

function integer(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("invalid diagnostic integer");
  return parsed;
}

function nullableAge(value: unknown): number | null {
  return value === null || value === undefined ? null : integer(value);
}

function issue(code: NpAgentContractDiagnosticIssueCodeV1, count: number): RawIssueRow {
  return { code, count: count.toString(), oldest_age_seconds: null };
}

async function collectSchemaIssues(
  client: NpAgentDiagnosticsQueryClientV1,
): Promise<RawIssueRow[]> {
  const tableResult = await client.query<{ missing_count: unknown }>(
    `select count(*)::text as missing_count
       from unnest($1::text[]) expected(name)
      where to_regclass('public.' || expected.name) is null`,
    [[...AGENT_TABLES]],
  );
  const constraintResult = await client.query<{
    missing_count: unknown;
    unvalidated_count: unknown;
  }>(
    `select count(*) filter (where constraint_row.oid is null)::text as missing_count,
            count(*) filter (where constraint_row.oid is not null and not constraint_row.convalidated)::text
              as unvalidated_count
       from unnest($1::text[]) expected(name)
       left join pg_constraint constraint_row
         on constraint_row.conname = expected.name
        and constraint_row.connamespace = 'public'::regnamespace`,
    [[...AGENT_CONSTRAINTS]],
  );
  const missingTables = integer(tableResult.rows[0]?.missing_count ?? 0);
  const missingConstraints = integer(constraintResult.rows[0]?.missing_count ?? 0);
  const unvalidatedConstraints = integer(constraintResult.rows[0]?.unvalidated_count ?? 0);
  return [
    ...(missingTables > 0 ? [issue("AGENT_SCHEMA_TABLE_MISSING", missingTables)] : []),
    ...(missingConstraints > 0
      ? [issue("AGENT_SCHEMA_CONSTRAINT_MISSING", missingConstraints)]
      : []),
    ...(unvalidatedConstraints > 0
      ? [issue("AGENT_SCHEMA_CONSTRAINT_UNVALIDATED", unvalidatedConstraints)]
      : []),
  ];
}

function parseIssues(rows: RawIssueRow[]): NpAgentContractDiagnosticIssueV1[] {
  const totals = new Map<
    NpAgentContractDiagnosticIssueCodeV1,
    { count: number; oldestAgeSeconds: number | null }
  >();
  for (const row of rows) {
    if (typeof row.code !== "string" || !ISSUE_CODES.has(row.code)) {
      throw new Error("invalid Agent diagnostic issue code");
    }
    const code = row.code as NpAgentContractDiagnosticIssueCodeV1;
    const count = integer(row.count);
    if (count === 0) continue;
    const age = nullableAge(row.oldest_age_seconds);
    const current = totals.get(code);
    totals.set(code, {
      count: (current?.count ?? 0) + count,
      oldestAgeSeconds:
        current?.oldestAgeSeconds === null || current?.oldestAgeSeconds === undefined
          ? age
          : age === null
            ? current.oldestAgeSeconds
            : Math.max(current.oldestAgeSeconds, age),
    });
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, value]) => ({ code, ...value }));
}

function parseStates(rows: RawStateRow[]): NpAgentDiagnosticStateCountV1[] {
  return rows.map((row) => {
    if (typeof row.entity !== "string" || !ENTITIES.has(row.entity)) {
      throw new Error("invalid Agent diagnostic entity");
    }
    if (typeof row.state !== "string" || !STATES.has(row.state)) {
      throw new Error("invalid Agent diagnostic state");
    }
    return {
      entity: row.entity as NpAgentDiagnosticEntityV1,
      state: row.state as NpAgentDiagnosticStateV1,
      count: integer(row.count),
      oldestAgeSeconds: nullableAge(row.oldest_age_seconds),
    };
  });
}

function parseRequiredAdapters(rows: RawRequiredAdapterRow[]) {
  return rows.map((row) => {
    if (
      typeof row.adapter_id !== "string" ||
      row.adapter_id.length === 0 ||
      typeof row.fingerprint !== "string" ||
      row.fingerprint.length === 0
    ) {
      throw new Error("invalid frozen adapter identity");
    }
    return {
      id: row.adapter_id,
      contractVersion: integer(row.contract_version),
      fingerprint: row.fingerprint,
    };
  });
}

function readiness(
  required: ReturnType<typeof parseRequiredAdapters>,
  available: readonly { id: string; contractVersion: number; fingerprint: string }[] | undefined,
): NpAgentAdapterReadinessV1 {
  if (required.length === 0) {
    return { state: "not-required", requiredCount: 0, availableCount: 0 };
  }
  if (!available) {
    return { state: "unknown", requiredCount: required.length, availableCount: 0 };
  }
  const availableKeys = new Set(
    available.map(
      (adapter) => `${adapter.id}\0${adapter.contractVersion.toString()}\0${adapter.fingerprint}`,
    ),
  );
  const availableCount = required.filter((adapter) =>
    availableKeys.has(
      `${adapter.id}\0${adapter.contractVersion.toString()}\0${adapter.fingerprint}`,
    ),
  ).length;
  return {
    state: availableCount === required.length ? "ready" : "unavailable",
    requiredCount: required.length,
    availableCount,
  };
}

function unavailableSummary(now: Date): NpAgentHealthSummaryV1 {
  return npRequireAgentHealthSummaryV1({
    schemaVersion: "np.agent-health-summary.v1",
    generatedAt: now.toISOString(),
    state: "error",
    issueCount: 1,
    issues: [{ code: "AGENT_SCHEMA_UNAVAILABLE", count: 1, oldestAgeSeconds: null }],
    states: [],
    readiness: {
      providers: { state: "unknown", requiredCount: 0, availableCount: 0 },
      vault: { state: "unknown", requiredCount: 0, availableCount: 0 },
    },
  });
}

/**
 * Collect one fail-closed, read-only Agent contract snapshot. Its projection
 * contains only aggregate counts, ages and adapter readiness; credentials,
 * locators, keyed digests, row identities and frozen adapter fingerprints
 * never cross the returned client-safe boundary.
 */
export async function npCollectAgentHealthSummaryV1(
  options: NpAgentDiagnosticsOptionsV1 = {},
): Promise<NpAgentHealthSummaryV1> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return unavailableSummary(new Date(0));
  try {
    const client = resolveClient(options.client);
    const schemaIssues = await collectSchemaIssues(client);
    if (schemaIssues.some((row) => row.code === "AGENT_SCHEMA_TABLE_MISSING")) {
      const issues = parseIssues(schemaIssues);
      return npRequireAgentHealthSummaryV1({
        schemaVersion: "np.agent-health-summary.v1",
        generatedAt: now.toISOString(),
        state: "error",
        issueCount: issues.reduce((total, current) => total + current.count, 0),
        issues,
        states: [],
        readiness: {
          providers: { state: "unknown", requiredCount: 0, availableCount: 0 },
          vault: { state: "unknown", requiredCount: 0, availableCount: 0 },
        },
      });
    }
    // Doctor uses one pg Client while Admin Health normally uses a Pool. Keep
    // these reads sequential so both hosts share the same supported contract.
    const issueResult = await client.query<RawIssueRow>(ISSUE_SUMMARY_SQL, [now.toISOString()]);
    const stateResult = await client.query<RawStateRow>(STATE_SUMMARY_SQL, [now.toISOString()]);
    const providerResult = await client.query<RawRequiredAdapterRow>(
      REQUIRED_PROVIDER_ADAPTERS_SQL,
    );
    const vaultResult = await client.query<RawRequiredAdapterRow>(REQUIRED_VAULT_ADAPTERS_SQL);
    const issues = parseIssues([...schemaIssues, ...issueResult.rows]);
    const providers = readiness(
      parseRequiredAdapters(providerResult.rows),
      options.providerRegistry?.list(),
    );
    const vault = readiness(parseRequiredAdapters(vaultResult.rows), options.vaultRegistry?.list());
    const issueCount = issues.reduce((total, current) => total + current.count, 0);
    const state =
      issueCount > 0
        ? "error"
        : providers.state === "ready" || providers.state === "not-required"
          ? vault.state === "ready" || vault.state === "not-required"
            ? "ok"
            : "warn"
          : "warn";
    return npRequireAgentHealthSummaryV1({
      schemaVersion: "np.agent-health-summary.v1",
      generatedAt: now.toISOString(),
      state,
      issueCount,
      issues,
      states: parseStates(stateResult.rows),
      readiness: { providers, vault },
    });
  } catch {
    return unavailableSummary(now);
  }
}

export const npAgentDiagnosticsSchemaInventoryV1 = Object.freeze({
  tables: Object.freeze([...AGENT_TABLES]),
  constraints: Object.freeze([...AGENT_CONSTRAINTS]),
});
