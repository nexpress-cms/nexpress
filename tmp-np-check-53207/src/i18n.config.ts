/**
 * Phase 12.2 — site-side i18n config, kept separate from
 * `nexpress.config.ts` so the middleware (which can't pull in
 * `@nexpress/core`'s pg / sharp / argon2 deps) can import it
 * cheaply. The shape mirrors what the framework registers via
 * the bootstrap; the two stay in sync because nexpress.config.ts
 * imports this same object.
 *
 * Adding a locale here requires a redeploy — the locale list
 * is consumed at build time. Switching the active site default
 * from one locale to another is just an edit to `defaultLocale`.
 */
export const i18nConfig = {
  locales: ["en", "ko"] as const,
  defaultLocale: "en" as const,
};

export type SiteLocale = (typeof i18nConfig.locales)[number];

export function isLocale(value: unknown): value is SiteLocale {
  return (
    typeof value === "string" && (i18nConfig.locales as readonly string[]).includes(value)
  );
}
