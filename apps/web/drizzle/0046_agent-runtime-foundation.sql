CREATE TABLE "np_agent_circuit_breakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_ref" text NOT NULL,
	"state" text NOT NULL,
	"reason_code" text,
	"failure_count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"probe_lease_until" timestamp with time zone,
	"version_number" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_circuit_breakers_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_circuit_breakers_scope_unique" UNIQUE("site_id","scope_kind","scope_ref"),
	CONSTRAINT "np_agent_circuit_breakers_scope_check" CHECK ((("np_agent_circuit_breakers"."scope_kind"='site' and "np_agent_circuit_breakers"."scope_ref"="np_agent_circuit_breakers"."site_id") or ("np_agent_circuit_breakers"."scope_kind" in ('agent','connection') and "np_agent_circuit_breakers"."scope_ref" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') or ("np_agent_circuit_breakers"."scope_kind"='subject' and "np_agent_circuit_breakers"."scope_ref" ~ '^[A-Za-z0-9_-]{43}$')) is true),
	CONSTRAINT "np_agent_circuit_breakers_state_check" CHECK ("np_agent_circuit_breakers"."state" in ('closed','open','half_open') and "np_agent_circuit_breakers"."version_number">0 and "np_agent_circuit_breakers"."failure_count">=0 and ("np_agent_circuit_breakers"."reason_code" is null or "np_agent_circuit_breakers"."reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')),
	CONSTRAINT "np_agent_circuit_breakers_time_check" CHECK (("np_agent_circuit_breakers"."updated_at">="np_agent_circuit_breakers"."window_started_at" and ((
      "np_agent_circuit_breakers"."state"='closed' and "np_agent_circuit_breakers"."opened_at" is null and "np_agent_circuit_breakers"."retry_at" is null and "np_agent_circuit_breakers"."probe_lease_until" is null
    ) or (
      "np_agent_circuit_breakers"."state"='open' and "np_agent_circuit_breakers"."reason_code" is not null and "np_agent_circuit_breakers"."opened_at">="np_agent_circuit_breakers"."window_started_at" and "np_agent_circuit_breakers"."retry_at">"np_agent_circuit_breakers"."opened_at" and "np_agent_circuit_breakers"."probe_lease_until" is null
    ) or (
      "np_agent_circuit_breakers"."state"='half_open' and "np_agent_circuit_breakers"."reason_code" is not null and "np_agent_circuit_breakers"."opened_at">="np_agent_circuit_breakers"."window_started_at" and "np_agent_circuit_breakers"."retry_at" is null and "np_agent_circuit_breakers"."probe_lease_until">"np_agent_circuit_breakers"."opened_at"
    ))) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_component" text NOT NULL,
	"subject" jsonb,
	"actor" jsonb,
	"causation" jsonb,
	"causal_root_run_id" uuid,
	"causal_run_id" uuid,
	"causal_action_id" uuid,
	"causal_depth" integer,
	"correlation_id" text,
	"deduplication_key" text,
	"event_hash" text NOT NULL,
	"privacy" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_events_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_events_kind_check" CHECK ("np_agent_events"."kind" in ('agent.action.changed','agent.policy.blocked','agent.run.changed','auth.login.failed','auth.login.succeeded','auth.session.revoked','authz.denied','authz.role.changed','community.content.created','community.content.moderated','community.content.reported','content.document.changed','content.document.published','jobs.backlog.threshold','jobs.handler.failed','jobs.worker.stale','ops.backup.failed','ops.backup.stale','ops.check.changed','security.edge.signal','security.error.signal')),
	CONSTRAINT "np_agent_events_source_check" CHECK ("np_agent_events"."source_kind" in ('auth','api','community','content','jobs','ops','storage','plugin','integration','agent') and "np_agent_events"."source_component" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$' and ("np_agent_events"."correlation_id" is null or "np_agent_events"."correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') and ("np_agent_events"."deduplication_key" is null or "np_agent_events"."deduplication_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')),
	CONSTRAINT "np_agent_events_body_check" CHECK (("np_agent_events"."privacy" in ('public','internal','sensitive') and "np_agent_events"."event_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_events"."payload"->>'kind'="np_agent_events"."kind" and octet_length("np_agent_events"."payload"::text)<=65536 and ("np_agent_events"."subject" is null or octet_length("np_agent_events"."subject"::text)<=4096) and ("np_agent_events"."actor" is null or octet_length("np_agent_events"."actor"::text)<=4096)) is true),
	CONSTRAINT "np_agent_events_causation_check" CHECK ((((
      "np_agent_events"."causal_root_run_id" is null and "np_agent_events"."causal_run_id" is null and "np_agent_events"."causal_action_id" is null and "np_agent_events"."causal_depth" is null
    ) or (
      "np_agent_events"."causal_root_run_id" is not null and "np_agent_events"."causal_run_id" is not null and "np_agent_events"."causal_action_id" is not null and "np_agent_events"."causal_depth" between 0 and 4 and "np_agent_events"."causation"->>'rootRunId'="np_agent_events"."causal_root_run_id"::text and "np_agent_events"."causation"->>'sourceRunId'="np_agent_events"."causal_run_id"::text and "np_agent_events"."causation"->>'sourceActionId'="np_agent_events"."causal_action_id"::text and "np_agent_events"."causation"->>'depth'="np_agent_events"."causal_depth"::text
    )) and ("np_agent_events"."causation" is null or (jsonb_typeof("np_agent_events"."causation")='object' and octet_length("np_agent_events"."causation"::text)<=4096))) is true),
	CONSTRAINT "np_agent_events_time_check" CHECK ("np_agent_events"."expires_at">"np_agent_events"."recorded_at" and ("np_agent_events"."dispatched_at" is null or "np_agent_events"."dispatched_at">="np_agent_events"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "np_agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"agent_id" uuid,
	"version" integer NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"rules" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "np_agent_policies_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_policies_status_check" CHECK ("np_agent_policies"."status" in ('draft','active','retired')),
	CONSTRAINT "np_agent_policies_version_check" CHECK ("np_agent_policies"."version">0 and "np_agent_policies"."row_version">0),
	CONSTRAINT "np_agent_policies_body_check" CHECK ((char_length("np_agent_policies"."name") between 1 and 120 and "np_agent_policies"."name"=btrim("np_agent_policies"."name") and octet_length("np_agent_policies"."instructions")<=262144 and "np_agent_policies"."rules"->>'schemaVersion'='np.agent-policy-rules.v1' and octet_length("np_agent_policies"."rules"::text)<=262144 and "np_agent_policies"."content_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') is true),
	CONSTRAINT "np_agent_policies_time_check" CHECK ((("np_agent_policies"."status"='draft' and "np_agent_policies"."activated_at" is null) or ("np_agent_policies"."status" in ('active','retired') and "np_agent_policies"."activated_at">="np_agent_policies"."created_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"retry_of_id" uuid,
	"connection_id" uuid NOT NULL,
	"connection_config_snapshot_id" uuid NOT NULL,
	"secret_version_id" uuid NOT NULL,
	"credential_version" integer NOT NULL,
	"connection_config_version" integer NOT NULL,
	"connection_config_hash" text NOT NULL,
	"provider_data_class_ceiling" text NOT NULL,
	"request_data_class" text NOT NULL,
	"classification_manifest" jsonb NOT NULL,
	"classification_manifest_digest" text NOT NULL,
	"recipe_id" text NOT NULL,
	"recipe_version" integer NOT NULL,
	"recipe_fingerprint" text NOT NULL,
	"instruction_template_id" text NOT NULL,
	"instruction_template_version" integer NOT NULL,
	"instruction_digest" text NOT NULL,
	"response_schema_digest" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"pricing_id" text NOT NULL,
	"pricing_version" integer NOT NULL,
	"pricing_fingerprint" text NOT NULL,
	"pricing_effective_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"dispatch_state" text NOT NULL,
	"usage_reservation_id" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"request_redacted" jsonb,
	"response_digest" text,
	"response_redacted" jsonb,
	"decision" jsonb,
	"provider_request_id" text,
	"idempotency_key" text NOT NULL,
	"error_class" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"usage_source" text,
	"cost_micros" bigint,
	"cost_source" text,
	"cost_currency" text,
	"finish_reason" text,
	"latency_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"diagnostic_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_provider_calls_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_provider_calls_run_id_unique" UNIQUE("site_id","run_id","id"),
	CONSTRAINT "np_agent_provider_calls_sequence_unique" UNIQUE("site_id","run_id","sequence"),
	CONSTRAINT "np_agent_provider_calls_idempotency_unique" UNIQUE("site_id","run_id","idempotency_key"),
	CONSTRAINT "np_agent_provider_calls_reservation_unique" UNIQUE("usage_reservation_id"),
	CONSTRAINT "np_agent_provider_calls_state_check" CHECK ("np_agent_provider_calls"."state" in ('reserved','in_flight','succeeded','failed','ambiguous','cancelled')),
	CONSTRAINT "np_agent_provider_calls_dispatch_check" CHECK (("np_agent_provider_calls"."dispatch_state" in ('not-dispatched','dispatched','unknown') and (("np_agent_provider_calls"."state"='reserved' and "np_agent_provider_calls"."dispatch_state"='not-dispatched') or ("np_agent_provider_calls"."state" in ('in_flight','ambiguous') and "np_agent_provider_calls"."dispatch_state"='unknown') or ("np_agent_provider_calls"."state"='succeeded' and "np_agent_provider_calls"."dispatch_state"='dispatched') or ("np_agent_provider_calls"."state" in ('failed','cancelled') and "np_agent_provider_calls"."dispatch_state" in ('not-dispatched','dispatched')))) is true),
	CONSTRAINT "np_agent_provider_calls_versions_check" CHECK ("np_agent_provider_calls"."sequence">0 and "np_agent_provider_calls"."credential_version">0 and "np_agent_provider_calls"."connection_config_version">0 and "np_agent_provider_calls"."recipe_version">0 and "np_agent_provider_calls"."instruction_template_version">0 and "np_agent_provider_calls"."pricing_version">0 and ("np_agent_provider_calls"."retry_of_id" is null or "np_agent_provider_calls"."retry_of_id"<>"np_agent_provider_calls"."id")),
	CONSTRAINT "np_agent_provider_calls_identity_check" CHECK (char_length("np_agent_provider_calls"."provider") between 1 and 128 and char_length("np_agent_provider_calls"."model") between 1 and 128 and char_length("np_agent_provider_calls"."recipe_id") between 1 and 128 and char_length("np_agent_provider_calls"."instruction_template_id") between 1 and 128 and char_length("np_agent_provider_calls"."pricing_id") between 1 and 128 and "np_agent_provider_calls"."idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' and ("np_agent_provider_calls"."provider_request_id" is null or "np_agent_provider_calls"."provider_request_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$')),
	CONSTRAINT "np_agent_provider_calls_hash_check" CHECK ("np_agent_provider_calls"."connection_config_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_provider_calls"."recipe_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_provider_calls"."instruction_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_provider_calls"."response_schema_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_provider_calls"."request_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_provider_calls"."classification_manifest_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_provider_calls"."pricing_fingerprint" ~ '^pr1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_provider_calls"."response_digest" is null or "np_agent_provider_calls"."response_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')),
	CONSTRAINT "np_agent_provider_calls_data_class_check" CHECK ("np_agent_provider_calls"."provider_data_class_ceiling" in ('public-only','internal-redacted','sensitive-approved') and "np_agent_provider_calls"."request_data_class" in ('public-only','internal-redacted','sensitive-approved') and (case "np_agent_provider_calls"."request_data_class" when 'public-only' then 0 when 'internal-redacted' then 1 else 2 end)<=(case "np_agent_provider_calls"."provider_data_class_ceiling" when 'public-only' then 0 when 'internal-redacted' then 1 else 2 end)),
	CONSTRAINT "np_agent_provider_calls_body_check" CHECK ((jsonb_typeof("np_agent_provider_calls"."classification_manifest")='object' and octet_length("np_agent_provider_calls"."classification_manifest"::text)<=262144 and ("np_agent_provider_calls"."request_redacted" is null or (jsonb_typeof("np_agent_provider_calls"."request_redacted")='object' and octet_length("np_agent_provider_calls"."request_redacted"::text)<=65536)) and ("np_agent_provider_calls"."response_redacted" is null or (jsonb_typeof("np_agent_provider_calls"."response_redacted")='object' and octet_length("np_agent_provider_calls"."response_redacted"::text)<=65536)) and (("np_agent_provider_calls"."request_redacted" is null and "np_agent_provider_calls"."response_redacted" is null) or "np_agent_provider_calls"."diagnostic_expires_at" is not null) and ("np_agent_provider_calls"."decision" is null or octet_length("np_agent_provider_calls"."decision"::text)<=262144)) is true),
	CONSTRAINT "np_agent_provider_calls_usage_bounds_check" CHECK (("np_agent_provider_calls"."input_tokens" is null or "np_agent_provider_calls"."input_tokens">=0) and ("np_agent_provider_calls"."cached_input_tokens" is null or "np_agent_provider_calls"."cached_input_tokens" between 0 and "np_agent_provider_calls"."input_tokens") and ("np_agent_provider_calls"."output_tokens" is null or "np_agent_provider_calls"."output_tokens">=0) and ("np_agent_provider_calls"."cost_micros" is null or "np_agent_provider_calls"."cost_micros" between 0 and 9007199254740991) and ("np_agent_provider_calls"."latency_ms" is null or "np_agent_provider_calls"."latency_ms">=0)),
	CONSTRAINT "np_agent_provider_calls_usage_check" CHECK (((
      "np_agent_provider_calls"."input_tokens" is null and "np_agent_provider_calls"."cached_input_tokens" is null and "np_agent_provider_calls"."output_tokens" is null and "np_agent_provider_calls"."cost_micros" is null and "np_agent_provider_calls"."cost_currency" is null and "np_agent_provider_calls"."finish_reason" is null and (("np_agent_provider_calls"."state"='ambiguous' and "np_agent_provider_calls"."usage_source"='unknown' and "np_agent_provider_calls"."cost_source"='unknown') or ("np_agent_provider_calls"."state"<>'ambiguous' and "np_agent_provider_calls"."usage_source" is null and "np_agent_provider_calls"."cost_source" is null))
    ) or (
      "np_agent_provider_calls"."state" in ('succeeded','failed','cancelled') and "np_agent_provider_calls"."dispatch_state"='dispatched' and "np_agent_provider_calls"."input_tokens" is not null and "np_agent_provider_calls"."cached_input_tokens" is not null and "np_agent_provider_calls"."output_tokens" is not null and "np_agent_provider_calls"."cost_micros" is not null and "np_agent_provider_calls"."cost_currency"='USD' and "np_agent_provider_calls"."usage_source" in ('provider','adapter-estimate') and "np_agent_provider_calls"."cost_source" in ('provider','adapter-estimate') and ("np_agent_provider_calls"."finish_reason" in ('stop','length','tool','content-filter','cancelled') or ("np_agent_provider_calls"."state" in ('failed','cancelled') and "np_agent_provider_calls"."finish_reason" is null))
    )) is true),
	CONSTRAINT "np_agent_provider_calls_outcome_check" CHECK ((((
      "np_agent_provider_calls"."state" in ('reserved','in_flight') and "np_agent_provider_calls"."response_digest" is null and "np_agent_provider_calls"."decision" is null and "np_agent_provider_calls"."error_class" is null and "np_agent_provider_calls"."retryable"=false and "np_agent_provider_calls"."latency_ms" is null and "np_agent_provider_calls"."input_tokens" is null
    ) or (
      "np_agent_provider_calls"."state"='succeeded' and "np_agent_provider_calls"."response_digest" is not null and "np_agent_provider_calls"."decision" is not null and "np_agent_provider_calls"."error_class" is null and "np_agent_provider_calls"."retryable"=false and "np_agent_provider_calls"."input_tokens" is not null and "np_agent_provider_calls"."latency_ms" is not null and "np_agent_provider_calls"."finish_reason" in ('stop','length','tool')
    ) or (
      "np_agent_provider_calls"."state" in ('failed','cancelled') and "np_agent_provider_calls"."response_digest" is not null and "np_agent_provider_calls"."decision" is null and "np_agent_provider_calls"."error_class" in ('authentication','rate-limited','transient','timeout','invalid-request','invalid-output','content-policy','cancelled','unknown') and "np_agent_provider_calls"."latency_ms" is not null and ("np_agent_provider_calls"."finish_reason" is null or "np_agent_provider_calls"."finish_reason" in ('content-filter','cancelled'))
    ) or (
      "np_agent_provider_calls"."state"='ambiguous' and "np_agent_provider_calls"."response_digest" is not null and "np_agent_provider_calls"."decision" is null and "np_agent_provider_calls"."error_class" in ('timeout','unknown') and "np_agent_provider_calls"."retryable"=false and "np_agent_provider_calls"."latency_ms" is not null
    )) and ("np_agent_provider_calls"."dispatch_state"<>'not-dispatched' or "np_agent_provider_calls"."provider_request_id" is null)) is true),
	CONSTRAINT "np_agent_provider_calls_time_check" CHECK ((((
      "np_agent_provider_calls"."state"='reserved' and "np_agent_provider_calls"."started_at" is null and "np_agent_provider_calls"."finished_at" is null
    ) or (
      "np_agent_provider_calls"."state"='in_flight' and "np_agent_provider_calls"."started_at">="np_agent_provider_calls"."created_at" and "np_agent_provider_calls"."finished_at" is null
    ) or (
      "np_agent_provider_calls"."state" in ('succeeded','failed','ambiguous','cancelled') and "np_agent_provider_calls"."finished_at">="np_agent_provider_calls"."created_at" and ("np_agent_provider_calls"."started_at" is null or "np_agent_provider_calls"."finished_at">="np_agent_provider_calls"."started_at") and ("np_agent_provider_calls"."dispatch_state"='not-dispatched' or "np_agent_provider_calls"."started_at">="np_agent_provider_calls"."created_at")
    )) and ("np_agent_provider_calls"."diagnostic_expires_at" is null or "np_agent_provider_calls"."diagnostic_expires_at">"np_agent_provider_calls"."created_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event_type" text,
	"cron" text,
	"catch_up" text,
	"next_run_at" timestamp with time zone,
	"last_enqueued_at" timestamp with time zone,
	"filter" jsonb NOT NULL,
	"filter_hash" text NOT NULL,
	"coalesce_seconds" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_triggers_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_triggers_version_binding_unique" UNIQUE("site_id","agent_id","agent_version_id","id"),
	CONSTRAINT "np_agent_triggers_kind_check" CHECK ("np_agent_triggers"."kind" in ('event','schedule','manual')),
	CONSTRAINT "np_agent_triggers_event_check" CHECK ("np_agent_triggers"."event_type" is null or "np_agent_triggers"."event_type" in ('agent.action.changed','agent.policy.blocked','agent.run.changed','auth.login.failed','auth.login.succeeded','auth.session.revoked','authz.denied','authz.role.changed','community.content.created','community.content.moderated','community.content.reported','content.document.changed','content.document.published','jobs.backlog.threshold','jobs.handler.failed','jobs.worker.stale','ops.backup.failed','ops.backup.stale','ops.check.changed','security.edge.signal','security.error.signal')),
	CONSTRAINT "np_agent_triggers_shape_check" CHECK ((("np_agent_triggers"."kind"='event' and "np_agent_triggers"."event_type" is not null and "np_agent_triggers"."cron" is null and "np_agent_triggers"."catch_up" is null and "np_agent_triggers"."next_run_at" is null and "np_agent_triggers"."last_enqueued_at" is null) or ("np_agent_triggers"."kind"='schedule' and "np_agent_triggers"."event_type" is null and "np_agent_triggers"."cron" ~ '^[^[:space:]]+ [^[:space:]]+ [^[:space:]]+ [^[:space:]]+ [^[:space:]]+$' and char_length("np_agent_triggers"."cron")<=128 and "np_agent_triggers"."catch_up" in ('skip','once') and ("np_agent_triggers"."enabled"=false or "np_agent_triggers"."next_run_at" is not null)) or ("np_agent_triggers"."kind"='manual' and "np_agent_triggers"."event_type" is null and "np_agent_triggers"."cron" is null and "np_agent_triggers"."catch_up" is null and "np_agent_triggers"."next_run_at" is null and "np_agent_triggers"."last_enqueued_at" is null)) is true),
	CONSTRAINT "np_agent_triggers_filter_check" CHECK ((jsonb_typeof("np_agent_triggers"."filter")='object' and octet_length("np_agent_triggers"."filter"::text)<=16384 and "np_agent_triggers"."filter_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_triggers"."coalesce_seconds" between 0 and 86400) is true),
	CONSTRAINT "np_agent_triggers_time_check" CHECK ("np_agent_triggers"."updated_at">="np_agent_triggers"."created_at")
);
--> statement-breakpoint
CREATE TABLE "np_agent_usage_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"provider_calls" integer DEFAULT 0 NOT NULL,
	"reported_input_tokens" integer DEFAULT 0 NOT NULL,
	"reported_cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reported_output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_input_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_output_tokens" integer DEFAULT 0 NOT NULL,
	"reported_cost_micros" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"budget_charge_cost_micros" bigint DEFAULT 0 NOT NULL,
	"unknown_calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "np_agent_usage_daily_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_usage_daily_bucket_unique" UNIQUE("site_id","agent_id","connection_id","usage_date"),
	CONSTRAINT "np_agent_usage_daily_tokens_check" CHECK ("np_agent_usage_daily"."provider_calls">=0 and "np_agent_usage_daily"."reported_input_tokens">=0 and "np_agent_usage_daily"."reported_cached_input_tokens" between 0 and "np_agent_usage_daily"."reported_input_tokens" and "np_agent_usage_daily"."reported_output_tokens">=0 and "np_agent_usage_daily"."estimated_input_tokens">=0 and "np_agent_usage_daily"."estimated_cached_input_tokens" between 0 and "np_agent_usage_daily"."estimated_input_tokens" and "np_agent_usage_daily"."estimated_output_tokens">=0 and "np_agent_usage_daily"."unknown_calls" between 0 and "np_agent_usage_daily"."provider_calls"),
	CONSTRAINT "np_agent_usage_daily_cost_check" CHECK ("np_agent_usage_daily"."reported_cost_micros" between 0 and 9007199254740991 and "np_agent_usage_daily"."estimated_cost_micros" between 0 and 9007199254740991 and "np_agent_usage_daily"."budget_charge_cost_micros" between 0 and 9007199254740991 and "np_agent_usage_daily"."budget_charge_cost_micros">="np_agent_usage_daily"."reported_cost_micros"+"np_agent_usage_daily"."estimated_cost_micros")
);
--> statement-breakpoint
CREATE TABLE "np_agent_usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_config_snapshot_id" uuid NOT NULL,
	"model" text NOT NULL,
	"pricing_id" text NOT NULL,
	"pricing_version" integer NOT NULL,
	"pricing_fingerprint" text NOT NULL,
	"pricing_effective_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text NOT NULL,
	"reserved_calls" integer NOT NULL,
	"reserved_input_tokens" integer NOT NULL,
	"reserved_output_tokens" integer NOT NULL,
	"reserved_cost_micros" bigint NOT NULL,
	"actual_input_tokens" integer,
	"actual_cached_input_tokens" integer,
	"actual_output_tokens" integer,
	"actual_cost_micros" bigint,
	"actual_usage_source" text,
	"actual_cost_source" text,
	"unpriced" boolean DEFAULT false NOT NULL,
	"budget_charge_cost_micros" bigint,
	"reserved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "np_agent_usage_reservations_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_usage_reservations_call_binding_unique" UNIQUE("site_id","run_id","connection_id","id"),
	CONSTRAINT "np_agent_usage_reservations_idempotency_unique" UNIQUE("site_id","run_id","connection_id","idempotency_key"),
	CONSTRAINT "np_agent_usage_reservations_state_check" CHECK ("np_agent_usage_reservations"."state" in ('reserved','reconciled','released','expired')),
	CONSTRAINT "np_agent_usage_reservations_bounds_check" CHECK ("np_agent_usage_reservations"."reserved_calls" between 1 and 2147483647 and "np_agent_usage_reservations"."reserved_input_tokens">=0 and "np_agent_usage_reservations"."reserved_output_tokens">=0 and "np_agent_usage_reservations"."reserved_cost_micros" between 0 and 9007199254740991 and ("np_agent_usage_reservations"."actual_input_tokens" is null or "np_agent_usage_reservations"."actual_input_tokens">=0) and ("np_agent_usage_reservations"."actual_cached_input_tokens" is null or "np_agent_usage_reservations"."actual_cached_input_tokens" between 0 and "np_agent_usage_reservations"."actual_input_tokens") and ("np_agent_usage_reservations"."actual_output_tokens" is null or "np_agent_usage_reservations"."actual_output_tokens">=0) and ("np_agent_usage_reservations"."actual_cost_micros" is null or "np_agent_usage_reservations"."actual_cost_micros" between 0 and 9007199254740991) and ("np_agent_usage_reservations"."budget_charge_cost_micros" is null or "np_agent_usage_reservations"."budget_charge_cost_micros" between 0 and 9007199254740991)),
	CONSTRAINT "np_agent_usage_reservations_pricing_check" CHECK ("np_agent_usage_reservations"."pricing_version">0 and "np_agent_usage_reservations"."pricing_fingerprint" ~ '^pr1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_usage_reservations"."pricing_effective_at"<="np_agent_usage_reservations"."reserved_at" and char_length("np_agent_usage_reservations"."model") between 1 and 128 and char_length("np_agent_usage_reservations"."pricing_id") between 1 and 128 and "np_agent_usage_reservations"."idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'),
	CONSTRAINT "np_agent_usage_reservations_usage_check" CHECK (((
      "np_agent_usage_reservations"."state" in ('reserved','released') and "np_agent_usage_reservations"."actual_input_tokens" is null and "np_agent_usage_reservations"."actual_cached_input_tokens" is null and "np_agent_usage_reservations"."actual_output_tokens" is null and "np_agent_usage_reservations"."actual_cost_micros" is null and "np_agent_usage_reservations"."actual_usage_source" is null and "np_agent_usage_reservations"."actual_cost_source" is null and "np_agent_usage_reservations"."unpriced"=false and (("np_agent_usage_reservations"."state"='reserved' and "np_agent_usage_reservations"."budget_charge_cost_micros" is null) or ("np_agent_usage_reservations"."state"='released' and "np_agent_usage_reservations"."budget_charge_cost_micros"=0))
    ) or (
      "np_agent_usage_reservations"."state"='reconciled' and "np_agent_usage_reservations"."actual_input_tokens" is not null and "np_agent_usage_reservations"."actual_cached_input_tokens" is not null and "np_agent_usage_reservations"."actual_output_tokens" is not null and "np_agent_usage_reservations"."actual_cost_micros" is not null and "np_agent_usage_reservations"."actual_usage_source" in ('provider','adapter-estimate') and "np_agent_usage_reservations"."actual_cost_source" in ('provider','adapter-estimate') and "np_agent_usage_reservations"."unpriced"=false and "np_agent_usage_reservations"."budget_charge_cost_micros"="np_agent_usage_reservations"."actual_cost_micros"
    ) or (
      "np_agent_usage_reservations"."state"='expired' and "np_agent_usage_reservations"."actual_input_tokens" is null and "np_agent_usage_reservations"."actual_cached_input_tokens" is null and "np_agent_usage_reservations"."actual_output_tokens" is null and "np_agent_usage_reservations"."actual_cost_micros" is null and "np_agent_usage_reservations"."actual_usage_source"='unknown' and "np_agent_usage_reservations"."actual_cost_source"='unknown' and "np_agent_usage_reservations"."unpriced"=true and "np_agent_usage_reservations"."budget_charge_cost_micros"="np_agent_usage_reservations"."reserved_cost_micros"
    )) is true),
	CONSTRAINT "np_agent_usage_reservations_time_check" CHECK (("np_agent_usage_reservations"."expires_at">"np_agent_usage_reservations"."reserved_at" and (("np_agent_usage_reservations"."state"='reserved' and "np_agent_usage_reservations"."finalized_at" is null) or ("np_agent_usage_reservations"."state"<>'reserved' and "np_agent_usage_reservations"."finalized_at">="np_agent_usage_reservations"."reserved_at")) and ("np_agent_usage_reservations"."state"<>'expired' or "np_agent_usage_reservations"."finalized_at">="np_agent_usage_reservations"."expires_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"model_connection_id" uuid,
	"model" text,
	"scopes" text[] NOT NULL,
	"autonomy" text NOT NULL,
	"capability_modes" jsonb NOT NULL,
	"policy_mode" text NOT NULL,
	"budget" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"recipe_registry_body" jsonb NOT NULL,
	"recipe_registry_fingerprint" text NOT NULL,
	"config_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "np_agent_versions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_versions_agent_id_unique" UNIQUE("site_id","agent_id","id"),
	CONSTRAINT "np_agent_versions_config_unique" UNIQUE("site_id","agent_id","id","config_hash"),
	CONSTRAINT "np_agent_versions_number_unique" UNIQUE("site_id","agent_id","version"),
	CONSTRAINT "np_agent_versions_status_check" CHECK ("np_agent_versions"."status" in ('draft','active','retired')),
	CONSTRAINT "np_agent_versions_number_check" CHECK ("np_agent_versions"."version">0 and "np_agent_versions"."row_version">0),
	CONSTRAINT "np_agent_versions_modes_check" CHECK ("np_agent_versions"."autonomy" in ('observe','advise','guarded','approved') and "np_agent_versions"."policy_mode" in ('site','site_and_agent')),
	CONSTRAINT "np_agent_versions_model_check" CHECK ((("np_agent_versions"."model_connection_id" is null and "np_agent_versions"."model" is null) or ("np_agent_versions"."model_connection_id" is not null and char_length("np_agent_versions"."model") between 1 and 128)) is true),
	CONSTRAINT "np_agent_versions_scopes_check" CHECK (cardinality("np_agent_versions"."scopes") between 0 and 64 and array_position("np_agent_versions"."scopes",null) is null and ("np_agent_versions"."status"='draft' or "np_agent_versions"."scopes" @> array['site:read']::text[])),
	CONSTRAINT "np_agent_versions_contract_check" CHECK ((jsonb_typeof("np_agent_versions"."capability_modes")='array' and jsonb_array_length("np_agent_versions"."capability_modes")<=21 and jsonb_typeof("np_agent_versions"."settings")='array' and jsonb_array_length("np_agent_versions"."settings") between 1 and 8 and "np_agent_versions"."budget"->>'schemaVersion'='np.agent-budget.v1' and "np_agent_versions"."budget"->>'costCurrency'='USD' and "np_agent_versions"."recipe_registry_body"->>'schemaVersion'='np.agent-recipe-registry.v1' and "np_agent_versions"."recipe_registry_body"->>'projection'='registry' and jsonb_array_length("np_agent_versions"."recipe_registry_body"->'recipes') between 1 and 8 and octet_length("np_agent_versions"."recipe_registry_body"::text)<=8388608 and octet_length("np_agent_versions"."settings"::text)<=262144) is true),
	CONSTRAINT "np_agent_versions_hash_check" CHECK ("np_agent_versions"."config_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_versions"."recipe_registry_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "np_agent_versions_time_check" CHECK ((("np_agent_versions"."status"='draft' and "np_agent_versions"."activated_at" is null and "np_agent_versions"."retired_at" is null) or ("np_agent_versions"."status"='active' and "np_agent_versions"."activated_at">="np_agent_versions"."created_at" and "np_agent_versions"."retired_at" is null) or ("np_agent_versions"."status"='retired' and "np_agent_versions"."activated_at">="np_agent_versions"."created_at" and "np_agent_versions"."retired_at">="np_agent_versions"."activated_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"status" text NOT NULL,
	"active_version_id" uuid,
	"draft_version_id" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agents_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agents_principal_unique" UNIQUE("principal_id"),
	CONSTRAINT "np_agents_principal_binding_unique" UNIQUE("site_id","id","principal_id"),
	CONSTRAINT "np_agents_status_check" CHECK ("np_agents"."status" in ('draft','active','paused','error','archived')),
	CONSTRAINT "np_agents_template_check" CHECK ("np_agents"."template" in ('publisher','moderator','operator','guardian','custom')),
	CONSTRAINT "np_agents_version_check" CHECK ("np_agents"."row_version" > 0),
	CONSTRAINT "np_agents_name_check" CHECK (char_length("np_agents"."name") between 1 and 120 and "np_agents"."name"=btrim("np_agents"."name")),
	CONSTRAINT "np_agents_lifecycle_check" CHECK ((("np_agents"."status"='draft' and "np_agents"."active_version_id" is null) or ("np_agents"."status" in ('active','paused','error') and "np_agents"."active_version_id" is not null) or "np_agents"."status"='archived') and ("np_agents"."active_version_id" is null or "np_agents"."draft_version_id" is null or "np_agents"."active_version_id"<>"np_agents"."draft_version_id") and ("np_agents"."status"<>'archived' or "np_agents"."draft_version_id" is null)),
	CONSTRAINT "np_agents_time_check" CHECK ("np_agents"."updated_at" >= "np_agents"."created_at")
);
--> statement-breakpoint
ALTER TABLE "np_agent_principals" DROP CONSTRAINT "np_agent_principals_scopes_check";--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD COLUMN "runtime_admission_sources" jsonb;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_run_binding_unique" UNIQUE("site_id","run_id","id");--> statement-breakpoint
ALTER TABLE "np_agent_connection_config_versions" ADD CONSTRAINT "np_agent_connection_config_versions_binding_unique" UNIQUE("site_id","connection_id","id","version","config_hash");--> statement-breakpoint
ALTER TABLE "np_agent_connection_secret_versions" ADD CONSTRAINT "np_agent_connection_secret_versions_binding_unique" UNIQUE("site_id","connection_id","id","version");--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_agent_binding_unique" UNIQUE("site_id","agent_id","id");--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_causation_unique" UNIQUE("site_id","id","root_run_id","causal_depth");--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_connection_binding_unique" UNIQUE("site_id","id","connection_id","connection_config_snapshot_id");--> statement-breakpoint
ALTER TABLE "np_agent_circuit_breakers" ADD CONSTRAINT "np_agent_circuit_breakers_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_events" ADD CONSTRAINT "np_agent_events_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_events" ADD CONSTRAINT "np_agent_events_causal_run_fk" FOREIGN KEY ("site_id","causal_run_id","causal_root_run_id","causal_depth") REFERENCES "public"."np_agent_runs"("site_id","id","root_run_id","causal_depth") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_events" ADD CONSTRAINT "np_agent_events_causal_action_fk" FOREIGN KEY ("site_id","causal_run_id","causal_action_id") REFERENCES "public"."np_agent_actions"("site_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_policies" ADD CONSTRAINT "np_agent_policies_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_policies" ADD CONSTRAINT "np_agent_policies_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_policies" ADD CONSTRAINT "np_agent_policies_agent_fk" FOREIGN KEY ("site_id","agent_id") REFERENCES "public"."np_agents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_provider_calls" ADD CONSTRAINT "np_agent_provider_calls_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_provider_calls" ADD CONSTRAINT "np_agent_provider_calls_run_fk" FOREIGN KEY ("site_id","run_id","connection_id","connection_config_snapshot_id") REFERENCES "public"."np_agent_runs"("site_id","id","connection_id","connection_config_snapshot_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_provider_calls" ADD CONSTRAINT "np_agent_provider_calls_retry_fk" FOREIGN KEY ("site_id","run_id","retry_of_id") REFERENCES "public"."np_agent_provider_calls"("site_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_provider_calls" ADD CONSTRAINT "np_agent_provider_calls_config_fk" FOREIGN KEY ("site_id","connection_id","connection_config_snapshot_id","connection_config_version","connection_config_hash") REFERENCES "public"."np_agent_connection_config_versions"("site_id","connection_id","id","version","config_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_provider_calls" ADD CONSTRAINT "np_agent_provider_calls_secret_fk" FOREIGN KEY ("site_id","connection_id","secret_version_id","credential_version") REFERENCES "public"."np_agent_connection_secret_versions"("site_id","connection_id","id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_provider_calls" ADD CONSTRAINT "np_agent_provider_calls_reservation_fk" FOREIGN KEY ("site_id","run_id","connection_id","usage_reservation_id") REFERENCES "public"."np_agent_usage_reservations"("site_id","run_id","connection_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_triggers" ADD CONSTRAINT "np_agent_triggers_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_triggers" ADD CONSTRAINT "np_agent_triggers_version_fk" FOREIGN KEY ("site_id","agent_id","agent_version_id") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_usage_daily" ADD CONSTRAINT "np_agent_usage_daily_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_usage_daily" ADD CONSTRAINT "np_agent_usage_daily_agent_fk" FOREIGN KEY ("site_id","agent_id") REFERENCES "public"."np_agents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_usage_daily" ADD CONSTRAINT "np_agent_usage_daily_connection_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_usage_reservations" ADD CONSTRAINT "np_agent_usage_reservations_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_usage_reservations" ADD CONSTRAINT "np_agent_usage_reservations_run_fk" FOREIGN KEY ("site_id","agent_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","agent_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_usage_reservations" ADD CONSTRAINT "np_agent_usage_reservations_connection_fk" FOREIGN KEY ("site_id","run_id","connection_id","connection_config_snapshot_id") REFERENCES "public"."np_agent_runs"("site_id","id","connection_id","connection_config_snapshot_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_versions" ADD CONSTRAINT "np_agent_versions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_versions" ADD CONSTRAINT "np_agent_versions_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_versions" ADD CONSTRAINT "np_agent_versions_agent_fk" FOREIGN KEY ("site_id","agent_id") REFERENCES "public"."np_agents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_versions" ADD CONSTRAINT "np_agent_versions_connection_fk" FOREIGN KEY ("site_id","model_connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_created_by_np_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_circuit_breakers_state_idx" ON "np_agent_circuit_breakers" USING btree ("site_id","state","retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_events_deduplication_uidx" ON "np_agent_events" USING btree ("site_id","source_kind","source_component","kind","deduplication_key") WHERE "np_agent_events"."deduplication_key" is not null;--> statement-breakpoint
CREATE INDEX "np_agent_events_recorded_idx" ON "np_agent_events" USING btree ("site_id","recorded_at");--> statement-breakpoint
CREATE INDEX "np_agent_events_kind_idx" ON "np_agent_events" USING btree ("site_id","kind","recorded_at");--> statement-breakpoint
CREATE INDEX "np_agent_events_undispatched_idx" ON "np_agent_events" USING btree ("site_id","recorded_at") WHERE "np_agent_events"."dispatched_at" is null;--> statement-breakpoint
CREATE INDEX "np_agent_events_expiry_idx" ON "np_agent_events" USING btree ("site_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_policies_site_number_uidx" ON "np_agent_policies" USING btree ("site_id","version") WHERE "np_agent_policies"."agent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_policies_agent_number_uidx" ON "np_agent_policies" USING btree ("site_id","agent_id","version") WHERE "np_agent_policies"."agent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_policies_site_active_uidx" ON "np_agent_policies" USING btree ("site_id") WHERE "np_agent_policies"."agent_id" is null and "np_agent_policies"."status"='active';--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_policies_agent_active_uidx" ON "np_agent_policies" USING btree ("site_id","agent_id") WHERE "np_agent_policies"."agent_id" is not null and "np_agent_policies"."status"='active';--> statement-breakpoint
CREATE INDEX "np_agent_policies_site_status_idx" ON "np_agent_policies" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_provider_calls_state_idx" ON "np_agent_provider_calls" USING btree ("site_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_triggers_logical_uidx" ON "np_agent_triggers" USING btree ("site_id","agent_id","agent_version_id","kind",coalesce("event_type","cron",''),"filter_hash");--> statement-breakpoint
CREATE INDEX "np_agent_triggers_due_idx" ON "np_agent_triggers" USING btree ("site_id","next_run_at") WHERE "np_agent_triggers"."enabled"=true and "np_agent_triggers"."kind"='schedule';--> statement-breakpoint
CREATE INDEX "np_agent_usage_daily_budget_idx" ON "np_agent_usage_daily" USING btree ("site_id","usage_date","agent_id");--> statement-breakpoint
CREATE INDEX "np_agent_usage_reservations_expiry_idx" ON "np_agent_usage_reservations" USING btree ("site_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_usage_reservations_budget_idx" ON "np_agent_usage_reservations" USING btree ("site_id","agent_id","reserved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_versions_active_uidx" ON "np_agent_versions" USING btree ("site_id","agent_id") WHERE "np_agent_versions"."status"='active';--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_versions_draft_uidx" ON "np_agent_versions" USING btree ("site_id","agent_id") WHERE "np_agent_versions"."status"='draft';--> statement-breakpoint
CREATE INDEX "np_agents_site_status_idx" ON "np_agents" USING btree ("site_id","status","created_at");--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_agent_fk" FOREIGN KEY ("site_id","agent_id","principal_id") REFERENCES "public"."np_agents"("site_id","id","principal_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_version_fk" FOREIGN KEY ("site_id","agent_id","agent_version_id","agent_config_hash") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id","config_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_trigger_fk" FOREIGN KEY ("site_id","agent_id","agent_version_id","trigger_id") REFERENCES "public"."np_agent_triggers"("site_id","agent_id","agent_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_connection_config_fk" FOREIGN KEY ("site_id","connection_id","connection_config_snapshot_id","connection_config_version","connection_config_hash") REFERENCES "public"."np_agent_connection_config_versions"("site_id","connection_id","id","version","config_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_runs_agent_idx" ON "np_agent_runs" USING btree ("site_id","agent_id","queued_at");--> statement-breakpoint
ALTER TABLE "np_agent_principals" ADD CONSTRAINT "np_agent_principals_scopes_check" CHECK (cardinality("np_agent_principals"."scopes") between (case when "np_agent_principals"."kind" = 'runtime' and "np_agent_principals"."status" <> 'active' then 0 else 1 end) and 64 and array_position("np_agent_principals"."scopes", null) is null);--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_runtime_admission_sources_check" CHECK ((("np_agent_runs"."origin"='gateway' and "np_agent_runs"."runtime_admission_sources" is null) or ("np_agent_runs"."origin"='runtime' and "np_agent_runs"."runtime_admission_sources"->>'schemaVersion'='np.agent-runtime-admission-sources.v1' and "np_agent_runs"."runtime_admission_sources"->'frameworkPolicy'->>'schemaVersion'='np.agent-policy.v1' and "np_agent_runs"."runtime_admission_sources"->'frameworkPolicy'->>'instructions'='' and "np_agent_runs"."runtime_admission_sources"->'frameworkPolicy'->'rules'->>'schemaVersion'='np.agent-policy-rules.v1' and "np_agent_runs"."runtime_admission_sources"->>'frameworkPolicyVersion' ~ '^[1-9][0-9]{0,9}$' and ("np_agent_runs"."runtime_admission_sources"->>'frameworkPolicyVersion')::numeric<=2147483647 and "np_agent_runs"."runtime_admission_sources"->'sitePolicy'->>'schemaVersion'='np.agent-policy.v1' and "np_agent_runs"."runtime_admission_sources"->'sitePolicy'->>'instructions'='' and "np_agent_runs"."runtime_admission_sources"->'sitePolicy'->'rules'->>'schemaVersion'='np.agent-policy-rules.v1' and "np_agent_runs"."runtime_admission_sources"->'deploymentBudget'->>'schemaVersion'='np.agent-budget.v1' and "np_agent_runs"."runtime_admission_sources"->'siteBudget'->>'schemaVersion'='np.agent-budget.v1' and octet_length("np_agent_runs"."runtime_admission_sources"::text)<=1048576)) is true);--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_runtime_shape_check" CHECK (("np_agent_runs"."origin"<>'runtime' or ("np_agent_runs"."agent_id" is not null and "np_agent_runs"."agent_version_id" is not null and "np_agent_runs"."agent_config_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_runs"."recipe_id" is not null and "np_agent_runs"."recipe_version">0 and "np_agent_runs"."recipe_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_runs"."response_schema_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_runs"."manual_input_schema_digest" is null or "np_agent_runs"."manual_input_schema_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$'))) is true);--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_provider_shape_check" CHECK (((
      "np_agent_runs"."connection_id" is null and "np_agent_runs"."connection_config_snapshot_id" is null and "np_agent_runs"."connection_config_version" is null and "np_agent_runs"."connection_config_hash" is null and "np_agent_runs"."provider_data_class_ceiling" is null and "np_agent_runs"."pricing_id" is null and "np_agent_runs"."pricing_version" is null and "np_agent_runs"."pricing_fingerprint" is null and "np_agent_runs"."pricing_effective_at" is null and "np_agent_runs"."provider_request_id" is null
    ) or (
      "np_agent_runs"."origin"='runtime' and "np_agent_runs"."connection_id" is not null and "np_agent_runs"."connection_config_snapshot_id" is not null and "np_agent_runs"."connection_config_version">0 and "np_agent_runs"."connection_config_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_runs"."provider_data_class_ceiling" in ('public-only','internal-redacted','sensitive-approved') and char_length("np_agent_runs"."pricing_id") between 1 and 128 and "np_agent_runs"."pricing_version">0 and "np_agent_runs"."pricing_fingerprint" ~ '^pr1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_runs"."pricing_effective_at" is not null
    )) is true);--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_instruction_check" CHECK ((( "np_agent_runs"."instruction_template_id" is null and "np_agent_runs"."instruction_template_version" is null and "np_agent_runs"."instruction_digest" is null ) or ( "np_agent_runs"."origin"='runtime' and char_length("np_agent_runs"."instruction_template_id") between 1 and 128 and "np_agent_runs"."instruction_template_version">0 and "np_agent_runs"."instruction_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' )) is true);--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_runtime_time_check" CHECK ("np_agent_runs"."origin"<>'runtime' or ("np_agent_runs"."deadline_at"<="np_agent_runs"."queued_at"+interval '86400 seconds' and ("np_agent_runs"."started_at" is null or "np_agent_runs"."started_at">="np_agent_runs"."queued_at") and ("np_agent_runs"."lease_until" is null or ("np_agent_runs"."started_at" is not null and "np_agent_runs"."lease_until"<="np_agent_runs"."deadline_at")) and ("np_agent_runs"."finished_at" is null or "np_agent_runs"."finished_at">="np_agent_runs"."queued_at")));