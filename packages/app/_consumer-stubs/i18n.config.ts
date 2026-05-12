// Stub — see ./lib/init-core.ts for the rationale.
export const i18nConfig = {
  locales: ["en"] as const,
  defaultLocale: "en" as const,
};

export type SiteLocale = (typeof i18nConfig.locales)[number];

export function isLocale(value: unknown): value is SiteLocale {
  return typeof value === "string" && i18nConfig.locales.includes(value as SiteLocale);
}
