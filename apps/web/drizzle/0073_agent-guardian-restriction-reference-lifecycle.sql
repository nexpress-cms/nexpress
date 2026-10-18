-- NexPress verified Guardian restriction reference lifecycle v11
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_actor_restrictions"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_actor_restrictions"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_restriction_enforcements"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_restriction_enforcements"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
