-- NexPress verified Guardian Runtime receipt reference lifecycle v13
CREATE OR REPLACE TRIGGER np_agent_reference_statement_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_runtime_receipts"
FOR EACH STATEMENT EXECUTE FUNCTION public.np_agent_reference_statement_v1();
CREATE OR REPLACE TRIGGER np_agent_reference_row_v1
BEFORE INSERT OR UPDATE OR DELETE ON public."np_agent_runtime_receipts"
FOR EACH ROW EXECUTE FUNCTION public.np_agent_reference_row_v1();
