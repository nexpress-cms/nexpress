CREATE TABLE "np_agent_containments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_ref" jsonb NOT NULL,
	"target_version_digest" text NOT NULL,
	"source_action_id" uuid NOT NULL,
	"restore_action_id" uuid,
	"incident_id" uuid,
	"state" text NOT NULL,
	"original_state" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_containments_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_containments_source_action_unique" UNIQUE("source_action_id"),
	CONSTRAINT "np_agent_containments_restore_action_unique" UNIQUE("restore_action_id"),
	CONSTRAINT "np_agent_containments_kind_check" CHECK (("np_agent_containments"."kind"='content_quarantine' and "np_agent_containments"."target_kind" in ('document','comment') and "np_agent_containments"."target_ref"->>'kind'="np_agent_containments"."target_kind") is true),
	CONSTRAINT "np_agent_containments_state_check" CHECK (("np_agent_containments"."state" in ('pending','active','restoring','restored','expired','failed') and ("np_agent_containments"."state" not in ('active','restoring','restored','expired') or "np_agent_containments"."activated_at" is not null) and ("np_agent_containments"."state"='restored')=("np_agent_containments"."restored_at" is not null) and ("np_agent_containments"."restore_action_id" is null or "np_agent_containments"."restore_action_id"<>"np_agent_containments"."source_action_id")) is true),
	CONSTRAINT "np_agent_containments_bounds_check" CHECK ((jsonb_typeof("np_agent_containments"."target_ref")='object' and octet_length("np_agent_containments"."target_ref"::text)<=4096 and "np_agent_containments"."target_version_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof("np_agent_containments"."original_state")='object' and octet_length("np_agent_containments"."original_state"::text)<=16384 and ("np_agent_containments"."last_error_code" is null or "np_agent_containments"."last_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')) is true),
	CONSTRAINT "np_agent_containments_time_check" CHECK (("np_agent_containments"."updated_at">="np_agent_containments"."created_at" and ("np_agent_containments"."expires_at" is null or ("np_agent_containments"."expires_at">"np_agent_containments"."created_at" and "np_agent_containments"."expires_at"<="np_agent_containments"."created_at"+interval '30 days')) and ("np_agent_containments"."activated_at" is null or "np_agent_containments"."activated_at">="np_agent_containments"."created_at") and ("np_agent_containments"."restored_at" is null or "np_agent_containments"."restored_at">="np_agent_containments"."activated_at")) is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_containments" ADD CONSTRAINT "np_agent_containments_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_containments" ADD CONSTRAINT "np_agent_containments_source_action_fk" FOREIGN KEY ("site_id","source_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_containments" ADD CONSTRAINT "np_agent_containments_restore_action_fk" FOREIGN KEY ("site_id","restore_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_containments" ADD CONSTRAINT "np_agent_containments_incident_fk" FOREIGN KEY ("site_id","incident_id") REFERENCES "public"."np_agent_incidents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_containments_active_target_uidx" ON "np_agent_containments" USING btree ("site_id","kind","target_ref") WHERE "np_agent_containments"."state" in ('pending','active','restoring');--> statement-breakpoint
CREATE INDEX "np_agent_containments_incident_idx" ON "np_agent_containments" USING btree ("site_id","incident_id");--> statement-breakpoint
CREATE INDEX "np_agent_containments_state_idx" ON "np_agent_containments" USING btree ("site_id","state","updated_at");