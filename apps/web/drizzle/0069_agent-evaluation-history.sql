CREATE TABLE "np_agent_evaluation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"case_id" text NOT NULL,
	"case_version" integer NOT NULL,
	"case_hash" text NOT NULL,
	"prediction_hash" text NOT NULL,
	"previous_revision_id" uuid,
	"recorded_by_user_id" uuid,
	"actor_fingerprint" text NOT NULL,
	"label_body" jsonb,
	"revision_hash" text NOT NULL,
	"invocation_id" uuid NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_evaluation_reviews_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_evaluation_reviews_source_id_id_unique" UNIQUE("site_id","source_id","id"),
	CONSTRAINT "np_agent_evaluation_reviews_version_unique" UNIQUE("site_id","source_id","version_number"),
	CONSTRAINT "np_agent_evaluation_reviews_invocation_unique" UNIQUE("site_id","invocation_id"),
	CONSTRAINT "np_agent_evaluation_reviews_bounds_check" CHECK (("np_agent_evaluation_reviews"."version_number" between 1 and 10000 and "np_agent_evaluation_reviews"."case_version" between 1 and 2147483646 and char_length("np_agent_evaluation_reviews"."case_id") between 1 and 128 and "np_agent_evaluation_reviews"."case_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_evaluation_reviews"."prediction_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_evaluation_reviews"."actor_fingerprint" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_evaluation_reviews"."revision_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and ("np_agent_evaluation_reviews"."previous_revision_id" is null or "np_agent_evaluation_reviews"."previous_revision_id"<>"np_agent_evaluation_reviews"."id") and ("np_agent_evaluation_reviews"."label_body" is null or (jsonb_typeof("np_agent_evaluation_reviews"."label_body")='object' and octet_length("np_agent_evaluation_reviews"."label_body"::text)<=393216 and "np_agent_evaluation_reviews"."label_body"->>'reviewer'='staff:'||"np_agent_evaluation_reviews"."actor_fingerprint" and "np_agent_evaluation_reviews"."label_body"->>'caseId'="np_agent_evaluation_reviews"."case_id" and "np_agent_evaluation_reviews"."label_body"->>'caseHash'="np_agent_evaluation_reviews"."case_hash" and "np_agent_evaluation_reviews"."label_body"->>'predictionHash'="np_agent_evaluation_reviews"."prediction_hash"))) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_evaluation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"recipe" text NOT NULL,
	"source_hash" text NOT NULL,
	"evaluation_body" jsonb NOT NULL,
	"version_number" integer NOT NULL,
	"case_count" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_evaluation_sources_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_evaluation_sources_source_unique" UNIQUE("site_id","recipe","source_hash"),
	CONSTRAINT "np_agent_evaluation_sources_bounds_check" CHECK (("np_agent_evaluation_sources"."version_number" between 0 and 10000 and "np_agent_evaluation_sources"."case_count" between 1 and 100 and "np_agent_evaluation_sources"."recipe" in ('moderator','moderator-proposal','operator','publisher','moderator-assessment','publisher-selection') and "np_agent_evaluation_sources"."source_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof("np_agent_evaluation_sources"."evaluation_body")='object' and octet_length("np_agent_evaluation_sources"."evaluation_body"::text)<=4194304) is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_reviews" ADD CONSTRAINT "np_agent_evaluation_reviews_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_reviews" ADD CONSTRAINT "np_agent_evaluation_reviews_recorded_by_user_id_np_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_reviews" ADD CONSTRAINT "np_agent_evaluation_reviews_audit_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."np_audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_reviews" ADD CONSTRAINT "np_agent_evaluation_reviews_source_fk" FOREIGN KEY ("site_id","source_id") REFERENCES "public"."np_agent_evaluation_sources"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_reviews" ADD CONSTRAINT "np_agent_evaluation_reviews_previous_fk" FOREIGN KEY ("site_id","source_id","previous_revision_id") REFERENCES "public"."np_agent_evaluation_reviews"("site_id","source_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_reviews" ADD CONSTRAINT "np_agent_evaluation_reviews_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_evaluation_sources" ADD CONSTRAINT "np_agent_evaluation_sources_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_evaluation_reviews_supersedes_unique" ON "np_agent_evaluation_reviews" USING btree ("site_id","previous_revision_id") WHERE "np_agent_evaluation_reviews"."previous_revision_id" is not null;--> statement-breakpoint
CREATE INDEX "np_agent_evaluation_reviews_case_idx" ON "np_agent_evaluation_reviews" USING btree ("site_id","source_id","case_id","case_version","version_number");--> statement-breakpoint
CREATE INDEX "np_agent_evaluation_sources_page_idx" ON "np_agent_evaluation_sources" USING btree ("site_id","id");--> statement-breakpoint
CREATE INDEX "np_agent_timeline_site_source_sequence_idx" ON "np_agent_incident_timeline" USING btree ("site_id","source_id","sequence");