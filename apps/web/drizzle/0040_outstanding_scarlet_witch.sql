CREATE TABLE "np_agent_changeset_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"changeset_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"generation" integer NOT NULL,
	"preview_contract_body" jsonb NOT NULL,
	"preview_contract_fingerprint" text NOT NULL,
	"admitting_invocation_id" uuid NOT NULL,
	"authorization_context_body" jsonb NOT NULL,
	"authorization_context_fingerprint" text NOT NULL,
	"authority_ref" jsonb NOT NULL,
	"requester_kind" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"requester_fingerprint" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"diff_summary" jsonb,
	"check_summary" jsonb,
	"risk_summary" jsonb,
	"allowed_routes" jsonb NOT NULL,
	"allowed_routes_digest" text NOT NULL,
	"digest" text,
	"expected_artifact_count" integer,
	"upload_set_digest" text,
	"artifact_reserved_at" timestamp with time zone,
	"render_bootstrap_jti" uuid,
	"render_attempt_id" uuid,
	"render_session_id" uuid,
	"render_bootstrap_issued_at" timestamp with time zone,
	"render_bootstrap_expires_at" timestamp with time zone,
	"render_bootstrap_consumed_at" timestamp with time zone,
	"run_id" uuid,
	"job_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendering_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "np_agent_changeset_previews_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_changeset_previews_contract_unique" UNIQUE("site_id","id","preview_contract_fingerprint"),
	CONSTRAINT "np_agent_changeset_previews_generation_unique" UNIQUE("site_id","changeset_id","plan_hash","generation"),
	CONSTRAINT "np_agent_changeset_previews_invocation_unique" UNIQUE("site_id","admitting_invocation_id"),
	CONSTRAINT "np_agent_changeset_previews_render_reservation_unique" UNIQUE("site_id","id","render_session_id","render_attempt_id"),
	CONSTRAINT "np_agent_changeset_previews_state_check" CHECK ("np_agent_changeset_previews"."state" in ('queued','rendering','ready','failed','expired') and "np_agent_changeset_previews"."generation">0),
	CONSTRAINT "np_agent_changeset_previews_hash_check" CHECK ("np_agent_changeset_previews"."plan_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_previews"."preview_contract_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_previews"."authorization_context_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_previews"."requester_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_previews"."allowed_routes_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_changeset_previews"."digest" is null or "np_agent_changeset_previews"."digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')),
	CONSTRAINT "np_agent_changeset_previews_authority_check" CHECK (("np_agent_changeset_previews"."authorization_context_body"->>'siteId'="np_agent_changeset_previews"."site_id" and "np_agent_changeset_previews"."authorization_context_body"->>'schemaVersion'='np.agent-authorization-context.v1' and "np_agent_changeset_previews"."authorization_context_body"->'authorityRef'="np_agent_changeset_previews"."authority_ref" and "np_agent_changeset_previews"."authorization_context_body"->'actor'->>'kind'="np_agent_changeset_previews"."requester_kind" and "np_agent_changeset_previews"."authorization_context_body"->'actor'->>'actorFingerprint'="np_agent_changeset_previews"."requester_fingerprint" and (("np_agent_changeset_previews"."requester_kind"='staff' and "np_agent_changeset_previews"."authorization_context_body"->'actor'->>'userId'="np_agent_changeset_previews"."requester_id"::text and "np_agent_changeset_previews"."authority_ref"->>'kind'='staff-session' and "np_agent_changeset_previews"."authority_ref"->>'userId'="np_agent_changeset_previews"."requester_id"::text) or ("np_agent_changeset_previews"."requester_kind"='principal' and "np_agent_changeset_previews"."authorization_context_body"->'actor'->>'principalId'="np_agent_changeset_previews"."requester_id"::text and "np_agent_changeset_previews"."authority_ref"->>'principalId'="np_agent_changeset_previews"."requester_id"::text and "np_agent_changeset_previews"."authority_ref"->>'kind' in ('service-family','oauth-grant','runtime-run')))) is true),
	CONSTRAINT "np_agent_changeset_previews_contract_check" CHECK (("np_agent_changeset_previews"."preview_contract_body"->>'schemaVersion'='np.agent-preview-contract.v1' and octet_length("np_agent_changeset_previews"."preview_contract_body"::text)<=65536 and jsonb_typeof("np_agent_changeset_previews"."allowed_routes")='array' and octet_length("np_agent_changeset_previews"."allowed_routes"::text)<=262144) is true),
	CONSTRAINT "np_agent_changeset_previews_reservation_check" CHECK ((("np_agent_changeset_previews"."expected_artifact_count" is null and "np_agent_changeset_previews"."upload_set_digest" is null and "np_agent_changeset_previews"."artifact_reserved_at" is null) or ("np_agent_changeset_previews"."expected_artifact_count" between 0 and 24 and "np_agent_changeset_previews"."upload_set_digest" ~ '^aus1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_previews"."artifact_reserved_at" is not null)) is true),
	CONSTRAINT "np_agent_changeset_previews_bootstrap_check" CHECK ((("np_agent_changeset_previews"."render_bootstrap_jti" is null and "np_agent_changeset_previews"."render_attempt_id" is null and "np_agent_changeset_previews"."render_session_id" is null and "np_agent_changeset_previews"."render_bootstrap_issued_at" is null and "np_agent_changeset_previews"."render_bootstrap_expires_at" is null and "np_agent_changeset_previews"."render_bootstrap_consumed_at" is null) or ("np_agent_changeset_previews"."render_bootstrap_jti" is not null and "np_agent_changeset_previews"."render_attempt_id" is not null and "np_agent_changeset_previews"."render_session_id" is not null and "np_agent_changeset_previews"."render_bootstrap_issued_at" is not null and "np_agent_changeset_previews"."render_bootstrap_expires_at">"np_agent_changeset_previews"."render_bootstrap_issued_at" and "np_agent_changeset_previews"."render_bootstrap_expires_at"<="np_agent_changeset_previews"."render_bootstrap_issued_at"+interval '120 seconds' and ("np_agent_changeset_previews"."render_bootstrap_consumed_at" is null or "np_agent_changeset_previews"."render_bootstrap_consumed_at">="np_agent_changeset_previews"."render_bootstrap_issued_at"))) is true),
	CONSTRAINT "np_agent_changeset_previews_started_check" CHECK (("np_agent_changeset_previews"."state"<>'queued' or "np_agent_changeset_previews"."rendering_started_at" is null) and ("np_agent_changeset_previews"."state" not in ('rendering','ready') or "np_agent_changeset_previews"."rendering_started_at" is not null) and ("np_agent_changeset_previews"."rendering_started_at" is null or "np_agent_changeset_previews"."rendering_started_at">="np_agent_changeset_previews"."created_at")),
	CONSTRAINT "np_agent_changeset_previews_terminal_check" CHECK ((("np_agent_changeset_previews"."state" in ('queued','rendering') and "np_agent_changeset_previews"."completed_at" is null and "np_agent_changeset_previews"."expires_at" is null and "np_agent_changeset_previews"."digest" is null) or ("np_agent_changeset_previews"."state"='ready' and "np_agent_changeset_previews"."completed_at" is not null and "np_agent_changeset_previews"."expires_at">"np_agent_changeset_previews"."completed_at" and "np_agent_changeset_previews"."expires_at"<="np_agent_changeset_previews"."completed_at"+interval '7 days' and "np_agent_changeset_previews"."digest" is not null and "np_agent_changeset_previews"."expected_artifact_count" is not null and "np_agent_changeset_previews"."error_code" is null) or ("np_agent_changeset_previews"."state"='failed' and "np_agent_changeset_previews"."completed_at" is not null and "np_agent_changeset_previews"."expires_at" is null and "np_agent_changeset_previews"."digest" is null and "np_agent_changeset_previews"."error_code" is not null) or ("np_agent_changeset_previews"."state"='expired' and "np_agent_changeset_previews"."completed_at" is not null and (("np_agent_changeset_previews"."expires_at" is null and "np_agent_changeset_previews"."digest" is null) or ("np_agent_changeset_previews"."expires_at" is not null and "np_agent_changeset_previews"."digest" is not null)))) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_preview_artifact_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"preview_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"upload_set_digest" text NOT NULL,
	"upload_request_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone,
	"call_deadline_at" timestamp with time zone,
	"adapter_operation_status" text DEFAULT 'not_dispatched' NOT NULL,
	"adapter_operation_ref" text,
	"adapter_operation_receipt_digest" text,
	"adapter_operation_resolved_at" timestamp with time zone,
	"observed_object_state" text DEFAULT 'unknown' NOT NULL,
	"ever_observed_present" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"prune_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_preview_artifact_uploads_artifact_unique" UNIQUE("artifact_id"),
	CONSTRAINT "np_agent_preview_artifact_uploads_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "np_agent_preview_artifact_uploads_bounds_check" CHECK ("np_agent_preview_artifact_uploads"."attempt" between 0 and 255 and "np_agent_preview_artifact_uploads"."row_version">0 and "np_agent_preview_artifact_uploads"."prune_at">="np_agent_preview_artifact_uploads"."created_at"+interval '365 days' and ("np_agent_preview_artifact_uploads"."adapter_operation_ref" is null or char_length("np_agent_preview_artifact_uploads"."adapter_operation_ref") between 1 and 512) and "np_agent_preview_artifact_uploads"."upload_set_digest" ~ '^aus1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_artifact_uploads"."upload_request_digest" ~ '^aur1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_artifact_uploads"."idempotency_key" ~ '^npau1_[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "np_agent_preview_artifact_uploads_state_check" CHECK ("np_agent_preview_artifact_uploads"."state" in ('queued','running','waiting_inspection','succeeded','failed','cancelled') and "np_agent_preview_artifact_uploads"."adapter_operation_status" in ('not_dispatched','pending','unknown','not_started','committed','failed_no_effect') and "np_agent_preview_artifact_uploads"."observed_object_state" in ('unknown','present','absent') and ("np_agent_preview_artifact_uploads"."observed_object_state"<>'present' or "np_agent_preview_artifact_uploads"."ever_observed_present")),
	CONSTRAINT "np_agent_preview_artifact_uploads_receipt_check" CHECK ((("np_agent_preview_artifact_uploads"."adapter_operation_status" in ('not_dispatched','pending','unknown') and "np_agent_preview_artifact_uploads"."adapter_operation_receipt_digest" is null and "np_agent_preview_artifact_uploads"."adapter_operation_resolved_at" is null) or ("np_agent_preview_artifact_uploads"."adapter_operation_status" in ('not_started','committed','failed_no_effect') and "np_agent_preview_artifact_uploads"."adapter_operation_receipt_digest" ~ '^auo1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_artifact_uploads"."adapter_operation_resolved_at" is not null)) is true),
	CONSTRAINT "np_agent_preview_artifact_uploads_lifecycle_check" CHECK ((
    ("np_agent_preview_artifact_uploads"."state"='queued' and "np_agent_preview_artifact_uploads"."attempt"=0 and "np_agent_preview_artifact_uploads"."adapter_operation_status"='not_dispatched' and not "np_agent_preview_artifact_uploads"."ever_observed_present" and "np_agent_preview_artifact_uploads"."observed_object_state"='unknown' and "np_agent_preview_artifact_uploads"."started_at" is null and "np_agent_preview_artifact_uploads"."lease_until" is null and "np_agent_preview_artifact_uploads"."call_deadline_at" is null and "np_agent_preview_artifact_uploads"."finished_at" is null and "np_agent_preview_artifact_uploads"."verified_at" is null) or
    ("np_agent_preview_artifact_uploads"."state"='running' and "np_agent_preview_artifact_uploads"."attempt">0 and "np_agent_preview_artifact_uploads"."started_at" is not null and "np_agent_preview_artifact_uploads"."lease_until" is not null and "np_agent_preview_artifact_uploads"."call_deadline_at" is not null and "np_agent_preview_artifact_uploads"."finished_at" is null and "np_agent_preview_artifact_uploads"."verified_at" is null) or
    ("np_agent_preview_artifact_uploads"."state"='waiting_inspection' and "np_agent_preview_artifact_uploads"."attempt">0 and "np_agent_preview_artifact_uploads"."started_at" is not null and "np_agent_preview_artifact_uploads"."lease_until" is null and "np_agent_preview_artifact_uploads"."call_deadline_at" is not null and "np_agent_preview_artifact_uploads"."finished_at" is null and "np_agent_preview_artifact_uploads"."verified_at" is null) or
    ("np_agent_preview_artifact_uploads"."state"='succeeded' and "np_agent_preview_artifact_uploads"."attempt">0 and "np_agent_preview_artifact_uploads"."started_at" is not null and "np_agent_preview_artifact_uploads"."lease_until" is null and "np_agent_preview_artifact_uploads"."call_deadline_at" is not null and "np_agent_preview_artifact_uploads"."finished_at" is not null and "np_agent_preview_artifact_uploads"."adapter_operation_status"='committed' and "np_agent_preview_artifact_uploads"."observed_object_state"='present' and "np_agent_preview_artifact_uploads"."ever_observed_present" and "np_agent_preview_artifact_uploads"."verified_at" is not null) or
    ("np_agent_preview_artifact_uploads"."state" in ('failed','cancelled') and "np_agent_preview_artifact_uploads"."lease_until" is null and "np_agent_preview_artifact_uploads"."finished_at" is not null and "np_agent_preview_artifact_uploads"."verified_at" is null and (("np_agent_preview_artifact_uploads"."adapter_operation_status" in ('not_started','failed_no_effect') and "np_agent_preview_artifact_uploads"."observed_object_state"='absent') or ("np_agent_preview_artifact_uploads"."adapter_operation_status"='committed' and "np_agent_preview_artifact_uploads"."observed_object_state" in ('present','absent')) or ("np_agent_preview_artifact_uploads"."state"='cancelled' and "np_agent_preview_artifact_uploads"."attempt"=0 and "np_agent_preview_artifact_uploads"."adapter_operation_status"='not_dispatched' and "np_agent_preview_artifact_uploads"."started_at" is null and "np_agent_preview_artifact_uploads"."call_deadline_at" is null and not "np_agent_preview_artifact_uploads"."ever_observed_present" and "np_agent_preview_artifact_uploads"."observed_object_state"='absent')))
  ) is true),
	CONSTRAINT "np_agent_preview_artifact_uploads_time_check" CHECK (("np_agent_preview_artifact_uploads"."started_at" is null or "np_agent_preview_artifact_uploads"."started_at">="np_agent_preview_artifact_uploads"."created_at") and ("np_agent_preview_artifact_uploads"."call_deadline_at" is null or ("np_agent_preview_artifact_uploads"."call_deadline_at">"np_agent_preview_artifact_uploads"."started_at" and "np_agent_preview_artifact_uploads"."call_deadline_at"<="np_agent_preview_artifact_uploads"."started_at"+interval '60 seconds')) and ("np_agent_preview_artifact_uploads"."finished_at" is null or "np_agent_preview_artifact_uploads"."finished_at">="np_agent_preview_artifact_uploads"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "np_agent_preview_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"preview_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"preview_contract_fingerprint" text NOT NULL,
	"route" text,
	"locale" text,
	"viewport" jsonb,
	"report_part" integer,
	"report_total_parts" integer,
	"storage_key" text NOT NULL,
	"content_digest" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"storage_adapter_id" text NOT NULL,
	"storage_adapter_contract_version" integer NOT NULL,
	"storage_adapter_fingerprint" text NOT NULL,
	"object_state" text DEFAULT 'absent' NOT NULL,
	"object_expires_at" timestamp with time zone,
	"metadata_prune_at" timestamp with time zone NOT NULL,
	"delete_attempt" integer DEFAULT 0 NOT NULL,
	"delete_receipt_digest" text,
	"delete_status" text,
	"delete_error_code" text,
	"deleted_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_preview_artifacts_site_preview_id_unique" UNIQUE("site_id","preview_id","id"),
	CONSTRAINT "np_agent_preview_artifacts_site_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_preview_artifacts_ordinal_unique" UNIQUE("preview_id","ordinal"),
	CONSTRAINT "np_agent_preview_artifacts_storage_key_unique" UNIQUE("storage_adapter_id","storage_key"),
	CONSTRAINT "np_agent_preview_artifacts_metadata_check" CHECK (("np_agent_preview_artifacts"."ordinal" between 1 and 24 and "np_agent_preview_artifacts"."bytes" between 0 and 2097152 and "np_agent_preview_artifacts"."storage_adapter_contract_version">0 and "np_agent_preview_artifacts"."row_version">0 and "np_agent_preview_artifacts"."delete_attempt" between 0 and 255 and char_length("np_agent_preview_artifacts"."storage_key") between 1 and 2048 and char_length("np_agent_preview_artifacts"."storage_adapter_id") between 1 and 128 and "np_agent_preview_artifacts"."content_digest" ~ '^ac1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_artifacts"."storage_adapter_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') is true),
	CONSTRAINT "np_agent_preview_artifacts_kind_check" CHECK ((("np_agent_preview_artifacts"."kind"='screenshot' and "np_agent_preview_artifacts"."mime" in ('image/png','image/webp') and "np_agent_preview_artifacts"."route" is not null and "np_agent_preview_artifacts"."viewport"->>'name' in ('desktop','mobile') and "np_agent_preview_artifacts"."report_part" is null and "np_agent_preview_artifacts"."report_total_parts" is null) or ("np_agent_preview_artifacts"."kind"='report' and "np_agent_preview_artifacts"."mime"='application/json' and "np_agent_preview_artifacts"."bytes"<=524288 and "np_agent_preview_artifacts"."route" is null and "np_agent_preview_artifacts"."locale" is null and "np_agent_preview_artifacts"."viewport" is null and "np_agent_preview_artifacts"."report_part" between 1 and 4 and "np_agent_preview_artifacts"."report_total_parts" between "np_agent_preview_artifacts"."report_part" and 4)) is true),
	CONSTRAINT "np_agent_preview_artifacts_state_check" CHECK ("np_agent_preview_artifacts"."object_state" in ('ready','delete_pending','absent') and ("np_agent_preview_artifacts"."object_state"<>'ready' or "np_agent_preview_artifacts"."object_expires_at" is not null) and ("np_agent_preview_artifacts"."object_state"='absent' or "np_agent_preview_artifacts"."deleted_at" is null)),
	CONSTRAINT "np_agent_preview_artifacts_delete_check" CHECK ((("np_agent_preview_artifacts"."delete_receipt_digest" is null and "np_agent_preview_artifacts"."delete_status" is null and "np_agent_preview_artifacts"."deleted_at" is null) or ("np_agent_preview_artifacts"."delete_receipt_digest" ~ '^adr1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_artifacts"."delete_status" in ('deleted','already_absent') and "np_agent_preview_artifacts"."deleted_at" is not null and "np_agent_preview_artifacts"."object_state"='absent' and "np_agent_preview_artifacts"."delete_attempt">0)) is true),
	CONSTRAINT "np_agent_preview_artifacts_retention_check" CHECK ("np_agent_preview_artifacts"."metadata_prune_at">="np_agent_preview_artifacts"."created_at"+interval '365 days' and ("np_agent_preview_artifacts"."object_expires_at" is null or "np_agent_preview_artifacts"."object_expires_at">"np_agent_preview_artifacts"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "np_agent_preview_render_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"preview_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"plan_hash" text NOT NULL,
	"render_attempt_id" uuid NOT NULL,
	"allowed_routes_digest" text NOT NULL,
	"preview_contract_fingerprint" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"cookie_verifier" text NOT NULL,
	"cookie_verifier_key_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"capture_plan" jsonb NOT NULL,
	"consumed_ordinals" jsonb NOT NULL,
	CONSTRAINT "np_agent_preview_render_sessions_attempt_unique" UNIQUE("preview_id","generation","render_attempt_id"),
	CONSTRAINT "np_agent_preview_render_sessions_claims_check" CHECK (("np_agent_preview_render_sessions"."generation">0 and "np_agent_preview_render_sessions"."expires_at">"np_agent_preview_render_sessions"."issued_at" and "np_agent_preview_render_sessions"."expires_at"<="np_agent_preview_render_sessions"."issued_at"+interval '120 seconds' and "np_agent_preview_render_sessions"."cookie_verifier" ~ '^rcv1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$' and split_part("np_agent_preview_render_sessions"."cookie_verifier",':',3)="np_agent_preview_render_sessions"."cookie_verifier_key_id" and "np_agent_preview_render_sessions"."plan_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_render_sessions"."allowed_routes_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof("np_agent_preview_render_sessions"."capture_plan")='array' and jsonb_array_length("np_agent_preview_render_sessions"."capture_plan") between 1 and 20 and jsonb_typeof("np_agent_preview_render_sessions"."consumed_ordinals")='array' and jsonb_array_length("np_agent_preview_render_sessions"."capture_plan")=jsonb_array_length("np_agent_preview_render_sessions"."consumed_ordinals") and octet_length("np_agent_preview_render_sessions"."capture_plan"::text)<=65536) is true),
	CONSTRAINT "np_agent_preview_render_sessions_state_check" CHECK ((("np_agent_preview_render_sessions"."state"='active' and "np_agent_preview_render_sessions"."closed_at" is null and "np_agent_preview_render_sessions"."close_reason" is null) or ("np_agent_preview_render_sessions"."state"='completed' and "np_agent_preview_render_sessions"."closed_at" is not null and "np_agent_preview_render_sessions"."close_reason" is null and not "np_agent_preview_render_sessions"."consumed_ordinals" @> '[false]'::jsonb) or ("np_agent_preview_render_sessions"."state" in ('failed','cancelled','expired') and "np_agent_preview_render_sessions"."closed_at" is not null and "np_agent_preview_render_sessions"."close_reason" in ('CAPTURE_FAILED','PREVIEW_INVALIDATED','SITE_DELETING','SESSION_EXPIRED'))) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_preview_viewer_launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"preview_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"staff_session_id" uuid NOT NULL,
	"session_fingerprint" text NOT NULL,
	"session_fingerprint_key_id" text NOT NULL,
	"generation" integer NOT NULL,
	"admitting_invocation_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"signing_kid" text NOT NULL,
	"allowed_routes_digest" text NOT NULL,
	"site_authorization_body" jsonb NOT NULL,
	"site_authorization_digest" text NOT NULL,
	"iat" integer NOT NULL,
	"exp" integer NOT NULL,
	"launch_path" text NOT NULL,
	"exchange_verifier" text NOT NULL,
	"exchange_key_id" text NOT NULL,
	"exchange_expires_at" timestamp with time zone NOT NULL,
	"exchange_consumed_at" timestamp with time zone,
	"one_time_value_issued" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'exchange_pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"terminal_reason" text,
	CONSTRAINT "np_agent_preview_viewer_launches_generation_unique" UNIQUE("preview_id","staff_session_id","generation"),
	CONSTRAINT "np_agent_preview_viewer_launches_invocation_unique" UNIQUE("site_id","admitting_invocation_id"),
	CONSTRAINT "np_agent_preview_viewer_launches_claims_check" CHECK (("np_agent_preview_viewer_launches"."generation">0 and "np_agent_preview_viewer_launches"."iat">=0 and "np_agent_preview_viewer_launches"."exp">"np_agent_preview_viewer_launches"."iat" and "np_agent_preview_viewer_launches"."exp"<="np_agent_preview_viewer_launches"."iat"+300 and "np_agent_preview_viewer_launches"."one_time_value_issued" and "np_agent_preview_viewer_launches"."site_authorization_body"->>'siteId'="np_agent_preview_viewer_launches"."site_id" and "np_agent_preview_viewer_launches"."site_authorization_body"->>'userId'="np_agent_preview_viewer_launches"."staff_user_id"::text and "np_agent_preview_viewer_launches"."site_authorization_body"->>'schemaVersion'='np.agent-staff-site-authorization.v1' and "np_agent_preview_viewer_launches"."session_fingerprint" ~ '^psf1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$' and split_part("np_agent_preview_viewer_launches"."session_fingerprint",':',3)="np_agent_preview_viewer_launches"."session_fingerprint_key_id" and "np_agent_preview_viewer_launches"."site_authorization_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_viewer_launches"."allowed_routes_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_viewer_launches"."request_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_preview_viewer_launches"."exchange_verifier" ~ '^lxv1:hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[A-Za-z0-9_-]{43}$' and split_part("np_agent_preview_viewer_launches"."exchange_verifier",':',3)="np_agent_preview_viewer_launches"."exchange_key_id" and "np_agent_preview_viewer_launches"."exchange_expires_at">"np_agent_preview_viewer_launches"."created_at" and "np_agent_preview_viewer_launches"."exchange_expires_at"<="np_agent_preview_viewer_launches"."created_at"+interval '30 seconds') is true),
	CONSTRAINT "np_agent_preview_viewer_launches_state_check" CHECK ((("np_agent_preview_viewer_launches"."state"='exchange_pending' and "np_agent_preview_viewer_launches"."activated_at" is null and "np_agent_preview_viewer_launches"."exchange_consumed_at" is null and "np_agent_preview_viewer_launches"."superseded_at" is null and "np_agent_preview_viewer_launches"."expired_at" is null and "np_agent_preview_viewer_launches"."terminal_reason" is null) or ("np_agent_preview_viewer_launches"."state"='active' and "np_agent_preview_viewer_launches"."activated_at" is not null and "np_agent_preview_viewer_launches"."exchange_consumed_at" is not null and "np_agent_preview_viewer_launches"."superseded_at" is null and "np_agent_preview_viewer_launches"."expired_at" is null and "np_agent_preview_viewer_launches"."terminal_reason" is null) or ("np_agent_preview_viewer_launches"."state"='superseded' and "np_agent_preview_viewer_launches"."superseded_at" is not null and "np_agent_preview_viewer_launches"."expired_at" is null and "np_agent_preview_viewer_launches"."terminal_reason" in ('REPLACED','SESSION_REVOKED','PREVIEW_INVALIDATED','SITE_DELETING')) or ("np_agent_preview_viewer_launches"."state"='expired' and "np_agent_preview_viewer_launches"."expired_at" is not null and "np_agent_preview_viewer_launches"."superseded_at" is null and "np_agent_preview_viewer_launches"."terminal_reason" in ('REPLACED','SESSION_REVOKED','PREVIEW_INVALIDATED','SITE_DELETING'))) is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_changeset_previews" ADD CONSTRAINT "np_agent_changeset_previews_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_previews" ADD CONSTRAINT "np_agent_changeset_previews_changeset_fk" FOREIGN KEY ("site_id","changeset_id") REFERENCES "public"."np_agent_changesets"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_previews" ADD CONSTRAINT "np_agent_changeset_previews_invocation_fk" FOREIGN KEY ("site_id","admitting_invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_previews" ADD CONSTRAINT "np_agent_changeset_previews_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_artifact_uploads" ADD CONSTRAINT "np_agent_preview_artifact_uploads_preview_fk" FOREIGN KEY ("site_id","preview_id") REFERENCES "public"."np_agent_changeset_previews"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_artifact_uploads" ADD CONSTRAINT "np_agent_preview_artifact_uploads_artifact_fk" FOREIGN KEY ("site_id","preview_id","artifact_id") REFERENCES "public"."np_agent_preview_artifacts"("site_id","preview_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_artifacts" ADD CONSTRAINT "np_agent_preview_artifacts_preview_fk" FOREIGN KEY ("site_id","preview_id","preview_contract_fingerprint") REFERENCES "public"."np_agent_changeset_previews"("site_id","id","preview_contract_fingerprint") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_render_sessions" ADD CONSTRAINT "np_agent_preview_render_sessions_preview_fk" FOREIGN KEY ("site_id","preview_id","preview_contract_fingerprint") REFERENCES "public"."np_agent_changeset_previews"("site_id","id","preview_contract_fingerprint") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_render_sessions" ADD CONSTRAINT "np_agent_preview_render_sessions_reservation_fk" FOREIGN KEY ("site_id","preview_id","id","render_attempt_id") REFERENCES "public"."np_agent_changeset_previews"("site_id","id","render_session_id","render_attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_viewer_launches" ADD CONSTRAINT "np_agent_preview_viewer_launches_preview_fk" FOREIGN KEY ("site_id","preview_id") REFERENCES "public"."np_agent_changeset_previews"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_preview_viewer_launches" ADD CONSTRAINT "np_agent_preview_viewer_launches_invocation_fk" FOREIGN KEY ("site_id","admitting_invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_changeset_previews_state_idx" ON "np_agent_changeset_previews" USING btree ("site_id","state","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_preview_artifact_uploads_state_idx" ON "np_agent_preview_artifact_uploads" USING btree ("site_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_preview_artifacts_capture_unique" ON "np_agent_preview_artifacts" USING btree ("preview_id","kind",coalesce("route",''),coalesce("locale",''),coalesce("viewport"->>'name',''),coalesce("report_part",0));--> statement-breakpoint
CREATE INDEX "np_agent_preview_artifacts_cleanup_idx" ON "np_agent_preview_artifacts" USING btree ("site_id","object_state","metadata_prune_at");--> statement-breakpoint
CREATE INDEX "np_agent_preview_render_sessions_expiry_idx" ON "np_agent_preview_render_sessions" USING btree ("site_id","state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_preview_viewer_launches_active_unique" ON "np_agent_preview_viewer_launches" USING btree ("preview_id","staff_session_id") WHERE "np_agent_preview_viewer_launches"."state" in ('exchange_pending','active');--> statement-breakpoint
CREATE INDEX "np_agent_preview_viewer_launches_site_state_idx" ON "np_agent_preview_viewer_launches" USING btree ("site_id","state","created_at");