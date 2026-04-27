import IntlMessageFormat from "intl-messageformat";

import { getCurrentSiteId } from "../sites/context.js";
import { NX_DEFAULT_SITE_ID } from "../sites/registry.js";
import { getLogger } from "../observability/logger.js";

import { getI18nConfig } from "./registry.js";
import {
  getStringOverride,
  getStringOverridesForSite,
} from "./string-overrides.js";

/**
 * Phase 12.5 — UI string translation registry.
 *
 * Plugins and themes ship key → string bundles per locale; the
 * framework merges them at boot and exposes a `t()` helper that
 * the runtime calls with `(key, locale?, params?)`. Lookup
 * order: requested locale → default locale → key itself
 * (so missing translations don't crash; they surface the key
 * to the operator who can fill it in).
 *
 * Distinct from Phase 12.1 collection content i18n: that's
 * about USER-AUTHORED content (page bodies, blog posts);
 * THIS is about FRAMEWORK + PLUGIN + THEME chrome ("Read
 * more", "min read", "Submit", error messages, dashboard
 * widget labels, etc.).
 *
 * No DB persistence in 12.5 — bundles are loaded from
 * plugins / themes / app at boot. Admin-overridable bundles
 * are a follow-up; the registry already supports
 * `addStrings(locale, bundle)` so an admin-side override
 * loader can layer on top without changing this surface.
 *
 * Phase 12.7 — message format upgraded from a private
 * `{{name}}` regex to ICU MessageFormat via
 * `intl-messageformat`. Plain strings still work unchanged
 * ("Read more"); `{name}` interpolation replaces the old
 * `{{name}}`; plural / select / date / number formatting
 * follow ICU syntax. Compiled message instances are cached
 * keyed by `(locale, template)` so a hot path doesn't re-parse
 * every call.
 */

/** A flat key → translated string map for a single locale. */
export type NxTranslationBundle = Record<string, string>;

const registry = new Map<string, NxTranslationBundle>();

/**
 * Merge a translation bundle into the registry for the given
 * locale. Keys not in the existing bundle are added; keys
 * already present are overwritten by the new value (last
 * writer wins). Plugins / themes call this from their
 * registration code via the `i18n` manifest field; sites
 * call it directly for app-level overrides.
 */
export function addStrings(
  locale: string,
  bundle: NxTranslationBundle,
): void {
  const existing = registry.get(locale) ?? {};
  registry.set(locale, { ...existing, ...bundle });
}

/** Replace (not merge) a locale's bundle. Tests use this between cases. */
export function setStrings(
  locale: string,
  bundle: NxTranslationBundle,
): void {
  registry.set(locale, { ...bundle });
}

/** Wipe every locale's bundle. Tests use this between cases. */
export function resetStrings(): void {
  registry.clear();
}

/** Read a single locale's merged bundle (frozen view). */
export function getStrings(locale: string): NxTranslationBundle {
  return { ...(registry.get(locale) ?? {}) };
}

/** Read the full registry, keyed by locale. Useful for export / admin tooling. */
export function getAllStrings(): Record<string, NxTranslationBundle> {
  const out: Record<string, NxTranslationBundle> = {};
  for (const [locale, bundle] of registry.entries()) {
    out[locale] = { ...bundle };
  }
  return out;
}

/**
 * Acceptable param value types for ICU MessageFormat. Beyond
 * primitives, `Date` is accepted because ICU's `{x, date, ...}`
 * and `{x, time, ...}` formatters expect them. `boolean` is
 * accepted because ICU's `{x, select, true {...} false {...}}`
 * pattern is occasionally useful even though `select` keys are
 * stringified in matching.
 */
export type NxTranslationParams = Record<
  string,
  string | number | boolean | Date | null | undefined
>;

/**
 * Resolve a translated string.
 *
 *   await t("readingTime", "ko", { minutes: 5 })
 *     → "5분 읽기"
 *   await t("items.count", "en", { count: 3 })
 *     → "3 items"  (ICU plural)
 *   await t("missing")
 *     → "missing"
 *
 * Lookup order (Phase D):
 *   1. site-scoped admin override for the requested locale
 *   2. requested-locale plugin / theme bundle
 *   3. site-scoped admin override for defaultLocale
 *   4. defaultLocale plugin / theme bundle
 *   5. the key itself (last-resort identity fallback)
 *
 * The locale-locality rule: a requested-locale BUNDLE wins
 * over a default-locale OVERRIDE. That keeps an English
 * override from accidentally bleeding into a fully-translated
 * Korean page — the override is only the cross-locale
 * fallback when the requested locale has nothing at all.
 *
 * Async because the override cache loads from DB on first
 * access. Subsequent calls within the same process hit the
 * in-memory cache for free; admin writes invalidate the
 * site's cache so the next call reloads.
 *
 * Phase 12.7 — message format is ICU MessageFormat. Plain
 * strings work unchanged; `{name}` interpolation replaces the
 * old `{{name}}`; plural / select / date / number formatters
 * are available via the standard ICU syntax. The locale used
 * for plural rules / number formatting is the locale the
 * matched template came from (so an English fallback message
 * gets English plural rules even on a Korean request).
 */
export async function t(
  key: string,
  locale?: string,
  params?: NxTranslationParams,
): Promise<string> {
  const config = getI18nConfig();
  const requested = locale ?? config?.defaultLocale ?? null;
  const defaultLocale = config?.defaultLocale ?? null;

  // Site-scoped overrides are populated lazily; ensure the
  // cache for THIS site has been loaded once before the
  // synchronous getStringOverride lookups below.
  const siteId = (await getCurrentSiteId()) ?? NX_DEFAULT_SITE_ID;
  await getStringOverridesForSite(siteId);

  // 1. requested-locale override
  if (requested) {
    const override = getStringOverride(siteId, requested, key);
    if (override !== null) return interpolate(override, params, requested);
  }
  // 2. requested-locale bundle
  if (requested) {
    const bundle = registry.get(requested)?.[key];
    if (bundle !== undefined) return interpolate(bundle, params, requested);
  }
  // 3. defaultLocale override (cross-locale fallback)
  if (defaultLocale && defaultLocale !== requested) {
    const override = getStringOverride(siteId, defaultLocale, key);
    if (override !== null) return interpolate(override, params, defaultLocale);
  }
  // 4. defaultLocale bundle
  if (defaultLocale && defaultLocale !== requested) {
    const bundle = registry.get(defaultLocale)?.[key];
    if (bundle !== undefined) return interpolate(bundle, params, defaultLocale);
  }
  // 5. key fallback — use the requested locale (or default)
  // for any plural rules in the literal key, though in
  // practice keys don't carry ICU syntax.
  return interpolate(key, params, requested ?? defaultLocale ?? "en");
}

/**
 * Synchronous variant for non-async contexts (rare). Skips
 * the override layer entirely and resolves only against the
 * in-memory plugin/theme bundles. Use `t()` everywhere
 * possible — that's the surface admins control via the
 * Strings settings tab.
 */
export function tSync(
  key: string,
  locale?: string,
  params?: NxTranslationParams,
): string {
  const config = getI18nConfig();
  const requested = locale ?? config?.defaultLocale ?? null;
  const defaultLocale = config?.defaultLocale ?? null;
  let template: string | undefined;
  let foundLocale: string | null = null;
  if (requested) {
    template = registry.get(requested)?.[key];
    if (template !== undefined) foundLocale = requested;
  }
  if (template === undefined && defaultLocale && defaultLocale !== requested) {
    template = registry.get(defaultLocale)?.[key];
    if (template !== undefined) foundLocale = defaultLocale;
  }
  if (template === undefined) {
    return interpolate(key, params, requested ?? defaultLocale ?? "en");
  }
  return interpolate(template, params, foundLocale ?? "en");
}

/**
 * Compiled-message cache keyed by `${locale}::${template}`.
 * The IntlMessageFormat constructor parses the ICU AST, which
 * isn't free; caching means a hot key (e.g. a header tagline
 * rendered on every request) parses once per process.
 *
 * The cache is unbounded by design — keys are bounded by
 * (locales × templates × site overrides), all small in
 * practice. If a misconfigured site managed to register
 * thousands of templates it would still grow into the low MB
 * range, well under the existing in-memory caches in this
 * file.
 */
const compiledCache = new Map<string, IntlMessageFormat>();

function compile(template: string, locale: string): IntlMessageFormat | null {
  const cacheKey = `${locale}::${template}`;
  const cached = compiledCache.get(cacheKey);
  if (cached) return cached;
  try {
    const fmt = new IntlMessageFormat(template, locale);
    compiledCache.set(cacheKey, fmt);
    return fmt;
  } catch (error) {
    // Malformed ICU template — log once at warn so the
    // operator can fix the bundle, then fall through to the
    // raw template (better to render the source than to crash
    // a page render over a typo).
    getLogger().warn("Failed to compile ICU translation template", {
      locale,
      template,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Drop the compile cache. Tests use this between cases. */
export function resetTranslationCache(): void {
  compiledCache.clear();
}

function interpolate(
  template: string,
  params: NxTranslationParams | undefined,
  locale: string,
): string {
  // Plain string fast path: no params + no ICU syntax.
  // Skipping the parser saves a measurable amount of work
  // for the common "Read more" / "Submit" case.
  if (!params && !template.includes("{")) return template;

  const fmt = compile(template, locale);
  if (!fmt) return template;
  try {
    const formatted = fmt.format(params ?? {});
    // intl-messageformat returns string for plain templates,
    // (string | object)[] for templates that pass non-string
    // values through `{x, plural, ...}` selectors with
    // <Component> placeholders. We don't use rich-text so
    // coerce to string for safety.
    return Array.isArray(formatted) ? formatted.join("") : String(formatted);
  } catch (error) {
    getLogger().warn("Failed to format ICU translation template", {
      locale,
      template,
      error: error instanceof Error ? error.message : String(error),
    });
    return template;
  }
}
