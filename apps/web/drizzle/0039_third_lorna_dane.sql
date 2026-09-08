CREATE TABLE "np_agent_changeset_validation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"changeset_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"draft_version" integer NOT NULL,
	"draft_hash" text NOT NULL,
	"admitting_invocation_id" uuid NOT NULL,
	"authorization_context_body" jsonb NOT NULL,
	"authorization_context_fingerprint" text NOT NULL,
	"authority_ref" jsonb NOT NULL,
	"requester_kind" text NOT NULL,
	"requester_id" uuid NOT NULL,
	"requester_fingerprint" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_summary" jsonb,
	"result_digest" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_changeset_validation_attempts_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_changeset_validation_attempts_generation_unique" UNIQUE("site_id","changeset_id","generation"),
	CONSTRAINT "np_agent_changeset_validation_attempts_invocation_unique" UNIQUE("site_id","admitting_invocation_id"),
	CONSTRAINT "np_agent_changeset_validation_attempts_version_check" CHECK ("np_agent_changeset_validation_attempts"."generation">0 and "np_agent_changeset_validation_attempts"."draft_version">0),
	CONSTRAINT "np_agent_changeset_validation_attempts_state_check" CHECK ("np_agent_changeset_validation_attempts"."state" in ('queued','validating','ready','invalid','failed')),
	CONSTRAINT "np_agent_changeset_validation_attempts_hash_check" CHECK ("np_agent_changeset_validation_attempts"."draft_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_validation_attempts"."authorization_context_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_changeset_validation_attempts"."requester_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_changeset_validation_attempts"."result_digest" is null or "np_agent_changeset_validation_attempts"."result_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')),
	CONSTRAINT "np_agent_changeset_validation_attempts_authority_check" CHECK ((jsonb_typeof("np_agent_changeset_validation_attempts"."authorization_context_body")='object' and "np_agent_changeset_validation_attempts"."authorization_context_body"->>'schemaVersion'='np.agent-authorization-context.v1' and "np_agent_changeset_validation_attempts"."authorization_context_body"->>'siteId'="np_agent_changeset_validation_attempts"."site_id" and "np_agent_changeset_validation_attempts"."authorization_context_body"->'authorityRef'="np_agent_changeset_validation_attempts"."authority_ref" and "np_agent_changeset_validation_attempts"."authorization_context_body"->'actor'->>'kind'="np_agent_changeset_validation_attempts"."requester_kind" and "np_agent_changeset_validation_attempts"."authorization_context_body"->'actor'->>'actorFingerprint'="np_agent_changeset_validation_attempts"."requester_fingerprint" and (("np_agent_changeset_validation_attempts"."requester_kind"='staff' and "np_agent_changeset_validation_attempts"."authorization_context_body"->'actor'->>'userId'="np_agent_changeset_validation_attempts"."requester_id"::text and "np_agent_changeset_validation_attempts"."authority_ref"->>'kind'='staff-session' and "np_agent_changeset_validation_attempts"."authority_ref"->>'userId'="np_agent_changeset_validation_attempts"."requester_id"::text) or ("np_agent_changeset_validation_attempts"."requester_kind"='principal' and "np_agent_changeset_validation_attempts"."authorization_context_body"->'actor'->>'principalId'="np_agent_changeset_validation_attempts"."requester_id"::text and "np_agent_changeset_validation_attempts"."authority_ref"->>'kind' in ('service-family','oauth-grant','runtime-run') and "np_agent_changeset_validation_attempts"."authority_ref"->>'principalId'="np_agent_changeset_validation_attempts"."requester_id"::text))) is true),
	CONSTRAINT "np_agent_changeset_validation_attempts_result_check" CHECK ((jsonb_typeof("np_agent_changeset_validation_attempts"."issues")='array' and jsonb_array_length("np_agent_changeset_validation_attempts"."issues")<=1000 and octet_length("np_agent_changeset_validation_attempts"."issues"::text)<=262144 and ("np_agent_changeset_validation_attempts"."risk_summary" is null or (jsonb_typeof("np_agent_changeset_validation_attempts"."risk_summary")='object' and octet_length("np_agent_changeset_validation_attempts"."risk_summary"::text)<=65536)) and ("np_agent_changeset_validation_attempts"."error_code" is null or "np_agent_changeset_validation_attempts"."error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')) is true),
	CONSTRAINT "np_agent_changeset_validation_attempts_time_check" CHECK ("np_agent_changeset_validation_attempts"."expires_at">="np_agent_changeset_validation_attempts"."created_at"+interval '60 seconds' and "np_agent_changeset_validation_attempts"."expires_at"<="np_agent_changeset_validation_attempts"."created_at"+interval '24 hours' and ("np_agent_changeset_validation_attempts"."started_at" is null or "np_agent_changeset_validation_attempts"."started_at">="np_agent_changeset_validation_attempts"."created_at") and ("np_agent_changeset_validation_attempts"."finished_at" is null or ("np_agent_changeset_validation_attempts"."finished_at">="np_agent_changeset_validation_attempts"."created_at" and ("np_agent_changeset_validation_attempts"."started_at" is null or "np_agent_changeset_validation_attempts"."finished_at">="np_agent_changeset_validation_attempts"."started_at")))),
	CONSTRAINT "np_agent_changeset_validation_attempts_terminal_check" CHECK ((
      ("np_agent_changeset_validation_attempts"."state"='queued' and "np_agent_changeset_validation_attempts"."started_at" is null and "np_agent_changeset_validation_attempts"."finished_at" is null and "np_agent_changeset_validation_attempts"."result_digest" is null and "np_agent_changeset_validation_attempts"."risk_summary" is null and "np_agent_changeset_validation_attempts"."error_code" is null and "np_agent_changeset_validation_attempts"."issues"='[]'::jsonb) or
      ("np_agent_changeset_validation_attempts"."state"='validating' and "np_agent_changeset_validation_attempts"."started_at" is not null and "np_agent_changeset_validation_attempts"."finished_at" is null and "np_agent_changeset_validation_attempts"."result_digest" is null and "np_agent_changeset_validation_attempts"."risk_summary" is null and "np_agent_changeset_validation_attempts"."error_code" is null and "np_agent_changeset_validation_attempts"."issues"='[]'::jsonb) or
      ("np_agent_changeset_validation_attempts"."state"='ready' and "np_agent_changeset_validation_attempts"."started_at" is not null and "np_agent_changeset_validation_attempts"."finished_at" is not null and "np_agent_changeset_validation_attempts"."result_digest" is not null and "np_agent_changeset_validation_attempts"."risk_summary" is not null and "np_agent_changeset_validation_attempts"."error_code" is null) or
      ("np_agent_changeset_validation_attempts"."state"='invalid' and "np_agent_changeset_validation_attempts"."started_at" is not null and "np_agent_changeset_validation_attempts"."finished_at" is not null and "np_agent_changeset_validation_attempts"."result_digest" is not null and "np_agent_changeset_validation_attempts"."error_code" is null) or
      ("np_agent_changeset_validation_attempts"."state"='failed' and "np_agent_changeset_validation_attempts"."finished_at" is not null and "np_agent_changeset_validation_attempts"."error_code" is not null and "np_agent_changeset_validation_attempts"."risk_summary" is null)
    ))
);
--> statement-breakpoint
ALTER TABLE "np_agent_changeset_validation_attempts" ADD CONSTRAINT "np_agent_changeset_validation_attempts_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_validation_attempts" ADD CONSTRAINT "np_agent_changeset_validation_attempts_changeset_fk" FOREIGN KEY ("site_id","changeset_id") REFERENCES "public"."np_agent_changesets"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_changeset_validation_attempts" ADD CONSTRAINT "np_agent_changeset_validation_attempts_invocation_fk" FOREIGN KEY ("site_id","admitting_invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_changeset_validation_attempts_active_unique" ON "np_agent_changeset_validation_attempts" USING btree ("site_id","changeset_id") WHERE "np_agent_changeset_validation_attempts"."state" in ('queued','validating');--> statement-breakpoint
CREATE INDEX "np_agent_changeset_validation_attempts_expiry_idx" ON "np_agent_changeset_validation_attempts" USING btree ("site_id","state","expires_at");