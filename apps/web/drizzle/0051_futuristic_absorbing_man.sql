ALTER TABLE "np_agent_runs" ADD COLUMN "manual_input" jsonb;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD COLUMN "manual_input_digest" text;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_manual_input_check" CHECK ((("np_agent_runs"."manual_input" is null and "np_agent_runs"."manual_input_digest" is null) or
        ("np_agent_runs"."origin"='runtime' and "np_agent_runs"."manual_input" is not null and jsonb_typeof("np_agent_runs"."manual_input")='object'
        and octet_length("np_agent_runs"."manual_input"::text)<=16384 and "np_agent_runs"."manual_input_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$'
        and "np_agent_runs"."manual_input_schema_digest" is not null and "np_agent_runs"."trigger_id" is not null
        and "np_agent_runs"."connection_id" is not null and "np_agent_runs"."provider_data_class_ceiling"='sensitive-approved')) is true);