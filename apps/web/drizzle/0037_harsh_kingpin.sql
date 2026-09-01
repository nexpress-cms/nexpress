CREATE TABLE "np_agent_mcp_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"invocation_id" uuid NOT NULL,
	"run_id" uuid,
	"principal_id" uuid NOT NULL,
	"authorization_context_body" jsonb NOT NULL,
	"authorization_context_fingerprint" text NOT NULL,
	"authority_ref" jsonb NOT NULL,
	"status" text NOT NULL,
	"requested_ttl_ms" bigint,
	"ttl_ms" bigint NOT NULL,
	"poll_interval_ms" integer NOT NULL,
	"terminal_result" jsonb,
	"terminal_result_digest" text,
	"safe_status_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "np_agent_mcp_tasks_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_mcp_tasks_invocation_unique" UNIQUE("invocation_id"),
	CONSTRAINT "np_agent_mcp_tasks_id_check" CHECK ("np_agent_mcp_tasks"."id" ~ '^npt1_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "np_agent_mcp_tasks_status_check" CHECK ("np_agent_mcp_tasks"."status" in ('working', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "np_agent_mcp_tasks_ttl_check" CHECK ("np_agent_mcp_tasks"."ttl_ms" between 60000 and 86400000 and
        ("np_agent_mcp_tasks"."requested_ttl_ms" is null or "np_agent_mcp_tasks"."requested_ttl_ms" between 60000 and 86400000) and
        "np_agent_mcp_tasks"."ttl_ms" <= coalesce("np_agent_mcp_tasks"."requested_ttl_ms", 3600000) and
        "np_agent_mcp_tasks"."poll_interval_ms" between 1000 and 10000),
	CONSTRAINT "np_agent_mcp_tasks_result_check" CHECK ((
        "np_agent_mcp_tasks"."status" = 'working' and "np_agent_mcp_tasks"."terminal_result" is null and
          "np_agent_mcp_tasks"."terminal_result_digest" is null and "np_agent_mcp_tasks"."safe_status_code" is null and
          "np_agent_mcp_tasks"."cancelled_at" is null
      ) or (
        "np_agent_mcp_tasks"."status" in ('completed', 'failed') and "np_agent_mcp_tasks"."terminal_result" is not null and
          "np_agent_mcp_tasks"."terminal_result_digest" is not null and "np_agent_mcp_tasks"."cancelled_at" is null
      ) or (
        "np_agent_mcp_tasks"."status" = 'cancelled' and "np_agent_mcp_tasks"."terminal_result" is not null and
          "np_agent_mcp_tasks"."terminal_result_digest" is not null and "np_agent_mcp_tasks"."safe_status_code" is not null and
          "np_agent_mcp_tasks"."cancelled_at" is not null
      )),
	CONSTRAINT "np_agent_mcp_tasks_time_check" CHECK ("np_agent_mcp_tasks"."last_updated_at" >= "np_agent_mcp_tasks"."created_at" and
        "np_agent_mcp_tasks"."last_updated_at" <= "np_agent_mcp_tasks"."expires_at" and
        "np_agent_mcp_tasks"."expires_at" = "np_agent_mcp_tasks"."created_at" + ("np_agent_mcp_tasks"."ttl_ms"::text || ' milliseconds')::interval)
);
--> statement-breakpoint
ALTER TABLE "np_agent_mcp_tasks" ADD CONSTRAINT "np_agent_mcp_tasks_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_mcp_tasks" ADD CONSTRAINT "np_agent_mcp_tasks_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_mcp_tasks" ADD CONSTRAINT "np_agent_mcp_tasks_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_mcp_tasks" ADD CONSTRAINT "np_agent_mcp_tasks_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_mcp_tasks_site_status_idx" ON "np_agent_mcp_tasks" USING btree ("site_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "np_agent_mcp_tasks_authorization_idx" ON "np_agent_mcp_tasks" USING btree ("site_id","principal_id","authorization_context_fingerprint","created_at");
