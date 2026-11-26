-- NexPress verified Operator execution source reference lifecycle v9
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_operator_executions"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_operator_executions"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
