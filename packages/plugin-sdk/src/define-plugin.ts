import { npAdminExtensionSchema, npPluginManifestSchema } from "./manifest.js";
import type { NpPluginDefinition, NpResolvedPlugin } from "./types.js";

/**
 * Reads the surface declared on the plugin definition (`blocks`, `routes`,
 * `hooks`, etc.) and returns the matching `manifest.provides` shape. Used
 * by `definePlugin` to fill in `provides.*` automatically when the author
 * doesn't pass it — the manifest's primary purpose for those arrays is
 * machine-readable cataloging (npm search, the admin Browse panel), and
 * forcing authors to keep two copies of the same list in sync is the
 * #1 boilerplate complaint.
 *
 * Author-supplied entries take precedence: when the manifest already lists
 * an item, we don't duplicate it. Auto-derived entries are appended.
 */
function deriveProvides(
  definition: NpPluginDefinition<unknown>,
  declared:
    | {
        blocks?: readonly string[];
        fields?: readonly string[];
        collections?: readonly string[];
        adminExtensions?: readonly string[];
        apiRoutes?: readonly string[];
        hooks?: readonly string[];
      }
    | undefined,
): {
  blocks: string[];
  fields: string[];
  collections: string[];
  adminExtensions: string[];
  apiRoutes: string[];
  hooks: string[];
} {
  const merge = (declaredArr: readonly string[] | undefined, derived: string[]): string[] => {
    const set = new Set<string>(declaredArr ?? []);
    for (const entry of derived) set.add(entry);
    return [...set];
  };

  const blockTypes = (definition.blocks ?? []).map((b) => b.type).filter((t): t is string => typeof t === "string");
  const routePaths = (definition.routes ?? []).map((r) => `${r.method} ${r.path}`);
  const hookNames = Object.keys(definition.hooks ?? {});
  // `admin.settings/widgets/actions/tables/collectionTabs/dashboardWidgets`
  // — flatten to the single label "admin" so we don't enumerate every id.
  // Catalog consumers that need detail walk `admin` directly.
  const adminExtensionLabels = definition.admin
    ? [
        ...(definition.admin.settings ? ["settings"] : []),
        ...(definition.admin.widgets?.length ? ["widgets"] : []),
        ...(definition.admin.actions?.length ? ["actions"] : []),
        ...(definition.admin.tables?.length ? ["tables"] : []),
        ...(definition.admin.collectionTabs?.length ? ["collectionTabs"] : []),
        ...(definition.admin.dashboardWidgets?.length ? ["dashboardWidgets"] : []),
      ]
    : [];
  const fieldTypes = (definition.fields ?? []).map((f) => f.type).filter((t): t is string => typeof t === "string");

  return {
    blocks: merge(declared?.blocks, blockTypes),
    fields: merge(declared?.fields, fieldTypes),
    collections: [...(declared?.collections ?? [])],
    adminExtensions: merge(declared?.adminExtensions, adminExtensionLabels),
    apiRoutes: merge(declared?.apiRoutes, routePaths),
    hooks: merge(declared?.hooks, hookNames),
  };
}

export function definePlugin<TConfig = Record<string, unknown>>(
  definition: NpPluginDefinition<TConfig>,
): NpResolvedPlugin<TConfig> {
  // Auto-fill `manifest.provides.*` from the actual surface the plugin
  // contributes. Author-declared entries keep their slot; derived entries
  // append. This collapses the boilerplate floor for a block-only plugin
  // from "list every block twice" to "just declare the blocks array".
  const declaredProvides = (
    definition.manifest as { provides?: Parameters<typeof deriveProvides>[1] }
  ).provides;
  const manifestWithProvides = {
    ...definition.manifest,
    provides: deriveProvides(definition as NpPluginDefinition<unknown>, declaredProvides),
  };

  const manifest = npPluginManifestSchema.parse(manifestWithProvides);
  if (definition.admin !== undefined) {
    // Structural validation — catches typos in widget kinds, missing
    // actionIds, etc. at plugin-build time rather than runtime render.
    npAdminExtensionSchema.parse(definition.admin);
  }
  return { ...definition, manifest } as NpResolvedPlugin<TConfig>;
}
