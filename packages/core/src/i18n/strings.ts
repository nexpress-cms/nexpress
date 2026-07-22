import IntlMessageFormat from "intl-messageformat";

import {
  npRequireLocale,
  npRequireTranslationBundle,
  npRequireTranslationCatalog,
  npRequireTranslationKey,
  npRequireTranslationParams,
} from "../i18n-contract/contract.js";
import type {
  NpI18nRuntimeDiagnostics,
  NpTranslationBundle,
  NpTranslationCatalog,
  NpTranslationParams,
} from "../i18n-contract/types.js";
import { getLogger } from "../observability/logger.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";

import { getI18nConfig } from "./registry.js";
import { getStringOverride, getStringOverridesForSite } from "./string-overrides.js";

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
 * Phase 12.7 — message format upgraded from a private
 * `{{name}}` regex to ICU MessageFormat via
 * `intl-messageformat`. Plain strings still work unchanged
 * ("Read more"); `{name}` interpolation replaces the old
 * `{{name}}`; plural / select / date / number formatting
 * follow ICU syntax. Compiled message instances are cached
 * keyed by `(locale, template)` so a hot path doesn't re-parse
 * every call.
 */

const registry = new Map<string, NpTranslationBundle>();
const contributorRegistries = new Map<string, NpTranslationCatalog>();
const effectiveBundleCache = new Map<string, NpTranslationBundle>();
const EFFECTIVE_BUNDLE_CACHE_LIMIT = 256;
const COMPILED_CACHE_LIMIT = 2_000;

export interface NpRegisteredPluginTranslation {
  readonly pluginId: string;
  readonly locale: string;
  readonly key: string;
  readonly message: string;
}

function effectiveBundle(
  locale: string,
  activePluginIds?: ReadonlySet<string>,
): NpTranslationBundle {
  const activeKey = activePluginIds ? [...activePluginIds].sort().join(",") : "*";
  const cacheKey = `${locale}\u0000${activeKey}`;
  const cached = effectiveBundleCache.get(cacheKey);
  if (cached) return cached;

  const merged: Record<string, string> = Object.assign(
    Object.create(null) as Record<string, string>,
    registry.get(locale) ?? {},
  );
  for (const [sourceId, bundles] of contributorRegistries) {
    if (
      activePluginIds &&
      sourceId.startsWith("plugin:") &&
      !activePluginIds.has(sourceId.slice("plugin:".length))
    ) {
      continue;
    }
    Object.assign(merged, bundles[locale] ?? {});
  }
  const immutable = Object.freeze(merged);
  effectiveBundleCache.set(cacheKey, immutable);
  while (effectiveBundleCache.size > EFFECTIVE_BUNDLE_CACHE_LIMIT) {
    const oldest = effectiveBundleCache.keys().next().value;
    if (oldest === undefined) break;
    effectiveBundleCache.delete(oldest);
  }
  return immutable;
}

async function getActiveTranslationPluginIds(): Promise<ReadonlySet<string>> {
  const pluginIds = [...contributorRegistries.keys()]
    .filter((sourceId) => sourceId.startsWith("plugin:"))
    .map((sourceId) => sourceId.slice("plugin:".length));
  if (pluginIds.length === 0) return new Set();
  const { isPluginEnabled } = await import("../plugins/enabled-gate.js");
  const enabled = await Promise.all(
    pluginIds.map(async (pluginId) => ({ pluginId, enabled: await isPluginEnabled(pluginId) })),
  );
  return new Set(enabled.filter((entry) => entry.enabled).map((entry) => entry.pluginId));
}

function invalidateEffectiveBundles(): void {
  effectiveBundleCache.clear();
}

export function registerPluginStrings(pluginId: string, bundles: NpTranslationCatalog): void {
  try {
    registerTranslationCatalog(`plugin:${pluginId}`, bundles);
  } catch (error) {
    throw new Error(
      `[plugin:${pluginId}] ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Register or atomically replace one named theme/plugin/runtime catalog. */
export function registerTranslationCatalog(sourceId: string, bundles: unknown): void {
  const normalizedSourceId = npRequireTranslationKey(sourceId, "translationSource");
  const catalog = npRequireTranslationCatalog(bundles, {
    path: `translations.${normalizedSourceId}`,
  });
  contributorRegistries.delete(normalizedSourceId);
  contributorRegistries.set(normalizedSourceId, catalog);
  invalidateEffectiveBundles();
}

export function unregisterPluginStrings(pluginId: string): void {
  unregisterTranslationCatalog(`plugin:${pluginId}`);
}

export function unregisterTranslationCatalog(sourceId: string): void {
  contributorRegistries.delete(npRequireTranslationKey(sourceId, "translationSource"));
  invalidateEffectiveBundles();
}

export function resetPluginStrings(): void {
  for (const sourceId of contributorRegistries.keys()) {
    if (sourceId.startsWith("plugin:")) contributorRegistries.delete(sourceId);
  }
  invalidateEffectiveBundles();
}

export function getRegisteredPluginStrings(): readonly NpRegisteredPluginTranslation[] {
  return Object.freeze(
    [...contributorRegistries.entries()].flatMap(([sourceId, bundles]) => {
      if (!sourceId.startsWith("plugin:")) return [];
      const pluginId = sourceId.slice("plugin:".length);
      return Object.entries(bundles).flatMap(([locale, bundle]) =>
        Object.entries(bundle).map(([key, message]) =>
          Object.freeze({ pluginId, locale, key, message }),
        ),
      );
    }),
  );
}

/**
 * Merge a translation bundle into the registry for the given
 * locale. Keys not in the existing bundle are added; keys
 * already present are overwritten by the new value (last
 * writer wins). Sites call this for app-level base strings;
 * plugins and themes use source-owned catalogs so reload can
 * remove keys they no longer declare.
 */
export function addStrings(locale: string, bundle: NpTranslationBundle): void {
  const normalized = npRequireTranslationBundle(locale, bundle, { path: `strings.${locale}` });
  const existing = registry.get(locale) ?? {};
  registry.set(
    locale,
    Object.freeze(
      Object.assign(Object.create(null) as Record<string, string>, existing, normalized),
    ),
  );
  invalidateEffectiveBundles();
}

/** Replace (not merge) a locale's bundle. Tests use this between cases. */
export function setStrings(locale: string, bundle: NpTranslationBundle): void {
  registry.set(locale, npRequireTranslationBundle(locale, bundle, { path: `strings.${locale}` }));
  invalidateEffectiveBundles();
}

/** Wipe every locale's bundle. Tests use this between cases. */
export function resetStrings(): void {
  registry.clear();
  contributorRegistries.clear();
  invalidateEffectiveBundles();
  resetTranslationCache();
}

/** Read a single locale's merged bundle (frozen view). */
export function getStrings(locale: string): NpTranslationBundle {
  return effectiveBundle(npRequireLocale(locale));
}

/** Read the full registry, keyed by locale. Useful for export / admin tooling. */
export function getAllStrings(): NpTranslationCatalog {
  const out: Record<string, NpTranslationBundle> = {};
  const locales = new Set(registry.keys());
  for (const bundles of contributorRegistries.values()) {
    for (const locale of Object.keys(bundles)) locales.add(locale);
  }
  for (const locale of locales) {
    out[locale] = effectiveBundle(locale);
  }
  return Object.freeze(out);
}

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
  params?: NpTranslationParams,
): Promise<string> {
  const normalizedKey = npRequireTranslationKey(key);
  const normalizedLocale = locale === undefined ? undefined : npRequireLocale(locale);
  const normalizedParams = npRequireTranslationParams(params);
  const config = getI18nConfig();
  const requested = normalizedLocale ?? config?.defaultLocale ?? null;
  const defaultLocale = config?.defaultLocale ?? null;

  // Site-scoped overrides are populated lazily; ensure the
  // cache for THIS site has been loaded once before the
  // synchronous getStringOverride lookups below.
  const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
  const [, activePluginIds] = await Promise.all([
    getStringOverridesForSite(siteId),
    getActiveTranslationPluginIds(),
  ]);

  // 1. requested-locale override
  if (requested) {
    const override = getStringOverride(siteId, requested, normalizedKey);
    if (override !== null) return interpolate(normalizedKey, override, normalizedParams, requested);
  }
  // 2. requested-locale bundle
  if (requested) {
    const bundle = effectiveBundle(requested, activePluginIds)[normalizedKey];
    if (bundle !== undefined)
      return interpolate(normalizedKey, bundle, normalizedParams, requested);
  }
  // 3. defaultLocale override (cross-locale fallback)
  if (defaultLocale && defaultLocale !== requested) {
    const override = getStringOverride(siteId, defaultLocale, normalizedKey);
    if (override !== null)
      return interpolate(normalizedKey, override, normalizedParams, defaultLocale);
  }
  // 4. defaultLocale bundle
  if (defaultLocale && defaultLocale !== requested) {
    const bundle = effectiveBundle(defaultLocale, activePluginIds)[normalizedKey];
    if (bundle !== undefined)
      return interpolate(normalizedKey, bundle, normalizedParams, defaultLocale);
  }
  // 5. A missing key is an identity fallback, never an ICU template. This
  // keeps punctuation in operator-visible keys from manufacturing a runtime
  // formatting failure.
  return normalizedKey;
}

/**
 * Synchronous variant for non-async contexts (rare). Skips
 * the override layer entirely and resolves only against the
 * in-memory plugin/theme bundles. Use `t()` everywhere
 * possible — that's the surface admins control via the
 * Strings settings tab.
 */
export function tSync(key: string, locale?: string, params?: NpTranslationParams): string {
  const normalizedKey = npRequireTranslationKey(key);
  const normalizedLocale = locale === undefined ? undefined : npRequireLocale(locale);
  const normalizedParams = npRequireTranslationParams(params);
  const config = getI18nConfig();
  const requested = normalizedLocale ?? config?.defaultLocale ?? null;
  const defaultLocale = config?.defaultLocale ?? null;
  let template: string | undefined;
  let foundLocale: string | null = null;
  if (requested) {
    template = effectiveBundle(requested)[normalizedKey];
    if (template !== undefined) foundLocale = requested;
  }
  if (template === undefined && defaultLocale && defaultLocale !== requested) {
    template = effectiveBundle(defaultLocale)[normalizedKey];
    if (template !== undefined) foundLocale = defaultLocale;
  }
  if (template === undefined) {
    return normalizedKey;
  }
  return interpolate(normalizedKey, template, normalizedParams, foundLocale ?? "en");
}

/**
 * Compiled-message cache keyed by `${locale}::${template}`.
 * The IntlMessageFormat constructor parses the ICU AST, which
 * isn't free; caching means a hot key (e.g. a header tagline
 * rendered on every request) parses once per process.
 *
 * The cache is bounded because admin overrides can introduce new
 * templates over time even though every individual message is bounded.
 */
const compiledCache = new Map<string, IntlMessageFormat>();
let compileFailures = 0;
let formatFailures = 0;
let lastFailure: NpI18nRuntimeDiagnostics["lastFailure"] = null;

function runtimeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function compile(key: string, template: string, locale: string): IntlMessageFormat | null {
  const cacheKey = `${locale}::${template}`;
  const cached = compiledCache.get(cacheKey);
  if (cached) return cached;
  try {
    const fmt = new IntlMessageFormat(template, locale);
    compiledCache.set(cacheKey, fmt);
    while (compiledCache.size > COMPILED_CACHE_LIMIT) {
      const oldest = compiledCache.keys().next().value;
      if (oldest === undefined) break;
      compiledCache.delete(oldest);
    }
    return fmt;
  } catch (error) {
    const message = runtimeErrorMessage(error);
    compileFailures += 1;
    lastFailure = Object.freeze({
      operation: "compile",
      locale,
      key,
      message,
      occurredAt: new Date().toISOString(),
    });
    // Malformed ICU template — log once at warn so the
    // operator can fix the bundle, then fall through to the
    // raw template (better to render the source than to crash
    // a page render over a typo).
    getLogger().warn("Failed to compile ICU translation template", {
      locale,
      key,
      error: message,
    });
    return null;
  }
}

/** Drop the compile cache. Tests use this between cases. */
export function resetTranslationCache(): void {
  compiledCache.clear();
  compileFailures = 0;
  formatFailures = 0;
  lastFailure = null;
}

function interpolate(
  key: string,
  template: string,
  params: NpTranslationParams | undefined,
  locale: string,
): string {
  // Plain string fast path: no params + no ICU syntax.
  // Skipping the parser saves a measurable amount of work
  // for the common "Read more" / "Submit" case.
  if (!params && !template.includes("{")) return template;

  const fmt = compile(key, template, locale);
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
    const message = runtimeErrorMessage(error);
    formatFailures += 1;
    lastFailure = Object.freeze({
      operation: "format",
      locale,
      key,
      message,
      occurredAt: new Date().toISOString(),
    });
    getLogger().warn("Failed to format ICU translation template", {
      locale,
      key,
      error: message,
    });
    return template;
  }
}

export function getI18nRuntimeDiagnostics(): NpI18nRuntimeDiagnostics {
  const config = getI18nConfig();
  const countCatalog = (catalog: NpTranslationCatalog): number =>
    Object.values(catalog).reduce((count, bundle) => count + Object.keys(bundle).length, 0);
  const pluginStrings = [...contributorRegistries.entries()].reduce(
    (total, [sourceId, catalog]) =>
      total + (sourceId.startsWith("plugin:") ? countCatalog(catalog) : 0),
    0,
  );
  const baseStrings =
    [...registry.values()].reduce((total, bundle) => total + Object.keys(bundle).length, 0) +
    [...contributorRegistries.entries()].reduce(
      (total, [sourceId, catalog]) =>
        total + (sourceId.startsWith("plugin:") ? 0 : countCatalog(catalog)),
      0,
    );
  return Object.freeze({
    configured: config !== null,
    locales: config?.locales.length ?? 0,
    baseStrings,
    pluginStrings,
    effectiveBundleCacheEntries: effectiveBundleCache.size,
    compiledMessageCacheEntries: compiledCache.size,
    compileFailures,
    formatFailures,
    lastFailure,
  });
}
