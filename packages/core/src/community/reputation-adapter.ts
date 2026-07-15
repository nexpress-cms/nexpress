/**
 * Pluggable reputation-rules hook. Sites install an adapter via
 * `setReputationAdapter()` to compute reputation deltas in response
 * to community events; the framework then atomically applies the
 * delta to `np_members.reputation`.
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
import type { NpReputationAdapter, NpReputationEvent } from "../community-contract/types.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

export type { NpReputationAdapter, NpReputationEvent };

const NOOP_ADAPTER: NpReputationAdapter = { apply: () => 0 };
let currentAdapter: NpReputationAdapter = NOOP_ADAPTER;

export function setReputationAdapter(adapter: NpReputationAdapter): void {
  if (typeof adapter?.apply !== "function") {
    npRecordCommunityRuntimeDiagnostic("reputation", "adapter must implement apply()");
    throw new Error("setReputationAdapter: adapter must implement apply()");
  }
  currentAdapter = adapter;
}

export function getReputationAdapter(): NpReputationAdapter {
  return currentAdapter;
}

/** Reset to the no-op adapter. Tests use this between cases. */
export function resetReputationAdapter(): void {
  currentAdapter = NOOP_ADAPTER;
}
