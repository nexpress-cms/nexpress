import { sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import type {
  NpAgentBudgetSnapshotCountersV1,
  NpAgentBudgetSnapshotReservationV1,
} from "../agent-contract/types.js";
import type { NpAgentConcreteBudgetV1 } from "../agent-contract/runtime-budget.js";
import { npAgentBudgetWindowsV1 } from "../agent-contract/runtime-budget.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";

export type NpAgentBudgetCountersV1 = NpAgentBudgetSnapshotCountersV1;
type Db = ReturnType<typeof getDb>;

function unavailable(): never {
  throw new NpAgentGatewayError(
    "RUNTIME_BUDGET_UNAVAILABLE",
    409,
    "Agent runtime budget is unavailable.",
  );
}
function counter(value: unknown, maximum = 2_147_483_647): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) unavailable();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) unavailable();
  return number;
}

/** An unresolved provider outcome is not spare capacity, even under a high ceiling. */
export async function npRequireAgentRuntimeUsageKnownV1(input: {
  db: Db;
  siteId: string;
}): Promise<void> {
  const rows = await input.db.execute(sql`
    select 1 from public.np_agent_usage_reservations u
    left join public.np_agent_provider_calls c on c.site_id=u.site_id and c.usage_reservation_id=u.id
    where u.site_id=${input.siteId} and (u.unpriced=true or
      (u.state='reserved' and (c.id is null or c.state='ambiguous'))) limit 1
  `);
  if (rows.rows.length)
    throw new NpAgentGatewayError(
      "RUNTIME_USAGE_UNKNOWN",
      409,
      "Agent runtime usage is unresolved.",
    );
}

/** Caller owns the existing site quota transaction lock. No row or provider state is changed. */
export async function npMeasureAgentRuntimeBudgetV1(input: {
  db: Db;
  siteId: string;
  agentId?: string;
  now: Date;
}): Promise<NpAgentBudgetCountersV1> {
  if (
    !npIsCanonicalSiteId(input.siteId) ||
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime())
  )
    unavailable();
  if (input.agentId !== undefined) canonicalBodyUuid(input.agentId, "agent.runtime.budget.agentId");
  const { db, siteId, agentId } = input;
  const windows = npAgentBudgetWindowsV1(input.now.toISOString());
  const day = windows.utcDay,
    month = `${windows.utcMonth}-01`;
  const hour = new Date(windows.rollingHourStartedAt);
  const monthStart = new Date(`${month}T00:00:00.000Z`);
  // The rolling hour may start in the prior UTC month. Pending reservations
  // remain charged regardless of their original day/month until finalized.
  const retainedSince = new Date(Math.min(monthStart.getTime(), hour.getTime()));
  const selectedRun = agentId ? sql`r.agent_id=${agentId}` : sql`true`;
  const selectedReservation = agentId ? sql`u.agent_id=${agentId}` : sql`true`;
  const selectedDaily = agentId ? sql`d.agent_id=${agentId}` : sql`true`;
  try {
    // A finalized detail can expire before a daily budget bucket. A retained detail may
    // never be missing from that bucket or exceed any of its source-specific counters.
    const missing = await db.execute(sql`
      with retained as (
        select u.site_id,u.agent_id,u.connection_id,(u.reserved_at at time zone 'UTC')::date as usage_date,
          sum(u.reserved_calls) as calls,
          sum(case when u.actual_usage_source='provider' then u.actual_input_tokens else 0 end) as reported_input,
          sum(case when u.actual_usage_source='provider' then u.actual_cached_input_tokens else 0 end) as reported_cached,
          sum(case when u.actual_usage_source='provider' then u.actual_output_tokens else 0 end) as reported_output,
          sum(case when u.actual_usage_source='adapter-estimate' then u.actual_input_tokens else 0 end) as estimated_input,
          sum(case when u.actual_usage_source='adapter-estimate' then u.actual_cached_input_tokens else 0 end) as estimated_cached,
          sum(case when u.actual_usage_source='adapter-estimate' then u.actual_output_tokens else 0 end) as estimated_output,
          sum(case when u.actual_cost_source='provider' then u.actual_cost_micros else 0 end) as reported_cost,
          sum(case when u.actual_cost_source='adapter-estimate' then u.actual_cost_micros else 0 end) as estimated_cost,
          sum(u.budget_charge_cost_micros) as charge,
          sum(case when u.unpriced then u.reserved_calls else 0 end) as unknown_calls
        from public.np_agent_usage_reservations u
        where u.site_id=${siteId} and ${selectedReservation} and u.state in ('reconciled','expired')
          and u.reserved_at>=${monthStart}
        group by u.site_id,u.agent_id,u.connection_id,(u.reserved_at at time zone 'UTC')::date
      )
      select 1 from retained r left join public.np_agent_usage_daily d using(site_id,agent_id,connection_id,usage_date)
      where d.id is null or d.provider_calls<r.calls or d.reported_input_tokens<r.reported_input
        or d.reported_cached_input_tokens<r.reported_cached or d.reported_output_tokens<r.reported_output
        or d.estimated_input_tokens<r.estimated_input or d.estimated_cached_input_tokens<r.estimated_cached
        or d.estimated_output_tokens<r.estimated_output or d.reported_cost_micros<r.reported_cost
        or d.estimated_cost_micros<r.estimated_cost or d.budget_charge_cost_micros<r.charge
        or d.unknown_calls<r.unknown_calls limit 1
    `);
    if (missing.rows.length) unavailable();
    const measured = await db.execute<Record<string, string>>(sql`
      with runs as (
        select count(*) filter (where r.state in ('queued','running','waiting_approval','waiting_retry','verifying')) as concurrent_runs,
          count(*) filter (where r.queued_at>=${hour} and r.queued_at<=${input.now}) as hourly_runs
        from public.np_agent_runs r where r.site_id=${siteId} and r.origin='runtime' and ${selectedRun}
          and (r.state in ('queued','running','waiting_approval','waiting_retry','verifying') or r.queued_at>=${hour})
      ), reservations as (
        select coalesce(sum(u.reserved_calls) filter (where u.state='reserved'),0) as concurrent_calls,
          coalesce(sum(u.reserved_calls) filter (where u.state<>'released' and u.reserved_at>=${hour} and u.reserved_at<=${input.now}),0) as hourly_calls,
          coalesce(sum(u.reserved_input_tokens) filter (where u.state='reserved' or (u.state='expired' and (u.reserved_at at time zone 'UTC')::date=${day}::date)),0) as daily_pending_input,
          coalesce(sum(u.reserved_output_tokens) filter (where u.state='reserved' or (u.state='expired' and (u.reserved_at at time zone 'UTC')::date=${day}::date)),0) as daily_pending_output,
          coalesce(sum(u.reserved_input_tokens) filter (where u.state='reserved' or (u.state='expired' and (u.reserved_at at time zone 'UTC')::date>=${month}::date)),0) as monthly_pending_input,
          coalesce(sum(u.reserved_output_tokens) filter (where u.state='reserved' or (u.state='expired' and (u.reserved_at at time zone 'UTC')::date>=${month}::date)),0) as monthly_pending_output,
          coalesce(sum(u.reserved_cost_micros) filter (where u.state='reserved'),0) as pending_cost
        from public.np_agent_usage_reservations u where u.site_id=${siteId} and ${selectedReservation}
          and (u.state='reserved' or u.reserved_at>=${retainedSince})
      ), daily as (
        select coalesce(sum(d.reported_input_tokens::bigint+d.estimated_input_tokens) filter (where d.usage_date=${day}::date),0) as daily_input,
          coalesce(sum(d.reported_output_tokens::bigint+d.estimated_output_tokens) filter (where d.usage_date=${day}::date),0) as daily_output,
          coalesce(sum(d.budget_charge_cost_micros) filter (where d.usage_date=${day}::date),0) as daily_cost,
          coalesce(sum(d.reported_input_tokens::bigint+d.estimated_input_tokens),0) as monthly_input,
          coalesce(sum(d.reported_output_tokens::bigint+d.estimated_output_tokens),0) as monthly_output,
          coalesce(sum(d.budget_charge_cost_micros),0) as monthly_cost
        from public.np_agent_usage_daily d where d.site_id=${siteId} and ${selectedDaily}
          and d.usage_date>=${month}::date and d.usage_date<=${day}::date
      ), direct_actions as (
        select count(*) as total from public.np_agent_actions a join public.np_agent_runs r on r.site_id=a.site_id and r.id=a.run_id
        where a.site_id=${siteId} and r.origin='runtime' and ${selectedRun} and a.effect_profile_id<>'domain.read'
          and a.state in ('executing','succeeded','failed','compensated') and coalesce(a.started_at,a.created_at)>=${hour}
      )
      select concurrent_runs::text, hourly_runs::text, concurrent_calls::text, hourly_calls::text,
        (daily_input+daily_pending_input)::text as daily_input,
        (daily_output+daily_pending_output)::text as daily_output,
        (monthly_input+monthly_pending_input)::text as monthly_input,
        (monthly_output+monthly_pending_output)::text as monthly_output,
        (daily_cost+pending_cost)::text as daily_cost, (monthly_cost+pending_cost)::text as monthly_cost,
        total::text as direct_actions from runs,reservations,daily,direct_actions
    `);
    const row = measured.rows[0];
    if (!row || measured.rows.length !== 1) unavailable();
    const directActions = counter(row.direct_actions);
    return {
      concurrentRuns: counter(row.concurrent_runs),
      runsRollingHour: counter(row.hourly_runs),
      concurrentProviderCalls: counter(row.concurrent_calls),
      providerCallsRollingHour: counter(row.hourly_calls),
      inputTokensUtcDay: counter(row.daily_input),
      outputTokensUtcDay: counter(row.daily_output),
      inputTokensUtcMonth: counter(row.monthly_input),
      outputTokensUtcMonth: counter(row.monthly_output),
      costMicrosUtcDay: counter(row.daily_cost, Number.MAX_SAFE_INTEGER),
      costMicrosUtcMonth: counter(row.monthly_cost, Number.MAX_SAFE_INTEGER),
      // These target-specific dimensions are non-applicable to the foundation
      // root admission. Their zero is never permission for incident/subject work:
      // that admission remains unavailable until it owns concrete target evidence.
      incidentAnalysesFingerprintUtcDay: 0,
      directActionsRollingHour: directActions,
      directActionsSubjectRollingHour: 0,
    };
  } catch {
    return unavailable();
  }
}

/** Both site and Agent ceilings use this same measured-capacity comparison. */
export function npRequireAgentRuntimeBudgetCapacityV1(input: {
  budget: NpAgentConcreteBudgetV1;
  counters: NpAgentBudgetCountersV1;
  reservation: NpAgentBudgetSnapshotReservationV1;
}): void {
  const { budget: b, counters: c, reservation: r } = input;
  const checks: [number, number, number][] = [
    [c.concurrentRuns, r.runs, b.maxConcurrentRuns],
    [c.runsRollingHour, r.runs, b.runsPerHour],
    [c.concurrentProviderCalls, r.providerCalls, b.maxConcurrentProviderCalls],
    [c.providerCallsRollingHour, r.providerCalls, b.providerCallsPerHour],
    [c.inputTokensUtcDay, r.inputTokens, b.inputTokensPerDay],
    [c.outputTokensUtcDay, r.outputTokens, b.outputTokensPerDay],
    [c.inputTokensUtcMonth, r.inputTokens, b.inputTokensPerMonth],
    [c.outputTokensUtcMonth, r.outputTokens, b.outputTokensPerMonth],
    [c.costMicrosUtcDay, r.costMicros, b.costMicrosPerDay],
    [c.costMicrosUtcMonth, r.costMicros, b.costMicrosPerMonth],
  ];
  for (const [current, additional, maximum] of checks) {
    if (![current, additional, maximum].every((value) => Number.isSafeInteger(value) && value >= 0))
      unavailable();
    if (BigInt(current) + BigInt(additional) > BigInt(maximum))
      throw new NpAgentGatewayError(
        "RUNTIME_BUDGET_BLOCKED",
        409,
        "Agent runtime budget is exhausted.",
      );
  }
}
