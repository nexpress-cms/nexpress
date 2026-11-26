import { sql, type SQL } from "drizzle-orm";
import { npIsCanonicalSiteId } from "./id-contract.js";

/** Private expression shared by ordinary and bounded quota admission. */
export function npSiteQuotaLockExpressionV1(siteId: string): SQL {
  if (!npIsCanonicalSiteId(siteId))
    throw new Error("Site quota lock requires a canonical site id.");
  return sql`pg_advisory_xact_lock(hashtextextended(${`np:site-quota:${siteId}`}, 0))`;
}

/** The sole wait in this statement is the quota lock. PostgreSQL reads the
 * newly installed lock_timeout when that wait begins. statement_timeout applies
 * to following statements; its current-statement timer is not restarted here.
 * Keep all site/settings reads in a later statement for a fresh post-lock snapshot. */
export async function npLockSiteQuotasWithBudgetV1(
  db: { execute(query: SQL): Promise<unknown> },
  siteId: string,
  budget: { lockMs: number; statementMs: number },
): Promise<void> {
  const expression = npSiteQuotaLockExpressionV1(siteId);
  for (const value of [budget.lockMs, budget.statementMs])
    if (!Number.isInteger(value) || value < 1 || value > 5000)
      throw new Error("Site quota budget requires bounded positive milliseconds.");
  await db.execute(sql`with budget as materialized (
    select set_config('lock_timeout',${`${budget.lockMs}ms`},true),
      set_config('statement_timeout',${`${budget.statementMs}ms`},true)
  ) select ${expression} from budget`);
}
