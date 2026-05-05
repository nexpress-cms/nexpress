import { npAdminExtensionSchema, npPluginManifestSchema } from "./manifest.js";
import type {
  NpPluginCapability,
  NpPluginDefinition,
  NpResolvedPlugin,
} from "./types.js";

/**
 * Capabilities the host can confidently infer from the plugin's declared
 * surface. We only auto-add ones whose presence is *unambiguous* from the
 * top-level definition — adding more permissive ones (`storage:kv`,
 * `media:write`, `network:fetch`, `content:write`) would require static
 * analysis of `setup` / route handler bodies, which is fragile and risks
 * silently granting privilege the author didn't ask for. So:
 *
 *   - Any `routes: [...]` entry → `api:route`. The host gates route
 *     registration on this capability already; failing to declare it is
 *     a guaranteed boot crash, so adding it is strictly correctness.
 *   - Any `hooks: { "<ns>:<event>": ... }` key → `hooks:<ns>`. Same
 *     story — `host.ts:hookCapabilityFor()` requires `hooks:<ns>`
 *     before allowing the registration to land.
 *
 * Author-declared capabilities keep their slot and merge with the
 * derived set — listing more (e.g. the always-explicit `storage:kv`
 * for plugins that touch `ctx.storage`) is still required.
 */
function deriveCapabilities(
  definition: NpPluginDefinition<unknown>,
  declared: readonly NpPluginCapability[] | undefined,
): NpPluginCapability[] {
  const set = new Set<NpPluginCapability>(declared ?? []);

  if (definition.routes && definition.routes.length > 0) {
    set.add("api:route");
  }

  for (const hookName of Object.keys(definition.hooks ?? {})) {
    const namespace = hookName.split(":")[0];
    if (!namespace) continue;
    const cap = `hooks:${namespace}` as NpPluginCapability;
    set.add(cap);
  }

  return [...set];
}

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
  const declaredCaps = (
    definition.manifest as { capabilities?: readonly NpPluginCapability[] }
  ).capabilities;
  const manifestWithDerived = {
    ...definition.manifest,
    provides: deriveProvides(definition as NpPluginDefinition<unknown>, declaredProvides),
    capabilities: deriveCapabilities(definition as NpPluginDefinition<unknown>, declaredCaps),
  };

  const manifest = npPluginManifestSchema.parse(manifestWithDerived);
  if (definition.admin !== undefined) {
    // Structural validation — catches typos in widget kinds, missing
    // actionIds, etc. at plugin-build time rather than runtime render.
    npAdminExtensionSchema.parse(definition.admin);
  }
  return { ...definition, manifest } as NpResolvedPlugin<TConfig>;
}
