CREATE TABLE "np_agent_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid,
	"target_fingerprint" text NOT NULL,
	"label" text NOT NULL,
	"detector_id" text,
	"detector_version" integer,
	"agent_version_id" uuid,
	"provider_call_id" uuid,
	"policy_hashes" text[] NOT NULL,
	"recorded_by_user_id" uuid,
	"actor_fingerprint" text NOT NULL,
	"note" text,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_feedback_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_feedback_kind_check" CHECK (("np_agent_feedback"."target_kind" in ('action','run','incident','agent_assessment') and "np_agent_feedback"."label" in ('confirmed-spam','false-positive','useful','incorrect')) is true),
	CONSTRAINT "np_agent_feedback_bounds_check" CHECK ((length("np_agent_feedback"."target_fingerprint") between 1 and 256 and length("np_agent_feedback"."actor_fingerprint") between 1 and 256 and ("np_agent_feedback"."detector_id" is null)=("np_agent_feedback"."detector_version" is null) and ("np_agent_feedback"."detector_version" is null or "np_agent_feedback"."detector_version">0) and cardinality("np_agent_feedback"."policy_hashes")<=64 and ("np_agent_feedback"."note" is null or length("np_agent_feedback"."note")<=4096) and ("np_agent_feedback"."supersedes_id" is null or "np_agent_feedback"."supersedes_id"<>"np_agent_feedback"."id")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_incident_signals" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"incident_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	CONSTRAINT "np_agent_incident_signals_site_id_incident_id_signal_id_pk" PRIMARY KEY("site_id","incident_id","signal_id"),
	CONSTRAINT "np_agent_incident_signals_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "np_agent_incident_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"incident_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"source_fingerprint" text NOT NULL,
	"event_id" uuid,
	"signal_id" uuid,
	"run_id" uuid,
	"action_id" uuid,
	"approval_id" uuid,
	"provider_call_id" uuid,
	"audit_event_id" uuid,
	"summary" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "np_agent_incident_timeline_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_incident_timeline_sequence_unique" UNIQUE("site_id","incident_id","sequence"),
	CONSTRAINT "np_agent_incident_timeline_kind_check" CHECK (("np_agent_incident_timeline"."kind" in ('observed','correlated','agent_assessment','human_note','state_transition','action','verification','notification') and "np_agent_incident_timeline"."source_kind" in ('system','agent','staff','integration') and ("np_agent_incident_timeline"."kind"<>'agent_assessment' or ("np_agent_incident_timeline"."run_id" is not null and "np_agent_incident_timeline"."provider_call_id" is not null))) is true),
	CONSTRAINT "np_agent_incident_timeline_bounds_check" CHECK (("np_agent_incident_timeline"."sequence">0 and length("np_agent_incident_timeline"."source_fingerprint") between 1 and 256 and length("np_agent_incident_timeline"."summary") between 1 and 2000 and jsonb_typeof("np_agent_incident_timeline"."details")='object' and octet_length("np_agent_incident_timeline"."details"::text)<=16384) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"primary_subject" jsonb,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"assigned_agent_id" uuid,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"contained_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution_code" text,
	"version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_incidents_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_incidents_state_check" CHECK (("np_agent_incidents"."category" in ('spam','abuse','authentication','authorization','traffic','integrity','availability','cost','agent-abuse') and "np_agent_incidents"."severity" in ('info','low','medium','high','critical') and "np_agent_incidents"."status" in ('open','investigating','contained','monitoring','resolved','dismissed') and ("np_agent_incidents"."status" in ('resolved','dismissed'))=("np_agent_incidents"."resolved_at" is not null) and ("np_agent_incidents"."status"<>'contained' or "np_agent_incidents"."contained_at" is not null)) is true),
	CONSTRAINT "np_agent_incidents_bounds_check" CHECK ((length("np_agent_incidents"."fingerprint") between 1 and 256 and length("np_agent_incidents"."title") between 1 and 200 and length("np_agent_incidents"."summary") between 1 and 2000 and "np_agent_incidents"."signal_count">=0 and "np_agent_incidents"."event_count">=0 and "np_agent_incidents"."version_number">0 and ("np_agent_incidents"."primary_subject" is null or octet_length("np_agent_incidents"."primary_subject"::text)<=4096) and ("np_agent_incidents"."resolution_code" is null or "np_agent_incidents"."resolution_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')) is true),
	CONSTRAINT "np_agent_incidents_time_check" CHECK (("np_agent_incidents"."last_observed_at">="np_agent_incidents"."first_observed_at" and ("np_agent_incidents"."contained_at" is null or "np_agent_incidents"."contained_at">="np_agent_incidents"."first_observed_at") and ("np_agent_incidents"."resolved_at" is null or "np_agent_incidents"."resolved_at">="np_agent_incidents"."first_observed_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"channel" text NOT NULL,
	"connection_id" uuid,
	"connection_config_snapshot_id" uuid,
	"incident_id" uuid,
	"run_id" uuid,
	"action_id" uuid,
	"adapter_id" text,
	"adapter_fingerprint" text,
	"connection_config_hash" text,
	"account_subject_key_id" text,
	"account_subject_digest" text,
	"destination_key_id" text,
	"destination_fingerprint" text,
	"adapter_idempotency" text,
	"adapter_contract_version" integer,
	"connection_config_version" integer,
	"destination_descriptor" jsonb,
	"transition_version" integer NOT NULL,
	"deduplication_key" text NOT NULL,
	"state" text NOT NULL,
	"payload_redacted" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"delivery_digest_body" jsonb,
	"delivery_result_digest" text,
	"last_error_code" text,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_notifications_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_notifications_dedup_unique" UNIQUE("site_id","deduplication_key"),
	CONSTRAINT "np_agent_notifications_state_check" CHECK (("np_agent_notifications"."channel" in ('admin','email','slack','webhook','siem') and "np_agent_notifications"."state" in ('queued','sending','sent','failed','suppressed') and ("np_agent_notifications"."state"='sent')=("np_agent_notifications"."sent_at" is not null) and ("np_agent_notifications"."delivery_digest_body" is null)=("np_agent_notifications"."delivery_result_digest" is null) and ("np_agent_notifications"."state"<>'sent' or "np_agent_notifications"."delivery_result_digest" is not null)) is true),
	CONSTRAINT "np_agent_notifications_channel_check" CHECK ((("np_agent_notifications"."channel"='admin' and "np_agent_notifications"."connection_id" is null and "np_agent_notifications"."connection_config_snapshot_id" is null and "np_agent_notifications"."adapter_id" is null and "np_agent_notifications"."adapter_fingerprint" is null and "np_agent_notifications"."connection_config_hash" is null and "np_agent_notifications"."account_subject_key_id" is null and "np_agent_notifications"."account_subject_digest" is null and "np_agent_notifications"."destination_key_id" is null and "np_agent_notifications"."destination_fingerprint" is null and "np_agent_notifications"."adapter_idempotency" is null and "np_agent_notifications"."adapter_contract_version" is null and "np_agent_notifications"."connection_config_version" is null and "np_agent_notifications"."destination_descriptor" is null and "np_agent_notifications"."state"='sent' and "np_agent_notifications"."attempts"=0 and "np_agent_notifications"."provider_message_id" is null and "np_agent_notifications"."last_error_code" is null and "np_agent_notifications"."next_attempt_at" is null and "np_agent_notifications"."sent_at"="np_agent_notifications"."created_at") or ("np_agent_notifications"."channel"<>'admin' and "np_agent_notifications"."connection_id" is not null and "np_agent_notifications"."connection_config_snapshot_id" is not null and "np_agent_notifications"."adapter_id" is not null and "np_agent_notifications"."adapter_fingerprint" is not null and "np_agent_notifications"."connection_config_hash" is not null and "np_agent_notifications"."account_subject_key_id" is not null and "np_agent_notifications"."account_subject_digest" is not null and "np_agent_notifications"."destination_key_id" is not null and "np_agent_notifications"."destination_fingerprint" is not null and "np_agent_notifications"."adapter_idempotency" is not null and "np_agent_notifications"."adapter_contract_version" is not null and "np_agent_notifications"."connection_config_version" is not null and "np_agent_notifications"."destination_descriptor" is not null and "np_agent_notifications"."adapter_idempotency" in ('enforced','none') and "np_agent_notifications"."adapter_contract_version">0 and "np_agent_notifications"."connection_config_version">0)) is true),
	CONSTRAINT "np_agent_notifications_bounds_check" CHECK (("np_agent_notifications"."transition_version">0 and "np_agent_notifications"."attempts" between 0 and 5 and length("np_agent_notifications"."deduplication_key") between 1 and 256 and jsonb_typeof("np_agent_notifications"."payload_redacted")='object' and octet_length("np_agent_notifications"."payload_redacted"::text)<=16384 and ("np_agent_notifications"."provider_message_id" is null or length("np_agent_notifications"."provider_message_id") between 1 and 256) and ("np_agent_notifications"."delivery_result_digest" is null or "np_agent_notifications"."delivery_result_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$') and ("np_agent_notifications"."delivery_digest_body" is null or octet_length("np_agent_notifications"."delivery_digest_body"::text)<=65536)) is true)
);
--> statement-breakpoint
CREATE TABLE "np_agent_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"detector_id" text NOT NULL,
	"detector_version" integer NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"confidence_basis" text NOT NULL,
	"score_basis_points" integer,
	"fingerprint" text NOT NULL,
	"subject" jsonb,
	"evidence" jsonb NOT NULL,
	"evidence_digest" text NOT NULL,
	"status" text NOT NULL,
	"incident_id" uuid,
	"window_started_at" timestamp with time zone NOT NULL,
	"window_ended_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_signals_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_signals_state_check" CHECK (("np_agent_signals"."category" in ('spam','abuse','authentication','authorization','traffic','integrity','availability','cost','agent-abuse') and "np_agent_signals"."severity" in ('info','low','medium','high','critical') and "np_agent_signals"."confidence_basis" in ('exact-rule','statistical','external') and "np_agent_signals"."status" in ('open','attached','suppressed','resolved') and ("np_agent_signals"."status"<>'attached' or "np_agent_signals"."incident_id" is not null)) is true),
	CONSTRAINT "np_agent_signals_bounds_check" CHECK (("np_agent_signals"."detector_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' and "np_agent_signals"."detector_version">0 and ("np_agent_signals"."score_basis_points" is null or "np_agent_signals"."score_basis_points" between 0 and 10000) and length("np_agent_signals"."fingerprint") between 1 and 256 and "np_agent_signals"."evidence_digest" ~ '^cj1:sha256:[A-Za-z0-9_-]{43}$' and jsonb_typeof("np_agent_signals"."evidence")='array' and jsonb_array_length("np_agent_signals"."evidence") between 1 and 100 and octet_length("np_agent_signals"."evidence"::text)<=524288 and ("np_agent_signals"."subject" is null or octet_length("np_agent_signals"."subject"::text)<=4096)) is true),
	CONSTRAINT "np_agent_signals_time_check" CHECK (("np_agent_signals"."window_ended_at">="np_agent_signals"."window_started_at" and "np_agent_signals"."expires_at">"np_agent_signals"."created_at") is true)
);
--> statement-breakpoint
ALTER TABLE "np_agent_feedback" ADD CONSTRAINT "np_agent_feedback_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_feedback" ADD CONSTRAINT "np_agent_feedback_recorded_by_user_id_np_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."np_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_feedback" ADD CONSTRAINT "np_agent_feedback_supersedes_fk" FOREIGN KEY ("site_id","supersedes_id") REFERENCES "public"."np_agent_feedback"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_feedback" ADD CONSTRAINT "np_agent_feedback_agent_version_fk" FOREIGN KEY ("site_id","agent_version_id") REFERENCES "public"."np_agent_versions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_feedback" ADD CONSTRAINT "np_agent_feedback_provider_call_fk" FOREIGN KEY ("site_id","provider_call_id") REFERENCES "public"."np_agent_provider_calls"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_signals" ADD CONSTRAINT "np_agent_incident_signals_incident_fk" FOREIGN KEY ("site_id","incident_id") REFERENCES "public"."np_agent_incidents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_signals" ADD CONSTRAINT "np_agent_incident_signals_signal_fk" FOREIGN KEY ("site_id","signal_id") REFERENCES "public"."np_agent_signals"("site_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_incident_timeline_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_incident_timeline_incident_fk" FOREIGN KEY ("site_id","incident_id") REFERENCES "public"."np_agent_incidents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_timeline_eventId_fk" FOREIGN KEY ("site_id","event_id") REFERENCES "public"."np_agent_events"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_timeline_signalId_fk" FOREIGN KEY ("site_id","signal_id") REFERENCES "public"."np_agent_signals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_timeline_runId_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_timeline_actionId_fk" FOREIGN KEY ("site_id","action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_timeline_approvalId_fk" FOREIGN KEY ("site_id","approval_id") REFERENCES "public"."np_agent_approvals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incident_timeline" ADD CONSTRAINT "np_agent_timeline_providerCallId_fk" FOREIGN KEY ("site_id","provider_call_id") REFERENCES "public"."np_agent_provider_calls"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incidents" ADD CONSTRAINT "np_agent_incidents_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_incidents" ADD CONSTRAINT "np_agent_incidents_assigned_fk" FOREIGN KEY ("site_id","assigned_agent_id") REFERENCES "public"."np_agents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_notifications" ADD CONSTRAINT "np_agent_notifications_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_notifications" ADD CONSTRAINT "np_agent_notifications_connectionId_fk" FOREIGN KEY ("site_id","connection_id") REFERENCES "public"."np_agent_connections"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_notifications" ADD CONSTRAINT "np_agent_notifications_connectionConfigSnapshotId_fk" FOREIGN KEY ("site_id","connection_id","connection_config_snapshot_id","connection_config_version","connection_config_hash") REFERENCES "public"."np_agent_connection_config_versions"("site_id","connection_id","id","version","config_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_notifications" ADD CONSTRAINT "np_agent_notifications_incidentId_fk" FOREIGN KEY ("site_id","incident_id") REFERENCES "public"."np_agent_incidents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_notifications" ADD CONSTRAINT "np_agent_notifications_runId_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_notifications" ADD CONSTRAINT "np_agent_notifications_actionId_fk" FOREIGN KEY ("site_id","action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_signals" ADD CONSTRAINT "np_agent_signals_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_signals" ADD CONSTRAINT "np_agent_signals_incident_fk" FOREIGN KEY ("site_id","incident_id") REFERENCES "public"."np_agent_incidents"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_feedback_supersedes_uidx" ON "np_agent_feedback" USING btree ("site_id","supersedes_id") WHERE "np_agent_feedback"."supersedes_id" is not null;--> statement-breakpoint
CREATE INDEX "np_agent_feedback_target_idx" ON "np_agent_feedback" USING btree ("site_id","target_kind","target_fingerprint","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "np_agent_incidents_active_uidx" ON "np_agent_incidents" USING btree ("site_id","category","fingerprint") WHERE "np_agent_incidents"."status" in ('open','investigating','contained','monitoring');--> statement-breakpoint
CREATE INDEX "np_agent_incidents_observed_idx" ON "np_agent_incidents" USING btree ("site_id","last_observed_at","id");--> statement-breakpoint
CREATE INDEX "np_agent_incidents_updated_idx" ON "np_agent_incidents" USING btree ("site_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "np_agent_incidents_status_idx" ON "np_agent_incidents" USING btree ("site_id","status","last_observed_at");--> statement-breakpoint
CREATE INDEX "np_agent_notifications_delivery_idx" ON "np_agent_notifications" USING btree ("site_id","state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "np_agent_signals_window_idx" ON "np_agent_signals" USING btree ("site_id","window_ended_at");--> statement-breakpoint
CREATE INDEX "np_agent_signals_fingerprint_idx" ON "np_agent_signals" USING btree ("site_id","fingerprint","window_ended_at");--> statement-breakpoint
CREATE INDEX "np_agent_signals_open_idx" ON "np_agent_signals" USING btree ("site_id","created_at") WHERE "np_agent_signals"."status"='open';--> statement-breakpoint
CREATE INDEX "np_agent_signals_expiry_idx" ON "np_agent_signals" USING btree ("site_id","expires_at");