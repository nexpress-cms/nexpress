CREATE TABLE "np_agent_changeset_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"changeset_id" uuid NOT NULL,
	"purpose" text DEFAULT 'apply' NOT NULL,
	"plan_hash" text NOT NULL,
	"approval_id" uuid NOT NULL,
	"invocation_id" uuid,
	"invocation_fingerprint" text NOT NULL,
	"verification_contract_fingerprint" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"state" text DEFAULT 'reserved' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"result_digest" text,
	"result_body" jsonb,
	"error_code" text,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verification_state" text,
	"verification_body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_digest" text,
	"verification_completed_at" timestamp with time zone,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "np_agent_changeset_executions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_changeset_executions_plan_unique" UNIQUE("site_id","changeset_id","purpose","plan_hash"),
	CONSTRAINT "np_agent_changeset_executions_approval_unique" UNIQUE("site_id","approval_id"),
	CONSTRAINT "np_agent_changeset_executions_invocation_unique" UNIQUE("site_id","invocation_id"),
	CONSTRAINT "np_agent_changeset_executions_idempotency_unique" UNIQUE("site_id","changeset_id","idempotency_key"),
	CONSTRAINT "np_agent_changeset_executions_state_check" CHECK (("np_agent_changeset_executions"."purpose"='apply' and "np_agent_changeset_executions"."state" in ('reserved','committed','verifying','succeeded','failed','ambiguous') and "np_agent_changeset_executions"."version">0 and "np_agent_changeset_executions"."attempts">=0) is true),
	CONSTRAINT "np_agent_changeset_executions_hash_check" CHECK (("np_agent_changeset_executions"."verification_contract_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_executions"."plan_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_executions"."invocation_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_changeset_executions"."result_digest" is null or "np_agent_changeset_executions"."result_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') and ("np_agent_changeset_executions"."verification_digest" is null or "np_agent_changeset_executions"."verification_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') and char_length("np_agent_changeset_executions"."idempotency_key") between 1 and 128 and ("np_agent_changeset_executions"."error_code" is null or "np_agent_changeset_executions"."error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')) is true),
	CONSTRAINT "np_agent_changeset_executions_lease_check" CHECK ((("np_agent_changeset_executions"."lease_owner" is null and "np_agent_changeset_executions"."lease_token" is null and "np_agent_changeset_executions"."lease_until" is null) or ("np_agent_changeset_executions"."lease_owner" is not null and char_length("np_agent_changeset_executions"."lease_owner") between 1 and 128 and "np_agent_changeset_executions"."lease_token" is not null and "np_agent_changeset_executions"."lease_until">"np_agent_changeset_executions"."reserved_at" and "np_agent_changeset_executions"."attempts">0 and "np_agent_changeset_executions"."state" in ('reserved','committed','verifying'))) is true),
	CONSTRAINT "np_agent_changeset_executions_time_check" CHECK ((("np_agent_changeset_executions"."committed_at" is null or "np_agent_changeset_executions"."committed_at">="np_agent_changeset_executions"."reserved_at") and ("np_agent_changeset_executions"."finished_at" is null or ("np_agent_changeset_executions"."finished_at">="np_agent_changeset_executions"."reserved_at" and ("np_agent_changeset_executions"."committed_at" is null or "np_agent_changeset_executions"."finished_at">="np_agent_changeset_executions"."committed_at"))) and ("np_agent_changeset_executions"."verification_completed_at" is null or ("np_agent_changeset_executions"."committed_at" is not null and "np_agent_changeset_executions"."verification_completed_at">="np_agent_changeset_executions"."committed_at"))) is true),
	CONSTRAINT "np_agent_changeset_executions_terminal_check" CHECK (((("np_agent_changeset_executions"."committed_at" is null)=("np_agent_changeset_executions"."result_digest" is null)) and ("np_agent_changeset_executions"."state"<>'reserved' or ("np_agent_changeset_executions"."committed_at" is null and "np_agent_changeset_executions"."error_code" is null)) and ("np_agent_changeset_executions"."state" not in ('committed','verifying','succeeded') or ("np_agent_changeset_executions"."committed_at" is not null and "np_agent_changeset_executions"."error_code" is null)) and (("np_agent_changeset_executions"."state" in ('succeeded','failed','ambiguous'))=("np_agent_changeset_executions"."finished_at" is not null)) and ("np_agent_changeset_executions"."state" not in ('failed','ambiguous') or "np_agent_changeset_executions"."error_code" is not null) and ("np_agent_changeset_executions"."state"<>'succeeded' or "np_agent_changeset_executions"."verification_state"='passed')) is true),
	CONSTRAINT "np_agent_changeset_executions_verification_check" CHECK ((jsonb_typeof("np_agent_changeset_executions"."verification_body")='array' and jsonb_array_length("np_agent_changeset_executions"."verification_body")<=1000 and octet_length("np_agent_changeset_executions"."verification_body"::text)<=1048576 and (( "np_agent_changeset_executions"."verification_state" is null and "np_agent_changeset_executions"."verification_digest" is null and "np_agent_changeset_executions"."verification_completed_at" is null and jsonb_array_length("np_agent_changeset_executions"."verification_body")=0) or ("np_agent_changeset_executions"."committed_at" is not null and "np_agent_changeset_executions"."verification_state" in ('queued','running') and "np_agent_changeset_executions"."verification_digest" is null and "np_agent_changeset_executions"."verification_completed_at" is null) or ("np_agent_changeset_executions"."committed_at" is not null and "np_agent_changeset_executions"."verification_state" in ('passed','failed') and "np_agent_changeset_executions"."verification_digest" is not null and "np_agent_changeset_executions"."verification_completed_at" is not null))) is true),
	CONSTRAINT "np_agent_changeset_executions_result_check" CHECK (((("np_agent_changeset_executions"."result_body" is null)=("np_agent_changeset_executions"."committed_at" is null)) and ("np_agent_changeset_executions"."result_body" is null or (jsonb_typeof("np_agent_changeset_executions"."result_body")='object' and jsonb_typeof("np_agent_changeset_executions"."result_body"->'operations')='array' and jsonb_array_length("np_agent_changeset_executions"."result_body"->'operations') between 1 and 500 and octet_length("np_agent_changeset_executions"."result_body"::text)<=33554432))) is true),
	CONSTRAINT "np_agent_changeset_executions_effects_check" CHECK ((jsonb_typeof("np_agent_changeset_executions"."effects")='array' and jsonb_array_length("np_agent_changeset_executions"."effects")<=4096 and octet_length("np_agent_changeset_executions"."effects"::text)<=4194304) is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_changeset_executions" ADD CONSTRAINT "np_agent_changeset_executions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_executions" ADD CONSTRAINT "np_agent_changeset_executions_changeset_fk" FOREIGN KEY ("site_id","changeset_id") REFERENCES "public"."np_agent_changesets"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_executions" ADD CONSTRAINT "np_agent_changeset_executions_approval_fk" FOREIGN KEY ("site_id","approval_id") REFERENCES "public"."np_agent_approvals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_executions" ADD CONSTRAINT "np_agent_changeset_executions_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_changeset_executions_recovery_idx" ON "np_agent_changeset_executions" USING btree ("site_id","state","lease_until","id");