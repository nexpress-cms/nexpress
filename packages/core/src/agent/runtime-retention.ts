import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { NpAgentContractError } from "../agent-contract/contract.js";
import { npAgentRuns } from "../db/schema/agent.js";
import type { NpAgentRuntimeSettingsV1 } from "../agent-contract/runtime-contract.js";
import { npRequireAgentRuntimeExecutionIntegrityV1 } from "./runtime-execution-store.js";
import { npRuntimeRunAdmissionBodyV1 } from "./runtime-admission.js";
import {
  npRequireAgentRuntimeVersionV1,
  npResolveAgentRuntimePolicyV1,
} from "./runtime-service.js";
import type { getDb } from "../db/runtime.js";
import { npAgentSiteOwnedTableNamesV1 } from "./site-deletion.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Db = ReturnType<typeof getDb>;
type Category = "events" | "diagnostics" | "calls" | "reservations" | "runs" | "breakers" | "daily";
interface CandidateSource {
  category: Category;
  table: string;
  eligible: SQL;
}

/** Retained logical references are evidence even when there is no lifecycle FK. */
function unreferenced(table: string, hasJobs: boolean): SQL {
  const checks = npAgentSiteOwnedTableNamesV1.map(
    (name) => sql`not exists (select 1 from ${sql.identifier(name)} dependency
      where dependency.site_id=t.site_id
      ${name === table ? sql`and dependency.id<>t.id` : sql``}
      and position(t.id::text in to_jsonb(dependency)::text)>0)`,
  );
  // Normal audit is immutable. Only its owning verified-reference lifecycle
  // can release a source; nominal history age is not such a release.
  checks.push(sql`not exists (select 1 from np_audit_events dependency
    where (dependency.site_id=t.site_id or dependency.site_id is null)
    and position(t.id::text in to_jsonb(dependency)::text)>0)`);
  if (hasJobs)
    checks.push(sql`not exists (select 1 from pgboss.job dependency
    where dependency.state::text in ('created','retry','active')
    and (dependency.data->>'siteId'=t.site_id or dependency.data->>'siteId' is null)
    and position(t.id::text in dependency.data::text)>0)`);
  return sql.join(checks, sql` and `);
}

/** Invoked only inside the existing site control transaction. */
export async function npPruneAgentRuntimeRetentionV1(options: {
  db: Db;
  siteId: string;
  cursor: string | null;
  limit: number;
  now: Date;
  settings: NpAgentRuntimeSettingsV1;
  revision: number;
  beforeStatement: () => Promise<void>;
}): Promise<{ examined: number; pruned: number; nextCursor: string | null }> {
  const { db, siteId, cursor, limit, now, beforeStatement } = options;
  const minimumDetailBefore = new Date(now.getTime() - 86_400_000);
  const detailBefore = new Date(now.getTime() - 90 * 86_400_000);
  const diagnosticBefore = new Date(now.getTime() - 30 * 86_400_000);
  const aggregateBefore = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
  const terminalRun = sql`exists (select 1 from np_agent_runs parent
    where parent.site_id=t.site_id and parent.id=t.run_id and parent.origin='runtime'
    and parent.state in ('succeeded','failed','cancelled','policy_blocked','budget_blocked')
    and parent.finished_at<=${detailBefore} and parent.lease_until is null
    and parent.runtime_retry_at is null)`;
  const sources: CandidateSource[] = [
    {
      category: "events",
      table: "np_agent_events",
      eligible: sql`t.dispatched_at is not null and t.expires_at<=${now}`,
    },
    {
      category: "diagnostics",
      table: "np_agent_provider_calls",
      eligible: sql`(t.request_redacted is not null or t.response_redacted is not null)
        and t.diagnostic_expires_at is not null
        and (t.diagnostic_expires_at<=${now} or t.created_at<=${diagnosticBefore})`,
    },
    {
      category: "calls",
      table: "np_agent_provider_calls",
      eligible: sql`t.state in ('succeeded','failed','cancelled')
        and t.dispatch_state in ('dispatched','not-dispatched')
        and t.usage_source is distinct from 'unknown' and t.cost_source is distinct from 'unknown'
        and t.finished_at<=${detailBefore} and ${terminalRun}
        and exists (select 1 from np_agent_usage_reservations reservation
          where reservation.site_id=t.site_id and reservation.id=t.usage_reservation_id
          and reservation.state in ('reconciled','released') and not reservation.unpriced
          and reservation.finalized_at<=${detailBefore}
          and reservation.actual_usage_source is distinct from 'unknown'
          and reservation.actual_cost_source is distinct from 'unknown')`,
    },
    {
      category: "reservations",
      table: "np_agent_usage_reservations",
      eligible: sql`t.state in ('reconciled','released') and not t.unpriced
        and t.actual_usage_source is distinct from 'unknown'
        and t.actual_cost_source is distinct from 'unknown'
        and t.finalized_at<=${detailBefore} and ${terminalRun}`,
    },
    {
      category: "runs",
      table: "np_agent_runs",
      eligible: sql`t.origin='runtime'
        and t.state in ('succeeded','failed','cancelled','policy_blocked','budget_blocked')
        and t.finished_at<=${minimumDetailBefore} and t.lease_until is null and t.runtime_retry_at is null`,
    },
    {
      category: "breakers",
      table: "np_agent_circuit_breakers",
      eligible: sql`t.state='closed' and t.failure_count=0 and t.probe_lease_until is null
        and t.updated_at<=${detailBefore}`,
    },
    {
      category: "daily",
      table: "np_agent_usage_daily",
      // Compare against the next UTC midnight: retain the entire final day.
      eligible: sql`t.usage_date<${aggregateBefore}::date and t.unknown_calls=0
        and not exists (select 1 from np_agent_usage_reservations reservation
          where reservation.site_id=t.site_id and reservation.agent_id=t.agent_id
          and reservation.connection_id=t.connection_id
          and (reservation.reserved_at at time zone 'UTC')::date=t.usage_date)`,
    },
  ];
  await beforeStatement();
  const candidates = await db.execute(
    sql`select distinct id from (${sql.join(
      sources.map(
        (source) => sql`(select t.id from ${sql.identifier(source.table)} t
        where t.site_id=${siteId} and ${source.eligible}
        ${cursor === null ? sql`` : sql`and t.id>${cursor}::uuid`}
        order by t.id limit ${limit})`,
      ),
      sql` union all `,
    )}) candidates order by id limit ${limit}`,
  );
  const ids = candidates.rows.map((row) => {
    if (
      typeof row.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(row.id)
    )
      throw new NpAgentGatewayError(
        "RUNTIME_MAINTENANCE_INVALID",
        409,
        "Agent maintenance is unavailable.",
      );
    return row.id;
  });
  let pruned = 0;
  if (ids.length) {
    await beforeStatement();
    const jobTable = await db.execute(sql`select to_regclass('pgboss.job') is not null as present`);
    const hasJobs = jobTable.rows[0]?.present === true;
    for (const source of sources) {
      let eligibleIds = ids;
      if (source.category === "runs") {
        await beforeStatement();
        const runs = await db
          .select()
          .from(npAgentRuns)
          .where(and(eq(npAgentRuns.siteId, siteId), inArray(npAgentRuns.id, ids)));
        eligibleIds = [];
        for (const run of runs) {
          try {
            await npRequireAgentRuntimeExecutionIntegrityV1(run);
            const admission = npRuntimeRunAdmissionBodyV1(run);
            const sources = run.runtimeAdmissionSources;
            if (!run.agentId || !run.agentVersionId || !sources || !run.finishedAt) continue;
            await beforeStatement();
            const evidence = await npRequireAgentRuntimeVersionV1({
              db,
              siteId,
              agentId: run.agentId,
              versionId: run.agentVersionId,
              active: false,
            });
            await beforeStatement();
            const policy = await npResolveAgentRuntimePolicyV1({
              db,
              siteId,
              evidence,
              settings: options.settings,
              settingsRevision: options.revision,
              frameworkPolicy: {
                version: sources.frameworkPolicyVersion,
                rules: sources.frameworkPolicy.rules,
              },
              frozenRefs: admission.policyRefs,
              frozenSources: sources,
            });
            if (
              run.finishedAt.getTime() + policy.effective.retentionDays.runDetails * 86_400_000 <=
              now.getTime()
            )
              eligibleIds.push(run.id);
          } catch (error) {
            // Invalid retained policy/canonical evidence remains for Doctor;
            // a protected identity must not pin the cursor forever.
            if (
              error instanceof NpAgentGatewayError &&
              error.code === "RUNTIME_MAINTENANCE_TIMEOUT"
            )
              throw error;
            if (!(error instanceof NpAgentGatewayError) && !(error instanceof NpAgentContractError))
              throw error;
          }
        }
      }
      if (!eligibleIds.length) continue;
      const selected = sql.join(
        eligibleIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      await beforeStatement();
      const result = await db.execute(
        source.category === "diagnostics"
          ? sql`update np_agent_provider_calls t
              set request_redacted=null, response_redacted=null
              where t.site_id=${siteId} and t.id in (${selected}) and ${source.eligible}
              returning t.id`
          : sql`delete from ${sql.identifier(source.table)} t
              where t.site_id=${siteId} and t.id in (${selected}) and ${source.eligible}
              and ${unreferenced(source.table, hasJobs)} returning t.id`,
      );
      pruned += result.rows.length;
    }
  }
  return {
    examined: ids.length,
    pruned,
    nextCursor: ids.length === limit ? ids.at(-1)! : null,
  };
}
