/**
 * Phase 12.8 — locale-to-text-direction lookup.
 *
 * Uses `Intl.Locale.prototype.textInfo` (ECMA-402 stage 3,
 * supported in Node 18+ and every evergreen browser) to
 * resolve a BCP-47 tag to its CLDR-canonical script direction.
 * `ar`, `he`, `fa`, `ur` etc. → `rtl`; everything else → `ltr`.
 *
 * Returning a static `"ltr"` on lookup failure (unknown tag,
 * older runtimes that haven't shipped textInfo) keeps the
 * call-side tolerant — a misconfigured locale shouldn't take
 * the page render down. Operators see the wrong direction
 * (which is fixable in config) instead of a 500.
 */
export type NxLocaleDirection = "ltr" | "rtl";

interface LocaleWithTextInfo extends Intl.Locale {
  /**
   * Stage-3 ECMA-402 addition. Marked optional so the helper
   * still type-checks if a future @types/node downgrade
   * removes it.
   */
  readonly textInfo?: { direction?: string };
}

export function getLocaleDirection(locale: string): NxLocaleDirection {
  if (typeof locale !== "string" || locale.length === 0) return "ltr";
  try {
    const parsed = new Intl.Locale(locale) as LocaleWithTextInfo;
    const dir = parsed.textInfo?.direction;
    return dir === "rtl" ? "rtl" : "ltr";
  } catch {
    // `new Intl.Locale("xx-not-a-tag-")` throws RangeError; we
    // swallow because rendering the page in `ltr` is
    // strictly better than 500ing on a typo'd config entry.
    return "ltr";
  }
}
