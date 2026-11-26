import type { NpConfig, NpResolvedPluginLike } from "@nexpress/core";
import {
  npIsForumBuildPreviewAdapterV1,
  type NpForumBuildPreviewAdapterV1,
  type NpForumBuildRouteOwnerV1,
} from "@nexpress/plugin-forum/build-contract";
import {
  npResolveConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";

export interface NpSiteBuildPreviewConfigDerivationV1 {
  scope: "forum-build-preview-analytics-only";
  package: "@nexpress/plugin-forum";
  contentDigest: string;
  pluginId: "forum";
  routePattern: string;
  collection: string;
  templateId: "detail";
  /** Live source-owned identities, not serializable provenance or authorization. */
  owner: NpForumBuildRouteOwnerV1;
  adapter: NpForumBuildPreviewAdapterV1;
}

/** Copy declarations without evaluating unrelated accessors or dropping property descriptors. */
function copyWith<T extends object>(source: T, replacements: Record<string, unknown>): T {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const [key, value] of Object.entries(replacements)) {
    const current = descriptors[key];
    if (current && !("value" in current))
      throw new Error("Build preview requires declared data properties.");
    Object.defineProperty(descriptors, key, {
      value: current
        ? { ...current, value }
        : { value, enumerable: true, writable: true, configurable: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const copy = Object.create(Object.getPrototypeOf(source), descriptors) as T;
  if (!Object.isExtensible(source)) Object.preventExtensions(copy);
  return copy;
}

/**
 * Derive only an explicitly private preview rendering configuration. Catalog and
 * direction/projection validation must keep using the original configuration.
 * No bootstrap, callbacks, services, filesystem, render, DB or provider is invoked.
 * This does not change ordinary Next dispatch: the fixed build host must select
 * the returned configuration and bind its compiled output as a harness derivation.
 */
export async function npDeriveConfiguredBuildPreviewConfigV1(
  configValue: unknown,
  rendererValue: unknown,
  ownerBindings: readonly NpSiteBuildOwnerBindingV1[],
): Promise<{
  scope: "private-build-preview-config";
  config: NpConfig;
  originalCatalog: Awaited<ReturnType<typeof npResolveConfiguredBuildCatalogV1>>["catalog"];
  originalCatalogFingerprint: string;
  derivations: NpSiteBuildPreviewConfigDerivationV1[];
}> {
  // Reuse the actual installed declarations and owner validators before deriving.
  // Shape alone cannot make an authored plugin/template a trusted Forum owner.
  const original = await npResolveConfiguredBuildCatalogV1(
    configValue,
    rendererValue,
    ownerBindings,
  );
  const config = configValue as NpConfig;
  const derivations: NpSiteBuildPreviewConfigDerivationV1[] = [];
  const plugins = (config.plugins ?? []).map((plugin) => {
    const bindings = ownerBindings.filter((binding) => binding.value === plugin);
    const routes = bindings[0]?.routes ?? [];
    if (bindings[0]?.package === "@nexpress/plugin-forum" && !routes.length)
      throw new Error("Build preview requires the installed Forum route owner.");
    if (!routes.length) return plugin;
    if (bindings.length !== 1 || bindings[0].package !== "@nexpress/plugin-forum")
      throw new Error("Build preview requires one exact Forum source owner.");
    // The owning catalog validator above rejects non-SDK and mismatched route owners.
    const declaration = plugin as NpResolvedPluginLike;
    const observed = original.catalog.plugins.filter(
      (entry) => entry.package === bindings[0].package && entry.declaration.id === "forum",
    );
    if (observed.length !== 1 || routes.length > 100)
      throw new Error("Build preview requires one observed Forum package declaration.");
    const packageOwners = original.catalog.sourceCapsule.packages.filter(
      (entry) => entry.name === "@nexpress/plugin-forum" && entry.version === observed[0].version,
    );
    if (packageOwners.length !== 1)
      throw new Error("Build preview requires the observed Forum package content.");
    const pageRoutes = [...(declaration.pageRoutes ?? [])];
    let templates = declaration.templates ?? {};
    const replacedRoutes = new Set<object>(),
      replacedTemplates = new Set<string>();
    for (const owner of routes) {
      const key = `${owner.postCollection.slug}.${owner.templateId}`;
      if (replacedRoutes.has(owner.route) || replacedTemplates.has(key))
        throw new Error("Build preview source owners must be unique.");
      const routeIndex = pageRoutes.findIndex((route) => route === owner.route);
      if (
        routeIndex < 0 ||
        pageRoutes[routeIndex].component !== owner.routeComponent ||
        templates[owner.postCollection.slug]?.[owner.templateId] !== owner.template ||
        typeof owner.createReadOnlyPreviewAdapter !== "function"
      )
        throw new Error("Build preview requires the current Forum route and template.");
      const adapter = owner.createReadOnlyPreviewAdapter();
      if (
        !npIsForumBuildPreviewAdapterV1(adapter) ||
        adapter.scope !== "forum-build-preview-analytics-only" ||
        adapter.owner !== owner ||
        adapter.route !== owner.route ||
        adapter.template !== owner.template
      )
        throw new Error("Build preview requires the actual branded analytics-only adapter.");
      pageRoutes[routeIndex] = copyWith(pageRoutes[routeIndex], { component: adapter.renderRoute });
      // Registry containers are copied as data; frozen originals never need to be written.
      const collectionTemplates = copyWith(templates[owner.postCollection.slug], {
        [owner.templateId]: copyWith(owner.template, { component: adapter.renderTemplate }),
      });
      templates = copyWith(templates, { [owner.postCollection.slug]: collectionTemplates });
      replacedRoutes.add(owner.route);
      replacedTemplates.add(key);
      derivations.push({
        scope: adapter.scope,
        package: "@nexpress/plugin-forum",
        contentDigest: packageOwners[0].contentDigest,
        pluginId: owner.pluginId,
        routePattern: owner.routePattern,
        collection: owner.postCollection.slug,
        templateId: owner.templateId,
        owner,
        adapter,
      });
    }
    return copyWith(plugin, { pageRoutes, templates });
  });
  return {
    scope: "private-build-preview-config",
    config: copyWith(config, derivations.length ? { plugins } : {}),
    originalCatalog: original.catalog,
    originalCatalogFingerprint: original.fingerprint,
    derivations,
  };
}
