import { type NxConfig } from "./types.js";
import { nxConfigSchema } from "./validation.js";

/**
 * Validates the project's NxConfig against the declarative schema and returns
 * it unchanged on success. Catches common mistakes (bad collection slug,
 * missing auth.secret, malformed storage adapter, etc.) at module-eval time
 * with a clear Zod error instead of a cryptic runtime failure once the app
 * tries to boot.
 *
 * Unknown plugin entries are accepted here — the plugin loader does the
 * deeper validation of manifests against @nexpress/plugin-sdk.
 */
export function defineConfig(config: NxConfig): NxConfig {
  nxConfigSchema.parse(config);

  // Phase 12.1 cross-field check — a collection can only opt
  // into i18n if the top-level i18n config is set. The schema
  // can't express this with `.refine()` cleanly because it
  // would force every collection to know the parent config.
  if (config.i18n === undefined) {
    const localized = config.collections.find((c) => c.i18n === true);
    if (localized) {
      throw new Error(
        `Collection "${localized.slug}" sets i18n: true but the top-level config has no \`i18n\` block. Add \`i18n: { locales: [...], defaultLocale: "..." }\` to nexpress.config.ts.`,
      );
    }
  }

  return config;
}
