/**
 * Pluggable profanity adapter. Sister to `spam-adapter.ts`, but
 * semantically scoped to *language* rather than *intent*: profanity
 * adapters score the words in a piece of content, spam adapters score
 * the likelihood that the post is unwanted commercial / abusive.
 *
 * Many sites want both: an off-the-shelf regex list to scrub slurs
 * plus an ML / Akismet-style classifier for spam. Rather than force
 * those to compose behind a single `setSpamAdapter` call, the
 * framework holds two slots and runs profanity FIRST, then spam.
 * Verdicts combine with the strongest-wins rule:
 *
 *   - any `reject` → write is refused with that adapter's reason
 *   - any `flag`   → write proceeds as `pending` with both adapters'
 *                    metadata aggregated for the audit row
 *   - both `pass`  → normal write
 *
 * The default adapter is "no-op pass" — every write proceeds as
 * before. Sites that want profanity protection install one
 * explicitly, typically from a plugin's `setup()`.
 */
import type {
  NpProfanityAdapter,
  NpProfanityCheckContext,
  NpProfanityVerdict,
  NpProfanityVerdictKind,
} from "../community-contract/types.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

export type {
  NpProfanityAdapter,
  NpProfanityCheckContext,
  NpProfanityVerdict,
  NpProfanityVerdictKind,
};

const PASS_ADAPTER: NpProfanityAdapter = {
  check: () => ({ kind: "pass" }),
};

let currentAdapter: NpProfanityAdapter = PASS_ADAPTER;

/**
 * Replace the global profanity adapter. Call once at app boot,
 * typically from a plugin's `setup()`. The framework holds at most
 * one adapter; sites that want to layer multiple lists should compose
 * them inside a single adapter (the same convention as the spam
 * adapter).
 */
export function setProfanityAdapter(adapter: NpProfanityAdapter): void {
  if (typeof adapter?.check !== "function") {
    npRecordCommunityRuntimeDiagnostic("profanity", "adapter must implement check()");
    throw new Error("setProfanityAdapter: adapter must implement check()");
  }
  currentAdapter = adapter;
}

export function getProfanityAdapter(): NpProfanityAdapter {
  return currentAdapter;
}

/** Reset to the default no-op adapter. Tests use this between cases. */
export function resetProfanityAdapter(): void {
  currentAdapter = PASS_ADAPTER;
}
