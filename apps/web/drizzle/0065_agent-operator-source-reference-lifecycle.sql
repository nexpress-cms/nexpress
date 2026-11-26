-- NexPress verified Operator plan source reference lifecycle v8
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_operator_plans"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_operator_plans"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
