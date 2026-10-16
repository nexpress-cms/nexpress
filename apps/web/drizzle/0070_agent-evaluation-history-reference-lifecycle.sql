-- NexPress verified evaluation history reference lifecycle v10
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_evaluation_sources"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_evaluation_sources"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_evaluation_reviews"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_evaluation_reviews"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
