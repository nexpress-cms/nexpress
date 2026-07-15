import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npMembers } from "../db/schema/community.js";
import {
  npRequireCommunityId,
  npRequireReputationDelta,
  npRequireReputationEvent,
} from "../community-contract/contract.js";
import { getLogger } from "../observability/logger.js";

import { getReputationAdapter, type NpReputationEvent } from "./reputation-adapter.js";
import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

/**
 * Calls the registered reputation adapter for `event`, then applies
 * the returned delta to the affected member's reputation atomically:
 *
 *     UPDATE np_members SET reputation = reputation + $delta
 *     WHERE id = $memberId
 *
 * Failure modes are intentionally fail-soft — a buggy adapter that
 * throws, returns a non-finite value, or hits a transient DB error
 * MUST NOT block the underlying community write (comment insert,
 * reaction toggle, etc.). The caller's transactional state is not
 * touched; we just log + skip.
 */
export async function applyReputation(memberId: string, event: NpReputationEvent): Promise<void> {
  let delta: number;
  let checkedEvent: NpReputationEvent;
  let checkedMemberId: string;
  try {
    checkedMemberId = npRequireCommunityId(memberId, "community.reputation.memberId");
    checkedEvent = npRequireReputationEvent(event);
    const eventMemberId =
      checkedEvent.kind === "reaction.received" || checkedEvent.kind === "reaction.removed"
        ? checkedEvent.recipientId
        : checkedEvent.memberId;
    if (eventMemberId !== checkedMemberId) {
      throw new Error("Reputation event recipient does not match the updated member");
    }
    delta = npRequireReputationDelta(await getReputationAdapter().apply(checkedEvent));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    npRecordCommunityRuntimeDiagnostic("reputation", message);
    getLogger().warn("reputation adapter contract failed — skipping update", {
      error: message,
      kind: event.kind,
      memberId,
    });
    return;
  }
  if (delta === 0) return;

  const db = getDb();
  try {
    await db
      .update(npMembers)
      .set({
        reputation: sql`${npMembers.reputation} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(npMembers.id, checkedMemberId));
  } catch (err) {
    getLogger().warn("reputation update failed — skipping", {
      error: err instanceof Error ? err.message : String(err),
      kind: checkedEvent.kind,
      memberId,
      delta,
    });
  }
}
