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
export type NxProfanityVerdictKind = "pass" | "flag" | "reject";

export interface NxProfanityVerdict {
  kind: NxProfanityVerdictKind;
  /**
   * Optional human-readable reason. Used as the
   * `NxValidationError` message on `reject`, surfaced to the
   * audit log on `flag`. Don't include the matched word verbatim
   * if you don't want it echoed to the end user on reject.
   */
  reason?: string;
  /**
   * Free-form metadata the adapter wants to log alongside the
   * verdict (matched categories, severity, locale, etc.). Surfaced
   * to the audit log; never echoed to the end user.
   */
  metadata?: Record<string, unknown>;
}

export interface NxProfanityCheckContext {
  /** Member id of the author. Adapters may use this to weight
   *  by reputation or recent infraction history. */
  memberId: string;
  /**
   * Surface the content lives on. For comments this is the
   * collection slug of the parent doc (`"posts"`, `"discussions"`,
   * etc.); for member-authored docs, this is the same collection
   * slug. Mirrors `NxSpamCheckContext.targetType`.
   */
  targetType: string;
  /** Document id the content belongs to. Empty string for a
   *  pre-insert doc create — adapters that key off the id should
   *  treat empty as "new doc". */
  targetId: string;
  /** Parent comment id when this is a reply, otherwise null /
   *  undefined (for doc creates). */
  parentId?: string | null;
}

export interface NxProfanityAdapter {
  check(
    text: string,
    ctx: NxProfanityCheckContext,
  ): NxProfanityVerdict | Promise<NxProfanityVerdict>;
}

const PASS_ADAPTER: NxProfanityAdapter = {
  check: () => ({ kind: "pass" }),
};

let currentAdapter: NxProfanityAdapter = PASS_ADAPTER;

/**
 * Replace the global profanity adapter. Call once at app boot,
 * typically from a plugin's `setup()`. The framework holds at most
 * one adapter; sites that want to layer multiple lists should compose
 * them inside a single adapter (the same convention as the spam
 * adapter).
 */
export function setProfanityAdapter(adapter: NxProfanityAdapter): void {
  if (typeof adapter?.check !== "function") {
    throw new Error("setProfanityAdapter: adapter must implement check()");
  }
  currentAdapter = adapter;
}

export function getProfanityAdapter(): NxProfanityAdapter {
  return currentAdapter;
}

/** Reset to the default no-op adapter. Tests use this between cases. */
export function resetProfanityAdapter(): void {
  currentAdapter = PASS_ADAPTER;
}
