import { nxAdminExtensionSchema, nxPluginManifestSchema } from "./manifest.js";
import type { NxPluginDefinition, NxResolvedPlugin } from "./types.js";

export function definePlugin<TConfig = Record<string, unknown>>(
  definition: NxPluginDefinition<TConfig>,
): NxResolvedPlugin<TConfig> {
  const manifest = nxPluginManifestSchema.parse(definition.manifest);
  if (definition.admin !== undefined) {
    // Structural validation — catches typos in widget kinds, missing
    // actionIds, etc. at plugin-build time rather than runtime render.
    nxAdminExtensionSchema.parse(definition.admin);
  }
  return { ...definition, manifest } as NxResolvedPlugin<TConfig>;
}
