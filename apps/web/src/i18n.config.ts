// Thin re-export of the framework's shared i18n config. Substance
// lives in `@nexpress/app/i18n-config` so apps/web and every
// scaffolded site share the same locale list without duplicating
// it across the snapshot mirror.
export { i18nConfig, isLocale, type SiteLocale } from "@nexpress/app/i18n-config";
