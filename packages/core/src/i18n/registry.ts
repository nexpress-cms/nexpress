import type { NpI18nConfig } from "../config/types.js";

/**
 * Phase 12.1 — process-wide i18n config singleton.
 *
 * The collection pipeline needs to know the configured locales
 * + default locale at write time (to validate the `locale` on
 * the data and pick a fallback when the caller omits it).
 * Loading the full NpConfig from collections would form a
 * cycle (config → collections → config), so we expose a small
 * setter the bootstrap calls during boot, mirroring how
 * `setDb` / `setStorageAdapter` / `registerThemes` are wired.
 *
 * Sites that don't configure i18n leave this null; the
 * pipeline treats per-collection `i18n: true` as a config
 * error in that case (also enforced earlier by `defineConfig`).
 */
let i18nConfig: NpI18nConfig | null = null;

export function setI18nConfig(config: NpI18nConfig | null): void {
  i18nConfig = config ?? null;
}

export function getI18nConfig(): NpI18nConfig | null {
  return i18nConfig;
}

export function resetI18nConfig(): void {
  i18nConfig = null;
}
