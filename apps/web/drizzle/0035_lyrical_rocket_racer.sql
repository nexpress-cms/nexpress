CREATE TABLE "np_agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"run_id" uuid,
	"run_fingerprint" text,
	"invocation_id" uuid,
	"invocation_fingerprint" text NOT NULL,
	"execution_invocation_id" uuid,
	"execution_invocation_fingerprint" text,
	"sequence" integer NOT NULL,
	"capability_id" text NOT NULL,
	"capability_contract_version" integer NOT NULL,
	"capability_fingerprint" text NOT NULL,
	"capability_definition_body" jsonb NOT NULL,
	"effect_profile_id" text NOT NULL,
	"effect_contract_version" integer NOT NULL,
	"risk" text NOT NULL,
	"state" text NOT NULL,
	"idempotency_key" text,
	"input_redacted" jsonb NOT NULL,
	"input_canonical" jsonb NOT NULL,
	"required_scopes" text[] NOT NULL,
	"target_refs" jsonb NOT NULL,
	"target_version_facts" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"output_redacted" jsonb,
	"output_hash" text,
	"effect_digest" text,
	"target_version_digest" text,
	"verifier_id" text,
	"verification_state" text,
	"verification_result_digest" text,
	"verification_evidence" jsonb,
	"verified_at" timestamp with time zone,
	"undo_ref" jsonb,
	"compensator_id" text,
	"compensation_result_digest" text,
	"compensation_evidence" jsonb,
	"compensated_at" timestamp with time zone,
	"error_code" text,
	"approval_id" uuid,
	"containment_id" uuid,
	"enforcement_adapter_id" text,
	"enforcement_adapter_contract_version" integer,
	"enforcement_adapter_fingerprint" text,
	"compensates_action_id" uuid,
	"audit_event_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "np_agent_actions_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_actions_invocation_sequence_unique" UNIQUE("invocation_id","sequence"),
	CONSTRAINT "np_agent_actions_sequence_check" CHECK ("np_agent_actions"."sequence" > 0),
	CONSTRAINT "np_agent_actions_contract_check" CHECK ("np_agent_actions"."capability_contract_version" > 0 and "np_agent_actions"."effect_contract_version" > 0),
	CONSTRAINT "np_agent_actions_risk_check" CHECK ("np_agent_actions"."risk" in ('read', 'reversible', 'sensitive', 'destructive')),
	CONSTRAINT "np_agent_actions_state_check" CHECK ("np_agent_actions"."state" in ('proposed', 'policy_blocked', 'approval_pending', 'approved', 'executing', 'succeeded', 'failed', 'compensated')),
	CONSTRAINT "np_agent_actions_attribution_check" CHECK (("np_agent_actions"."run_id" is null) = ("np_agent_actions"."run_fingerprint" is null) and
        ("np_agent_actions"."execution_invocation_id" is null) = ("np_agent_actions"."execution_invocation_fingerprint" is null)),
	CONSTRAINT "np_agent_actions_output_check" CHECK (("np_agent_actions"."output_redacted" is null) = ("np_agent_actions"."output_hash" is null)),
	CONSTRAINT "np_agent_actions_read_effect_check" CHECK ("np_agent_actions"."effect_profile_id" <> 'domain.read' or (
        "np_agent_actions"."risk" = 'read' and "np_agent_actions"."verifier_id" is null and "np_agent_actions"."verification_state" is null and
        "np_agent_actions"."verification_result_digest" is null and "np_agent_actions"."verification_evidence" is null and
        "np_agent_actions"."verified_at" is null and "np_agent_actions"."effect_digest" is null and "np_agent_actions"."target_version_digest" is null and
        "np_agent_actions"."undo_ref" is null and "np_agent_actions"."compensator_id" is null and
        "np_agent_actions"."compensation_result_digest" is null and "np_agent_actions"."compensation_evidence" is null and
        "np_agent_actions"."compensated_at" is null and "np_agent_actions"."approval_id" is null and "np_agent_actions"."containment_id" is null and
        "np_agent_actions"."enforcement_adapter_id" is null and "np_agent_actions"."enforcement_adapter_contract_version" is null and
        "np_agent_actions"."enforcement_adapter_fingerprint" is null and "np_agent_actions"."compensates_action_id" is null
      )),
	CONSTRAINT "np_agent_actions_terminal_check" CHECK ((("np_agent_actions"."state" in ('policy_blocked', 'succeeded', 'failed', 'compensated')) = ("np_agent_actions"."finished_at" is not null)) and
        (("np_agent_actions"."state" in ('policy_blocked', 'failed')) = ("np_agent_actions"."error_code" is not null)))
);
--> statement-breakpoint
CREATE TABLE "np_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"origin" text NOT NULL,
	"agent_id" uuid,
	"agent_version_id" uuid,
	"agent_config_hash" text,
	"principal_id" uuid NOT NULL,
	"invocation_id" uuid,
	"admission_fingerprint" text NOT NULL,
	"trigger_id" uuid,
	"root_run_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"causal_depth" integer NOT NULL,
	"causal_event_id" uuid,
	"causal_action_id" uuid,
	"recipe_id" text,
	"recipe_version" integer,
	"recipe_fingerprint" text,
	"instruction_template_id" text,
	"instruction_template_version" integer,
	"instruction_digest" text,
	"response_schema_digest" text,
	"manual_input_schema_digest" text,
	"state" text NOT NULL,
	"goal" text NOT NULL,
	"event_ref" jsonb,
	"policy_refs" jsonb NOT NULL,
	"run_limits" jsonb NOT NULL,
	"run_limits_hash" text NOT NULL,
	"budget_snapshot" jsonb NOT NULL,
	"budget_snapshot_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt" integer NOT NULL,
	"provider_request_id" text,
	"connection_id" uuid,
	"connection_config_snapshot_id" uuid,
	"connection_config_version" integer,
	"connection_config_hash" text,
	"provider_data_class_ceiling" text,
	"pricing_id" text,
	"pricing_version" integer,
	"pricing_fingerprint" text,
	"pricing_effective_at" timestamp with time zone,
	"usage" jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"queued_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "np_agent_runs_site_id_id_unique" UNIQUE("site_id","id"),
	CONSTRAINT "np_agent_runs_invocation_unique" UNIQUE("invocation_id"),
	CONSTRAINT "np_agent_runs_admission_unique" UNIQUE("site_id","origin","principal_id","admission_fingerprint"),
	CONSTRAINT "np_agent_runs_origin_check" CHECK ("np_agent_runs"."origin" in ('gateway', 'runtime')),
	CONSTRAINT "np_agent_runs_state_check" CHECK ("np_agent_runs"."state" in ('queued', 'running', 'waiting_approval', 'waiting_retry', 'verifying', 'succeeded', 'failed', 'cancelled', 'policy_blocked', 'budget_blocked')),
	CONSTRAINT "np_agent_runs_gateway_shape_check" CHECK ("np_agent_runs"."origin" <> 'gateway' or (
        "np_agent_runs"."agent_id" is null and "np_agent_runs"."agent_version_id" is null and "np_agent_runs"."agent_config_hash" is null and
        "np_agent_runs"."invocation_id" is not null and "np_agent_runs"."trigger_id" is null and "np_agent_runs"."recipe_id" is null and
        "np_agent_runs"."recipe_version" is null and "np_agent_runs"."recipe_fingerprint" is null and
        "np_agent_runs"."instruction_template_id" is null and "np_agent_runs"."instruction_template_version" is null and
        "np_agent_runs"."instruction_digest" is null and "np_agent_runs"."response_schema_digest" is null and
        "np_agent_runs"."manual_input_schema_digest" is null and "np_agent_runs"."connection_id" is null and
        "np_agent_runs"."connection_config_snapshot_id" is null and "np_agent_runs"."connection_config_version" is null and
        "np_agent_runs"."connection_config_hash" is null and "np_agent_runs"."provider_data_class_ceiling" is null and
        "np_agent_runs"."provider_request_id" is null and
        "np_agent_runs"."pricing_id" is null and "np_agent_runs"."pricing_version" is null and
        "np_agent_runs"."pricing_fingerprint" is null and "np_agent_runs"."pricing_effective_at" is null
      )),
	CONSTRAINT "np_agent_runs_lineage_check" CHECK (("np_agent_runs"."parent_run_id" is null and "np_agent_runs"."root_run_id" = "np_agent_runs"."id" and "np_agent_runs"."causal_depth" = 0 and "np_agent_runs"."causal_action_id" is null)
        or ("np_agent_runs"."parent_run_id" is not null and "np_agent_runs"."parent_run_id" <> "np_agent_runs"."id" and "np_agent_runs"."root_run_id" <> "np_agent_runs"."id" and "np_agent_runs"."causal_depth" between 1 and 4)),
	CONSTRAINT "np_agent_runs_attempt_check" CHECK ("np_agent_runs"."attempt" > 0),
	CONSTRAINT "np_agent_runs_deadline_check" CHECK ("np_agent_runs"."deadline_at" > "np_agent_runs"."queued_at"),
	CONSTRAINT "np_agent_runs_terminal_check" CHECK ((("np_agent_runs"."state" in ('succeeded', 'failed', 'cancelled', 'policy_blocked', 'budget_blocked')) = ("np_agent_runs"."finished_at" is not null)) and
        ("np_agent_runs"."error_code" is null) = ("np_agent_runs"."error_message" is null))
);
--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_audit_event_id_np_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."np_audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_execution_invocation_fk" FOREIGN KEY ("site_id","execution_invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_compensates_fk" FOREIGN KEY ("site_id","compensates_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_site_id_np_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."np_sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."np_agent_principals"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_invocation_fk" FOREIGN KEY ("site_id","invocation_id") REFERENCES "public"."np_agent_invocations"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_root_fk" FOREIGN KEY ("site_id","root_run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_parent_fk" FOREIGN KEY ("site_id","parent_run_id") REFERENCES "public"."np_agent_runs"("site_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "np_agent_actions_site_state_idx" ON "np_agent_actions" USING btree ("site_id","state","created_at");--> statement-breakpoint
CREATE INDEX "np_agent_actions_run_idx" ON "np_agent_actions" USING btree ("site_id","run_id","sequence");--> statement-breakpoint
CREATE INDEX "np_agent_runs_site_state_idx" ON "np_agent_runs" USING btree ("site_id","state","queued_at");--> statement-breakpoint
CREATE INDEX "np_agent_runs_principal_idx" ON "np_agent_runs" USING btree ("site_id","principal_id","queued_at");--> statement-breakpoint
CREATE INDEX "np_agent_runs_deadline_idx" ON "np_agent_runs" USING btree ("site_id","deadline_at");
