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
  return config;
}
