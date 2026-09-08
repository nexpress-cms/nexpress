CREATE TABLE "np_agent_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_changeset_id" uuid,
	"target_action_id" uuid,
	"generation" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"plan_hash" text NOT NULL,
	"capability_id" text NOT NULL,
	"capability_contract_version" integer NOT NULL,
	"capability_fingerprint" text NOT NULL,
	"required_scopes" text[] NOT NULL,
	"required_human_capabilities" text[] NOT NULL,
	"required_human_predicates" text[] NOT NULL,
	"policy_hashes" text[] NOT NULL,
	"requires_live_preview" boolean NOT NULL,
	"preview_id" uuid,
	"preview_digest" text,
	"required_reauth_mode" text NOT NULL,
	"required_reauth_max_age_seconds" integer,
	"statement_body" jsonb NOT NULL,
	"statement_hash" text NOT NULL,
	"statement_mac" text NOT NULL,
	"integrity_key_id" text NOT NULL,
	"challenge_generation" integer DEFAULT 0 NOT NULL,
	"challenge_purpose" text,
	"challenge_hash" text,
	"challenge_hash_key_id" text,
	"challenge_issued_to_user_id" uuid,
	"challenge_session_fingerprint" text,
	"challenge_expires_at" timestamp with time zone,
	"challenge_consumed_at" timestamp with time zone,
	"state" text DEFAULT 'pending' NOT NULL,
	"risk" text NOT NULL,
	"requester_kind" text NOT NULL,
	"requested_by_principal_id" uuid,
	"requested_by_user_id" uuid,
	"requester_fingerprint" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_user_id" uuid,
	"decider_fingerprint" text,
	"decision_body" jsonb,
	"decision_hash" text,
	"decision_mac" text,
	"decision_reauth_fingerprint" text,
	"decision_reauthenticated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"reason" text,
	"revocation_kind" text,
	"revoked_by_user_id" uuid,
	"revoker_fingerprint" text,
	"revocation_code" text,
	"revocation_reason" text,
	"revocation_body" jsonb,
	"revocation_hash" text,
	"revocation_mac" text,
	"revocation_integrity_key_id" text,
	"revoked_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "np_agent_approvals_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_approvals_generation_unique" UNIQUE("site_id","target_kind","target_id","plan_hash","generation"),
	CONSTRAINT "np_agent_approvals_target_check" CHECK ((("np_agent_approvals"."target_kind"='changeset' and "np_agent_approvals"."target_changeset_id"="np_agent_approvals"."target_id" and "np_agent_approvals"."target_action_id" is null) or ("np_agent_approvals"."target_kind"='action' and "np_agent_approvals"."target_action_id"="np_agent_approvals"."target_id" and "np_agent_approvals"."target_changeset_id" is null)) is true),
	CONSTRAINT "np_agent_approvals_version_check" CHECK (("np_agent_approvals"."generation">0 and "np_agent_approvals"."version">0 and "np_agent_approvals"."capability_contract_version">0 and "np_agent_approvals"."challenge_generation">=0) is true),
	CONSTRAINT "np_agent_approvals_state_check" CHECK (("np_agent_approvals"."state" in ('pending','approved','rejected','expired','consumed','revoked') and "np_agent_approvals"."risk" in ('reversible','sensitive','destructive')) is true),
	CONSTRAINT "np_agent_approvals_requester_check" CHECK ((("np_agent_approvals"."requester_kind"='staff' and "np_agent_approvals"."requested_by_principal_id" is null) or ("np_agent_approvals"."requester_kind"='principal' and "np_agent_approvals"."requested_by_principal_id" is not null and "np_agent_approvals"."requested_by_user_id" is null)) is true),
	CONSTRAINT "np_agent_approvals_scope_check" CHECK ((cardinality("np_agent_approvals"."required_scopes") between 1 and 64 and array_position("np_agent_approvals"."required_scopes",null) is null and cardinality("np_agent_approvals"."required_human_capabilities") between 1 and 5 and "np_agent_approvals"."required_human_capabilities"<@array['site.access','content.author','content.publish','community.moderate','admin.manage']::text[] and array_position("np_agent_approvals"."required_human_capabilities",null) is null and "np_agent_approvals"."required_human_predicates"<@array['is-super-admin']::text[] and array_position("np_agent_approvals"."required_human_predicates",null) is null) is true),
	CONSTRAINT "np_agent_approvals_preview_check" CHECK ((("np_agent_approvals"."requires_live_preview" and "np_agent_approvals"."preview_id" is not null and "np_agent_approvals"."preview_digest" is not null) or (not "np_agent_approvals"."requires_live_preview" and "np_agent_approvals"."preview_id" is null and "np_agent_approvals"."preview_digest" is null)) is true),
	CONSTRAINT "np_agent_approvals_reauth_check" CHECK ((("np_agent_approvals"."required_reauth_mode"='none' and "np_agent_approvals"."required_reauth_max_age_seconds" is null) or ("np_agent_approvals"."required_reauth_mode"='recent-staff-primary' and "np_agent_approvals"."required_reauth_max_age_seconds" between 1 and 300)) is true),
	CONSTRAINT "np_agent_approvals_statement_check" CHECK ((jsonb_typeof("np_agent_approvals"."statement_body")='object' and "np_agent_approvals"."statement_body"->>'version'='np.agent-approval-statement.v1' and "np_agent_approvals"."statement_body"->>'siteId'="np_agent_approvals"."site_id" and "np_agent_approvals"."statement_body"->>'approvalId'="np_agent_approvals"."id"::text and "np_agent_approvals"."statement_body"->>'capabilityId'="np_agent_approvals"."capability_id" and "np_agent_approvals"."statement_body"->>'capabilityContractVersion'="np_agent_approvals"."capability_contract_version"::text and "np_agent_approvals"."statement_body"->>'capabilityFingerprint'="np_agent_approvals"."capability_fingerprint" and "np_agent_approvals"."statement_body"->'target'->>'kind'="np_agent_approvals"."target_kind" and
 (("np_agent_approvals"."target_kind"='changeset' and "np_agent_approvals"."statement_body"->'target'->>'changeSetId'="np_agent_approvals"."target_id"::text and "np_agent_approvals"."statement_body"->'target'->>'planHash'="np_agent_approvals"."plan_hash") or ("np_agent_approvals"."target_kind"='action' and "np_agent_approvals"."statement_body"->'target'->>'actionId'="np_agent_approvals"."target_id"::text and "np_agent_approvals"."statement_body"->'target'->>'proposalHash'="np_agent_approvals"."plan_hash"))) is true),
	CONSTRAINT "np_agent_approvals_challenge_check" CHECK ((("np_agent_approvals"."challenge_hash" is null and "np_agent_approvals"."challenge_purpose" is null and "np_agent_approvals"."challenge_hash_key_id" is null and "np_agent_approvals"."challenge_issued_to_user_id" is null and "np_agent_approvals"."challenge_session_fingerprint" is null and "np_agent_approvals"."challenge_expires_at" is null) or
 ("np_agent_approvals"."challenge_generation">0 and "np_agent_approvals"."challenge_hash" is not null and "np_agent_approvals"."challenge_purpose" in ('approve','reject','revoke') and "np_agent_approvals"."challenge_hash_key_id" is not null and "np_agent_approvals"."challenge_issued_to_user_id" is not null and "np_agent_approvals"."challenge_session_fingerprint" is not null and "np_agent_approvals"."challenge_expires_at" is not null and "np_agent_approvals"."challenge_expires_at"<="np_agent_approvals"."expires_at")) is true),
	CONSTRAINT "np_agent_approvals_decision_check" CHECK (((
 ("np_agent_approvals"."decision_body" is null and "np_agent_approvals"."decision_hash" is null and "np_agent_approvals"."decision_mac" is null and "np_agent_approvals"."decider_fingerprint" is null and "np_agent_approvals"."decided_by_user_id" is null and "np_agent_approvals"."decided_at" is null and "np_agent_approvals"."decision_reauth_fingerprint" is null and "np_agent_approvals"."decision_reauthenticated_at" is null) or
 ("np_agent_approvals"."decision_body" is not null and "np_agent_approvals"."decision_hash" is not null and "np_agent_approvals"."decision_mac" is not null and "np_agent_approvals"."decider_fingerprint" is not null and "np_agent_approvals"."decided_at" is not null and
 "np_agent_approvals"."decision_body"->>'schemaVersion'='np.agent-approval-decision.v1' and "np_agent_approvals"."decision_body"->>'siteId'="np_agent_approvals"."site_id" and "np_agent_approvals"."decision_body"->>'approvalId'="np_agent_approvals"."id"::text and "np_agent_approvals"."decision_body"->>'approvalGeneration'="np_agent_approvals"."generation"::text and "np_agent_approvals"."decision_body"->>'statementHash'="np_agent_approvals"."statement_hash" and
 (("np_agent_approvals"."required_reauth_mode"='none' and "np_agent_approvals"."decision_reauth_fingerprint" is null and "np_agent_approvals"."decision_reauthenticated_at" is null) or ("np_agent_approvals"."required_reauth_mode"='recent-staff-primary' and "np_agent_approvals"."decision_reauth_fingerprint" is not null and "np_agent_approvals"."decision_reauthenticated_at" is not null)))) and
 ("np_agent_approvals"."state" not in ('approved','rejected','consumed') or "np_agent_approvals"."decision_body" is not null) and ("np_agent_approvals"."state"<>'pending' or "np_agent_approvals"."decision_body" is null) and
 ("np_agent_approvals"."state" not in ('approved','consumed') or "np_agent_approvals"."decision_body"->>'decision'='approve') and ("np_agent_approvals"."state"<>'rejected' or "np_agent_approvals"."decision_body"->>'decision'='reject')) is true),
	CONSTRAINT "np_agent_approvals_revocation_check" CHECK ((("np_agent_approvals"."state"='revoked' and "np_agent_approvals"."revocation_kind" in ('human','authority_loss','site_deleting','integrity_key_retired','target_invalidated') and "np_agent_approvals"."revoker_fingerprint" is not null and "np_agent_approvals"."revocation_code" is not null and "np_agent_approvals"."revocation_body" is not null and "np_agent_approvals"."revocation_hash" is not null and "np_agent_approvals"."revocation_mac" is not null and "np_agent_approvals"."revocation_integrity_key_id" is not null and "np_agent_approvals"."revoked_at" is not null and "np_agent_approvals"."revocation_body"->>'schemaVersion'='np.agent-approval-revocation.v1' and "np_agent_approvals"."revocation_body"->>'siteId'="np_agent_approvals"."site_id" and "np_agent_approvals"."revocation_body"->>'approvalId'="np_agent_approvals"."id"::text and "np_agent_approvals"."revocation_body"->>'approvalGeneration'="np_agent_approvals"."generation"::text and "np_agent_approvals"."revocation_body"->>'statementHash'="np_agent_approvals"."statement_hash" and ("np_agent_approvals"."revocation_kind"='human' or ("np_agent_approvals"."revoked_by_user_id" is null and "np_agent_approvals"."revocation_reason" is null))) or
 ("np_agent_approvals"."state"<>'revoked' and "np_agent_approvals"."revocation_kind" is null and "np_agent_approvals"."revoked_by_user_id" is null and "np_agent_approvals"."revoker_fingerprint" is null and "np_agent_approvals"."revocation_code" is null and "np_agent_approvals"."revocation_reason" is null and "np_agent_approvals"."revocation_body" is null and "np_agent_approvals"."revocation_hash" is null and "np_agent_approvals"."revocation_mac" is null and "np_agent_approvals"."revocation_integrity_key_id" is null and "np_agent_approvals"."revoked_at" is null)) is true),
	CONSTRAINT "np_agent_approvals_time_check" CHECK (("np_agent_approvals"."expires_at">"np_agent_approvals"."requested_at" and "np_agent_approvals"."expires_at"<="np_agent_approvals"."requested_at"+interval '7 days' and ("np_agent_approvals"."decided_at" is null or ("np_agent_approvals"."decided_at">="np_agent_approvals"."requested_at" and "np_agent_approvals"."decided_at"<"np_agent_approvals"."expires_at")) and ("np_agent_approvals"."revoked_at" is null or "np_agent_approvals"."revoked_at">="np_agent_approvals"."requested_at") and (("np_agent_approvals"."state"='consumed')=("np_agent_approvals"."consumed_at" is not null)) and ("np_agent_approvals"."consumed_at" is null or ("np_agent_approvals"."consumed_at">="np_agent_approvals"."decided_at" and "np_agent_approvals"."consumed_at"<"np_agent_approvals"."expires_at")) and ("np_agent_approvals"."reason" is null or char_length("np_agent_approvals"."reason")<=4000) and ("np_agent_approvals"."revocation_reason" is null or char_length("np_agent_approvals"."revocation_reason")<=4000)) is true),
	CONSTRAINT "np_agent_approvals_hash_check" CHECK (("np_agent_approvals"."plan_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_approvals"."capability_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_approvals"."statement_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_approvals"."requester_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and char_length("np_agent_approvals"."statement_mac") between 1 and 256 and char_length("np_agent_approvals"."integrity_key_id") between 1 and 128) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_changeset_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"changeset_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"client_operation_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_key" jsonb NOT NULL,
	"operation" text NOT NULL,
	"input" jsonb NOT NULL,
	"base_version" jsonb,
	"before_hash" text,
	"before_snapshot" jsonb,
	"snapshot_hash" text,
	"after_hash" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_changeset_operations_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_changeset_operations_ordinal_unique" UNIQUE("site_id","changeset_id","ordinal"),
	CONSTRAINT "np_agent_changeset_operations_client_id_unique" UNIQUE("site_id","changeset_id","client_operation_id"),
	CONSTRAINT "np_agent_changeset_operations_ordinal_check" CHECK (("np_agent_changeset_operations"."ordinal" between 1 and 500 and char_length("np_agent_changeset_operations"."client_operation_id") between 1 and 128) is true),
	CONSTRAINT "np_agent_changeset_operations_kind_check" CHECK ((("np_agent_changeset_operations"."resource_kind"='document' and "np_agent_changeset_operations"."operation" in ('create','update','publish','schedule','archive')) or ("np_agent_changeset_operations"."resource_kind" in ('navigation','theme_tokens') and "np_agent_changeset_operations"."operation"='replace') or ("np_agent_changeset_operations"."resource_kind"='setting' and "np_agent_changeset_operations"."operation" in ('replace','remove')) or ("np_agent_changeset_operations"."resource_kind"='media_ref' and "np_agent_changeset_operations"."operation" in ('attach','detach'))) is true),
	CONSTRAINT "np_agent_changeset_operations_body_check" CHECK ((jsonb_typeof("np_agent_changeset_operations"."resource_key")='object' and "np_agent_changeset_operations"."resource_key"->>'kind'="np_agent_changeset_operations"."resource_kind" and jsonb_typeof("np_agent_changeset_operations"."input")='object' and "np_agent_changeset_operations"."input"->>'kind'="np_agent_changeset_operations"."resource_kind" and "np_agent_changeset_operations"."input"->>'operation'="np_agent_changeset_operations"."operation" and "np_agent_changeset_operations"."input"->>'clientOperationId'="np_agent_changeset_operations"."client_operation_id") is true),
	CONSTRAINT "np_agent_changeset_operations_state_check" CHECK (("np_agent_changeset_operations"."state" in ('draft','valid','invalid','applied','verified','failed')) is true),
	CONSTRAINT "np_agent_changeset_operations_snapshot_check" CHECK ((("np_agent_changeset_operations"."before_snapshot" is null and "np_agent_changeset_operations"."snapshot_hash" is null) or ("np_agent_changeset_operations"."before_snapshot" is not null and "np_agent_changeset_operations"."snapshot_hash" is not null and "np_agent_changeset_operations"."snapshot_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof("np_agent_changeset_operations"."before_snapshot")='object' and "np_agent_changeset_operations"."before_snapshot"->>'schemaVersion'='np.agent-changeset-snapshot.v1' and "np_agent_changeset_operations"."before_snapshot"->>'siteId'="np_agent_changeset_operations"."site_id" and "np_agent_changeset_operations"."before_snapshot"->>'changeSetId'="np_agent_changeset_operations"."changeset_id"::text and "np_agent_changeset_operations"."before_snapshot"->>'operationOrdinal'="np_agent_changeset_operations"."ordinal"::text and "np_agent_changeset_operations"."before_snapshot"->'canonicalResourceKey'="np_agent_changeset_operations"."resource_key")) is true),
	CONSTRAINT "np_agent_changeset_operations_time_check" CHECK (("np_agent_changeset_operations"."updated_at">="np_agent_changeset_operations"."created_at") is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_changesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"creator_kind" text NOT NULL,
	"principal_id" uuid,
	"created_by_user_id" uuid,
	"actor_deleted_at" timestamp with time zone,
	"actor_fingerprint" text NOT NULL,
	"source_operation_id" text NOT NULL,
	"source_input_hash" text NOT NULL,
	"source_idempotency_fingerprint" text NOT NULL,
	"agent_id" uuid,
	"agent_version_id" uuid,
	"agent_config_hash" text,
	"run_id" uuid,
	"run_fingerprint" text,
	"invocation_id" uuid,
	"invocation_fingerprint" text,
	"title" text NOT NULL,
	"summary" text,
	"state" text DEFAULT 'draft' NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"draft_hash" text NOT NULL,
	"validation_generation" integer DEFAULT 0 NOT NULL,
	"base_fingerprint" text,
	"plan_hash" text,
	"sealed_plan_body" jsonb,
	"risk_summary" jsonb,
	"policy_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"rollback_window_seconds" integer,
	"rollback_eligible_until" timestamp with time zone,
	"cancellation_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "np_agent_changesets_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_changesets_source_unique" UNIQUE("site_id","actor_fingerprint","source_operation_id","source_idempotency_fingerprint"),
	CONSTRAINT "np_agent_changesets_state_check" CHECK (("np_agent_changesets"."state" in ('draft','validating','invalid','ready','approval_pending','approved','scheduled','applying','applied','verifying','verified','rejected','cancelled','apply_failed','verification_failed','rolling_back','rolled_back','rollback_failed')) is true),
	CONSTRAINT "np_agent_changesets_version_check" CHECK (("np_agent_changesets"."draft_version">0 and "np_agent_changesets"."validation_generation">=0) is true),
	CONSTRAINT "np_agent_changesets_actor_check" CHECK (((
 ("np_agent_changesets"."creator_kind"='staff' and "np_agent_changesets"."principal_id" is null and (("np_agent_changesets"."created_by_user_id" is not null and "np_agent_changesets"."actor_deleted_at" is null) or ("np_agent_changesets"."created_by_user_id" is null and "np_agent_changesets"."actor_deleted_at" is not null))) or
 ("np_agent_changesets"."creator_kind" in ('external','runtime') and "np_agent_changesets"."principal_id" is not null and "np_agent_changesets"."created_by_user_id" is null and "np_agent_changesets"."actor_deleted_at" is null)) and
 (("np_agent_changesets"."creator_kind"='runtime' and "np_agent_changesets"."agent_id" is not null and "np_agent_changesets"."agent_version_id" is not null and "np_agent_changesets"."agent_config_hash" is not null) or
 ("np_agent_changesets"."creator_kind"<>'runtime' and "np_agent_changesets"."agent_id" is null and "np_agent_changesets"."agent_version_id" is null and "np_agent_changesets"."agent_config_hash" is null))) is true),
	CONSTRAINT "np_agent_changesets_attribution_check" CHECK ((("np_agent_changesets"."run_id" is null or "np_agent_changesets"."run_fingerprint" is not null) and ("np_agent_changesets"."invocation_id" is null or "np_agent_changesets"."invocation_fingerprint" is not null)) is true),
	CONSTRAINT "np_agent_changesets_text_check" CHECK ((char_length("np_agent_changesets"."title") between 1 and 4000 and "np_agent_changesets"."title"=btrim("np_agent_changesets"."title") and ("np_agent_changesets"."summary" is null or char_length("np_agent_changesets"."summary")<=4000) and char_length("np_agent_changesets"."source_operation_id") between 1 and 128) is true),
	CONSTRAINT "np_agent_changesets_hash_check" CHECK (("np_agent_changesets"."actor_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changesets"."source_input_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changesets"."source_idempotency_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changesets"."draft_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_changesets"."plan_hash" is null or "np_agent_changesets"."plan_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')) is true),
	CONSTRAINT "np_agent_changesets_sealed_check" CHECK (((
 ("np_agent_changesets"."sealed_plan_body" is null and "np_agent_changesets"."plan_hash" is null and "np_agent_changesets"."rollback_window_seconds" is null) or
 ("np_agent_changesets"."sealed_plan_body" is not null and "np_agent_changesets"."plan_hash" is not null and "np_agent_changesets"."rollback_window_seconds" between 60 and 7776000 and "np_agent_changesets"."validation_generation">0 and
 jsonb_typeof("np_agent_changesets"."sealed_plan_body")='object' and "np_agent_changesets"."sealed_plan_body"->>'schemaVersion'='np.agent-changeset-plan.v1' and "np_agent_changesets"."sealed_plan_body"->>'planKind'='changeset' and
 "np_agent_changesets"."sealed_plan_body"->>'siteId'="np_agent_changesets"."site_id" and "np_agent_changesets"."sealed_plan_body"->>'changeSetId'="np_agent_changesets"."id"::text and
 "np_agent_changesets"."sealed_plan_body"->'body'->>'rollbackWindowSeconds'="np_agent_changesets"."rollback_window_seconds"::text)) and
 ("np_agent_changesets"."state" not in ('draft','validating','invalid') or "np_agent_changesets"."sealed_plan_body" is null) and
 ("np_agent_changesets"."state" in ('draft','validating','invalid','cancelled','rejected') or "np_agent_changesets"."sealed_plan_body" is not null)) is true),
	CONSTRAINT "np_agent_changesets_time_check" CHECK (("np_agent_changesets"."updated_at">="np_agent_changesets"."created_at" and "np_agent_changesets"."expires_at">"np_agent_changesets"."created_at" and "np_agent_changesets"."expires_at"<="np_agent_changesets"."created_at"+interval '90 days' and
 ("np_agent_changesets"."scheduled_for" is null or ("np_agent_changesets"."scheduled_for">="np_agent_changesets"."created_at" and "np_agent_changesets"."scheduled_for"<"np_agent_changesets"."expires_at")) and
 ("np_agent_changesets"."applied_at" is null or "np_agent_changesets"."applied_at">="np_agent_changesets"."created_at") and ("np_agent_changesets"."verified_at" is null or ("np_agent_changesets"."applied_at" is not null and "np_agent_changesets"."verified_at">="np_agent_changesets"."applied_at")) and
 ("np_agent_changesets"."rolled_back_at" is null or ("np_agent_changesets"."applied_at" is not null and "np_agent_changesets"."rolled_back_at">="np_agent_changesets"."applied_at")) and
 (("np_agent_changesets"."rollback_eligible_until" is null and "np_agent_changesets"."applied_at" is null) or ("np_agent_changesets"."applied_at" is not null and "np_agent_changesets"."rollback_window_seconds" is not null and "np_agent_changesets"."rollback_eligible_until"="np_agent_changesets"."applied_at"+make_interval(secs=>"np_agent_changesets"."rollback_window_seconds")))) is true),
	CONSTRAINT "np_agent_changesets_cancel_check" CHECK ((("np_agent_changesets"."state"='cancelled')=("np_agent_changesets"."cancellation_code" is not null)) is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_challenge_issued_to_user_id_np_users_id_fk" FOREIGN KEY ("challenge_issued_to_user_id") REFERENCES "public"."np_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_requested_by_user_id_np_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_decided_by_user_id_np_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_revoked_by_user_id_np_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_changeset_fk" FOREIGN KEY ("site_id","target_changeset_id") REFERENCES "public"."np_agent_changesets"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_action_fk" FOREIGN KEY ("site_id","target_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_approvals" ADD CONSTRAINT "np_agent_approvals_requester_fk" FOREIGN KEY ("site_id","requested_by_principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_operations" ADD CONSTRAINT "np_agent_changeset_operations_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_operations" ADD CONSTRAINT "np_agent_changeset_operations_changeset_fk" FOREIGN KEY ("site_id","changeset_id") REFERENCES "public"."np_agent_changesets"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changesets" ADD CONSTRAINT "np_agent_changesets_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changesets" ADD CONSTRAINT "np_agent_changesets_created_by_user_id_np_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changesets" ADD CONSTRAINT "np_agent_changesets_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changesets" ADD CONSTRAINT "np_agent_changesets_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changesets" ADD CONSTRAINT "np_agent_changesets_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_approvals_live_statement_uidx" ON "np_agent_approvals" USING btree ("site_id","target_kind","target_id","plan_hash") WHERE "np_agent_approvals"."state" in ('pending','approved');--> statement-breakpoint
CREATE INDEX "np_agent_approvals_expiry_idx" ON "np_agent_approvals" USING btree ("site_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_changesets_site_state_idx" ON "np_agent_changesets" USING btree ("site_id","state","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_changesets_principal_idx" ON "np_agent_changesets" USING btree ("site_id","principal_id","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_changesets_expiry_idx" ON "np_agent_changesets" USING btree ("site_id","state","expires_at");