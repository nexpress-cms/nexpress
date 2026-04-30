import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getDb } from "../db/runtime.js";
import { nxMembers } from "../db/schema/community.js";
import { getLogger } from "../observability/logger.js";

import {
  getReputationAdapter,
  type NxReputationEvent,
} from "./reputation-adapter.js";

/**
 * Calls the registered reputation adapter for `event`, then applies
 * the returned delta to the affected member's reputation atomically:
 *
 *     UPDATE nx_members SET reputation = reputation + $delta
 *     WHERE id = $memberId
 *
 * Failure modes are intentionally fail-soft — a buggy adapter that
 * throws, returns a non-finite value, or hits a transient DB error
 * MUST NOT block the underlying community write (comment insert,
 * reaction toggle, etc.). The caller's transactional state is not
 * touched; we just log + skip.
 */
export async function applyReputation(
  memberId: string,
  event: NxReputationEvent,
): Promise<void> {
  let delta: number;
  try {
    delta = await getReputationAdapter().apply(event);
  } catch (err) {
    getLogger().warn("reputation adapter threw — skipping update", {
      error: err instanceof Error ? err.message : String(err),
      kind: event.kind,
      memberId,
    });
    return;
  }

  if (!Number.isFinite(delta)) {
    getLogger().warn("reputation adapter returned non-finite delta", {
      kind: event.kind,
      memberId,
      delta,
    });
    return;
  }
  const truncated = Math.trunc(delta);
  if (truncated === 0) return;

  const db = getDb() as unknown as NodePgDatabase<Record<string, unknown>>;
  try {
    await db
      .update(nxMembers)
      .set({
        reputation: sql`${nxMembers.reputation} + ${truncated}`,
        updatedAt: new Date(),
      })
      .where(eq(nxMembers.id, memberId));
  } catch (err) {
    getLogger().warn("reputation update failed — skipping", {
      error: err instanceof Error ? err.message : String(err),
      kind: event.kind,
      memberId,
      delta: truncated,
    });
  }
}
