/**
 * `@nexpress/core/i18n` — internationalization surface.
 *
 * Locale registry, translation lookup, per-site overrides, locale
 * formatting, and direction resolution. Consumers reach this through
 * the dedicated subpath so the rest of `@nexpress/core` doesn't have
 * to import the `intl-messageformat` runtime to use unrelated APIs.
 */

export { setI18nConfig, getI18nConfig, resetI18nConfig } from "./registry.js";
export {
  addStrings,
  setStrings,
  resetStrings,
  resetTranslationCache,
  getStrings,
  getAllStrings,
  t,
  tSync,
} from "./strings.js";
export type { NxTranslationBundle, NxTranslationParams } from "./strings.js";
export { getLocaleDirection } from "./direction.js";
export type { NxLocaleDirection } from "./direction.js";
export { formatNumber, formatDate, formatRelativeTime, resetIntlFormatterCache } from "./format.js";
export {
  loadStringOverridesForSite,
  getStringOverridesForSite,
  clearStringOverrideCacheForSite,
  resetStringOverrideCache,
  getStringOverride,
  setStringOverride,
  deleteStringOverride,
  listStringOverridesForSite,
} from "./string-overrides.js";
export type { NxStringOverrideRow } from "./string-overrides.js";
