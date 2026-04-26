/**
 * Pluggable reputation-rules hook. Sites install an adapter via
 * `setReputationAdapter()` to compute reputation deltas in response
 * to community events; the framework then atomically applies the
 * delta to `nx_members.reputation`.
 *
 * Default adapter is "no-op" (every event returns 0) — existing
 * sites' reputation values stay at zero until they opt in.
 *
 * Adapter is single-method by design: a tagged-union `event` is the
 * only argument, the return value is a signed integer delta. This
 * keeps the API surface small while letting sites encode arbitrary
 * weighting (e.g. "+5 for a like on a comment, −10 for a moderator
 * hide, −0 if the reactor is a brand-new account, etc.").
 *
 * Adapters can be sync or async — the framework awaits the result.
 * Throwing aborts only the reputation update, not the underlying
 * community write (fail-soft via observability hook, same pattern
 * as the spam adapter).
 */
export type NxReputationEvent =
  /** A new visible comment was inserted. Flagged / hidden / deleted
   *  comments do NOT emit this event. */
  | {
      kind: "comment.created";
      commentId: string;
      memberId: string;
      targetType: string;
      targetId: string;
    }
  /** Mod (or member with the right grant) hid a comment. Adapters
   *  typically penalize the author. */
  | {
      kind: "comment.hidden";
      commentId: string;
      memberId: string;
      byStaff: boolean;
      reason?: string | null;
    }
  /** Mod-side hard delete (`staffDeleteComment`). The body is wiped;
   *  this is harsher than `hidden` and adapters usually penalize
   *  more. */
  | {
      kind: "comment.deleted";
      commentId: string;
      memberId: string;
      byStaff: boolean;
    }
  /** Someone reacted to the recipient's content (comment / thread /
   *  reply). `recipientId` is the content author; `reactorId` is the
   *  member who clicked the reaction. Self-reactions are filtered
   *  before the event fires. */
  | {
      kind: "reaction.received";
      reactionKind: string;
      recipientId: string;
      reactorId: string;
      targetType: string;
      targetId: string;
    }
  /** Reactor undid their reaction. Symmetric to `reaction.received`;
   *  adapters typically return the negative of the corresponding
   *  positive delta. */
  | {
      kind: "reaction.removed";
      reactionKind: string;
      recipientId: string;
      reactorId: string;
      targetType: string;
      targetId: string;
    };

export interface NxReputationAdapter {
  /** Returns the integer delta to apply to the affected member's
   *  reputation. Sign matters: positive credits, negative debits.
   *  Non-integer values are truncated; non-finite (NaN/Infinity)
   *  values are skipped. Returning 0 is the no-op path. */
  apply(event: NxReputationEvent): number | Promise<number>;
}

const NOOP_ADAPTER: NxReputationAdapter = { apply: () => 0 };
let currentAdapter: NxReputationAdapter = NOOP_ADAPTER;

export function setReputationAdapter(adapter: NxReputationAdapter): void {
  if (typeof adapter?.apply !== "function") {
    throw new Error("setReputationAdapter: adapter must implement apply()");
  }
  currentAdapter = adapter;
}

export function getReputationAdapter(): NxReputationAdapter {
  return currentAdapter;
}

/** Reset to the no-op adapter. Tests use this between cases. */
export function resetReputationAdapter(): void {
  currentAdapter = NOOP_ADAPTER;
}
