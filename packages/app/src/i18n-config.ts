/**
 * Phase 12.2 — framework-wide i18n config consumed by both
 * apps/web and scaffolded sites. Kept separate from
 * `nexpress.config.ts` so the middleware (which can't pull in
 * `@nexpress/core`'s pg / sharp / argon2 deps) can import it
 * cheaply. The shape mirrors what the framework registers via
 * the bootstrap; the two stay in sync because the consumer's
 * `nexpress.config.ts` imports this same object via the thin
 * `@/i18n.config` wrapper.
 *
 * Adding a locale here requires a redeploy — the locale list
 * is consumed at build time. Switching the active site default
 * from one locale to another is just an edit to `defaultLocale`.
 *
 * This module lives in `@nexpress/app` so both the reference
 * app and every scaffolded site reach the same locale list
 * without duplicating it across the snapshot mirror.
 */
import { npRequireI18nConfig } from "@nexpress/core/i18n-contract";

const configuredLocales = Object.freeze(["en", "ko"] as const);

export const i18nConfig = Object.freeze({
  locales: configuredLocales,
  defaultLocale: "en" as const,
});

// The same exact contract guards project config/bootstrap. Keeping the proxy's
// build-time catalog on it prevents middleware and server runtime drift.
npRequireI18nConfig(i18nConfig);

export type SiteLocale = (typeof i18nConfig.locales)[number];

export function isLocale(value: unknown): value is SiteLocale {
  return typeof value === "string" && (i18nConfig.locales as readonly string[]).includes(value);
}
