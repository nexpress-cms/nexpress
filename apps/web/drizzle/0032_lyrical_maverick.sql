CREATE TABLE "np_agent_connection_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"expected_connection_status" text NOT NULL,
	"provider" text NOT NULL,
	"adapter_contract_version" integer NOT NULL,
	"adapter_contract_fingerprint" text NOT NULL,
	"oauth_client_config_digest" text NOT NULL,
	"connection_config_version" integer NOT NULL,
	"connection_config_hash" text NOT NULL,
	"config_snapshot_id" uuid NOT NULL,
	"expected_secret_version_id" uuid,
	"expected_credential_version" integer,
	"expected_account_subject_key_id" text,
	"expected_account_subject_digest" text,
	"staff_session_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"state_hash" text NOT NULL,
	"hash_key_id" text NOT NULL,
	"pkce_secret_version_id" uuid NOT NULL,
	"code_secret_version_id" uuid,
	"code_vault_operation_id" uuid,
	"connection_operation_id" uuid,
	"requested_permissions" text[] NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "np_agent_connection_auth_requests_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_connection_auth_requests_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "np_agent_connection_auth_requests_code_secret_unique" UNIQUE("code_secret_version_id"),
	CONSTRAINT "np_agent_connection_auth_requests_code_vault_operation_unique" UNIQUE("code_vault_operation_id"),
	CONSTRAINT "np_agent_connection_auth_requests_operation_unique" UNIQUE("connection_operation_id"),
	CONSTRAINT "np_agent_connection_auth_requests_mode_check" CHECK ("np_agent_connection_auth_requests"."mode" in ('initial', 'replace')),
	CONSTRAINT "np_agent_connection_auth_requests_expected_status_check" CHECK ("np_agent_connection_auth_requests"."expected_connection_status" in ('pending', 'ready', 'error', 'disabled')),
	CONSTRAINT "np_agent_connection_auth_requests_status_check" CHECK ("np_agent_connection_auth_requests"."status" in ('pending', 'consumed', 'denied', 'failed', 'expired', 'revoked')),
	CONSTRAINT "np_agent_connection_auth_requests_versions_check" CHECK ("np_agent_connection_auth_requests"."adapter_contract_version" > 0 and "np_agent_connection_auth_requests"."connection_config_version" > 0 and
        ("np_agent_connection_auth_requests"."expected_credential_version" is null or "np_agent_connection_auth_requests"."expected_credential_version" > 0)),
	CONSTRAINT "np_agent_connection_auth_requests_expected_secret_check" CHECK ((
        "np_agent_connection_auth_requests"."mode" = 'initial' and "np_agent_connection_auth_requests"."expected_secret_version_id" is null and "np_agent_connection_auth_requests"."expected_credential_version" is null and
          "np_agent_connection_auth_requests"."expected_account_subject_key_id" is null and "np_agent_connection_auth_requests"."expected_account_subject_digest" is null
      ) or (
        "np_agent_connection_auth_requests"."mode" = 'replace' and "np_agent_connection_auth_requests"."expected_secret_version_id" is not null and "np_agent_connection_auth_requests"."expected_credential_version" is not null and
          "np_agent_connection_auth_requests"."expected_account_subject_key_id" is not null and "np_agent_connection_auth_requests"."expected_account_subject_digest" is not null
      )),
	CONSTRAINT "np_agent_connection_auth_requests_permissions_check" CHECK (cardinality("np_agent_connection_auth_requests"."requested_permissions") between 1 and 128 and array_position("np_agent_connection_auth_requests"."requested_permissions", null) is null),
	CONSTRAINT "np_agent_connection_auth_requests_expiry_check" CHECK ("np_agent_connection_auth_requests"."expires_at" > "np_agent_connection_auth_requests"."created_at" and "np_agent_connection_auth_requests"."expires_at" <= "np_agent_connection_auth_requests"."created_at" + interval '10 minutes'),
	CONSTRAINT "np_agent_connection_auth_requests_callback_links_check" CHECK ((
        "np_agent_connection_auth_requests"."status" = 'consumed' and "np_agent_connection_auth_requests"."consumed_at" is not null and "np_agent_connection_auth_requests"."denied_at" is null and
          "np_agent_connection_auth_requests"."code_secret_version_id" is not null and "np_agent_connection_auth_requests"."code_vault_operation_id" is not null and "np_agent_connection_auth_requests"."connection_operation_id" is not null
      ) or (
        "np_agent_connection_auth_requests"."status" = 'denied' and "np_agent_connection_auth_requests"."denied_at" is not null and "np_agent_connection_auth_requests"."consumed_at" is null and
          "np_agent_connection_auth_requests"."code_secret_version_id" is null and "np_agent_connection_auth_requests"."code_vault_operation_id" is null and "np_agent_connection_auth_requests"."connection_operation_id" is null and
          "np_agent_connection_auth_requests"."last_error_code" = 'AUTHORIZATION_DENIED'
      ) or (
        "np_agent_connection_auth_requests"."status" in ('pending', 'failed', 'expired', 'revoked') and "np_agent_connection_auth_requests"."consumed_at" is null and "np_agent_connection_auth_requests"."denied_at" is null and
          "np_agent_connection_auth_requests"."code_secret_version_id" is null and "np_agent_connection_auth_requests"."code_vault_operation_id" is null and "np_agent_connection_auth_requests"."connection_operation_id" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_connection_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"adapter_id" text NOT NULL,
	"adapter_contract_version" integer NOT NULL,
	"adapter_fingerprint" text NOT NULL,
	"config" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"pricing_catalog" jsonb NOT NULL,
	"pricing_catalog_fingerprint" text NOT NULL,
	"data_processing_ceiling" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	CONSTRAINT "np_agent_connection_config_versions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_connection_config_versions_number_unique" UNIQUE("site_id","connection_id","version"),
	CONSTRAINT "np_agent_connection_config_versions_version_check" CHECK ("np_agent_connection_config_versions"."version" > 0),
	CONSTRAINT "np_agent_connection_config_versions_adapter_version_check" CHECK ("np_agent_connection_config_versions"."adapter_contract_version" > 0),
	CONSTRAINT "np_agent_connection_config_versions_data_class_check" CHECK ("np_agent_connection_config_versions"."data_processing_ceiling" in ('public-only', 'internal-redacted', 'sensitive-approved')),
	CONSTRAINT "np_agent_connection_config_versions_state_check" CHECK ("np_agent_connection_config_versions"."state" in ('candidate', 'active', 'retired', 'rejected')),
	CONSTRAINT "np_agent_connection_config_versions_state_time_check" CHECK ((
        ("np_agent_connection_config_versions"."state" = 'candidate' and "np_agent_connection_config_versions"."activated_at" is null and "np_agent_connection_config_versions"."retired_at" is null and "np_agent_connection_config_versions"."rejected_at" is null)
        or ("np_agent_connection_config_versions"."state" = 'active' and "np_agent_connection_config_versions"."activated_at" is not null and "np_agent_connection_config_versions"."retired_at" is null and "np_agent_connection_config_versions"."rejected_at" is null)
        or ("np_agent_connection_config_versions"."state" = 'retired' and "np_agent_connection_config_versions"."activated_at" is not null and "np_agent_connection_config_versions"."retired_at" is not null and "np_agent_connection_config_versions"."rejected_at" is null)
        or ("np_agent_connection_config_versions"."state" = 'rejected' and "np_agent_connection_config_versions"."activated_at" is null and "np_agent_connection_config_versions"."retired_at" is null and "np_agent_connection_config_versions"."rejected_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_connection_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"invocation_id" uuid,
	"run_id" uuid,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"expected_config_version" integer NOT NULL,
	"expected_config_hash" text NOT NULL,
	"config_snapshot_id" uuid NOT NULL,
	"adapter_contract_version" integer NOT NULL,
	"adapter_fingerprint" text NOT NULL,
	"auth_request_id" uuid,
	"input_secret_version_ids" uuid[] NOT NULL,
	"expected_secret_version_id" uuid,
	"expected_credential_version" integer,
	"expected_refresh_generation" integer,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"result_redacted" jsonb,
	"result_digest" text,
	"last_error_code" text,
	"deadline_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "np_agent_connection_operations_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_connection_operations_invocation_unique" UNIQUE("invocation_id"),
	CONSTRAINT "np_agent_connection_operations_auth_request_unique" UNIQUE("auth_request_id"),
	CONSTRAINT "np_agent_connection_operations_idempotency_unique" UNIQUE("site_id","connection_id","idempotency_key"),
	CONSTRAINT "np_agent_connection_operations_source_check" CHECK ("np_agent_connection_operations"."source" in ('admin-invocation', 'oauth-setup', 'runtime-refresh')),
	CONSTRAINT "np_agent_connection_operations_kind_check" CHECK ("np_agent_connection_operations"."kind" in ('probe', 'activate-secret', 'activate-config', 'oauth-exchange', 'oauth-refresh', 'destroy-secret')),
	CONSTRAINT "np_agent_connection_operations_state_check" CHECK ("np_agent_connection_operations"."state" in ('awaiting_secret', 'queued', 'running', 'succeeded', 'failed', 'ambiguous', 'cancelled')),
	CONSTRAINT "np_agent_connection_operations_versions_check" CHECK ("np_agent_connection_operations"."expected_config_version" > 0 and "np_agent_connection_operations"."adapter_contract_version" > 0 and "np_agent_connection_operations"."attempt" between 1 and 65535 and
        ("np_agent_connection_operations"."expected_credential_version" is null or "np_agent_connection_operations"."expected_credential_version" > 0) and
        ("np_agent_connection_operations"."expected_refresh_generation" is null or "np_agent_connection_operations"."expected_refresh_generation" > 0)),
	CONSTRAINT "np_agent_connection_operations_source_authority_check" CHECK ((
        ("np_agent_connection_operations"."source" = 'admin-invocation' and "np_agent_connection_operations"."invocation_id" is not null and "np_agent_connection_operations"."auth_request_id" is null and "np_agent_connection_operations"."run_id" is null)
        or ("np_agent_connection_operations"."source" = 'oauth-setup' and "np_agent_connection_operations"."invocation_id" is null and "np_agent_connection_operations"."auth_request_id" is not null and "np_agent_connection_operations"."run_id" is null)
        or ("np_agent_connection_operations"."source" = 'runtime-refresh' and "np_agent_connection_operations"."invocation_id" is null and "np_agent_connection_operations"."auth_request_id" is null and "np_agent_connection_operations"."run_id" is not null)
      )),
	CONSTRAINT "np_agent_connection_operations_refresh_check" CHECK ((
        "np_agent_connection_operations"."kind" = 'oauth-refresh' and "np_agent_connection_operations"."expected_secret_version_id" is not null and
          "np_agent_connection_operations"."expected_credential_version" is not null and "np_agent_connection_operations"."expected_refresh_generation" is not null
      ) or (
        "np_agent_connection_operations"."kind" <> 'oauth-refresh' and "np_agent_connection_operations"."expected_refresh_generation" is null
      )),
	CONSTRAINT "np_agent_connection_operations_result_pair_check" CHECK (("np_agent_connection_operations"."result_redacted" is null) = ("np_agent_connection_operations"."result_digest" is null)),
	CONSTRAINT "np_agent_connection_operations_state_time_check" CHECK ((
        ("np_agent_connection_operations"."state" = 'awaiting_secret' and "np_agent_connection_operations"."source" = 'oauth-setup' and "np_agent_connection_operations"."kind" = 'oauth-exchange' and
          "np_agent_connection_operations"."deadline_at" is null and "np_agent_connection_operations"."lease_until" is null and "np_agent_connection_operations"."started_at" is null and "np_agent_connection_operations"."finished_at" is null)
        or ("np_agent_connection_operations"."state" = 'queued' and "np_agent_connection_operations"."deadline_at" is not null and "np_agent_connection_operations"."lease_until" is null and "np_agent_connection_operations"."started_at" is null and "np_agent_connection_operations"."finished_at" is null)
        or ("np_agent_connection_operations"."state" = 'running' and "np_agent_connection_operations"."deadline_at" is not null and "np_agent_connection_operations"."lease_until" is not null and "np_agent_connection_operations"."started_at" is not null and "np_agent_connection_operations"."finished_at" is null)
        or ("np_agent_connection_operations"."state" = 'succeeded' and "np_agent_connection_operations"."deadline_at" is not null and "np_agent_connection_operations"."finished_at" is not null and "np_agent_connection_operations"."last_error_code" is null and "np_agent_connection_operations"."result_digest" is not null)
        or ("np_agent_connection_operations"."state" in ('failed', 'ambiguous', 'cancelled') and "np_agent_connection_operations"."finished_at" is not null and "np_agent_connection_operations"."last_error_code" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_connection_secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"purpose" text NOT NULL,
	"vault_adapter" text NOT NULL,
	"vault_adapter_contract_version" integer NOT NULL,
	"vault_adapter_fingerprint" text NOT NULL,
	"seal_operation_id" uuid NOT NULL,
	"secret_ref" text,
	"material_kind" text NOT NULL,
	"credential_envelope_version" integer NOT NULL,
	"vault_algorithm" text NOT NULL,
	"aad_body" jsonb NOT NULL,
	"aad_digest" text NOT NULL,
	"expires_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"refresh_token_present" boolean,
	"refresh_expires_at" timestamp with time zone,
	"refresh_generation" integer,
	"permission_digest" text,
	"account_subject_key_id" text,
	"account_subject_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone,
	CONSTRAINT "np_agent_connection_secret_versions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_connection_secret_versions_number_unique" UNIQUE("site_id","connection_id","purpose","version"),
	CONSTRAINT "np_agent_connection_secret_versions_seal_operation_unique" UNIQUE("seal_operation_id"),
	CONSTRAINT "np_agent_connection_secret_versions_version_check" CHECK ("np_agent_connection_secret_versions"."version" > 0),
	CONSTRAINT "np_agent_connection_secret_versions_status_check" CHECK ("np_agent_connection_secret_versions"."status" in ('pending', 'active', 'retiring', 'revoked', 'destroyed')),
	CONSTRAINT "np_agent_connection_secret_versions_purpose_check" CHECK ("np_agent_connection_secret_versions"."purpose" in ('connection-credential', 'provider-oauth-pkce', 'provider-oauth-code')),
	CONSTRAINT "np_agent_connection_secret_versions_material_check" CHECK ("np_agent_connection_secret_versions"."material_kind" in ('api_key', 'oauth', 'provider_oauth_pkce', 'provider_oauth_code')),
	CONSTRAINT "np_agent_connection_secret_versions_envelope_check" CHECK ("np_agent_connection_secret_versions"."vault_adapter_contract_version" > 0 and "np_agent_connection_secret_versions"."credential_envelope_version" = 1),
	CONSTRAINT "np_agent_connection_secret_versions_purpose_material_check" CHECK ((
        "np_agent_connection_secret_versions"."purpose" = 'connection-credential' and "np_agent_connection_secret_versions"."material_kind" in ('api_key', 'oauth')
      ) or (
        "np_agent_connection_secret_versions"."purpose" = 'provider-oauth-pkce' and "np_agent_connection_secret_versions"."material_kind" = 'provider_oauth_pkce'
      ) or (
        "np_agent_connection_secret_versions"."purpose" = 'provider-oauth-code' and "np_agent_connection_secret_versions"."material_kind" = 'provider_oauth_code'
      )),
	CONSTRAINT "np_agent_connection_secret_versions_temporary_expiry_check" CHECK ((
        "np_agent_connection_secret_versions"."purpose" = 'connection-credential' and "np_agent_connection_secret_versions"."expires_at" is null
      ) or (
        "np_agent_connection_secret_versions"."purpose" in ('provider-oauth-pkce', 'provider-oauth-code') and "np_agent_connection_secret_versions"."expires_at" is not null and
        "np_agent_connection_secret_versions"."expires_at" > "np_agent_connection_secret_versions"."created_at" and "np_agent_connection_secret_versions"."expires_at" <= "np_agent_connection_secret_versions"."created_at" + interval '10 minutes'
      )),
	CONSTRAINT "np_agent_connection_secret_versions_subject_check" CHECK ((
        "np_agent_connection_secret_versions"."purpose" = 'connection-credential' and
          (("np_agent_connection_secret_versions"."account_subject_key_id" is null and "np_agent_connection_secret_versions"."account_subject_digest" is null and "np_agent_connection_secret_versions"."status" = 'pending') or
           ("np_agent_connection_secret_versions"."account_subject_key_id" is not null and "np_agent_connection_secret_versions"."account_subject_digest" is not null))
      ) or (
        "np_agent_connection_secret_versions"."purpose" <> 'connection-credential' and "np_agent_connection_secret_versions"."account_subject_key_id" is null and "np_agent_connection_secret_versions"."account_subject_digest" is null
      )),
	CONSTRAINT "np_agent_connection_secret_versions_oauth_metadata_check" CHECK ((
        "np_agent_connection_secret_versions"."material_kind" = 'oauth' and "np_agent_connection_secret_versions"."access_expires_at" is not null and
          "np_agent_connection_secret_versions"."refresh_token_present" is not null and "np_agent_connection_secret_versions"."refresh_generation" is not null and "np_agent_connection_secret_versions"."refresh_generation" > 0 and
          "np_agent_connection_secret_versions"."permission_digest" is not null and ("np_agent_connection_secret_versions"."refresh_token_present" = true or "np_agent_connection_secret_versions"."refresh_expires_at" is null)
      ) or (
        "np_agent_connection_secret_versions"."material_kind" <> 'oauth' and "np_agent_connection_secret_versions"."access_expires_at" is null and "np_agent_connection_secret_versions"."refresh_token_present" is null and
          "np_agent_connection_secret_versions"."refresh_expires_at" is null and "np_agent_connection_secret_versions"."refresh_generation" is null and "np_agent_connection_secret_versions"."permission_digest" is null
      )),
	CONSTRAINT "np_agent_connection_secret_versions_locator_check" CHECK (("np_agent_connection_secret_versions"."status" = 'destroyed' and "np_agent_connection_secret_versions"."secret_ref" is null) or
        ("np_agent_connection_secret_versions"."status" <> 'destroyed' and ("np_agent_connection_secret_versions"."secret_ref" is not null or "np_agent_connection_secret_versions"."status" = 'pending'))),
	CONSTRAINT "np_agent_connection_secret_versions_state_time_check" CHECK ((
        ("np_agent_connection_secret_versions"."status" = 'pending' and "np_agent_connection_secret_versions"."activated_at" is null and "np_agent_connection_secret_versions"."retired_at" is null and "np_agent_connection_secret_versions"."destroyed_at" is null)
        or ("np_agent_connection_secret_versions"."status" = 'active' and "np_agent_connection_secret_versions"."purpose" = 'connection-credential' and "np_agent_connection_secret_versions"."activated_at" is not null and "np_agent_connection_secret_versions"."retired_at" is null and "np_agent_connection_secret_versions"."destroyed_at" is null)
        or ("np_agent_connection_secret_versions"."status" = 'retiring' and "np_agent_connection_secret_versions"."purpose" = 'connection-credential' and "np_agent_connection_secret_versions"."activated_at" is not null and "np_agent_connection_secret_versions"."retired_at" is not null and "np_agent_connection_secret_versions"."destroyed_at" is null)
        or ("np_agent_connection_secret_versions"."status" = 'revoked' and "np_agent_connection_secret_versions"."destroyed_at" is null and
          (("np_agent_connection_secret_versions"."purpose" = 'connection-credential') or ("np_agent_connection_secret_versions"."activated_at" is null and "np_agent_connection_secret_versions"."retired_at" is null)))
        or ("np_agent_connection_secret_versions"."status" = 'destroyed' and "np_agent_connection_secret_versions"."destroyed_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"adapter_contract_version" integer NOT NULL,
	"name" text NOT NULL,
	"auth_kind" text NOT NULL,
	"active_secret_version_id" uuid,
	"active_config_snapshot_id" uuid NOT NULL,
	"credential_version" integer,
	"active_account_subject_key_id" text,
	"active_account_subject_digest" text,
	"active_destination_key_id" text,
	"active_destination_descriptor" jsonb,
	"active_destination_fingerprint" text,
	"config" jsonb NOT NULL,
	"config_version" integer NOT NULL,
	"config_hash" text NOT NULL,
	"pricing_catalog_fingerprint" text NOT NULL,
	"data_processing_ceiling" text NOT NULL,
	"status" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_verified_config_version" integer,
	"last_verified_credential_version" integer,
	"last_probe_result_digest" text,
	"last_error_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_connections_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_connections_kind_check" CHECK ("np_agent_connections"."kind" in ('model', 'notification')),
	CONSTRAINT "np_agent_connections_auth_kind_check" CHECK ("np_agent_connections"."auth_kind" in ('api_key', 'oauth')),
	CONSTRAINT "np_agent_connections_status_check" CHECK ("np_agent_connections"."status" in ('pending', 'ready', 'error', 'disabled', 'revoked')),
	CONSTRAINT "np_agent_connections_data_class_check" CHECK ("np_agent_connections"."data_processing_ceiling" in ('public-only', 'internal-redacted', 'sensitive-approved')),
	CONSTRAINT "np_agent_connections_versions_check" CHECK ("np_agent_connections"."adapter_contract_version" > 0 and "np_agent_connections"."config_version" > 0 and ("np_agent_connections"."credential_version" is null or "np_agent_connections"."credential_version" > 0)),
	CONSTRAINT "np_agent_connections_name_check" CHECK (char_length("np_agent_connections"."name") between 1 and 120 and "np_agent_connections"."name" = btrim("np_agent_connections"."name")),
	CONSTRAINT "np_agent_connections_credential_tuple_check" CHECK ((
        "np_agent_connections"."active_secret_version_id" is null and "np_agent_connections"."credential_version" is null and
        "np_agent_connections"."active_account_subject_key_id" is null and "np_agent_connections"."active_account_subject_digest" is null
      ) or (
        "np_agent_connections"."active_secret_version_id" is not null and "np_agent_connections"."credential_version" is not null and
        "np_agent_connections"."active_account_subject_key_id" is not null and "np_agent_connections"."active_account_subject_digest" is not null
      )),
	CONSTRAINT "np_agent_connections_destination_check" CHECK ((
        "np_agent_connections"."kind" = 'notification' and (
          ("np_agent_connections"."active_secret_version_id" is null and "np_agent_connections"."active_destination_key_id" is null and
            "np_agent_connections"."active_destination_descriptor" is null and "np_agent_connections"."active_destination_fingerprint" is null)
          or
          ("np_agent_connections"."active_secret_version_id" is not null and "np_agent_connections"."active_destination_key_id" is not null and
            "np_agent_connections"."active_destination_descriptor" is not null and "np_agent_connections"."active_destination_fingerprint" is not null)
        )
      ) or (
        "np_agent_connections"."kind" = 'model' and "np_agent_connections"."active_destination_key_id" is null and
        "np_agent_connections"."active_destination_descriptor" is null and "np_agent_connections"."active_destination_fingerprint" is null
      )),
	CONSTRAINT "np_agent_connections_probe_tuple_check" CHECK ((
        "np_agent_connections"."last_verified_at" is null and "np_agent_connections"."last_verified_config_version" is null and
        "np_agent_connections"."last_verified_credential_version" is null and "np_agent_connections"."last_probe_result_digest" is null
      ) or (
        "np_agent_connections"."last_verified_at" is not null and "np_agent_connections"."last_verified_config_version" is not null and
        "np_agent_connections"."last_verified_credential_version" is not null and "np_agent_connections"."last_probe_result_digest" is not null
      )),
	CONSTRAINT "np_agent_connections_state_matrix_check" CHECK ((
        ("np_agent_connections"."status" = 'pending' and "np_agent_connections"."active_secret_version_id" is null and "np_agent_connections"."last_verified_at" is null and "np_agent_connections"."last_error_code" is null)
        or ("np_agent_connections"."status" = 'ready' and "np_agent_connections"."active_secret_version_id" is not null and "np_agent_connections"."last_verified_at" is not null and
          "np_agent_connections"."last_verified_config_version" = "np_agent_connections"."config_version" and "np_agent_connections"."last_verified_credential_version" = "np_agent_connections"."credential_version" and "np_agent_connections"."last_error_code" is null)
        or ("np_agent_connections"."status" = 'disabled' and "np_agent_connections"."active_secret_version_id" is not null and "np_agent_connections"."last_verified_at" is not null and
          "np_agent_connections"."last_verified_config_version" = "np_agent_connections"."config_version" and "np_agent_connections"."last_verified_credential_version" = "np_agent_connections"."credential_version" and "np_agent_connections"."last_error_code" is null)
        or ("np_agent_connections"."status" = 'error' and "np_agent_connections"."last_error_code" is not null and
          (("np_agent_connections"."active_secret_version_id" is null and "np_agent_connections"."last_verified_at" is null) or
           ("np_agent_connections"."active_secret_version_id" is not null and "np_agent_connections"."last_verified_at" is not null)))
        or ("np_agent_connections"."status" = 'revoked' and "np_agent_connections"."active_secret_version_id" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"principal_id" uuid,
	"staff_user_id" uuid,
	"actor_fingerprint" text NOT NULL,
	"authorization_context_body" jsonb NOT NULL,
	"authorization_context_fingerprint" text NOT NULL,
	"authority_ref" jsonb NOT NULL,
	"actor_deleted_at" timestamp with time zone,
	"operation_kind" text NOT NULL,
	"operation_id" text NOT NULL,
	"contract_version" integer NOT NULL,
	"contract_fingerprint" text NOT NULL,
	"capability_definition_body" jsonb,
	"effect_profile_id" text,
	"effect_contract_version" integer,
	"transport" text NOT NULL,
	"mcp_execution_mode" text,
	"mcp_requested_task_ttl_ms" bigint,
	"idempotency_key" text,
	"request_body" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"run_id" uuid,
	"result_kind" text,
	"result_id" uuid,
	"output_redacted" jsonb,
	"output_hash" text,
	"one_time_value_issued" boolean DEFAULT false NOT NULL,
	"one_time_resource_id" uuid,
	"one_time_recovery_operation_id" text,
	"audit_event_id" uuid NOT NULL,
	"error_code" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_invocations_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_invocations_actor_kind_check" CHECK ("np_agent_invocations"."actor_kind" in ('principal', 'staff')),
	CONSTRAINT "np_agent_invocations_operation_kind_check" CHECK ("np_agent_invocations"."operation_kind" in ('capability', 'admin')),
	CONSTRAINT "np_agent_invocations_transport_check" CHECK ("np_agent_invocations"."transport" in ('mcp-oauth', 'mcp-service', 'stdio', 'agent-api', 'runtime', 'admin')),
	CONSTRAINT "np_agent_invocations_state_check" CHECK ("np_agent_invocations"."state" in ('started', 'accepted', 'approval_required', 'completed', 'failed')),
	CONSTRAINT "np_agent_invocations_result_kind_check" CHECK ("np_agent_invocations"."result_kind" is null or "np_agent_invocations"."result_kind" in ('action', 'changeset', 'approval', 'admin_resource')),
	CONSTRAINT "np_agent_invocations_contract_version_check" CHECK ("np_agent_invocations"."contract_version" > 0),
	CONSTRAINT "np_agent_invocations_actor_check" CHECK ((
        ("np_agent_invocations"."actor_kind" = 'principal' and "np_agent_invocations"."principal_id" is not null and "np_agent_invocations"."staff_user_id" is null and "np_agent_invocations"."actor_deleted_at" is null)
        or ("np_agent_invocations"."actor_kind" = 'staff' and "np_agent_invocations"."principal_id" is null and
          (("np_agent_invocations"."staff_user_id" is not null and "np_agent_invocations"."actor_deleted_at" is null) or
           ("np_agent_invocations"."staff_user_id" is null and "np_agent_invocations"."actor_deleted_at" is not null)))
      )),
	CONSTRAINT "np_agent_invocations_operation_contract_check" CHECK ((
        ("np_agent_invocations"."operation_kind" = 'capability' and "np_agent_invocations"."capability_definition_body" is not null and
          "np_agent_invocations"."effect_profile_id" is not null and "np_agent_invocations"."effect_contract_version" is not null and "np_agent_invocations"."effect_contract_version" > 0)
        or ("np_agent_invocations"."operation_kind" = 'admin' and "np_agent_invocations"."capability_definition_body" is null and
          "np_agent_invocations"."effect_profile_id" is null and "np_agent_invocations"."effect_contract_version" is null)
      )),
	CONSTRAINT "np_agent_invocations_admin_transport_check" CHECK (("np_agent_invocations"."operation_kind" = 'admin') = ("np_agent_invocations"."transport" = 'admin')),
	CONSTRAINT "np_agent_invocations_mcp_mode_check" CHECK ((
        ("np_agent_invocations"."transport" in ('mcp-oauth', 'mcp-service') and "np_agent_invocations"."mcp_execution_mode" in ('normal', 'task') and
          (("np_agent_invocations"."mcp_execution_mode" = 'task' and "np_agent_invocations"."mcp_requested_task_ttl_ms" is not null and "np_agent_invocations"."mcp_requested_task_ttl_ms" > 0) or
           ("np_agent_invocations"."mcp_execution_mode" = 'normal' and "np_agent_invocations"."mcp_requested_task_ttl_ms" is null)))
        or ("np_agent_invocations"."transport" not in ('mcp-oauth', 'mcp-service') and "np_agent_invocations"."mcp_execution_mode" is null and "np_agent_invocations"."mcp_requested_task_ttl_ms" is null)
      )),
	CONSTRAINT "np_agent_invocations_result_pair_check" CHECK (("np_agent_invocations"."result_kind" is null) = ("np_agent_invocations"."result_id" is null)),
	CONSTRAINT "np_agent_invocations_output_pair_check" CHECK (("np_agent_invocations"."output_redacted" is null) = ("np_agent_invocations"."output_hash" is null)),
	CONSTRAINT "np_agent_invocations_one_time_check" CHECK ((
        ("np_agent_invocations"."one_time_value_issued" = false and "np_agent_invocations"."one_time_resource_id" is null and "np_agent_invocations"."one_time_recovery_operation_id" is null)
        or ("np_agent_invocations"."one_time_value_issued" = true and "np_agent_invocations"."one_time_resource_id" is not null and "np_agent_invocations"."one_time_recovery_operation_id" is not null and "np_agent_invocations"."output_redacted" is null)
      )),
	CONSTRAINT "np_agent_invocations_state_time_check" CHECK ((
        ("np_agent_invocations"."state" in ('started', 'accepted', 'approval_required') and "np_agent_invocations"."completed_at" is null and "np_agent_invocations"."error_code" is null)
        or ("np_agent_invocations"."state" = 'completed' and "np_agent_invocations"."completed_at" is not null and "np_agent_invocations"."error_code" is null)
        or ("np_agent_invocations"."state" = 'failed' and "np_agent_invocations"."completed_at" is not null and "np_agent_invocations"."error_code" is not null)
      ) and "np_agent_invocations"."expires_at" > "np_agent_invocations"."requested_at")
);
--> statement-breakpoint
CREATE TABLE "np_agent_oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"registration_source" text NOT NULL,
	"status" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "np_agent_oauth_clients_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_oauth_clients_site_client_id_unique" UNIQUE("site_id","client_id"),
	CONSTRAINT "np_agent_oauth_clients_status_check" CHECK ("np_agent_oauth_clients"."status" in ('active', 'revoked')),
	CONSTRAINT "np_agent_oauth_clients_source_check" CHECK ("np_agent_oauth_clients"."registration_source" in ('admin', 'dynamic')),
	CONSTRAINT "np_agent_oauth_clients_redirects_check" CHECK (cardinality("np_agent_oauth_clients"."redirect_uris") between 1 and 32 and array_position("np_agent_oauth_clients"."redirect_uris", null) is null),
	CONSTRAINT "np_agent_oauth_clients_revocation_check" CHECK (("np_agent_oauth_clients"."status" = 'revoked') = ("np_agent_oauth_clients"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "np_agent_oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"staff_session_id" uuid,
	"client_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] NOT NULL,
	"exposure_mode" text NOT NULL,
	"resource" text NOT NULL,
	"pkce_method" text NOT NULL,
	"pkce_challenge" text NOT NULL,
	"code_hash" text NOT NULL,
	"hash_key_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "np_agent_oauth_codes_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_oauth_codes_request_unique" UNIQUE("request_id"),
	CONSTRAINT "np_agent_oauth_codes_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "np_agent_oauth_codes_status_check" CHECK ("np_agent_oauth_codes"."status" in ('active', 'consumed', 'revoked', 'expired')),
	CONSTRAINT "np_agent_oauth_codes_exposure_check" CHECK ("np_agent_oauth_codes"."exposure_mode" in ('read', 'propose', 'approved-execute')),
	CONSTRAINT "np_agent_oauth_codes_pkce_check" CHECK ("np_agent_oauth_codes"."pkce_method" = 'S256'),
	CONSTRAINT "np_agent_oauth_codes_scopes_check" CHECK (cardinality("np_agent_oauth_codes"."scopes") between 1 and 64 and "np_agent_oauth_codes"."scopes" @> array['site:read']::text[] and array_position("np_agent_oauth_codes"."scopes", null) is null),
	CONSTRAINT "np_agent_oauth_codes_expiry_check" CHECK ("np_agent_oauth_codes"."expires_at" > "np_agent_oauth_codes"."created_at"),
	CONSTRAINT "np_agent_oauth_codes_state_time_check" CHECK ((
        ("np_agent_oauth_codes"."status" = 'active' and "np_agent_oauth_codes"."consumed_at" is null and "np_agent_oauth_codes"."revoked_at" is null and "np_agent_oauth_codes"."expired_at" is null)
        or ("np_agent_oauth_codes"."status" = 'consumed' and "np_agent_oauth_codes"."consumed_at" is not null and "np_agent_oauth_codes"."revoked_at" is null and "np_agent_oauth_codes"."expired_at" is null)
        or ("np_agent_oauth_codes"."status" = 'revoked' and "np_agent_oauth_codes"."revoked_at" is not null and "np_agent_oauth_codes"."expired_at" is null)
        or ("np_agent_oauth_codes"."status" = 'expired' and "np_agent_oauth_codes"."expired_at" is not null and "np_agent_oauth_codes"."revoked_at" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"staff_user_id" uuid,
	"principal_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"scope_hash" text NOT NULL,
	"exposure_mode" text NOT NULL,
	"resource" text NOT NULL,
	"audience" text NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"consent_generation" integer DEFAULT 1 NOT NULL,
	"authority_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "np_agent_oauth_grants_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_oauth_grants_generation_unique" UNIQUE("site_id","client_id","staff_user_id","resource","scope_hash","exposure_mode","consent_generation"),
	CONSTRAINT "np_agent_oauth_grants_status_check" CHECK ("np_agent_oauth_grants"."status" in ('active', 'revoked', 'expired')),
	CONSTRAINT "np_agent_oauth_grants_exposure_check" CHECK ("np_agent_oauth_grants"."exposure_mode" in ('read', 'propose', 'approved-execute')),
	CONSTRAINT "np_agent_oauth_grants_versions_check" CHECK ("np_agent_oauth_grants"."token_version" > 0 and "np_agent_oauth_grants"."consent_generation" > 0 and "np_agent_oauth_grants"."authority_version" > 0),
	CONSTRAINT "np_agent_oauth_grants_scopes_check" CHECK (cardinality("np_agent_oauth_grants"."scopes") between 1 and 64 and "np_agent_oauth_grants"."scopes" @> array['site:read']::text[] and array_position("np_agent_oauth_grants"."scopes", null) is null),
	CONSTRAINT "np_agent_oauth_grants_expiry_check" CHECK ("np_agent_oauth_grants"."expires_at" > "np_agent_oauth_grants"."created_at"),
	CONSTRAINT "np_agent_oauth_grants_state_time_check" CHECK ((
        ("np_agent_oauth_grants"."status" = 'active' and "np_agent_oauth_grants"."staff_user_id" is not null and "np_agent_oauth_grants"."revoked_at" is null and "np_agent_oauth_grants"."expired_at" is null)
        or ("np_agent_oauth_grants"."status" = 'revoked' and "np_agent_oauth_grants"."revoked_at" is not null and "np_agent_oauth_grants"."expired_at" is null)
        or ("np_agent_oauth_grants"."status" = 'expired' and "np_agent_oauth_grants"."expired_at" is not null and "np_agent_oauth_grants"."revoked_at" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"parent_token_id" uuid,
	"replacement_token_id" uuid,
	"token_hash" text NOT NULL,
	"hash_key_id" text NOT NULL,
	"grant_authority_version" integer NOT NULL,
	"family_generation" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "np_agent_oauth_refresh_tokens_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_site_token_id_unique" UNIQUE("site_id","token_id"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_parent_unique" UNIQUE("parent_token_id"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_replacement_unique" UNIQUE("replacement_token_id"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_family_generation_unique" UNIQUE("site_id","family_id","family_generation"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_status_check" CHECK ("np_agent_oauth_refresh_tokens"."status" in ('active', 'consumed', 'revoked', 'expired')),
	CONSTRAINT "np_agent_oauth_refresh_tokens_versions_check" CHECK ("np_agent_oauth_refresh_tokens"."grant_authority_version" > 0 and "np_agent_oauth_refresh_tokens"."family_generation" > 0),
	CONSTRAINT "np_agent_oauth_refresh_tokens_expiry_check" CHECK ("np_agent_oauth_refresh_tokens"."expires_at" > "np_agent_oauth_refresh_tokens"."created_at"),
	CONSTRAINT "np_agent_oauth_refresh_tokens_state_time_check" CHECK ((
        ("np_agent_oauth_refresh_tokens"."status" = 'active' and "np_agent_oauth_refresh_tokens"."consumed_at" is null and "np_agent_oauth_refresh_tokens"."revoked_at" is null and "np_agent_oauth_refresh_tokens"."expired_at" is null)
        or ("np_agent_oauth_refresh_tokens"."status" = 'consumed' and "np_agent_oauth_refresh_tokens"."consumed_at" is not null and "np_agent_oauth_refresh_tokens"."revoked_at" is null and "np_agent_oauth_refresh_tokens"."expired_at" is null)
        or ("np_agent_oauth_refresh_tokens"."status" = 'revoked' and "np_agent_oauth_refresh_tokens"."revoked_at" is not null and "np_agent_oauth_refresh_tokens"."expired_at" is null)
        or ("np_agent_oauth_refresh_tokens"."status" = 'expired' and "np_agent_oauth_refresh_tokens"."expired_at" is not null and "np_agent_oauth_refresh_tokens"."revoked_at" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_oauth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"staff_user_id" uuid,
	"staff_session_id" uuid,
	"redirect_uri" text NOT NULL,
	"client_state" text NOT NULL,
	"requested_scopes" text[] NOT NULL,
	"resource" text NOT NULL,
	"exposure_mode" text NOT NULL,
	"pkce_method" text NOT NULL,
	"pkce_challenge" text NOT NULL,
	"consent_challenge_hash" text NOT NULL,
	"consent_hash_key_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "np_agent_oauth_requests_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_oauth_requests_consent_hash_unique" UNIQUE("consent_challenge_hash"),
	CONSTRAINT "np_agent_oauth_requests_status_check" CHECK ("np_agent_oauth_requests"."status" in ('pending', 'authorized', 'denied', 'consumed', 'expired')),
	CONSTRAINT "np_agent_oauth_requests_exposure_check" CHECK ("np_agent_oauth_requests"."exposure_mode" in ('read', 'propose', 'approved-execute')),
	CONSTRAINT "np_agent_oauth_requests_pkce_check" CHECK ("np_agent_oauth_requests"."pkce_method" = 'S256'),
	CONSTRAINT "np_agent_oauth_requests_scopes_check" CHECK (cardinality("np_agent_oauth_requests"."requested_scopes") between 1 and 64 and "np_agent_oauth_requests"."requested_scopes" @> array['site:read']::text[] and array_position("np_agent_oauth_requests"."requested_scopes", null) is null),
	CONSTRAINT "np_agent_oauth_requests_expiry_check" CHECK ("np_agent_oauth_requests"."expires_at" > "np_agent_oauth_requests"."created_at" and "np_agent_oauth_requests"."expires_at" <= "np_agent_oauth_requests"."created_at" + interval '10 minutes'),
	CONSTRAINT "np_agent_oauth_requests_state_time_check" CHECK ((
        ("np_agent_oauth_requests"."status" = 'pending' and "np_agent_oauth_requests"."authorized_at" is null and "np_agent_oauth_requests"."denied_at" is null and "np_agent_oauth_requests"."consumed_at" is null and "np_agent_oauth_requests"."expired_at" is null)
        or ("np_agent_oauth_requests"."status" = 'authorized' and "np_agent_oauth_requests"."authorized_at" is not null and "np_agent_oauth_requests"."denied_at" is null and "np_agent_oauth_requests"."consumed_at" is null and "np_agent_oauth_requests"."expired_at" is null)
        or ("np_agent_oauth_requests"."status" = 'denied' and "np_agent_oauth_requests"."denied_at" is not null and "np_agent_oauth_requests"."authorized_at" is null and "np_agent_oauth_requests"."consumed_at" is null and "np_agent_oauth_requests"."expired_at" is null)
        or ("np_agent_oauth_requests"."status" = 'consumed' and "np_agent_oauth_requests"."authorized_at" is not null and "np_agent_oauth_requests"."consumed_at" is not null and "np_agent_oauth_requests"."denied_at" is null and "np_agent_oauth_requests"."expired_at" is null)
        or ("np_agent_oauth_requests"."status" = 'expired' and "np_agent_oauth_requests"."expired_at" is not null and "np_agent_oauth_requests"."denied_at" is null and "np_agent_oauth_requests"."consumed_at" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"scopes" text[] NOT NULL,
	"authority_kind" text NOT NULL,
	"authority_user_id" uuid,
	"authority_policy_id" text,
	"authority_fingerprint" text NOT NULL,
	"authority_deleted_at" timestamp with time zone,
	"token_version" integer DEFAULT 1 NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "np_agent_principals_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_principals_kind_check" CHECK ("np_agent_principals"."kind" in ('runtime', 'external')),
	CONSTRAINT "np_agent_principals_status_check" CHECK ("np_agent_principals"."status" in ('active', 'suspended', 'revoked')),
	CONSTRAINT "np_agent_principals_authority_kind_check" CHECK ("np_agent_principals"."authority_kind" in ('user', 'deployment')),
	CONSTRAINT "np_agent_principals_token_version_check" CHECK ("np_agent_principals"."token_version" > 0),
	CONSTRAINT "np_agent_principals_name_check" CHECK (char_length("np_agent_principals"."name") between 1 and 120 and "np_agent_principals"."name" = btrim("np_agent_principals"."name")),
	CONSTRAINT "np_agent_principals_description_check" CHECK ("np_agent_principals"."description" is null or char_length("np_agent_principals"."description") <= 4096),
	CONSTRAINT "np_agent_principals_scopes_check" CHECK (cardinality("np_agent_principals"."scopes") between 1 and 64 and array_position("np_agent_principals"."scopes", null) is null),
	CONSTRAINT "np_agent_principals_active_scope_check" CHECK ("np_agent_principals"."status" <> 'active' or "np_agent_principals"."scopes" @> array['site:read']::text[]),
	CONSTRAINT "np_agent_principals_revocation_check" CHECK (("np_agent_principals"."status" = 'revoked') = ("np_agent_principals"."revoked_at" is not null)),
	CONSTRAINT "np_agent_principals_authority_check" CHECK ((
        ("np_agent_principals"."authority_kind" = 'user' and "np_agent_principals"."authority_policy_id" is null and
          (("np_agent_principals"."authority_user_id" is not null and "np_agent_principals"."authority_deleted_at" is null) or
           ("np_agent_principals"."authority_user_id" is null and "np_agent_principals"."authority_deleted_at" is not null)))
        or
        ("np_agent_principals"."authority_kind" = 'deployment' and "np_agent_principals"."authority_user_id" is null and
          "np_agent_principals"."authority_deleted_at" is null and "np_agent_principals"."authority_policy_id" is not null)
      )),
	CONSTRAINT "np_agent_principals_active_authority_check" CHECK ("np_agent_principals"."status" <> 'active' or ("np_agent_principals"."authority_kind" = 'deployment' or "np_agent_principals"."authority_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "np_agent_service_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"hash_key_id" text NOT NULL,
	"rotation_family_id" uuid NOT NULL,
	"family_authority_version" integer DEFAULT 1 NOT NULL,
	"family_generation" integer DEFAULT 1 NOT NULL,
	"replaces_token_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"scopes" text[] NOT NULL,
	"transport" text NOT NULL,
	"exposure_mode" text NOT NULL,
	"audience" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overlap_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "np_agent_service_tokens_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_service_tokens_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "np_agent_service_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "np_agent_service_tokens_replaces_unique" UNIQUE("replaces_token_id"),
	CONSTRAINT "np_agent_service_tokens_family_generation_unique" UNIQUE("site_id","rotation_family_id","family_generation"),
	CONSTRAINT "np_agent_service_tokens_status_check" CHECK ("np_agent_service_tokens"."status" in ('active_head', 'overlap', 'revoked', 'expired')),
	CONSTRAINT "np_agent_service_tokens_transport_check" CHECK ("np_agent_service_tokens"."transport" in ('stdio', 'mcp-http', 'agent-http')),
	CONSTRAINT "np_agent_service_tokens_exposure_check" CHECK ("np_agent_service_tokens"."exposure_mode" in ('read', 'propose', 'approved-execute')),
	CONSTRAINT "np_agent_service_tokens_versions_check" CHECK ("np_agent_service_tokens"."family_authority_version" > 0 and "np_agent_service_tokens"."family_generation" > 0 and "np_agent_service_tokens"."row_version" > 0),
	CONSTRAINT "np_agent_service_tokens_prefix_check" CHECK ("np_agent_service_tokens"."prefix" = 'npst1_' || "np_agent_service_tokens"."id"::text),
	CONSTRAINT "np_agent_service_tokens_scopes_check" CHECK (cardinality("np_agent_service_tokens"."scopes") between 1 and 64 and "np_agent_service_tokens"."scopes" @> array['site:read']::text[] and array_position("np_agent_service_tokens"."scopes", null) is null),
	CONSTRAINT "np_agent_service_tokens_time_check" CHECK ("np_agent_service_tokens"."expires_at" > "np_agent_service_tokens"."created_at" and ("np_agent_service_tokens"."last_used_at" is null or "np_agent_service_tokens"."last_used_at" >= "np_agent_service_tokens"."created_at")),
	CONSTRAINT "np_agent_service_tokens_state_time_check" CHECK ((
        ("np_agent_service_tokens"."status" = 'active_head' and "np_agent_service_tokens"."overlap_expires_at" is null and "np_agent_service_tokens"."revoked_at" is null)
        or ("np_agent_service_tokens"."status" = 'overlap' and "np_agent_service_tokens"."overlap_expires_at" is not null and "np_agent_service_tokens"."revoked_at" is null and "np_agent_service_tokens"."overlap_expires_at" <= "np_agent_service_tokens"."expires_at")
        or ("np_agent_service_tokens"."status" in ('revoked', 'expired') and "np_agent_service_tokens"."revoked_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "np_agent_site_deletion_sagas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"state" text NOT NULL,
	"plan_body" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"site_version_digest" text NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	"cursor" jsonb NOT NULL,
	"requested_by_user_id" uuid,
	"requester_fingerprint" text NOT NULL,
	"last_error_code" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleanup_completed_at" timestamp with time zone,
	CONSTRAINT "np_agent_site_deletion_sagas_site_unique" UNIQUE("site_id"),
	CONSTRAINT "np_agent_site_deletion_sagas_state_check" CHECK ("np_agent_site_deletion_sagas"."state" in ('prepared', 'cleaning', 'ready_to_commit', 'failed', 'committing')),
	CONSTRAINT "np_agent_site_deletion_sagas_completion_check" CHECK (("np_agent_site_deletion_sagas"."state" in ('ready_to_commit', 'committing')) = ("np_agent_site_deletion_sagas"."cleanup_completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "np_agent_vault_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"secret_version_id" uuid NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"algorithm" text NOT NULL,
	"kek_id" text NOT NULL,
	"kek_version" text NOT NULL,
	"aad_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destroyed_at" timestamp with time zone,
	CONSTRAINT "np_agent_vault_entries_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_vault_entries_secret_unique" UNIQUE("secret_version_id"),
	CONSTRAINT "np_agent_vault_entries_bytes_check" CHECK (octet_length("np_agent_vault_entries"."ciphertext") > 0 and octet_length("np_agent_vault_entries"."wrapped_data_key") > 0 and
        octet_length("np_agent_vault_entries"."nonce") > 0 and octet_length("np_agent_vault_entries"."auth_tag") > 0)
);
--> statement-breakpoint
CREATE TABLE "np_agent_vault_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"secret_version_id" uuid NOT NULL,
	"vault_adapter" text NOT NULL,
	"vault_adapter_contract_version" integer NOT NULL,
	"vault_adapter_fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest_key_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"state" text NOT NULL,
	"secret_ref" text,
	"result_digest" text,
	"last_error_code" text,
	"target_key_id" text,
	"target_key_version" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "np_agent_vault_operations_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_vault_operations_adapter_idempotency_unique" UNIQUE("vault_adapter","idempotency_key"),
	CONSTRAINT "np_agent_vault_operations_kind_check" CHECK ("np_agent_vault_operations"."kind" in ('seal', 'rewrap', 'destroy')),
	CONSTRAINT "np_agent_vault_operations_state_check" CHECK ("np_agent_vault_operations"."state" in ('queued', 'running', 'waiting_inspection', 'succeeded', 'failed')),
	CONSTRAINT "np_agent_vault_operations_versions_check" CHECK ("np_agent_vault_operations"."vault_adapter_contract_version" > 0 and "np_agent_vault_operations"."attempt" between 1 and 65535 and "np_agent_vault_operations"."row_version" > 0),
	CONSTRAINT "np_agent_vault_operations_rewrap_target_check" CHECK (("np_agent_vault_operations"."kind" = 'rewrap' and "np_agent_vault_operations"."target_key_id" is not null and "np_agent_vault_operations"."target_key_version" is not null) or
        ("np_agent_vault_operations"."kind" <> 'rewrap' and "np_agent_vault_operations"."target_key_id" is null and "np_agent_vault_operations"."target_key_version" is null)),
	CONSTRAINT "np_agent_vault_operations_state_time_check" CHECK ((
        ("np_agent_vault_operations"."state" = 'queued' and "np_agent_vault_operations"."lease_until" is null and "np_agent_vault_operations"."finished_at" is null and "np_agent_vault_operations"."result_digest" is null and "np_agent_vault_operations"."last_error_code" is null)
        or ("np_agent_vault_operations"."state" in ('running', 'waiting_inspection') and "np_agent_vault_operations"."finished_at" is null and "np_agent_vault_operations"."result_digest" is null)
        or ("np_agent_vault_operations"."state" = 'succeeded' and "np_agent_vault_operations"."finished_at" is not null and "np_agent_vault_operations"."result_digest" is not null and "np_agent_vault_operations"."last_error_code" is null)
        or ("np_agent_vault_operations"."state" = 'failed' and "np_agent_vault_operations"."finished_at" is not null and "np_agent_vault_operations"."result_digest" is not null and "np_agent_vault_operations"."last_error_code" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_staff_session_id_np_sessions_id_fk" FOREIGN KEY ("staff_session_id") REFERENCES "public"."np_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_connection_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_config_fk" FOREIGN KEY ("site_id","config_snapshot_id") REFERENCES "public"."np_agent_connection_config_versions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_config_versions" ADD CONSTRAINT "np_agent_connection_config_versions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_config_versions" ADD CONSTRAINT "np_agent_connection_config_versions_connection_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_created_by_user_id_np_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_connection_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_config_fk" FOREIGN KEY ("site_id","config_snapshot_id") REFERENCES "public"."np_agent_connection_config_versions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_auth_request_fk" FOREIGN KEY ("site_id","auth_request_id") REFERENCES "public"."np_agent_connection_auth_requests"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_connection_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_invocations" ADD CONSTRAINT "np_agent_invocations_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_invocations" ADD CONSTRAINT "np_agent_invocations_staff_user_id_np_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_invocations" ADD CONSTRAINT "np_agent_invocations_audit_event_id_np_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."np_audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_invocations" ADD CONSTRAINT "np_agent_invocations_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_clients" ADD CONSTRAINT "np_agent_oauth_clients_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_clients" ADD CONSTRAINT "np_agent_oauth_clients_created_by_user_id_np_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_codes" ADD CONSTRAINT "np_agent_oauth_codes_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_codes" ADD CONSTRAINT "np_agent_oauth_codes_staff_session_id_np_sessions_id_fk" FOREIGN KEY ("staff_session_id") REFERENCES "public"."np_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_codes" ADD CONSTRAINT "np_agent_oauth_codes_request_fk" FOREIGN KEY ("site_id","request_id") REFERENCES "public"."np_agent_oauth_requests"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_codes" ADD CONSTRAINT "np_agent_oauth_codes_grant_fk" FOREIGN KEY ("site_id","grant_id") REFERENCES "public"."np_agent_oauth_grants"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_codes" ADD CONSTRAINT "np_agent_oauth_codes_client_fk" FOREIGN KEY ("site_id","client_id") REFERENCES "public"."np_agent_oauth_clients"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_grants" ADD CONSTRAINT "np_agent_oauth_grants_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_grants" ADD CONSTRAINT "np_agent_oauth_grants_staff_user_id_np_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_grants" ADD CONSTRAINT "np_agent_oauth_grants_client_fk" FOREIGN KEY ("site_id","client_id") REFERENCES "public"."np_agent_oauth_clients"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_grants" ADD CONSTRAINT "np_agent_oauth_grants_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_refresh_tokens" ADD CONSTRAINT "np_agent_oauth_refresh_tokens_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_refresh_tokens" ADD CONSTRAINT "np_agent_oauth_refresh_tokens_grant_fk" FOREIGN KEY ("site_id","grant_id") REFERENCES "public"."np_agent_oauth_grants"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_refresh_tokens" ADD CONSTRAINT "np_agent_oauth_refresh_tokens_parent_fk" FOREIGN KEY ("site_id","parent_token_id") REFERENCES "public"."np_agent_oauth_refresh_tokens"("site_id","token_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_refresh_tokens" ADD CONSTRAINT "np_agent_oauth_refresh_tokens_replacement_fk" FOREIGN KEY ("site_id","replacement_token_id") REFERENCES "public"."np_agent_oauth_refresh_tokens"("site_id","token_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_requests" ADD CONSTRAINT "np_agent_oauth_requests_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_requests" ADD CONSTRAINT "np_agent_oauth_requests_staff_user_id_np_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_requests" ADD CONSTRAINT "np_agent_oauth_requests_staff_session_id_np_sessions_id_fk" FOREIGN KEY ("staff_session_id") REFERENCES "public"."np_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_oauth_requests" ADD CONSTRAINT "np_agent_oauth_requests_client_fk" FOREIGN KEY ("site_id","client_id") REFERENCES "public"."np_agent_oauth_clients"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_principals" ADD CONSTRAINT "np_agent_principals_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_principals" ADD CONSTRAINT "np_agent_principals_authority_user_id_np_users_id_fk" FOREIGN KEY ("authority_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_principals" ADD CONSTRAINT "np_agent_principals_owner_user_id_np_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ADD CONSTRAINT "np_agent_service_tokens_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ADD CONSTRAINT "np_agent_service_tokens_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ADD CONSTRAINT "np_agent_service_tokens_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_service_tokens" ADD CONSTRAINT "np_agent_service_tokens_replaces_fk" FOREIGN KEY ("site_id","replaces_token_id") REFERENCES "public"."np_agent_service_tokens"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_site_deletion_sagas" ADD CONSTRAINT "np_agent_site_deletion_sagas_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_site_deletion_sagas" ADD CONSTRAINT "np_agent_site_deletion_sagas_requested_by_user_id_np_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_vault_entries" ADD CONSTRAINT "np_agent_vault_entries_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_vault_entries" ADD CONSTRAINT "np_agent_vault_entries_secret_fk" FOREIGN KEY ("site_id","secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_vault_operations" ADD CONSTRAINT "np_agent_vault_operations_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_vault_operations" ADD CONSTRAINT "np_agent_vault_operations_connection_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_vault_operations" ADD CONSTRAINT "np_agent_vault_operations_secret_fk" FOREIGN KEY ("site_id","secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_active_config_fk" FOREIGN KEY ("site_id","active_config_snapshot_id") REFERENCES "public"."np_agent_connection_config_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connections" ADD CONSTRAINT "np_agent_connections_active_secret_fk" FOREIGN KEY ("site_id","active_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_expected_secret_fk" FOREIGN KEY ("site_id","expected_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_pkce_secret_fk" FOREIGN KEY ("site_id","pkce_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_code_secret_fk" FOREIGN KEY ("site_id","code_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_code_vault_operation_fk" FOREIGN KEY ("site_id","code_vault_operation_id") REFERENCES "public"."np_agent_vault_operations"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_auth_requests" ADD CONSTRAINT "np_agent_connection_auth_requests_connection_operation_fk" FOREIGN KEY ("site_id","connection_operation_id") REFERENCES "public"."np_agent_connection_operations"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_operations" ADD CONSTRAINT "np_agent_connection_operations_expected_secret_fk" FOREIGN KEY ("site_id","expected_secret_version_id") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_seal_operation_fk" FOREIGN KEY ("site_id","seal_operation_id") REFERENCES "public"."np_agent_vault_operations"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_connection_auth_requests_pending_uidx" ON "np_agent_connection_auth_requests" USING btree ("site_id","connection_id") WHERE "np_agent_connection_auth_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "np_agent_connection_auth_requests_expiry_idx" ON "np_agent_connection_auth_requests" USING btree ("site_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_connection_config_versions_active_uidx" ON "np_agent_connection_config_versions" USING btree ("site_id","connection_id") WHERE "np_agent_connection_config_versions"."state" = 'active';--> statement-breakpoint
CREATE INDEX "np_agent_connection_config_versions_connection_idx" ON "np_agent_connection_config_versions" USING btree ("site_id","connection_id","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_connection_operations_claim_idx" ON "np_agent_connection_operations" USING btree ("site_id","state","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_connection_secret_versions_active_uidx" ON "np_agent_connection_secret_versions" USING btree ("site_id","connection_id") WHERE "np_agent_connection_secret_versions"."status" = 'active' and "np_agent_connection_secret_versions"."purpose" = 'connection-credential';--> statement-breakpoint
CREATE INDEX "np_agent_connection_secret_versions_connection_idx" ON "np_agent_connection_secret_versions" USING btree ("site_id","connection_id","status");--> statement-breakpoint
CREATE INDEX "np_agent_connection_secret_versions_expiry_idx" ON "np_agent_connection_secret_versions" USING btree ("site_id","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_connections_site_status_idx" ON "np_agent_connections" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_connections_active_secret_idx" ON "np_agent_connections" USING btree ("active_secret_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_invocations_idempotency_uidx" ON "np_agent_invocations" USING btree ("site_id","actor_kind","actor_fingerprint","authorization_context_fingerprint","operation_kind","operation_id","idempotency_key") WHERE "np_agent_invocations"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "np_agent_invocations_site_state_idx" ON "np_agent_invocations" USING btree ("site_id","state","requested_at");--> statement-breakpoint
CREATE INDEX "np_agent_invocations_principal_idx" ON "np_agent_invocations" USING btree ("site_id","principal_id");--> statement-breakpoint
CREATE INDEX "np_agent_invocations_expiry_idx" ON "np_agent_invocations" USING btree ("site_id","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_oauth_clients_site_status_idx" ON "np_agent_oauth_clients" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "np_agent_oauth_codes_expiry_idx" ON "np_agent_oauth_codes" USING btree ("site_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_oauth_grants_active_uidx" ON "np_agent_oauth_grants" USING btree ("site_id","client_id","staff_user_id","resource","scope_hash","exposure_mode") WHERE "np_agent_oauth_grants"."status" = 'active';--> statement-breakpoint
CREATE INDEX "np_agent_oauth_grants_principal_idx" ON "np_agent_oauth_grants" USING btree ("site_id","principal_id");--> statement-breakpoint
CREATE INDEX "np_agent_oauth_grants_expiry_idx" ON "np_agent_oauth_grants" USING btree ("site_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_oauth_refresh_tokens_active_leaf_uidx" ON "np_agent_oauth_refresh_tokens" USING btree ("site_id","family_id") WHERE "np_agent_oauth_refresh_tokens"."status" = 'active';--> statement-breakpoint
CREATE INDEX "np_agent_oauth_refresh_tokens_expiry_idx" ON "np_agent_oauth_refresh_tokens" USING btree ("site_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_oauth_requests_expiry_idx" ON "np_agent_oauth_requests" USING btree ("site_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_principals_site_status_idx" ON "np_agent_principals" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_principals_authority_user_idx" ON "np_agent_principals" USING btree ("authority_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_service_tokens_active_head_uidx" ON "np_agent_service_tokens" USING btree ("site_id","rotation_family_id") WHERE "np_agent_service_tokens"."status" = 'active_head';--> statement-breakpoint
CREATE INDEX "np_agent_service_tokens_principal_idx" ON "np_agent_service_tokens" USING btree ("site_id","principal_id");--> statement-breakpoint
CREATE INDEX "np_agent_service_tokens_expiry_idx" ON "np_agent_service_tokens" USING btree ("site_id","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_site_deletion_sagas_state_idx" ON "np_agent_site_deletion_sagas" USING btree ("state","lease_until");--> statement-breakpoint
CREATE INDEX "np_agent_vault_entries_site_idx" ON "np_agent_vault_entries" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_vault_operations_claim_idx" ON "np_agent_vault_operations" USING btree ("site_id","state","lease_until");
