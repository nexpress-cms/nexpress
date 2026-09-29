CREATE TABLE "np_agent_operator_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"invocation_id" uuid NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"operation" jsonb NOT NULL,
	"contract_id" text NOT NULL,
	"artifact_canonical" jsonb NOT NULL,
	"artifact_digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_operator_plans_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_operator_plans_invocation_unique" UNIQUE("invocation_id"),
	CONSTRAINT "np_agent_operator_plans_bounds_check" CHECK ((length("np_agent_operator_plans"."contract_id") between 1 and 128 and jsonb_typeof("np_agent_operator_plans"."operation")='object' and octet_length("np_agent_operator_plans"."operation"::text)<=4096 and jsonb_typeof("np_agent_operator_plans"."artifact_canonical")='object' and octet_length("np_agent_operator_plans"."artifact_canonical"::text)<=1048576 and "np_agent_operator_plans"."artifact_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') is true),
	CONSTRAINT "np_agent_operator_plans_time_check" CHECK (("np_agent_operator_plans"."expires_at">"np_agent_operator_plans"."created_at" and "np_agent_operator_plans"."expires_at"<="np_agent_operator_plans"."created_at"+interval '24 hours') is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_operator_plans" ADD CONSTRAINT "np_agent_operator_plans_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_plans" ADD CONSTRAINT "np_agent_operator_plans_audit_event_id_np_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."np_audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_plans" ADD CONSTRAINT "np_agent_operator_plans_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;