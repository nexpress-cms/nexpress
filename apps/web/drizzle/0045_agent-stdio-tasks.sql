ALTER TABLE "np_agent_invocations" DROP CONSTRAINT "np_agent_invocations_mcp_mode_check";--> statement-breakpoint
ALTER TABLE "np_agent_invocations" ADD CONSTRAINT "np_agent_invocations_mcp_mode_check" CHECK ((
        ("np_agent_invocations"."transport" in ('mcp-oauth', 'mcp-service', 'stdio') and "np_agent_invocations"."mcp_execution_mode" in ('normal', 'task') and
          (("np_agent_invocations"."mcp_execution_mode" = 'task' and "np_agent_invocations"."mcp_requested_task_ttl_ms" is not null and "np_agent_invocations"."mcp_requested_task_ttl_ms" > 0) or
           ("np_agent_invocations"."mcp_execution_mode" = 'normal' and "np_agent_invocations"."mcp_requested_task_ttl_ms" is null)))
        or ("np_agent_invocations"."transport" not in ('mcp-oauth', 'mcp-service') and "np_agent_invocations"."mcp_execution_mode" is null and "np_agent_invocations"."mcp_requested_task_ttl_ms" is null)
      ));