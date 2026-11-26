import {
  defineConfig,
  type NpConfig,
  type NpPluginConfig,
  type NpResolvedPluginLike,
  npProjectPluginDeclarationDiscoveryV1,
  npAnalyzePageTemplateRegistry,
} from "@nexpress/core";
import {
  npBuildCanonicalDigest,
  npBuildInstalledCatalogDigestV1,
  npProjectBuildCollectionDefinitionV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildInstalledCatalogV1,
  type NpAgentBuildInstalledCatalogV1,
  type NpAgentBuildInstalledThemeV1,
} from "@nexpress/core/agent-contract";
import {
  getDefaultBlocks,
  npAnalyzeBlockDefinitions,
  npAnalyzePatternDefinitions,
  npSelectBlockCandidatesForActiveSources,
  npSelectPatternCandidatesForActiveSources,
  type NpBlockDefinition,
  type NpPattern,
  type NpPatternDefinition,
} from "@nexpress/blocks";
import { npAssertThemeDefinition } from "@nexpress/theme";
import { DEFAULT_THEME, npMergeThemeTokens, type NpThemeTokens } from "@nexpress/core/theme";
import {
  npIsForumBuildRouteOwnerV1,
  type NpForumBuildRouteOwnerV1,
} from "@nexpress/plugin-forum/build-contract";
import { blockToManifest } from "./manifest.js";

/** Trusted host-source registration, never a JSON claim supplied by a blueprint. */
export interface NpSiteBuildOwnerBindingV1 {
  package: string;
  value: unknown;
  /** Host-only actual route/template identities, never parsed from JSON. */
  routes?: readonly NpForumBuildRouteOwnerV1[];
}

export interface NpSiteBuildResolvedRouteOwnerV1 {
  package: string;
  version: string;
  contentDigest: string;
  owner: NpForumBuildRouteOwnerV1;
}

/** Host-only declarations retained for installed proposal validation, never a wire DTO. */
export interface NpSiteBuildResolvedThemeV1 {
  id: string;
  package: string;
  definitions: NpBlockDefinition[];
  patterns: NpPattern[];
  templates: Array<{ id: string; collection: string }>;
  routeOwners: NpSiteBuildResolvedRouteOwnerV1[];
  tokens: NpThemeTokens;
}
const compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

function contributions(plugin: NpPluginConfig | NpResolvedPluginLike): {
  blocks: NpBlockDefinition[];
  patterns: NpPatternDefinition[];
} {
  const blockValue: unknown = Reflect.get(plugin, "blocks");
  const patternValue: unknown = Reflect.get(plugin, "patterns");
  if (blockValue !== undefined && npAnalyzeBlockDefinitions(blockValue).length)
    throw new Error("Invalid configured plugin blocks");
  if (patternValue !== undefined && npAnalyzePatternDefinitions(patternValue).length)
    throw new Error("Invalid configured plugin patterns");
  return {
    blocks: (blockValue ?? []) as NpBlockDefinition[],
    patterns: (patternValue ?? []) as NpPatternDefinition[],
  };
}

/**
 * Observes loaded config declarations only. No bootstrap, plugin setup, DB,
 * storage, provider, worker, registry mutation or rendering is invoked here.
 * The caller owns isolated module loading and fresh source/package observation.
 */
export async function npResolveConfiguredBuildCatalogV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
): Promise<{
  catalog: NpAgentBuildInstalledCatalogV1;
  fingerprint: string;
  themes: NpSiteBuildResolvedThemeV1[];
}> {
  // Validate completely without replacing the host's component object identities.
  const config = defineConfig(configValue as NpConfig);
  const sourceCapsule = npRequireAgentBuildDirectionRendererV1(sourceCapsuleValue);
  const capsuleDigest = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    sourceCapsule,
  );
  const owner = (value: unknown) => {
    const bindings = ownerBindings.filter((binding) => binding.value === value);
    if (bindings.length !== 1)
      throw new Error("Configured component requires one source-owned package binding");
    const packages = sourceCapsule.packages.filter((pkg) => pkg.name === bindings[0].package);
    if (packages.length !== 1)
      throw new Error("Configured component requires one observed installed package instance");
    return packages[0];
  };
  const plugins = (config.plugins ?? []).map((plugin) => ({
    plugin,
    owner: owner(plugin),
    declaration: npProjectPluginDeclarationDiscoveryV1(plugin),
    contributions: contributions(plugin),
  }));
  const routeOwners: NpSiteBuildResolvedRouteOwnerV1[] = [];
  for (const { plugin, owner: packageOwner, declaration } of plugins) {
    // The owning projection above accepts SDK declarations only.
    const declaredPlugin = plugin as NpResolvedPluginLike;
    const binding = ownerBindings.find((entry) => entry.value === plugin)!;
    for (const routeOwner of binding.routes ?? []) {
      if (
        packageOwner.name !== "@nexpress/plugin-forum" ||
        !npIsForumBuildRouteOwnerV1(routeOwner) ||
        declaration.id !== routeOwner.pluginId ||
        !declaredPlugin.pageRoutes?.includes(routeOwner.route) ||
        routeOwner.route.component !== routeOwner.routeComponent ||
        routeOwner.route.pattern !== routeOwner.routePattern ||
        Reflect.get(routeOwner.route, "metadata") !== routeOwner.routeMetadata ||
        (Reflect.get(routeOwner.route, "locale") ?? "auto") !== "auto" ||
        (Reflect.get(routeOwner.route, "surface") ?? "site") !== "site" ||
        declaredPlugin.templates?.[routeOwner.postCollection.slug]?.[routeOwner.templateId] !==
          routeOwner.template ||
        routeOwner.template.component !== routeOwner.templateComponent ||
        !config.collections.includes(routeOwner.boardCollection) ||
        !config.collections.includes(routeOwner.postCollection)
      )
        throw new Error(
          "Build route owner requires exact source-owned plugin, route, template and collection identities",
        );
      if (routeOwners.some((entry) => entry.owner === routeOwner))
        throw new Error("Build route owner must be registered exactly once");
      routeOwners.push({
        package: packageOwner.name,
        version: packageOwner.version,
        contentDigest: packageOwner.contentDigest,
        owner: routeOwner,
      });
    }
  }
  const themes = (config.themes ?? []).map((theme) => {
    npAssertThemeDefinition(theme);
    return { theme, owner: owner(theme) };
  });
  const blockCandidates: NpBlockDefinition[] = [
    ...getDefaultBlocks(),
    ...plugins.flatMap((item) =>
      item.contributions.blocks.map((block) => ({
        ...block,
        source: `plugin:${item.declaration.id}`,
      })),
    ),
    ...themes.flatMap(({ theme }) =>
      (theme.impl.blocks ?? []).map((block) => ({
        ...block,
        source: `theme:${theme.manifest.id}`,
      })),
    ),
  ];
  const patternCandidates: NpPattern[] = [
    ...plugins.flatMap((item) =>
      item.contributions.patterns.map((pattern) => ({
        ...pattern,
        source: `plugin:${item.declaration.id}`,
      })),
    ),
    ...themes.flatMap(({ theme }) =>
      (theme.impl.patterns ?? []).map((pattern) => ({
        ...pattern,
        source: `theme:${theme.manifest.id}`,
      })),
    ),
  ];
  const configuredPluginIds = new Set(plugins.map((item) => item.declaration.id));
  const resolvedThemes: NpSiteBuildResolvedThemeV1[] = [];
  const installedThemes: NpAgentBuildInstalledThemeV1[] = themes
    .map(({ theme, owner }) => {
      const context = { themeId: theme.manifest.id, pluginIds: configuredPluginIds };
      const definitions = npSelectBlockCandidatesForActiveSources(blockCandidates, context);
      const patterns = npSelectPatternCandidatesForActiveSources(
        patternCandidates,
        definitions,
        context,
      );
      const templates = new Map<string, { id: string; collection: string }>();
      const templateComponents = new Map<string, unknown>();
      const addTemplates = (value: unknown) => {
        if (value === undefined) return;
        if (npAnalyzePageTemplateRegistry(value).length)
          throw new Error("Invalid configured template registry");
        for (const [collection, entries] of Object.entries(
          value as Record<string, Record<string, unknown>>,
        )) {
          for (const template of Object.keys(entries)) {
            const id = `${collection}.${template}`;
            templates.set(id, { id, collection });
            templateComponents.set(id, Reflect.get(entries[template] as object, "component"));
          }
        }
      };
      for (const { plugin } of plugins) addTemplates(Reflect.get(plugin, "templates"));
      addTemplates(theme.impl.templates);
      const templateInventory = [...templates.values()].sort((left, right) =>
        compare(left.id, right.id),
      );
      resolvedThemes.push({
        id: theme.manifest.id,
        package: owner.name,
        definitions,
        patterns,
        templates: templateInventory,
        routeOwners: routeOwners.filter(
          (entry) =>
            templateComponents.get(
              `${entry.owner.postCollection.slug}.${entry.owner.templateId}`,
            ) === entry.owner.templateComponent,
        ),
        tokens: npMergeThemeTokens(DEFAULT_THEME, theme.impl.tokens),
      });
      const blocks = definitions
        .map((definition) => {
          const { render, ...metadata } = definition;
          void render;
          return blockToManifest(metadata);
        })
        .sort((left, right) => compare(left.type, right.type));
      return {
        id: theme.manifest.id,
        package: owner.name,
        version: owner.version,
        tokens: theme.impl.tokens ?? {},
        templates: templateInventory,
        navigationLocations: [
          ...new Set(["header", "footer", "main", ...Object.keys(theme.impl.navLocations ?? {})]),
        ].sort(compare),
        blocks,
        patterns: patterns
          .map((pattern) => ({ id: pattern.id, blocks: pattern.blocks }))
          .sort((left, right) => compare(left.id, right.id)),
      };
    })
    .sort((left, right) => compare(left.package, right.package));
  const body = {
    schemaVersion: "np.agent-build-installed-catalog.v1",
    observation: "configured-declarations",
    sourceCapsule,
    collections: config.collections
      .map((collection) => npProjectBuildCollectionDefinitionV1(collection, capsuleDigest))
      .sort((left, right) =>
        compare(
          typeof left.configuration.slug === "string" ? left.configuration.slug : "",
          typeof right.configuration.slug === "string" ? right.configuration.slug : "",
        ),
      ),
    themes: installedThemes,
    plugins: plugins
      .map((item) => ({
        package: item.owner.name,
        version: item.owner.version,
        declaration: item.declaration,
      }))
      .sort((left, right) => compare(left.package, right.package)),
    locales: [...(config.i18n?.locales ?? [])],
    defaultLocale: config.i18n?.defaultLocale ?? null,
  };
  // Transport only the constructed, owner-validated DTOs, never the config or its functions.
  // A wire round-trip detaches shared metadata reused by several theme declarations.
  const json = JSON.stringify(body, (_key, value: unknown) => {
    if (["function", "symbol", "bigint"].includes(typeof value))
      throw new Error("Executable or unsupported catalog metadata");
    return value;
  });
  const catalog = npRequireAgentBuildInstalledCatalogV1(JSON.parse(json));
  return {
    catalog,
    fingerprint: await npBuildInstalledCatalogDigestV1(catalog),
    themes: resolvedThemes.sort((left, right) => compare(left.package, right.package)),
  };
}

/** Observe the serializable installed catalog without exposing executable declarations. */
export async function npCollectConfiguredBuildCatalogV1(
  configValue: unknown,
  sourceCapsuleValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
): Promise<{ catalog: NpAgentBuildInstalledCatalogV1; fingerprint: string }> {
  const { catalog, fingerprint } = await npResolveConfiguredBuildCatalogV1(
    configValue,
    sourceCapsuleValue,
    ownerBindings,
  );
  return { catalog, fingerprint };
}
