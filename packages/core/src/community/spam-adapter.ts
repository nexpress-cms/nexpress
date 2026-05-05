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
export type NpSpamVerdictKind = "pass" | "flag" | "reject";

export interface NpSpamVerdict {
  kind: NpSpamVerdictKind;
  /**
   * Optional human-readable reason. Used as the
   * `NpValidationError` message on `reject`, surfaced to the
   * audit log on `flag`. Don't include PII or provider error text
   * verbatim — operators see this in logs.
   */
  reason?: string;
  /**
   * Free-form metadata the adapter wants to log alongside the
   * verdict (model name, score, classifier id, etc.). Surfaced to
   * the audit log; never echoed to the end user.
   */
  metadata?: Record<string, unknown>;
}

export interface NpSpamCheckContext {
  /** Member id of the author. Adapters may use this to weight by
   *  reputation or recent infraction history. */
  memberId: string;
  /**
   * Collection slug that owns the document the comment is attached
   * to (`"posts"`, `"discussions"`, etc.) — same value as
   * `np_comments.target_type`. The schema is polymorphic over
   * collection, so this is the collection identifier, not a
   * "comment vs thread" classifier.
   */
  targetType: string;
  /** Document id within `targetType` — the post / discussion the
   *  comment is attached to. */
  targetId: string;
  /** Parent comment id when this is a reply, otherwise null. */
  parentId?: string | null;
}

export interface NpSpamAdapter {
  check(text: string, ctx: NpSpamCheckContext): NpSpamVerdict | Promise<NpSpamVerdict>;
}

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
