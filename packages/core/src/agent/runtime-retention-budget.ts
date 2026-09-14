import { sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { NpAgentGatewayError } from "./admin-admission.js";

/** A maintenance-only wall-time budget; never change the shared pool's settings. */
export async function npWithAgentRuntimeRetentionBudgetV1<T>(
  operation: (db: ReturnType<typeof getDb>, beforeStatement: () => Promise<void>) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    const timeout = await tx.execute(sql`select
      current_setting('statement_timeout') as original,
      extract(epoch from current_setting('statement_timeout')::interval)*1000 as milliseconds`);
    const original = timeout.rows[0]?.original;
    const milliseconds = Number(timeout.rows[0]?.milliseconds);
    if (typeof original !== "string" || !Number.isFinite(milliseconds) || milliseconds < 0)
      throw new NpAgentGatewayError(
        "RUNTIME_MAINTENANCE_INVALID",
        409,
        "Agent maintenance is unavailable.",
      );
    const deadline = performance.now() + Math.min(5000, milliseconds || 5000);
    const beforeStatement = async () => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0)
        throw new NpAgentGatewayError(
          "RUNTIME_MAINTENANCE_TIMEOUT",
          503,
          "Agent maintenance is unavailable.",
        );
      await tx.execute(sql`select set_config('statement_timeout',${`${remaining}ms`},true)`);
    };
    await beforeStatement();
    const result = await operation(tx, beforeStatement);
    // A sequence of cheap reads/hashes may exhaust the total budget without
    // any individual statement timing out. Such a sweep also rolls back.
    await beforeStatement();
    await tx.execute(sql`select set_config('statement_timeout',${original},true)`);
    return result;
  });
}
