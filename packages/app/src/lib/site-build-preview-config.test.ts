import { describe, expect, it, vi } from "vitest";
import {
  createForum,
  npIsForumBuildRouteOwnerV1 as normalOwnerGuard,
  npIsForumBuildPreviewAdapterV1 as normalAdapterGuard,
} from "@nexpress/plugin-forum";
import * as host from "@nexpress/plugin-forum/build-contract";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import type { NpResolvedPluginLike } from "@nexpress/core";
import type { NpAgentBuildDirectionRendererV1 } from "@nexpress/core/agent-contract";
import {
  defaultCollections,
  defaultForumPlugin,
  defaultPlugins,
  defaultThemes,
  npGetDefaultBuildOwnerBindingsV1,
} from "../config-defaults/index.js";
import { i18nConfig } from "../i18n-config.js";
import type { NpSiteBuildOwnerBindingV1 } from "./site-build-catalog.js";
import { npResolveConfiguredBuildCatalogV1 } from "./site-build-catalog.js";
import { npDeriveConfiguredBuildPreviewConfigV1 } from "./site-build-preview-config.js";

const capsule = (
  bindings: readonly NpSiteBuildOwnerBindingV1[],
): NpAgentBuildDirectionRendererV1 => ({
  schemaVersion: "np.agent-build-direction-renderer.v1",
  implementation: "np.site-build.v1",
  projectSources: { schemaVersion: "np.agent-build-source-tree.v1", files: [] },
  packages: [
    ...new Set([
      "@nexpress/app",
      "@nexpress/blocks",
      "@nexpress/cli",
      "@nexpress/core",
      "@nexpress/theme",
      "react",
      "react-dom",
      ...bindings.map((b) => b.package),
    ]),
  ]
    .sort()
    .map((name) => ({ name, version: "0.4.6", contentDigest: `npkg1:sha256:${"A".repeat(43)}` })),
});
const config = () => ({
  site: { name: "Synthetic Build preview", url: "http://127.0.0.1:18080" },
  db: { connectionString: "postgres://synthetic:synthetic@127.0.0.1:15432/build_fixture" },
  collections: defaultCollections,
  themes: defaultThemes,
  plugins: defaultPlugins,
  i18n: i18nConfig,
});

describe("private configured Build preview derivation", () => {
  it("clones only the exact Forum route/template component and preserves original configured discovery", async () => {
    const input = config(),
      bindings = npGetDefaultBuildOwnerBindingsV1(),
      renderer = capsule(bindings);
    const before = await npResolveConfiguredBuildCatalogV1(input, renderer, bindings),
      registry = getRegisteredBlockMetadata();
    const result = await npDeriveConfiguredBuildPreviewConfigV1(input, renderer, bindings);
    expect(result.scope).toBe("private-build-preview-config");
    expect(result.originalCatalog).toEqual(before.catalog);
    expect(result.originalCatalogFingerprint).toBe(before.fingerprint);
    expect(result.derivations).toHaveLength(1);
    const derivation = result.derivations[0],
      owner = derivation.owner;
    expect(derivation).toMatchObject({
      scope: "forum-build-preview-analytics-only",
      package: "@nexpress/plugin-forum",
      contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
      pluginId: "forum",
      collection: "forum-posts",
      templateId: "detail",
      routePattern: "/boards/:boardKey/:postId",
    });
    expect(host.npIsForumBuildPreviewAdapterV1(derivation.adapter)).toBe(true);
    expect(derivation.adapter.owner).toBe(owner);
    const derived = result.config.plugins?.find(
      (p) => "manifest" in p && p.manifest.id === "forum",
    ) as NpResolvedPluginLike;
    expect(derived).not.toBe(defaultForumPlugin);
    expect(derived.manifest).toBe(defaultForumPlugin.manifest);
    for (const field of Object.keys(defaultForumPlugin).filter(
      (key) => !["pageRoutes", "templates"].includes(key),
    )) {
      const originalValue: unknown = Reflect.get(defaultForumPlugin, field),
        derivedValue: unknown = Reflect.get(derived, field);
      expect(derivedValue).toBe(originalValue);
    }
    for (const route of defaultForumPlugin.pageRoutes ?? []) {
      const next = derived.pageRoutes?.find((r) => r.pattern === route.pattern);
      if (route === owner.route) {
        expect(next).not.toBe(route);
        expect(next?.component).toBe(derivation.adapter.renderRoute);
        expect(next?.metadata).toBe(route.metadata);
      } else expect(next).toBe(route);
    }
    const template = derived.templates?.["forum-posts"]?.detail as { component: unknown };
    expect(template).not.toBe(owner.template);
    expect(template.component).toBe(derivation.adapter.renderTemplate);
    expect(defaultForumPlugin.pageRoutes?.includes(owner.route)).toBe(true);
    expect(owner.route.component).toBe(owner.routeComponent);
    expect(owner.template.component).toBe(owner.templateComponent);
    expect(result.config.collections).toBe(input.collections);
    expect(result.config.themes).toBe(input.themes);
    expect(result.config.db).toBe(input.db);
    expect(result.config.i18n).toBe(input.i18n);
    for (const plugin of input.plugins.filter((p) => p !== defaultForumPlugin))
      expect(result.config.plugins?.includes(plugin)).toBe(true);
    expect((await npResolveConfiguredBuildCatalogV1(input, renderer, bindings)).fingerprint).toBe(
      before.fingerprint,
    );
    // Derived components intentionally cannot impersonate original installed catalog identities.
    await expect(
      npResolveConfiguredBuildCatalogV1(result.config, renderer, bindings),
    ).rejects.toThrow("binding");
    expect(getRegisteredBlockMetadata()).toEqual(registry);
  });

  it("does not run callbacks and can derive from frozen host-owned declarations", async () => {
    const forum = createForum(),
      setup = vi.fn(),
      input = {
        ...config(),
        plugins: [forum.plugin],
        collections: [
          ...defaultCollections.filter((c) => !forum.collections.some((f) => f.slug === c.slug)),
          ...forum.collections,
        ],
      };
    forum.plugin.setup = setup;
    const bindings: NpSiteBuildOwnerBindingV1[] = [
      ...npGetDefaultBuildOwnerBindingsV1().filter((b) => b.package !== "@nexpress/plugin-forum"),
      { package: "@nexpress/plugin-forum", value: forum.plugin, routes: [forum.buildRouteOwner] },
    ];
    Object.freeze(forum.buildRouteOwner.route);
    Object.freeze(forum.buildRouteOwner.template);
    Object.freeze(forum.plugin.templates?.[forum.collections[1].slug]);
    Object.freeze(forum.plugin.templates);
    Object.freeze(forum.plugin.pageRoutes);
    Object.freeze(forum.plugin);
    Object.freeze(input);
    const result = await npDeriveConfiguredBuildPreviewConfigV1(input, capsule(bindings), bindings);
    expect(result.derivations[0].adapter.owner).toBe(forum.buildRouteOwner);
    expect(setup).not.toHaveBeenCalled();
    expect(result.config.plugins?.[0]).not.toBe(forum.plugin);
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(Object.isFrozen(result.config.plugins?.[0])).toBe(true);
  });

  it("rejects missing/copied descriptors, lookalike plugin objects and incomplete package observations", async () => {
    const bindings = npGetDefaultBuildOwnerBindingsV1(),
      bound = bindings.find((b) => b.package === "@nexpress/plugin-forum");
    if (!bound?.routes?.length) throw new Error("Fixture owner missing");
    const owner = bound.routes[0],
      renderer = capsule(bindings);
    bound.routes = undefined;
    await expect(
      npDeriveConfiguredBuildPreviewConfigV1(config(), renderer, bindings),
    ).rejects.toThrow("route owner");
    bound.routes = [{ ...owner }];
    await expect(
      npDeriveConfiguredBuildPreviewConfigV1(config(), renderer, bindings),
    ).rejects.toThrow("exact source-owned");
    bound.routes = [owner];
    const lookalike = { ...defaultForumPlugin };
    await expect(
      npDeriveConfiguredBuildPreviewConfigV1(
        { ...config(), plugins: [lookalike] },
        renderer,
        bindings,
      ),
    ).rejects.toThrow("binding");
    await expect(
      npDeriveConfiguredBuildPreviewConfigV1(
        config(),
        {
          ...renderer,
          packages: renderer.packages.filter((p) => p.name !== "@nexpress/plugin-forum"),
        },
        bindings,
      ),
    ).rejects.toThrow("observed installed");
  });

  it("leaves a configuration with no Forum unchanged except for its private top-level copy", async () => {
    const input = { ...config(), plugins: defaultPlugins.filter((p) => p !== defaultForumPlugin) },
      bindings = npGetDefaultBuildOwnerBindingsV1();
    const result = await npDeriveConfiguredBuildPreviewConfigV1(input, capsule(bindings), bindings);
    expect(result.config).not.toBe(input);
    expect(result.config.plugins).toBe(input.plugins);
    expect(result.derivations).toEqual([]);
  });

  it("shares actual built Forum brands through the light guard entry without exposing registration", () => {
    expect(Object.keys(host).sort()).toEqual([
      "npIsForumBuildPreviewAdapterV1",
      "npIsForumBuildRouteOwnerV1",
    ]);
    const { buildRouteOwner: owner } = createForum();
    const adapter = owner.createReadOnlyPreviewAdapter();
    expect(host.npIsForumBuildRouteOwnerV1).toBe(normalOwnerGuard);
    expect(host.npIsForumBuildPreviewAdapterV1).toBe(normalAdapterGuard);
    expect(host.npIsForumBuildRouteOwnerV1(owner)).toBe(true);
    expect(host.npIsForumBuildPreviewAdapterV1(adapter)).toBe(true);
    expect(host.npIsForumBuildRouteOwnerV1({ ...owner })).toBe(false);
    expect(host.npIsForumBuildPreviewAdapterV1({ ...adapter })).toBe(false);
    expect(host.npIsForumBuildRouteOwnerV1(JSON.parse(JSON.stringify(owner)))).toBe(false);
    const original = owner.template.component;
    owner.template.component = (...args) => original(...args);
    expect(host.npIsForumBuildPreviewAdapterV1(adapter)).toBe(false);
    expect(() => owner.createReadOnlyPreviewAdapter()).toThrow(
      "Forum build preview source owner changed.",
    );
  });
});
