import { sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  NP_AGENT_RUNTIME_OUTCOME_STATES,
  npRequireAgentRuntimeOutcomeV1,
  type NpAgentRuntimeOutcomeV1,
} from "../agent-contract/runtime-outcome-contract.js";

/** Uses a host root handle (including Doctor's Client), never a parent transaction. */
export async function npCollectAgentRuntimeOutcomeV1(
  options: { db?: ReturnType<typeof getDb> } = {},
): Promise<NpAgentRuntimeOutcomeV1> {
  const at = new Date();
  const unknown: NpAgentRuntimeOutcomeV1 = {
    schemaVersion: "np.agent-runtime-outcome.v1",
    source: "runtime-records",
    generatedAt: at.toISOString(),
    windowStart: new Date(at.getTime() - 86_400_000).toISOString(),
    state: "unavailable",
    outcomes: NP_AGENT_RUNTIME_OUTCOME_STATES.map((state) => ({
      state,
      count: null,
      lastFinishedAt: null,
    })),
    active: {
      unfinished: null,
      deadlineElapsed: null,
      executing: null,
      leaseElapsed: null,
      leaseMissing: null,
    },
  };
  try {
    return await (options.db ?? getDb()).transaction(
      async (tx) => {
        const settings =
          await tx.execute(sql`select current_setting('statement_timeout') as original,
        extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`);
        const original = settings.rows[0]?.original,
          milliseconds = Number(settings.rows[0]?.milliseconds);
        if (typeof original !== "string" || !Number.isFinite(milliseconds) || milliseconds < 0)
          throw new Error("Invalid query budget");
        await tx.execute(
          sql`select set_config('statement_timeout', ${`${Math.min(500, milliseconds || 500)}ms`}, true)`,
        );
        const storage = await tx.execute(
          sql`select to_regclass('np_agent_runs')::text as relation`,
        );
        if (storage.rows[0]?.relation === null) {
          await tx.execute(sql`select set_config('statement_timeout', ${original}, true)`);
          return npRequireAgentRuntimeOutcomeV1({ ...unknown, state: "unsupported" });
        }
        // One statement and one millisecond clock define all counts and both window bounds.
        // Only lifecycle fields are read: no identities, payloads, results or errors.
        const facts = await tx.execute(sql`
        with clock as (select date_trunc('milliseconds', statement_timestamp()) as at),
        retained as (select true as present, state, queued_at, started_at, finished_at, deadline_at, lease_until
          from np_agent_runs where origin='runtime'),
        observation as (select at,
          count(*) filter (where present and finished_at is null) as unfinished,
          count(*) filter (where finished_at is null and deadline_at<=at) as deadline_elapsed,
          count(*) filter (where state in ('running','verifying')) as executing,
          count(*) filter (where state in ('running','verifying') and lease_until<=at) as lease_elapsed,
          count(*) filter (where state in ('running','verifying') and lease_until is null) as lease_missing,
          count(*) filter (where present and (state is null or
            state not in ('queued','running','waiting_approval','waiting_retry','verifying','succeeded','failed','cancelled','policy_blocked','budget_blocked') or
            queued_at is null or not isfinite(queued_at) or queued_at>at or
            deadline_at is null or not isfinite(deadline_at) or deadline_at<=queued_at or deadline_at>queued_at+interval '24 hours' or
            (started_at is not null and (not isfinite(started_at) or started_at<queued_at or started_at>at)) or
            (finished_at is not null and (not isfinite(finished_at) or finished_at<queued_at or finished_at>at or finished_at<started_at)) or
            ((state in ('succeeded','failed','cancelled','policy_blocked','budget_blocked'))<>(finished_at is not null)) or
            (state in ('running','verifying') and started_at is null) or
            (lease_until is not null and (not isfinite(lease_until) or started_at is null or lease_until<started_at or lease_until>deadline_at or state not in ('running','verifying')))
          )) as invalid
          from clock left join retained on true group by at),
        outcomes as (select state, count(*) as count, max(finished_at) as last_finished_at
          from retained cross join clock where finished_at between at-interval '24 hours' and at group by state)
        select observation.*, outcomes.state, outcomes.count, outcomes.last_finished_at
          from observation left join outcomes on true`);
        const row = facts.rows[0];
        if (!row || Number(row.invalid) !== 0) throw new Error("Invalid Runtime chronology");
        const iso = (v: unknown): string => {
          if (!(v instanceof Date) && typeof v !== "string")
            throw new Error("Invalid observation clock");
          return new Date(v).toISOString();
        };
        const generatedAt = iso(row.at);
        const byState = new Map(facts.rows.map((fact) => [fact.state, fact]));
        const result = npRequireAgentRuntimeOutcomeV1({
          ...unknown,
          generatedAt,
          windowStart: new Date(Date.parse(generatedAt) - 86_400_000).toISOString(),
          state: "observed",
          outcomes: NP_AGENT_RUNTIME_OUTCOME_STATES.map((state) => {
            const outcome = byState.get(state);
            return {
              state,
              count: outcome ? Number(outcome.count) : 0,
              lastFinishedAt: outcome ? iso(outcome.last_finished_at) : null,
            };
          }),
          active: {
            unfinished: Number(row.unfinished),
            deadlineElapsed: Number(row.deadline_elapsed),
            executing: Number(row.executing),
            leaseElapsed: Number(row.lease_elapsed),
            leaseMissing: Number(row.lease_missing),
          },
        });
        await tx.execute(sql`select set_config('statement_timeout', ${original}, true)`);
        return result;
      },
      { accessMode: "read only" },
    );
  } catch {
    return npRequireAgentRuntimeOutcomeV1(unknown);
  }
}
