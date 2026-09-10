ALTER TABLE "np_agent_changeset_rollback_plans" ADD CONSTRAINT "np_agent_changeset_rollback_plans_execution_fk" FOREIGN KEY ("site_id","compensates_execution_id") REFERENCES "public"."np_agent_changeset_executions"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "np_agent_changeset_rollback_plans" ADD CONSTRAINT "np_agent_changeset_rollback_plans_approval_fk" FOREIGN KEY ("site_id","approval_id") REFERENCES "public"."np_agent_approvals"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
