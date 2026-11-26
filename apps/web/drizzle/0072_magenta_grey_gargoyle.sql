CREATE TABLE "np_agent_actor_restrictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"incident_id" uuid NOT NULL,
	"source_action_id" uuid NOT NULL,
	"removal_action_id" uuid,
	"descriptor" jsonb NOT NULL,
	"restriction_hash" text NOT NULL,
	"subject_key" text NOT NULL,
	"scope_digest" text NOT NULL,
	"adapter_id" text NOT NULL,
	"adapter_contract_version" integer NOT NULL,
	"adapter_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"install_receipt" jsonb,
	"removal_receipt" jsonb,
	"row_version" integer DEFAULT 1 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_actor_restrictions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_actor_restrictions_source_action_unique" UNIQUE("source_action_id"),
	CONSTRAINT "np_agent_actor_restrictions_removal_action_unique" UNIQUE("removal_action_id"),
	CONSTRAINT "np_agent_actor_restrictions_descriptor_check" CHECK ((jsonb_typeof("np_agent_actor_restrictions"."descriptor")='object' and octet_length("np_agent_actor_restrictions"."descriptor"::text)<=8192 and "np_agent_actor_restrictions"."descriptor"->>'restrictionId'="np_agent_actor_restrictions"."id"::text and "np_agent_actor_restrictions"."descriptor"->>'siteId'="np_agent_actor_restrictions"."site_id" and "np_agent_actor_restrictions"."descriptor"->>'schemaVersion'='np.agent-restriction.v1' and ("np_agent_actor_restrictions"."descriptor"->>'expiresAt')::timestamptz="np_agent_actor_restrictions"."expires_at") is true),
	CONSTRAINT "np_agent_actor_restrictions_bounds_check" CHECK (("np_agent_actor_restrictions"."restriction_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and "np_agent_actor_restrictions"."scope_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and length("np_agent_actor_restrictions"."subject_key") between 1 and 512 and length("np_agent_actor_restrictions"."adapter_id") between 1 and 128 and "np_agent_actor_restrictions"."adapter_contract_version">0 and length("np_agent_actor_restrictions"."adapter_fingerprint") between 1 and 256 and "np_agent_actor_restrictions"."row_version">0 and ("np_agent_actor_restrictions"."last_error_code" is null or "np_agent_actor_restrictions"."last_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$') and ("np_agent_actor_restrictions"."install_receipt" is null or (jsonb_typeof("np_agent_actor_restrictions"."install_receipt")='object' and octet_length("np_agent_actor_restrictions"."install_receipt"::text)<=4096)) and ("np_agent_actor_restrictions"."removal_receipt" is null or (jsonb_typeof("np_agent_actor_restrictions"."removal_receipt")='object' and octet_length("np_agent_actor_restrictions"."removal_receipt"::text)<=4096))) is true),
	CONSTRAINT "np_agent_actor_restrictions_state_check" CHECK (("np_agent_actor_restrictions"."state" in ('pending','active','removing','removed','expired','failed') and ("np_agent_actor_restrictions"."state"<>'active' or ("np_agent_actor_restrictions"."activated_at" is not null and "np_agent_actor_restrictions"."install_receipt" is not null)) and ("np_agent_actor_restrictions"."state" in ('removed','expired'))=("np_agent_actor_restrictions"."removed_at" is not null) and ("np_agent_actor_restrictions"."removed_at" is null or "np_agent_actor_restrictions"."removal_receipt" is not null) and ("np_agent_actor_restrictions"."removal_action_id" is null or "np_agent_actor_restrictions"."removal_action_id"<>"np_agent_actor_restrictions"."source_action_id")) is true),
	CONSTRAINT "np_agent_actor_restrictions_time_check" CHECK (("np_agent_actor_restrictions"."updated_at">="np_agent_actor_restrictions"."created_at" and "np_agent_actor_restrictions"."expires_at">("np_agent_actor_restrictions"."descriptor"->>'startsAt')::timestamptz and "np_agent_actor_restrictions"."expires_at">=("np_agent_actor_restrictions"."descriptor"->>'startsAt')::timestamptz+interval '60 seconds' and "np_agent_actor_restrictions"."expires_at"<=("np_agent_actor_restrictions"."descriptor"->>'startsAt')::timestamptz+interval '3600 seconds' and ("np_agent_actor_restrictions"."activated_at" is null or "np_agent_actor_restrictions"."activated_at">="np_agent_actor_restrictions"."created_at") and ("np_agent_actor_restrictions"."removed_at" is null or "np_agent_actor_restrictions"."removed_at">="np_agent_actor_restrictions"."created_at") and ("np_agent_actor_restrictions"."revoked_at" is null or "np_agent_actor_restrictions"."revoked_at">="np_agent_actor_restrictions"."created_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_restriction_enforcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"descriptor" jsonb NOT NULL,
	"restriction_hash" text NOT NULL,
	"subject_key" text NOT NULL,
	"action_scopes" text[] NOT NULL,
	"install_key" text NOT NULL,
	"remove_key" text,
	"expected_row_version" integer NOT NULL,
	"state" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_restriction_enforcements_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_restriction_enforcements_descriptor_check" CHECK ((jsonb_typeof("np_agent_restriction_enforcements"."descriptor")='object' and octet_length("np_agent_restriction_enforcements"."descriptor"::text)<=8192 and "np_agent_restriction_enforcements"."descriptor"->>'restrictionId'="np_agent_restriction_enforcements"."id"::text and "np_agent_restriction_enforcements"."descriptor"->>'siteId'="np_agent_restriction_enforcements"."site_id" and "np_agent_restriction_enforcements"."descriptor"->>'schemaVersion'='np.agent-restriction.v1' and ("np_agent_restriction_enforcements"."descriptor"->>'startsAt')::timestamptz="np_agent_restriction_enforcements"."starts_at" and ("np_agent_restriction_enforcements"."descriptor"->>'expiresAt')::timestamptz="np_agent_restriction_enforcements"."expires_at") is true),
	CONSTRAINT "np_agent_restriction_enforcements_bounds_check" CHECK (("np_agent_restriction_enforcements"."restriction_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and length("np_agent_restriction_enforcements"."subject_key") between 1 and 512 and cardinality("np_agent_restriction_enforcements"."action_scopes") between 1 and 5 and "np_agent_restriction_enforcements"."action_scopes"<@ARRAY['auth.staff','auth.member','agent.gateway','community.write','content.write']::text[] and "np_agent_restriction_enforcements"."expected_row_version">0 and length("np_agent_restriction_enforcements"."install_key") between 1 and 256 and ("np_agent_restriction_enforcements"."remove_key" is null or length("np_agent_restriction_enforcements"."remove_key") between 1 and 256)) is true),
	CONSTRAINT "np_agent_restriction_enforcements_state_check" CHECK (("np_agent_restriction_enforcements"."state" in ('installed','removed') and ("np_agent_restriction_enforcements"."state"='removed')=("np_agent_restriction_enforcements"."remove_key" is not null)) is true),
	CONSTRAINT "np_agent_restriction_enforcements_time_check" CHECK (("np_agent_restriction_enforcements"."updated_at">="np_agent_restriction_enforcements"."created_at" and "np_agent_restriction_enforcements"."expires_at">="np_agent_restriction_enforcements"."starts_at"+interval '60 seconds' and "np_agent_restriction_enforcements"."expires_at"<="np_agent_restriction_enforcements"."starts_at"+interval '3600 seconds') is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_actor_restrictions" ADD CONSTRAINT "np_agent_actor_restrictions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actor_restrictions" ADD CONSTRAINT "np_agent_actor_restrictions_incident_fk" FOREIGN KEY ("site_id","incident_id") REFERENCES "public"."np_agent_incidents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actor_restrictions" ADD CONSTRAINT "np_agent_actor_restrictions_source_action_fk" FOREIGN KEY ("site_id","source_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actor_restrictions" ADD CONSTRAINT "np_agent_actor_restrictions_removal_action_fk" FOREIGN KEY ("site_id","removal_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_restriction_enforcements" ADD CONSTRAINT "np_agent_restriction_enforcements_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_actor_restrictions_active_target_uidx" ON "np_agent_actor_restrictions" USING btree ("site_id","subject_key","scope_digest") WHERE "np_agent_actor_restrictions"."state" in ('pending','active','removing');--> statement-breakpoint
CREATE INDEX "np_agent_actor_restrictions_incident_idx" ON "np_agent_actor_restrictions" USING btree ("site_id","incident_id");--> statement-breakpoint
CREATE INDEX "np_agent_actor_restrictions_expiry_idx" ON "np_agent_actor_restrictions" USING btree ("site_id","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_restriction_enforcements_subject_idx" ON "np_agent_restriction_enforcements" USING btree ("site_id","subject_key","expires_at");