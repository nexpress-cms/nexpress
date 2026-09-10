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
  "np_agent_approvals",
  "np_agent_changeset_executions",
  "np_agent_changeset_operations",
  "np_agent_changeset_previews",
  "np_agent_changeset_rollback_operations",
  "np_agent_changeset_rollback_plans",
  "np_agent_changeset_validation_attempts",
  "np_agent_changesets",
  "np_agent_connection_auth_requests",
  "np_agent_connection_config_versions",
  "np_agent_connection_operations",
  "np_agent_connection_secret_versions",
  "np_agent_connections",
  "np_agent_invocations",
  "np_agent_mcp_tasks",
  "np_agent_oauth_clients",
  "np_agent_oauth_codes",
  "np_agent_oauth_grants",
  "np_agent_oauth_refresh_tokens",
  "np_agent_oauth_requests",
  "np_agent_preview_artifact_uploads",
  "np_agent_preview_artifacts",
  "np_agent_preview_render_sessions",
  "np_agent_preview_viewer_launches",
  "np_agent_principals",
  "np_agent_runs",
  "np_agent_service_tokens",
  "np_agent_site_deletion_sagas",
  "np_agent_vault_entries",
  "np_agent_vault_operations",
] as const;

/** Critical state and same-site constraints whose absence weakens fail-closed diagnostics. */
const AGENT_CONSTRAINTS = [
  "np_agent_changeset_rollback_operations_bounds_check",
  "np_agent_changeset_rollback_operations_changeset_fk",
  "np_agent_changeset_rollback_operations_hash_check",
  "np_agent_changeset_rollback_operations_original_fk",
  "np_agent_changeset_rollback_operations_plan_fk",
  "np_agent_changeset_rollback_operations_snapshot_check",
  "np_agent_changeset_rollback_operations_state_check",
  "np_agent_changeset_rollback_operations_time_check",
  "np_agent_changeset_rollback_plans_approval_check",
  "np_agent_changeset_rollback_plans_authority_check",
  "np_agent_changeset_rollback_plans_bounds_check",
  "np_agent_changeset_rollback_plans_changeset_fk",
  "np_agent_changeset_rollback_plans_hash_check",
  "np_agent_changeset_rollback_plans_invocation_fk",
  "np_agent_changeset_rollback_plans_sealed_check",
  "np_agent_changeset_rollback_plans_state_check",
  "np_agent_changeset_rollback_plans_terminal_check",
  "np_agent_changeset_rollback_plans_time_check",
  "np_agent_changeset_rollback_plans_execution_fk",
  "np_agent_changeset_rollback_plans_approval_fk",
  "np_agent_approvals_rollback_plan_fk",
  "np_agent_changeset_executions_rollback_plan_fk",
  "np_agent_changeset_executions_target_check",

  "np_agent_changeset_executions_changeset_fk",
  "np_agent_changeset_executions_approval_fk",
  "np_agent_changeset_executions_invocation_fk",
  "np_agent_changeset_executions_state_check",
  "np_agent_changeset_executions_hash_check",
  "np_agent_changeset_executions_lease_check",
  "np_agent_changeset_executions_time_check",
  "np_agent_changeset_executions_terminal_check",
  "np_agent_changeset_executions_verification_check",
  "np_agent_changeset_executions_effects_check",
  "np_agent_changeset_executions_result_check",

  "np_agent_changeset_previews_started_check",
  "np_agent_changeset_previews_changeset_fk",
  "np_agent_changeset_previews_invocation_fk",
  "np_agent_changeset_previews_run_fk",
  "np_agent_changeset_previews_state_check",
  "np_agent_changeset_previews_hash_check",
  "np_agent_changeset_previews_authority_check",
  "np_agent_changeset_previews_contract_check",
  "np_agent_changeset_previews_reservation_check",
  "np_agent_changeset_previews_bootstrap_check",
  "np_agent_changeset_previews_terminal_check",
  "np_agent_preview_artifacts_preview_fk",
  "np_agent_preview_artifacts_metadata_check",
  "np_agent_preview_artifacts_kind_check",
  "np_agent_preview_artifacts_state_check",
  "np_agent_preview_artifacts_delete_check",
  "np_agent_preview_artifacts_retention_check",
  "np_agent_preview_artifact_uploads_preview_fk",
  "np_agent_preview_artifact_uploads_artifact_fk",
  "np_agent_preview_artifact_uploads_bounds_check",
  "np_agent_preview_artifact_uploads_state_check",
  "np_agent_preview_artifact_uploads_receipt_check",
  "np_agent_preview_artifact_uploads_lifecycle_check",
  "np_agent_preview_artifact_uploads_time_check",
  "np_agent_preview_viewer_launches_preview_fk",
  "np_agent_preview_viewer_launches_invocation_fk",
  "np_agent_preview_viewer_launches_claims_check",
  "np_agent_preview_viewer_launches_state_check",
  "np_agent_preview_render_sessions_preview_fk",
  "np_agent_preview_render_sessions_reservation_fk",
  "np_agent_preview_render_sessions_claims_check",
  "np_agent_preview_render_sessions_state_check",

  "np_agent_actions_invocation_fk",
  "np_agent_actions_read_effect_check",
  "np_agent_actions_run_fk",
  "np_agent_actions_state_check",
  "np_agent_actions_terminal_check",
  "np_agent_changeset_validation_attempts_changeset_fk",
  "np_agent_changeset_validation_attempts_invocation_fk",
  "np_agent_changeset_validation_attempts_version_check",
  "np_agent_changeset_validation_attempts_state_check",
  "np_agent_changeset_validation_attempts_hash_check",
  "np_agent_changeset_validation_attempts_authority_check",
  "np_agent_changeset_validation_attempts_result_check",
  "np_agent_changeset_validation_attempts_time_check",
  "np_agent_changeset_validation_attempts_terminal_check",
  "np_agent_changesets_principal_fk",
  "np_agent_changesets_run_fk",
  "np_agent_changesets_invocation_fk",
  "np_agent_changesets_state_check",
  "np_agent_changesets_version_check",
  "np_agent_changesets_actor_check",
  "np_agent_changesets_sealed_check",
  "np_agent_changesets_time_check",
  "np_agent_changeset_operations_changeset_fk",
  "np_agent_changeset_operations_kind_check",
  "np_agent_changeset_operations_body_check",
  "np_agent_changeset_operations_snapshot_check",
  "np_agent_approvals_changeset_fk",
  "np_agent_approvals_action_fk",
  "np_agent_approvals_requester_fk",
  "np_agent_approvals_target_check",
  "np_agent_approvals_state_check",
  "np_agent_approvals_version_check",
  "np_agent_approvals_statement_check",
  "np_agent_approvals_decision_check",
  "np_agent_approvals_revocation_check",
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
  "np_agent_mcp_tasks_invocation_fk",
  "np_agent_mcp_tasks_principal_fk",
  "np_agent_mcp_tasks_result_check",
  "np_agent_mcp_tasks_run_fk",
  "np_agent_mcp_tasks_status_check",
  "np_agent_mcp_tasks_time_check",
  "np_agent_mcp_tasks_ttl_check",
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
    union all select 'changeset-validation-attempt', state, created_at from public.np_agent_changeset_validation_attempts
    union all select 'changeset-preview', state, created_at from public.np_agent_changeset_previews
    union all select 'preview-artifact', object_state, created_at from public.np_agent_preview_artifacts
    union all select 'preview-upload', state, created_at from public.np_agent_preview_artifact_uploads
    union all select 'preview-viewer-launch', state, created_at from public.np_agent_preview_viewer_launches
    union all select 'preview-render-session', state, issued_at from public.np_agent_preview_render_sessions
    union all select 'rollback-plan', state, created_at from public.np_agent_changeset_rollback_plans
    union all select 'rollback-operation', state, created_at from public.np_agent_changeset_rollback_operations
    union all select 'changeset-execution', state, reserved_at from public.np_agent_changeset_executions
    union all select 'changeset', state, created_at from public.np_agent_changesets
    union all select 'changeset-operation', state, created_at from public.np_agent_changeset_operations
    union all select 'approval', state, requested_at from public.np_agent_approvals
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
    union all select 'mcp-task', status, created_at from public.np_agent_mcp_tasks
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
    union all select 'AGENT_ROW_STATE_INVALID', p.created_at from public.np_agent_changeset_previews p
     where p.state not in ('queued','rendering','ready','failed','expired') or (p.state='ready' and (p.digest is null or p.completed_at is null or p.expires_at is null or p.expected_artifact_count is distinct from (select count(*)::int from public.np_agent_preview_artifacts a where a.site_id=p.site_id and a.preview_id=p.id) or exists(select 1 from public.np_agent_preview_artifacts a where a.site_id=p.site_id and a.preview_id=p.id and (a.object_state<>'ready' or a.object_expires_at is distinct from p.expires_at))))
    union all select 'AGENT_RELATION_CROSS_SITE', a.created_at from public.np_agent_preview_artifacts a
     where not exists(select 1 from public.np_agent_changeset_previews p where p.site_id=a.site_id and p.id=a.preview_id and p.preview_contract_fingerprint=a.preview_contract_fingerprint)
    union all select 'AGENT_ROW_STATE_INVALID', u.created_at from public.np_agent_preview_artifact_uploads u
     where not exists(select 1 from public.np_agent_changeset_previews p where p.site_id=u.site_id and p.id=u.preview_id and p.upload_set_digest=u.upload_set_digest) or not exists(select 1 from public.np_agent_preview_artifacts a where a.site_id=u.site_id and a.preview_id=u.preview_id and a.id=u.artifact_id)
    union all select 'AGENT_EXPIRY_BACKLOG', expires_at from public.np_agent_changeset_previews where state='ready' and expires_at<=$1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', exchange_expires_at from public.np_agent_preview_viewer_launches l where (state='exchange_pending' and exchange_expires_at<=$1::timestamptz) or (state='active' and to_timestamp(exp)<=$1::timestamptz)
    union all select 'AGENT_ROW_STATE_INVALID', l.created_at from public.np_agent_preview_viewer_launches l where state in ('exchange_pending','active') and not exists(select 1 from public.np_sessions s join public.np_users u on u.id=s.user_id where s.id=l.staff_session_id and u.id=l.staff_user_id and s.access_expires_at>$1::timestamptz and s.refresh_expires_at>$1::timestamptz)
    union all select 'AGENT_EXPIRY_BACKLOG', expires_at from public.np_agent_preview_render_sessions where state='active' and expires_at<=$1::timestamptz
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
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_changesets where state not in ('draft','validating','invalid','ready','approval_pending','approved','scheduled','applying','applied','verifying','verified','rejected','cancelled','apply_failed','verification_failed','rolling_back','rolled_back','rollback_failed')
    union all select 'AGENT_EXECUTION_DIVERGED', e.reserved_at from public.np_agent_changeset_executions e
     where not exists(select 1 from public.np_agent_changesets c where c.site_id=e.site_id and c.id=e.changeset_id and ((e.purpose='apply' and c.plan_hash=e.plan_hash and c.scheduled_for is not distinct from e.scheduled_for) or (e.purpose='rollback' and exists(select 1 from public.np_agent_changeset_rollback_plans p where p.site_id=e.site_id and p.changeset_id=e.changeset_id and p.id=e.rollback_plan_id and p.plan_hash=e.plan_hash and p.approval_id=e.approval_id))))
       or not exists(select 1 from public.np_agent_approvals a where a.site_id=e.site_id and a.id=e.approval_id and ((e.purpose='apply' and a.target_kind='changeset' and a.target_changeset_id=e.changeset_id) or (e.purpose='rollback' and a.target_kind='changeset_rollback' and a.target_rollback_plan_id=e.rollback_plan_id)) and a.plan_hash=e.plan_hash and (e.committed_at is null or (a.state='consumed' and a.consumed_at=e.committed_at)))
       or (e.invocation_id is not null and not exists(select 1 from public.np_agent_invocations i where i.site_id=e.site_id and i.id=e.invocation_id))
       or (e.purpose='apply' and e.committed_at is not null and (not exists(select 1 from public.np_agent_changeset_operations o where o.site_id=e.site_id and o.changeset_id=e.changeset_id) or exists(select 1 from public.np_agent_changeset_operations o where o.site_id=e.site_id and o.changeset_id=e.changeset_id and (o.after_hash is null or o.result_digest is null or o.state not in ('applied','verified','failed')))))
       or (e.purpose='rollback' and e.committed_at is not null and (not exists(select 1 from public.np_agent_changeset_rollback_operations o where o.site_id=e.site_id and o.rollback_plan_id=e.rollback_plan_id) or exists(select 1 from public.np_agent_changeset_rollback_operations o where o.site_id=e.site_id and o.rollback_plan_id=e.rollback_plan_id and (o.after_hash is null or o.result_digest is null or o.state not in ('applied','verified','failed')))))
       or e.state='ambiguous'
       or exists(select 1 from jsonb_array_elements(e.effects) x where x->>'state'='unknown' or (e.state='failed' and x->>'state' in ('pending','running')))
    union all select 'AGENT_EXECUTION_DIVERGED', p.created_at from public.np_agent_changeset_rollback_plans p where not exists(select 1 from public.np_agent_changeset_executions e where e.site_id=p.site_id and e.changeset_id=p.changeset_id and e.id=p.compensates_execution_id and e.purpose='apply' and e.committed_at is not null and e.plan_hash=p.original_plan_hash and e.result_digest=p.applied_result_digest)
    union all select 'AGENT_RELATION_CROSS_SITE', p.created_at from public.np_agent_changeset_rollback_plans p where p.approval_id is not null and not exists(select 1 from public.np_agent_approvals a where a.site_id=p.site_id and a.id=p.approval_id and a.target_kind='changeset_rollback' and a.target_rollback_plan_id=p.id and a.target_changeset_id=p.changeset_id and a.plan_hash=p.plan_hash)
    union all select 'AGENT_RELATION_CROSS_SITE', o.created_at from public.np_agent_changeset_rollback_operations o where not exists(select 1 from public.np_agent_changeset_rollback_plans p where p.site_id=o.site_id and p.id=o.rollback_plan_id and p.changeset_id=o.changeset_id) or not exists(select 1 from public.np_agent_changeset_operations source where source.site_id=o.site_id and source.id=o.original_operation_id and source.changeset_id=o.changeset_id and source.ordinal=o.original_operation_ordinal)
    union all select 'AGENT_EXPIRY_BACKLOG', p.expires_at from public.np_agent_changeset_rollback_plans p where p.state in ('preparing','ready','approval_pending','approved') and p.expires_at<=$1::timestamptz
    union all select 'AGENT_STALE_EXECUTION', e.reserved_at from public.np_agent_changeset_executions e
     where e.state in ('reserved','committed','verifying') and ((e.lease_until is not null and e.lease_until<=$1::timestamptz) or (e.lease_until is null and coalesce(e.committed_at,e.scheduled_for,e.reserved_at)<=$1::timestamptz-interval '10 minutes'))
    union all select 'AGENT_EXECUTION_VERIFICATION_FAILED', e.verification_completed_at from public.np_agent_changeset_executions e where e.verification_state='failed'
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_changeset_operations where state not in ('draft','valid','invalid','applied','verified','failed')
    union all select 'AGENT_ROW_STATE_INVALID', requested_at from public.np_agent_approvals where state not in ('pending','approved','rejected','expired','consumed','revoked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connections
     where status not in ('pending', 'ready', 'error', 'disabled', 'revoked')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_connection_config_versions
     where state not in ('candidate', 'active', 'retired', 'rejected')
    union all select 'AGENT_ROW_STATE_INVALID', requested_at from public.np_agent_invocations
     where state not in ('started', 'accepted', 'approval_required', 'completed', 'failed')
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_mcp_tasks
     where status not in ('working', 'completed', 'failed', 'cancelled')
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

    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_changeset_validation_attempts
     where state not in ('queued','validating','ready','invalid','failed') or generation<1 or draft_version<1
       or (state in ('queued','validating') and (finished_at is not null or result_digest is not null or error_code is not null))
       or (state in ('ready','invalid','failed') and finished_at is null)
       or (state='queued' and started_at is not null) or (state in ('validating','ready','invalid') and started_at is null)
       or (state in ('ready','invalid') and result_digest is null) or (state='ready' and risk_summary is null)
       or (state='failed' and error_code is null)
    union all select 'AGENT_RELATION_CROSS_SITE', attempt.created_at from public.np_agent_changeset_validation_attempts attempt
      left join public.np_agent_changesets parent on parent.id=attempt.changeset_id
      left join public.np_agent_invocations invocation on invocation.id=attempt.admitting_invocation_id
     where parent.id is null or parent.site_id<>attempt.site_id or invocation.id is null or invocation.site_id<>attempt.site_id
    union all select 'AGENT_ROW_STATE_INVALID', attempt.created_at from public.np_agent_changeset_validation_attempts attempt
      join public.np_agent_invocations invocation on invocation.id=attempt.admitting_invocation_id and invocation.site_id=attempt.site_id
     where attempt.authorization_context_body is distinct from invocation.authorization_context_body
       or attempt.authorization_context_fingerprint is distinct from invocation.authorization_context_fingerprint
       or attempt.authority_ref is distinct from invocation.authority_ref
       or attempt.requester_kind is distinct from invocation.actor_kind
       or attempt.requester_fingerprint is distinct from invocation.actor_fingerprint
       or attempt.requester_id::text is distinct from coalesce(invocation.authorization_context_body->'actor'->>'userId',invocation.authorization_context_body->'actor'->>'principalId')
    union all select 'AGENT_EXPIRY_BACKLOG', expires_at from public.np_agent_changeset_validation_attempts
     where state in ('queued','validating') and expires_at <= $1::timestamptz
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_changesets
     where draft_version < 1 or validation_generation < 0 or (sealed_plan_body is null) <> (plan_hash is null) or (sealed_plan_body is null) <> (rollback_window_seconds is null)
    union all select 'AGENT_ROW_STATE_INVALID', created_at from public.np_agent_changeset_operations
     where ordinal not between 1 and 500 or (before_snapshot is null) <> (snapshot_hash is null)
    union all select 'AGENT_ROW_STATE_INVALID', requested_at from public.np_agent_approvals
     where generation < 1 or version < 1 or (state = 'consumed') <> (consumed_at is not null)
        or statement_body->>'siteId' is distinct from site_id
        or statement_body->>'approvalId' is distinct from id::text
        or statement_body->>'capabilityId' is distinct from capability_id
        or statement_body->>'capabilityFingerprint' is distinct from capability_fingerprint
        or (case when target_kind='action' then statement_body->'target'->>'proposalHash' else statement_body->'target'->>'planHash' end) is distinct from plan_hash
        or statement_body->'requester'->>'fingerprint' is distinct from requester_fingerprint
        or statement_body->'requiredScopes' is distinct from to_jsonb(required_scopes)
        or statement_body->'requiredHumanCapabilities' is distinct from to_jsonb(required_human_capabilities)
        or statement_body->'requiredHumanPredicates' is distinct from to_jsonb(required_human_predicates)
        or statement_body->'policyHashes' is distinct from to_jsonb(policy_hashes)
        or (state in ('approved','rejected','consumed') and decision_body is null)
        or (state = 'pending' and decision_body is not null)
        or (decision_body is not null and (
          decision_body->>'siteId' is distinct from site_id
          or decision_body->>'approvalId' is distinct from id::text
          or decision_body->>'approvalGeneration' is distinct from generation::text
          or decision_body->>'statementHash' is distinct from statement_hash
          or decision_body->>'deciderFingerprint' is distinct from decider_fingerprint
          or not coalesce((
            (decision_body->>'decision'='reject' and decision_body->'reauthentication'->>'mode'='none' and decision_reauth_fingerprint is null and decision_reauthenticated_at is null)
            or (decision_body->>'decision'='approve' and (
              (required_reauth_mode='none' and decision_body->'reauthentication'->>'mode'='none' and decision_reauth_fingerprint is null and decision_reauthenticated_at is null)
              or (required_reauth_mode='recent-staff-primary' and decision_body->'reauthentication'->>'mode'='recent' and decision_reauth_fingerprint is not null and decision_reauthenticated_at is not null)
            ))
          ), false)
        ))
    union all select 'AGENT_RELATION_CROSS_SITE', operation.created_at from public.np_agent_changeset_operations operation
      left join public.np_agent_changesets target on target.id=operation.changeset_id
     where target.id is null or target.site_id<>operation.site_id
    union all select 'AGENT_RELATION_CROSS_SITE', approval.requested_at from public.np_agent_approvals approval
      left join public.np_agent_changesets target on target.id=approval.target_changeset_id
     where approval.target_kind='changeset' and (target.id is null or target.site_id<>approval.site_id)
    union all select 'AGENT_RELATION_CROSS_SITE', approval.requested_at from public.np_agent_approvals approval
      left join public.np_agent_actions target on target.id=approval.target_action_id
     where approval.target_kind='action' and (target.id is null or target.site_id<>approval.site_id)
    union all select 'AGENT_RELATION_CROSS_SITE', approval.requested_at from public.np_agent_approvals approval
      left join public.np_agent_changeset_rollback_plans target on target.id=approval.target_rollback_plan_id
     where approval.target_kind='changeset_rollback' and (target.id is null or target.site_id<>approval.site_id or approval.statement_body->'target'->>'changeSetId' is distinct from target.changeset_id::text)
    union all select 'AGENT_EXPIRY_BACKLOG', expires_at from public.np_agent_changesets
     where state in ('draft','invalid','ready','approval_pending','approved','scheduled') and expires_at <= $1::timestamptz
    union all select 'AGENT_EXPIRY_BACKLOG', expires_at from public.np_agent_approvals
     where state in ('pending','approved') and expires_at <= $1::timestamptz

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
      select 'AGENT_MCP_TASK_DIVERGED', task.created_at
        from public.np_agent_mcp_tasks task
        left join public.np_agent_invocations invocation on invocation.id = task.invocation_id
       where invocation.id is null or invocation.site_id <> task.site_id
          or invocation.principal_id <> task.principal_id
          or invocation.authorization_context_fingerprint <> task.authorization_context_fingerprint
          or invocation.authorization_context_body <> task.authorization_context_body
          or invocation.authority_ref <> task.authority_ref
          or invocation.mcp_execution_mode <> 'task'
          or invocation.mcp_requested_task_ttl_ms is distinct from
             coalesce(task.requested_ttl_ms, 3600000)
          or task.ttl_ms > coalesce(task.requested_ttl_ms, 3600000)
          or ((task.status = 'working') <> (task.terminal_result is null))
          or ((task.status = 'cancelled') <> (task.cancelled_at is not null))

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
        union all select task.created_at from public.np_agent_mcp_tasks task
          left join public.np_agent_invocations invocation on invocation.id = task.invocation_id
          where invocation.id is null
        union all select task.created_at from public.np_agent_mcp_tasks task
          left join public.np_agent_principals principal on principal.id = task.principal_id
          where principal.id is null
        union all select task.created_at from public.np_agent_mcp_tasks task
          left join public.np_agent_runs run on run.id = task.run_id
          where task.run_id is not null and run.id is null
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
        union all select task.created_at from public.np_agent_mcp_tasks task
          join public.np_agent_invocations invocation on invocation.id = task.invocation_id
          where invocation.site_id <> task.site_id
        union all select task.created_at from public.np_agent_mcp_tasks task
          join public.np_agent_principals principal on principal.id = task.principal_id
          where principal.site_id <> task.site_id
        union all select task.created_at from public.np_agent_mcp_tasks task
          join public.np_agent_runs run on run.id = task.run_id
          where run.site_id <> task.site_id
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
    union all select 'AGENT_STALE_MCP_TASK', created_at from public.np_agent_mcp_tasks
      where status = 'working' and expires_at <= $1::timestamptz
    union all select 'AGENT_MCP_TASK_DIVERGED', created_at from public.np_agent_mcp_tasks
      where status <> 'working' and
        (terminal_result is null or terminal_result_digest is null or last_updated_at > expires_at)
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
