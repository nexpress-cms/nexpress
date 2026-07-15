/**
 * Pluggable anti-spam adapter. Plugins call `setSpamAdapter(adapter)`
 * at startup; the community write path consults `getSpamAdapter()
 * .check(text, context)` before inserting and acts on the verdict:
 *
 *   - `"pass"`  → write proceeds normally (status = `visible`)
 *   - `"flag"`  → write proceeds but lands as `pending` (visible only
 *                 to mods; appears in the report queue indirectly via
 *                 the moderation surface)
 *   - `"reject"` → write is refused; the caller surfaces a 400
 *                  `NpValidationError`. Adapters may attach a `reason`
 *                  string for the error message.
 *
 * Adapters are intentionally synchronous-friendly (they may also
 * return a Promise). The framework awaits the result so adapters that
 * call out to a network service (Akismet, OpenAI moderation, etc.)
 * work transparently.
 *
 * The default adapter is "no-op pass" — every write proceeds as
 * before. Sites that want spam protection install one explicitly.
 */
import type {
  NpSpamAdapter,
  NpSpamCheckContext,
  NpSpamVerdict,
  NpSpamVerdictKind,
} from "../community-contract/types.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

export type { NpSpamAdapter, NpSpamCheckContext, NpSpamVerdict, NpSpamVerdictKind };

const PASS_ADAPTER: NpSpamAdapter = {
  check: () => ({ kind: "pass" }),
};

let currentAdapter: NpSpamAdapter = PASS_ADAPTER;

/**
 * Replace the global spam adapter. Call once at app boot, typically
 * from a plugin's `setup()`. Multiple plugins competing for this slot
 * should compose their checks behind a single `setSpamAdapter` call —
 * the framework holds at most one adapter to keep the verdict
 * unambiguous.
 */
export function setSpamAdapter(adapter: NpSpamAdapter): void {
  if (typeof adapter?.check !== "function") {
    npRecordCommunityRuntimeDiagnostic("spam", "adapter must implement check()");
    throw new Error("setSpamAdapter: adapter must implement check()");
  }
  currentAdapter = adapter;
}

export function getSpamAdapter(): NpSpamAdapter {
  return currentAdapter;
}

/** Reset to the default no-op adapter. Tests use this between cases. */
export function resetSpamAdapter(): void {
  currentAdapter = PASS_ADAPTER;
}
