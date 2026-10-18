import { sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import type { NpAgentDiagnosticsQueryClientV1 } from "./contract-diagnostics.js";
import { npRequireAgentGuardianReceiptCoverageV1 } from "../agent-contract/guardian-delivery-contract.js";

const states = ["pending", "blocked", "held", "sampled"] as const;
const tables = {
  content: "np_agent_content_receipts",
  runtime: "np_agent_runtime_receipts",
} as const;
function coverage(rows: { state: unknown }[]) {
  if (rows.some((row) => !states.some((state) => row.state === state)))
    throw new Error("Invalid Guardian content delivery state");
  const counts = Object.fromEntries(
    states.map((state) => [state, rows.filter((row) => row.state === state).length]),
  );
  return npRequireAgentGuardianReceiptCoverageV1({
    ...Object.fromEntries(states.map((state) => [state, Math.min(counts[state], 25)])),
    truncated: states.some((state) => counts[state] > 25),
  });
}
/** Fixed bounded reads; the caller owns the existing diagnostic transaction and timeout. */
export async function npReadAgentGuardianContentCoverageV1(
  db: ReturnType<typeof getDb>,
  siteId: string,
  source: keyof typeof tables = "content",
) {
  const result = await db.execute<{ state: unknown }>(
    sql.join(
      states.map(
        (state) =>
          sql`(select state from ${sql.identifier(tables[source])} where site_id=${siteId} and state=${state} limit 26)`,
      ),
      sql` union all `,
    ),
  );
  return coverage(result.rows);
}
export async function npCollectAgentGuardianContentCoverageV1(
  client: NpAgentDiagnosticsQueryClientV1,
  source: keyof typeof tables = "content",
) {
  const result = await client.query<{
    state: unknown;
  }>(`/* np.guardian-health.${source}-coverage.v1 */
    (select state from public.${tables[source]} where state='pending' limit 26) union all
    (select state from public.${tables[source]} where state='blocked' limit 26) union all
    (select state from public.${tables[source]} where state='held' limit 26) union all
    (select state from public.${tables[source]} where state='sampled' limit 26)`);
  return coverage(result.rows);
}
