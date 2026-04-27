import { getI18nConfig } from "./registry.js";

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
 * Resolve a translated string.
 *
 *   t("readingTime", "ko", { minutes: 5 }) → "5분 읽기"
 *   t("readingTime", "en", { minutes: 5 }) → "5 min read"
 *   t("missing")                            → "missing"
 *
 * Lookup order:
 *   1. requested locale (defaults to the configured
 *      defaultLocale when `locale` is omitted)
 *   2. defaultLocale fallback
 *   3. the key itself (last-resort identity fallback so the
 *      operator sees what's missing rather than a blank string)
 *
 * Param interpolation is `{{name}}` style. Missing params are
 * left as the literal `{{name}}` placeholder (helps surface
 * missing-data bugs in templates).
 */
export function t(
  key: string,
  locale?: string,
  params?: Record<string, string | number>,
): string {
  const config = getI18nConfig();
  const requested = locale ?? config?.defaultLocale ?? null;
  const defaultLocale = config?.defaultLocale ?? null;

  let template: string | undefined;
  if (requested) {
    template = registry.get(requested)?.[key];
  }
  if (template === undefined && defaultLocale && defaultLocale !== requested) {
    template = registry.get(defaultLocale)?.[key];
  }
  if (template === undefined) {
    return interpolate(key, params);
  }
  return interpolate(template, params);
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
