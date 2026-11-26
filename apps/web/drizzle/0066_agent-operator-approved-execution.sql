CREATE TABLE "np_agent_operator_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"source_run_id" uuid,
	"result_run_id" uuid,
	"state" text NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_canonical" jsonb,
	"evidence_canonical" jsonb,
	"result_digest" text,
	CONSTRAINT "np_agent_operator_executions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_operator_executions_plan_unique" UNIQUE("plan_id"),
	CONSTRAINT "np_agent_operator_executions_invocation_unique" UNIQUE("invocation_id"),
	CONSTRAINT "np_agent_operator_executions_state_check" CHECK ("np_agent_operator_executions"."state" in ('reserved','dispatching','succeeded','failed','conflicted','unknown')),
	CONSTRAINT "np_agent_operator_executions_body_check" CHECK ((("np_agent_operator_executions"."result_canonical" is null and "np_agent_operator_executions"."result_digest" is null) or (jsonb_typeof("np_agent_operator_executions"."result_canonical")='object' and octet_length("np_agent_operator_executions"."result_canonical"::text)<=65536 and "np_agent_operator_executions"."result_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$')) is true and ("np_agent_operator_executions"."evidence_canonical" is null or (jsonb_typeof("np_agent_operator_executions"."evidence_canonical")='object' and octet_length("np_agent_operator_executions"."evidence_canonical"::text)<=1048576))),
	CONSTRAINT "np_agent_operator_executions_time_check" CHECK (("np_agent_operator_executions"."dispatched_at" is null or "np_agent_operator_executions"."dispatched_at">="np_agent_operator_executions"."reserved_at") and ("np_agent_operator_executions"."finished_at" is null or "np_agent_operator_executions"."finished_at">="np_agent_operator_executions"."reserved_at") and ("np_agent_operator_executions"."state" not in ('succeeded','failed','conflicted') or ("np_agent_operator_executions"."finished_at" is not null and "np_agent_operator_executions"."result_canonical" is not null))),
	CONSTRAINT "np_agent_operator_executions_run_check" CHECK ("np_agent_operator_executions"."result_run_id" is null or ("np_agent_operator_executions"."source_run_id" is not null and "np_agent_operator_executions"."result_run_id"<>"np_agent_operator_executions"."source_run_id"))
);
--> statement-breakpoint
ALTER TABLE "np_agent_operator_plans" ADD COLUMN "approval_action_id" uuid;--> statement-breakpoint
ALTER TABLE "np_agent_operator_executions" ADD CONSTRAINT "np_agent_operator_executions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_executions" ADD CONSTRAINT "np_agent_operator_executions_plan_fk" FOREIGN KEY ("site_id","plan_id") REFERENCES "public"."np_agent_operator_plans"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_executions" ADD CONSTRAINT "np_agent_operator_executions_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_executions" ADD CONSTRAINT "np_agent_operator_executions_action_fk" FOREIGN KEY ("site_id","action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_executions" ADD CONSTRAINT "np_agent_operator_executions_source_run_fk" FOREIGN KEY ("site_id","source_run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_executions" ADD CONSTRAINT "np_agent_operator_executions_result_run_fk" FOREIGN KEY ("site_id","result_run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_plans" ADD CONSTRAINT "np_agent_operator_plans_approval_action_fk" FOREIGN KEY ("site_id","approval_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_operator_plans" ADD CONSTRAINT "np_agent_operator_plans_approval_action_unique" UNIQUE("approval_action_id");