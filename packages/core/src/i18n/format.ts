import { getI18nConfig } from "./registry.js";

/**
 * Phase 12.10 — locale-aware formatting helpers for sites that
 * render standalone numbers / dates outside an ICU template
 * wrapper. Thin layer over `Intl.NumberFormat`,
 * `Intl.DateTimeFormat`, and `Intl.RelativeTimeFormat` that
 *
 *   1. Resolves the locale once: explicit arg → i18n config's
 *      default → runtime default ("en").
 *   2. Caches formatter instances per (locale, options) so the
 *      relatively-expensive `new Intl.*Format(...)` only runs
 *      the first time a given shape is requested. Cache keys
 *      include the `JSON.stringify` of the options for stable
 *      ordering.
 *
 * Sites that need behavior outside this surface (e.g. `formatToParts`,
 * locale-cascading fallbacks) should keep calling `Intl.*` directly —
 * these helpers are intentionally narrow.
 */

function resolveLocale(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) return explicit;
  return getI18nConfig()?.defaultLocale ?? "en";
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateFormatCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

function getNumberFormatter(
  locale: string,
  options: Intl.NumberFormatOptions | undefined,
): Intl.NumberFormat {
  const key = `${locale}|${options ? JSON.stringify(options) : ""}`;
  let cached = numberFormatCache.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, cached);
  }
  return cached;
}

function getDateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions | undefined,
): Intl.DateTimeFormat {
  const key = `${locale}|${options ? JSON.stringify(options) : ""}`;
  let cached = dateFormatCache.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    dateFormatCache.set(key, cached);
  }
  return cached;
}

function getRelativeTimeFormatter(
  locale: string,
  options: Intl.RelativeTimeFormatOptions | undefined,
): Intl.RelativeTimeFormat {
  const key = `${locale}|${options ? JSON.stringify(options) : ""}`;
  let cached = relativeTimeFormatCache.get(key);
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, options);
    relativeTimeFormatCache.set(key, cached);
  }
  return cached;
}

/**
 * Format a number for display. Returns the input as-is when
 * `value` isn't a finite number — defending the caller against
 * `NaN` / `Infinity` from upstream parsing failures so the page
 * renders something readable instead of "NaN".
 */
export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return String(value);
  return getNumberFormatter(resolveLocale(locale), options).format(value);
}

/**
 * Format a date for display. Accepts the three shapes a CMS
 * caller typically has on hand:
 *   - `Date` (already parsed)
 *   - ISO string (`updatedAt` from the API)
 *   - epoch milliseconds
 * Returns an empty string for unparseable inputs so a stale
 * "Invalid Date" never lands in the page.
 */
export function formatDate(
  value: Date | string | number,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (!date) return "";
  return getDateFormatter(resolveLocale(locale), options).format(date);
}

/**
 * Format a relative time difference (`-2 days`, `in 3 hours`).
 * Wraps `Intl.RelativeTimeFormat`; the unit is constrained to
 * the standard set the platform supports.
 */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale?: string,
  options?: Intl.RelativeTimeFormatOptions,
): string {
  if (!Number.isFinite(value)) return String(value);
  return getRelativeTimeFormatter(resolveLocale(locale), options).format(
    value,
    unit,
  );
}

function toDate(value: Date | string | number): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Test hook — clear the formatter caches between tests so a
 * stale `Intl.*Format` instance from a previous test doesn't
 * survive into a new locale registration. Production code never
 * needs to call this.
 */
export function resetIntlFormatterCache(): void {
  numberFormatCache.clear();
  dateFormatCache.clear();
  relativeTimeFormatCache.clear();
}
