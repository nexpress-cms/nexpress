ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_active_version_fk" FOREIGN KEY ("site_id","id","active_version_id") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "np_agents" ADD CONSTRAINT "np_agents_draft_version_fk" FOREIGN KEY ("site_id","id","draft_version_id") REFERENCES "public"."np_agent_versions"("site_id","agent_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_causal_event_fk" FOREIGN KEY ("site_id","causal_event_id") REFERENCES "public"."np_agent_events"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "np_agent_runs" ADD CONSTRAINT "np_agent_runs_causal_action_fk" FOREIGN KEY ("site_id","causal_action_id") REFERENCES "public"."np_agent_actions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
