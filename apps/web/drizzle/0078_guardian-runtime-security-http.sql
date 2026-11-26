CREATE TABLE "np_agent_runtime_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"key_id" text NOT NULL,
	"source_mac" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_code" text,
	"emitted_event_id" uuid,
	"emitted_at" timestamp with time zone,
	CONSTRAINT "np_agent_runtime_receipts_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_runtime_receipts_source_check" CHECK (("np_agent_runtime_receipts"."body"->>'schemaVersion'='np.agent-guardian-runtime-activity.v1'
    and "np_agent_runtime_receipts"."body"->>'siteId'="np_agent_runtime_receipts"."site_id" and "np_agent_runtime_receipts"."body"->>'observationId'="np_agent_runtime_receipts"."id"::text
    and "np_agent_runtime_receipts"."body"->>'agentId'="np_agent_runtime_receipts"."agent_id"::text and "np_agent_runtime_receipts"."body"->>'agentVersionId'="np_agent_runtime_receipts"."agent_version_id"::text
    and "np_agent_runtime_receipts"."body"->>'runId'="np_agent_runtime_receipts"."run_id"::text and "np_agent_runtime_receipts"."body"->>'principalId'="np_agent_runtime_receipts"."principal_id"::text
    and "np_agent_runtime_receipts"."body"->>'occurredAt'=to_char("np_agent_runtime_receipts"."occurred_at" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    and octet_length("np_agent_runtime_receipts"."body"::text)<=8192 and "np_agent_runtime_receipts"."body_hash" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$'
    and "np_agent_runtime_receipts"."key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and "np_agent_runtime_receipts"."source_mac" ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$') is true),
	CONSTRAINT "np_agent_runtime_receipts_delivery_check" CHECK (((
    "np_agent_runtime_receipts"."state"='emitted' and "np_agent_runtime_receipts"."emitted_event_id" is not null and "np_agent_runtime_receipts"."emitted_at" is not null and "np_agent_runtime_receipts"."failure_code" is null)
    or ("np_agent_runtime_receipts"."state"='pending' and "np_agent_runtime_receipts"."emitted_event_id" is null and "np_agent_runtime_receipts"."emitted_at" is null and "np_agent_runtime_receipts"."failure_code" is null)
    or ("np_agent_runtime_receipts"."state"='blocked' and "np_agent_runtime_receipts"."emitted_event_id" is null and "np_agent_runtime_receipts"."emitted_at" is null and "np_agent_runtime_receipts"."failure_code" in ('KEY_UNAVAILABLE','SOURCE_INTEGRITY','DELIVERY_UNAVAILABLE'))
    or ("np_agent_runtime_receipts"."state"='sampled' and "np_agent_runtime_receipts"."emitted_event_id" is null and "np_agent_runtime_receipts"."emitted_at" is null and "np_agent_runtime_receipts"."failure_code"='COVERAGE_CAPPED')
    or ("np_agent_runtime_receipts"."state"='held' and "np_agent_runtime_receipts"."emitted_event_id" is null and "np_agent_runtime_receipts"."emitted_at" is null and "np_agent_runtime_receipts"."failure_code"='DELIVERY_CLOSED')) is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_events" DROP CONSTRAINT "np_agent_events_kind_check";--> statement-breakpoint
ALTER TABLE "np_agent_triggers" DROP CONSTRAINT "np_agent_triggers_event_check";--> statement-breakpoint
ALTER TABLE "np_agent_runtime_receipts" ADD CONSTRAINT "np_agent_runtime_receipts_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runtime_receipts" ADD CONSTRAINT "np_agent_runtime_receipts_agent_fk" FOREIGN KEY ("site_id","agent_id") REFERENCES "public"."np_agents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runtime_receipts" ADD CONSTRAINT "np_agent_runtime_receipts_run_fk" FOREIGN KEY ("site_id","agent_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","agent_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runtime_receipts" ADD CONSTRAINT "np_agent_runtime_receipts_version_fk" FOREIGN KEY ("site_id","agent_id","agent_version_id") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runtime_receipts" ADD CONSTRAINT "np_agent_runtime_receipts_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runtime_receipts" ADD CONSTRAINT "np_agent_runtime_receipts_event_fk" FOREIGN KEY ("site_id","emitted_event_id") REFERENCES "public"."np_agent_events"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_pending_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","next_attempt_at","created_at","id") WHERE "np_agent_runtime_receipts"."state" in ('pending','blocked');--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_state_idx" ON "np_agent_runtime_receipts" USING btree ("state","site_id");--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_event_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","emitted_event_id");--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_history_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","created_at","id");--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_coverage_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","occurred_at","id") WHERE "np_agent_runtime_receipts"."state"='emitted';--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_cohort_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","agent_id","occurred_at","id") WHERE "np_agent_runtime_receipts"."state"='emitted';--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_run_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","run_id");--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_principal_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","principal_id");--> statement-breakpoint
CREATE INDEX "np_agent_runtime_receipts_version_idx" ON "np_agent_runtime_receipts" USING btree ("site_id","agent_version_id");--> statement-breakpoint
ALTER TABLE "np_agent_events" ADD CONSTRAINT "np_agent_events_kind_check" CHECK ("np_agent_events"."kind" in ('api.rate-limited','agent.action.changed','agent.policy.blocked','agent.policy.changed','agent.run.changed','agent.runtime.activity.observed','http.response.observed','auth.login.failed','auth.login.succeeded','auth.session.revoked','authz.denied','authz.role.changed','community.content.created','community.content.moderated','community.content.reported','community.member.reported','content.document.changed','content.activity.observed','content.document.published','jobs.backlog.threshold','jobs.handler.failed','jobs.worker.stale','ops.backup.failed','ops.backup.stale','ops.check.changed','security.edge.signal','security.error.signal','security.authority.changed','security.credential.changed','security.plugin.changed'));--> statement-breakpoint
ALTER TABLE "np_agent_triggers" ADD CONSTRAINT "np_agent_triggers_event_check" CHECK ("np_agent_triggers"."event_type" is null or "np_agent_triggers"."event_type" in ('api.rate-limited','agent.action.changed','agent.policy.blocked','agent.policy.changed','agent.run.changed','agent.runtime.activity.observed','http.response.observed','auth.login.failed','auth.login.succeeded','auth.session.revoked','authz.denied','authz.role.changed','community.content.created','community.content.moderated','community.content.reported','community.member.reported','content.document.changed','content.activity.observed','content.document.published','jobs.backlog.threshold','jobs.handler.failed','jobs.worker.stale','ops.backup.failed','ops.backup.stale','ops.check.changed','security.edge.signal','security.error.signal','security.authority.changed','security.credential.changed','security.plugin.changed'));