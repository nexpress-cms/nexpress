import { describe, expect, it, vi } from "vitest";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import {
  npBuildInstalledCatalogDigestV1,
  type NpAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import {
  defaultCollections,
  defaultForumPlugin,
  defaultShopPlugin,
  defaultThemes,
  defaultPlugins,
  npGetDefaultBuildOwnerBindingsV1,
} from "../config-defaults/index.js";
import { i18nConfig } from "../i18n-config.js";
import {
  npCollectConfiguredBuildCatalogV1,
  npResolveConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";

const bindings = (): NpSiteBuildOwnerBindingV1[] => [
  ...defaultThemes.map((value) => ({ package: `@nexpress/theme-${value.manifest.id}`, value })),
  { package: "@nexpress/plugin-forum", value: defaultForumPlugin },
  { package: "@nexpress/plugin-shop", value: defaultShopPlugin },
];
const capsule = (
  owners: readonly NpSiteBuildOwnerBindingV1[],
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
      ...owners.map((owner) => owner.package),
    ]),
  ]
    .sort()
    .map((name) => ({ name, version: "0.4.6", contentDigest: `npkg1:sha256:${"A".repeat(43)}` })),
});
const config = () => ({
  site: { name: "Synthetic Build fixture", url: "http://127.0.0.1:61000" },
  db: { connectionString: "postgres://synthetic:synthetic@127.0.0.1:61001/build_fixture" },
  collections: defaultCollections,
  themes: defaultThemes,
  plugins: [defaultForumPlugin, defaultShopPlugin],
  i18n: i18nConfig,
});

describe("configured Build catalog projection", () => {
  it("retains trusted Forum route identities and rejects descriptor copies or changed component owners", async () => {
    const owners = npGetDefaultBuildOwnerBindingsV1();
    const input = { ...config(), plugins: defaultPlugins };
    const result = await npResolveConfiguredBuildCatalogV1(input, capsule(owners), owners);
    expect(result.themes.every((theme) => theme.routeOwners.length === 1)).toBe(true);
    const bound = owners.find((entry) => entry.package === "@nexpress/plugin-forum")!;
    const original = bound.routes![0];
    bound.routes = [{ ...original }];
    await expect(npResolveConfiguredBuildCatalogV1(input, capsule(owners), owners)).rejects.toThrow(
      "exact source-owned",
    );
    bound.routes = [original];
    const component = original.template.component;
    try {
      original.template.component = (props) => component(props);
      await expect(
        npResolveConfiguredBuildCatalogV1(input, capsule(owners), owners),
      ).rejects.toThrow("exact source-owned");
    } finally {
      original.template.component = component;
    }
    expect(result.themes[0].tokens.typography.fontHeading).toBeTruthy();
  });
  it("does not launder a new component through a modified public defaults array", async () => {
    const original = defaultThemes[0];
    const replacement = { ...original };
    try {
      defaultThemes[0] = replacement;
      const owners = npGetDefaultBuildOwnerBindingsV1();
      expect(owners.some((owner) => owner.value === replacement)).toBe(false);
      await expect(
        npCollectConfiguredBuildCatalogV1(
          { ...config(), themes: [replacement] },
          capsule(owners),
          owners,
        ),
      ).rejects.toThrow("binding");
    } finally {
      defaultThemes[0] = original;
    }
  });
  it("binds all built-in plugin and theme objects to their declared package owners", async () => {
    const owners = npGetDefaultBuildOwnerBindingsV1();
    const result = await npCollectConfiguredBuildCatalogV1(
      { ...config(), plugins: defaultPlugins },
      capsule(owners),
      owners,
    );
    expect(result.catalog.plugins).toHaveLength(defaultPlugins.length);
    expect(result.catalog.themes).toHaveLength(defaultThemes.length);
    expect(
      result.catalog.plugins.every((item) => item.package.startsWith("@nexpress/plugin-")),
    ).toBe(true);
  });
  it("uses actual default collection/theme/plugin contracts without bootstrap or registry mutation", async () => {
    const before = getRegisteredBlockMetadata();
    const owners = bindings();
    const result = await npCollectConfiguredBuildCatalogV1(config(), capsule(owners), owners);
    expect(result.catalog.themes).toHaveLength(6);
    expect(result.catalog.collections).toHaveLength(defaultCollections.length);
    expect(
      result.catalog.collections.find((item) => item.configuration.slug === "posts")?.callbacks,
    ).toContain("/access/read");
    expect(
      result.catalog.collections.find((item) => item.configuration.slug === "pages")?.callbacks,
    ).toContain("/hooks/afterUpdate/0");
    for (const theme of result.catalog.themes) {
      expect(theme.blocks.length).toBeGreaterThan(0);
      expect(theme.templates.length).toBeGreaterThan(0);
      if (theme.id === "docs")
        expect(theme.templates.map((template) => template.id)).toEqual(
          expect.arrayContaining(["pages.front", "pages.apiReference"]),
        );
      if (theme.id === "community")
        expect(theme.templates.map((template) => template.id)).toEqual(
          expect.arrayContaining(["pages.default", "pages.front"]),
        );
      expect(
        theme.blocks
          .filter((block) => block.source.startsWith("theme:"))
          .every((block) => block.source === `theme:${theme.id}`),
      ).toBe(true);
    }
    expect(result.catalog.plugins.map((plugin) => plugin.declaration.id)).toEqual([
      "forum",
      "shop",
    ]);
    expect(getRegisteredBlockMetadata()).toEqual(before);
    expect(result.fingerprint).toBe(
      await npBuildInstalledCatalogDigestV1(JSON.parse(JSON.stringify(result.catalog))),
    );
  });

  it("does not invoke configured ACLs, hooks or plugin setup while observing declarations", async () => {
    const callback = vi.fn(() => true),
      setup = vi.fn();
    const plugin = {
      manifest: {
        apiVersion: "1",
        id: "fixture",
        name: "Fixture",
        version: "0.4.6",
        capabilities: [],
      },
      setup,
    };
    const owners = [...bindings(), { package: "@fixture/plugin", value: plugin }];
    const input = {
      ...config(),
      plugins: [plugin],
      collections: [
        ...defaultCollections,
        {
          slug: "notes",
          labels: { singular: "Note", plural: "Notes" },
          fields: [{ name: "title", type: "text" }],
          access: { read: callback },
          hooks: { beforeCreate: [callback] },
        },
      ],
    };
    await npCollectConfiguredBuildCatalogV1(input, capsule(owners), owners);
    expect(callback).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it("rejects unknown/ambiguous component ownership rather than inventing installed package evidence", async () => {
    const owners = bindings();
    await expect(
      npCollectConfiguredBuildCatalogV1(config(), capsule(owners), owners.slice(1)),
    ).rejects.toThrow("binding");
    await expect(
      npCollectConfiguredBuildCatalogV1(config(), capsule(owners), [...owners, owners[0]]),
    ).rejects.toThrow("binding");
  });
});
