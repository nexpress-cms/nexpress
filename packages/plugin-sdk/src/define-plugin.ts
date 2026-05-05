import { npAdminExtensionSchema, npPluginManifestSchema } from "./manifest.js";
import type { NpPluginDefinition, NpResolvedPlugin } from "./types.js";

export function definePlugin<TConfig = Record<string, unknown>>(
  definition: NpPluginDefinition<TConfig>,
): NpResolvedPlugin<TConfig> {
  const manifest = npPluginManifestSchema.parse(definition.manifest);
  if (definition.admin !== undefined) {
    // Structural validation — catches typos in widget kinds, missing
    // actionIds, etc. at plugin-build time rather than runtime render.
    npAdminExtensionSchema.parse(definition.admin);
  }
  return { ...definition, manifest } as NpResolvedPlugin<TConfig>;
}
