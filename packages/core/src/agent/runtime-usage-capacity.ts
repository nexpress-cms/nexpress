import { sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { NpAgentGatewayError } from "./admin-admission.js";

/** Settled usage replaces reservations; unresolved work continues to consume its maximum. */
export async function npMeasureAgentRuntimeRunUsageV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  runId: string;
  excludeProviderCallId?: string;
}): Promise<{ turns: bigint; input: bigint; output: bigint; cost: bigint }> {
  const excluded = input.excludeProviderCallId
    ? sql`and id not in (
        select usage_reservation_id from public.np_agent_provider_calls
        where site_id=${input.siteId} and run_id=${input.runId} and id=${input.excludeProviderCallId}
      )`
    : sql``;
  const rows = await input.db.execute<Record<string, string>>(sql`
    select count(*)::text as turns,
      coalesce(sum(case when state='reconciled' then actual_input_tokens when state='released' then 0 else reserved_input_tokens end),0)::text as input,
      coalesce(sum(case when state='reconciled' then actual_output_tokens when state='released' then 0 else reserved_output_tokens end),0)::text as output,
      coalesce(sum(case when state='reconciled' then actual_cost_micros when state='released' then 0 else reserved_cost_micros end),0)::text as cost
    from public.np_agent_usage_reservations
    where site_id=${input.siteId} and run_id=${input.runId} ${excluded}
  `);
  const row = rows.rows[0];
  if (!row || [row.turns, row.input, row.output, row.cost].some((value) => !/^\d+$/.test(value)))
    throw new NpAgentGatewayError(
      "RUNTIME_BUDGET_UNAVAILABLE",
      409,
      "Runtime usage is unavailable.",
    );
  return {
    turns: BigInt(row.turns),
    input: BigInt(row.input),
    output: BigInt(row.output),
    cost: BigInt(row.cost),
  };
}
