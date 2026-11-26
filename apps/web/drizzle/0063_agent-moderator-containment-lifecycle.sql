-- NexPress verified Moderator containment lifecycle v7
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_containments"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_containments"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_containment_fk" FOREIGN KEY ("site_id","containment_id") REFERENCES "public"."np_agent_containments"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "np_agent_actions" ADD CONSTRAINT "np_agent_actions_approval_fk" FOREIGN KEY ("site_id","approval_id") REFERENCES "public"."np_agent_approvals"("site_id","id") ON DELETE no action DEFERRABLE INITIALLY DEFERRED;
