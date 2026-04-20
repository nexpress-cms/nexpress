import { nxPluginManifestSchema } from "./manifest.js";
import type { NxPluginDefinition, NxResolvedPlugin } from "./types.js";

export function definePlugin<TConfig = Record<string, unknown>>(
  definition: NxPluginDefinition<TConfig>,
): NxResolvedPlugin<TConfig> {
  const manifest = nxPluginManifestSchema.parse(definition.manifest);
  return { ...definition, manifest } as NxResolvedPlugin<TConfig>;
}
