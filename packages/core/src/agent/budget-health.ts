import { asc, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npSites } from "../db/schema/system.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import {
  NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT,
  npRequireAgentBudgetHealthV1,
  type NpAgentBudgetHealthV1,
} from "../agent-contract/budget-health-contract.js";
import { npRequireAgentBudgetSnapshotCountersV1 } from "../agent-contract/canonical-budget-snapshot.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import {
  npMeasureAgentRuntimeBudgetV1,
  npRequireAgentRuntimeUsageKnownV1,
} from "./runtime-budget.js";

type Db = ReturnType<typeof getDb>;

/**
 * Aggregate observations only; no provider calls, persistence writes or admission decisions.
 * Supply a root database handle, not an existing transaction: parent transactions
 * retain site locks until their own commit, defeating release between observations.
 */
export async function npCollectAgentBudgetHealthV1(
  options: { db?: Db; now?: Date } = {},
): Promise<NpAgentBudgetHealthV1> {
  const now = options.now ?? new Date();
  const result: NpAgentBudgetHealthV1 = {
    schemaVersion: "np.agent-budget-health.v1",
    generatedAt: now.toISOString(),
    state: "unavailable",
    sampledSites: null,
    hasMore: null,
    measuredSites: null,
    unresolvedUsageSites: null,
    unavailableSites: null,
  };
  // Stop scheduling sites after five seconds. Each statement (including lock waits)
  // is capped at 500ms or the host's stricter timeout; an in-progress site may finish
  // after the scheduling deadline. Locks are released between sites.
  const deadline = performance.now() + 5_000;
  const checkDeadline = () => {
    if (performance.now() >= deadline) throw new Error("Budget observation deadline");
  };
  try {
    const db = options.db ?? getDb();
    const bounded = <T>(operation: (tx: Db) => Promise<T>) =>
      db.transaction(async (tx) => {
        checkDeadline();
        const timeout = await tx.execute(
          sql`select current_setting('statement_timeout') as original, extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`,
        );
        const milliseconds = Number(timeout.rows[0]?.milliseconds);
        if (
          typeof timeout.rows[0]?.original !== "string" ||
          !Number.isFinite(milliseconds) ||
          milliseconds < 0
        )
          throw new Error("Invalid query budget");
        const remaining = Math.floor(deadline - performance.now());
        if (remaining <= 0) throw new Error("Budget observation deadline");
        const cap = Math.min(500, remaining, milliseconds || 500);
        await tx.execute(sql`select set_config('statement_timeout',${`${cap}ms`},true)`);
        const value = await operation(tx);
        await tx.execute(
          sql`select set_config('statement_timeout',${timeout.rows[0].original},true)`,
        );
        return value;
      });
    const sites = await bounded((tx) =>
      tx
        .select({ id: npSites.id })
        .from(npSites)
        .orderBy(asc(npSites.id))
        .limit(NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT + 1),
    );
    if (
      sites.some((site) => !npIsCanonicalSiteId(site.id)) ||
      new Set(sites.map((site) => site.id)).size !== sites.length
    )
      throw new Error("Invalid site sample");
    const sample = sites.slice(0, NP_AGENT_BUDGET_HEALTH_SAMPLE_LIMIT);
    let measuredSites = 0,
      unresolvedUsageSites = 0,
      unavailableSites = 0;
    for (const site of sample) {
      if (performance.now() >= deadline) {
        unavailableSites++;
        continue;
      }
      try {
        await bounded((tx) =>
          npWithAgentRuntimeControlTransactionV1(
            site.id,
            async ({ db: locked }) => {
              checkDeadline();
              await npRequireAgentRuntimeUsageKnownV1({ db: locked, siteId: site.id });
              checkDeadline();
              npRequireAgentBudgetSnapshotCountersV1(
                await npMeasureAgentRuntimeBudgetV1({ db: locked, siteId: site.id, now }),
              );
            },
            tx,
          ),
        );
        measuredSites++;
      } catch (error) {
        if (error instanceof NpAgentGatewayError && error.code === "RUNTIME_USAGE_UNKNOWN")
          unresolvedUsageSites++;
        else unavailableSites++;
      }
    }
    Object.assign(result, {
      state: "observed",
      sampledSites: sample.length,
      hasMore: sites.length > sample.length,
      measuredSites,
      unresolvedUsageSites,
      unavailableSites,
    });
  } catch {
    // A failed sample is unknown, never an observed empty/healthy host.
  }
  return npRequireAgentBudgetHealthV1(result);
}
