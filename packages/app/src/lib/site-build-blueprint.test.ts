import { describe, expect, it, vi } from "vitest";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  npRequireAgentDesignDirectionSetV1,
  npRequireAgentSiteBlueprintV1,
  type NpAgentBuildDirectionRendererV1,
  type NpAgentDesignDirectionSetV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import type { NpCollectionConfig, NpConfig } from "@nexpress/core";
import { DEFAULT_THEME, npMergeThemeTokens } from "@nexpress/core/theme";
import directionVectors from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import canonicalVectors from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import {
  defaultCollections,
  defaultPlugins,
  defaultThemes,
  npGetDefaultBuildOwnerBindingsV1,
} from "../config-defaults/index.js";
import { i18nConfig } from "../i18n-config.js";
import { npCollectConfiguredBuildCatalogV1 } from "./site-build-catalog.js";
import { npValidateConfiguredBuildBlueprintV1 } from "./site-build-blueprint.js";

const rawHash = (value: string) => npBuildFileDigest("np.build-source-file.v1", Buffer.from(value));
async function bindSelection(
  set: NpAgentDesignDirectionSetV1,
  blueprint: NpAgentSiteBlueprintV1,
  copy = true,
) {
  set.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    set.comparisonInputs,
  );
  for (const direction of set.directions) {
    direction.discoveryFingerprint = set.discoveryFingerprint;
    direction.comparisonInputsDigest = set.comparisonInputsDigest;
    direction.projectionDigest = await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      npBuildDirectionProjectionV1(direction),
    );
    for (const preview of Object.values(direction.previewArtifact)) {
      preview.comparisonInputsDigest = set.comparisonInputsDigest;
      preview.directionProjectionDigest = direction.projectionDigest;
    }
  }
  const selected = set.directions[0];
  blueprint.directionSetHash = await npBuildCanonicalDigest(
    "np.build-design-direction-set.v1",
    set,
  );
  blueprint.selectedDirectionId = selected.id;
  blueprint.selectedDirectionHash = await npBuildCanonicalDigest(
    "np.build-design-direction.v1",
    selected,
  );
  blueprint.selectedDirectionProjectionDigest = selected.projectionDigest;
  blueprint.discoveryFingerprint = set.discoveryFingerprint;
  if (copy) {
    blueprint.theme = { package: selected.themeBase, tokens: structuredClone(selected.tokens) };
    blueprint.pages = selected.pageBindings.map((binding) => ({
      id: binding.pageId,
      route: "/",
      locale: null,
      audience: "public",
      source: binding.source,
      patternId: binding.patternId,
      patternOverrides: binding.overrides,
      templateId: binding.templateId,
      blocks: structuredClone(binding.blocks),
    }));
  }
}
async function fixture(extraCollection?: NpCollectionConfig) {
  const owners = npGetDefaultBuildOwnerBindingsV1();
  const config: NpConfig = {
    site: { name: "Synthetic declaration fixture", url: "http://127.0.0.1:61000" },
    db: { connectionString: "postgres://synthetic:synthetic@127.0.0.1:61001/build_fixture" },
    collections: extraCollection ? [...defaultCollections, extraCollection] : defaultCollections,
    themes: defaultThemes,
    plugins: defaultPlugins,
    i18n: i18nConfig,
  };
  const capsule: NpAgentBuildDirectionRendererV1 = {
    schemaVersion: "np.agent-build-direction-renderer.v1",
    implementation: "np.site-build.v1",
    projectSources: {
      schemaVersion: "np.agent-build-source-tree.v1",
      files: [
        {
          path: "nexpress.config.ts",
          kind: "file",
          mode: "100644",
          digest: await rawHash("synthetic reviewed config\n"),
        },
        {
          path: "public/hero.png",
          kind: "file",
          mode: "100644",
          digest: await rawHash("synthetic image bytes\n"),
        },
      ],
    },
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
  };
  const { catalog, fingerprint } = await npCollectConfiguredBuildCatalogV1(config, capsule, owners);
  const set = npRequireAgentDesignDirectionSetV1(structuredClone(directionVectors.set));
  set.discoveryFingerprint = fingerprint;
  set.comparisonInputs.projectionInputs.discoveryFingerprint = fingerprint;
  set.comparisonInputs.projectionInputs.themeBaseIds = ["@nexpress/theme-default"];
  set.comparisonInputs.projectionInputs.patternIds = [];
  set.comparisonInputs.projectionInputs.templateIds = ["pages.default"];
  set.comparisonInputs.projectionInputs.blockDefinitionFingerprints = (
    await npBuildInstalledBlockDefinitionFingerprintsV1(catalog)
  )
    .filter((entry) => entry.themePackage === "@nexpress/theme-default")
    .map((entry) => entry.fingerprint)
    .sort();
  const fonts = npMergeThemeTokens(
    DEFAULT_THEME,
    catalog.themes.find((theme) => theme.package === "@nexpress/theme-default")!.tokens,
  ).typography;
  for (const direction of set.directions) {
    direction.pageBindings[0].templateId = "pages.default";
    direction.typography = { heading: fonts.fontHeading, body: fonts.fontBody, mono: null };
    direction.layout = {
      density: "theme-native",
      contentWidth: "theme-native",
      navigation: "theme-native",
    };
  }
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonicalVectors.structured.find((entry) => entry.purpose === "np.build-site-blueprint.v1")!
        .canonical,
    ),
  );
  blueprint.briefHash = set.briefHash;
  blueprint.framework.nexpressVersion = "0.4.6";
  blueprint.filePlan = [];
  blueprint.commands = [];
  blueprint.verification = [];
  const definition = catalog.collections.find((entry) => entry.configuration.slug === "pages")!;
  blueprint.collections = [
    {
      id: "pages",
      action: "reuse",
      slug: "pages",
      sourcePath: "nexpress.config.ts",
      expectedSourceHash: capsule.projectSources.files[0].digest,
      definition,
      definitionHash: await npBuildCanonicalDigest("np.build-collection-definition.v1", definition),
      migrationClass: "none",
    },
  ];
  blueprint.plugins = [
    {
      source: "installed",
      package: catalog.plugins[0].package,
      version: catalog.plugins[0].version,
      discoveryFingerprint: fingerprint,
      reason: "Use the existing installed declaration",
      requiredCapabilities: [...catalog.plugins[0].declaration.capabilities],
      configPlaceholders: [],
    },
  ];
  blueprint.deployment.requiredEnvironment = [
    { name: "NP_SECRET", owner: "nexpress", sourceId: null },
    { name: "DATABASE_URL", owner: "platform", sourceId: null },
  ];
  await bindSelection(set, blueprint);
  const validate = () =>
    npValidateConfiguredBuildBlueprintV1(
      config,
      capsule,
      owners,
      directionVectors.brief,
      set,
      blueprint,
    );
  return { config, capsule, owners, catalog, set, blueprint, validate };
}

describe("configured Build blueprint declarations", () => {
  it("validates actual defaults and exact sealed selection without invoking declarations or mutating registries", async () => {
    const before = getRegisteredBlockMetadata(),
      value = await fixture();
    const copy = structuredClone(value.blueprint);
    const result = await value.validate();
    expect(result.scope).toBe("declarations-only");
    expect(result.blueprint).toEqual(copy);
    expect(value.blueprint).toEqual(copy);
    expect(result.expectedCollectionDefinitions).toHaveLength(defaultCollections.length);
    expect(result.blueprintHash).toBe(
      await npBuildCanonicalDigest("np.build-site-blueprint.v1", copy),
    );
    expect(getRegisteredBlockMetadata()).toEqual(before);
  });

  it("rejects set/member/catalog/IA/selected-token cross-binding even with otherwise valid JSON", async () => {
    for (const mutation of ["set", "member", "catalog", "route", "tokens"] as const) {
      const value = await fixture();
      if (mutation === "set") value.blueprint.directionSetHash = `nb1:sha256:${"A".repeat(43)}`;
      if (mutation === "member") value.blueprint.selectedDirectionId = value.set.directions[1].id;
      if (mutation === "catalog") value.blueprint.discoveryFingerprint = "fixture:invented";
      if (mutation === "route") value.blueprint.pages[0].route = "/different";
      if (mutation === "tokens") value.blueprint.theme.tokens = { colors: { primary: "#abcdef" } };
      await expect(value.validate()).rejects.toThrow(/selection|catalog|IA|projection/);
    }
  });

  it("rejects reused collection shape/source drift and an uninstalled framework/plugin version", async () => {
    for (const mutation of ["definition", "source", "framework", "plugin"] as const) {
      const value = await fixture();
      if (mutation === "definition") {
        value.blueprint.collections[0].definition = structuredClone(
          value.blueprint.collections[0].definition,
        );
        Object.assign(value.blueprint.collections[0].definition.configuration.labels as object, {
          plural: "Changed pages",
        });
        value.blueprint.collections[0].definitionHash = await npBuildCanonicalDigest(
          "np.build-collection-definition.v1",
          value.blueprint.collections[0].definition,
        );
      }
      if (mutation === "source")
        value.blueprint.collections[0].expectedSourceHash = await rawHash("wrong source");
      if (mutation === "framework") value.blueprint.framework.nexpressVersion = "0.0.0";
      if (mutation === "plugin") value.blueprint.plugins[0].version = "0.0.0";
      await expect(value.validate()).rejects.toThrow(
        /live definition|source precondition|framework version|plugin package/,
      );
    }
  });

  it("supports source-planned pure new definitions and rejects dangling relationships or callback authoring", async () => {
    const value = await fixture();
    const definition = {
      schemaVersion: "np.agent-build-collection-definition.v1" as const,
      configuration: {
        slug: "articles",
        labels: { singular: "Article", plural: "Articles" },
        fields: [{ name: "title", type: "text", required: true }],
      },
      callbacks: [],
      sourceCapsuleDigest: null,
    };
    value.blueprint.collections.push({
      id: "articles",
      action: "create",
      slug: "articles",
      sourcePath: "src/collections/articles.ts",
      expectedSourceHash: null,
      definition,
      definitionHash: await npBuildCanonicalDigest("np.build-collection-definition.v1", definition),
      migrationClass: "additive",
    });
    value.blueprint.filePlan.push(
      {
        path: "src/collections/articles.ts",
        action: "create",
        owner: "collection",
        source: "staged",
        stagedArtifactPath: ".nexpress/site/files/articles.ts",
        generatedByCommandId: null,
        expectedHash: null,
        contentHash: await rawHash("planned static source\n"),
        rationale: "Declare the collection",
      },
      {
        path: "nexpress.config.ts",
        action: "update",
        owner: "config",
        source: "staged",
        stagedArtifactPath: ".nexpress/site/files/config.ts",
        generatedByCommandId: null,
        expectedHash: value.capsule.projectSources.files[0].digest,
        contentHash: await rawHash("planned config registration\n"),
        rationale: "Register the collection",
      },
    );
    expect(
      (await value.validate()).expectedCollectionDefinitions.some(
        (entry) => entry.configuration.slug === "articles",
      ),
    ).toBe(true);
    const row = value.blueprint.collections[1];
    row.definition.configuration.fields = [
      { name: "missing", type: "relationship", relationTo: "uninstalled" },
    ];
    row.definitionHash = await npBuildCanonicalDigest(
      "np.build-collection-definition.v1",
      row.definition,
    );
    await expect(value.validate()).rejects.toThrow(/relationship|target/);
    row.definition.configuration.fields = [{ name: "title", type: "text" }];
    row.definition.configuration.access = { read: null };
    row.definition.callbacks = ["/access/read"];
    row.definition.sourceCapsuleDigest = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      value.capsule,
    );
    row.definitionHash = await npBuildCanonicalDigest(
      "np.build-collection-definition.v1",
      row.definition,
    );
    await expect(value.validate()).rejects.toThrow("callback authoring is unsupported");
  });

  it("rejects custom environment placeholders and invented capabilities", async () => {
    for (const mutation of ["placeholder", "adapter", "name", "capability"] as const) {
      const value = await fixture();
      if (mutation === "placeholder")
        value.blueprint.plugins[0].configPlaceholders = ["PLUGIN_SECRET"];
      if (mutation === "adapter")
        value.blueprint.deployment.requiredEnvironment = [
          { name: "PROVIDER_KEY", owner: "adapter", sourceId: "custom" },
        ];
      if (mutation === "name")
        value.blueprint.deployment.requiredEnvironment = [
          { name: "NP_INVENTED", owner: "nexpress", sourceId: null },
        ];
      if (mutation === "capability")
        value.blueprint.plugins[0].requiredCapabilities = ["invented:capability"];
      await expect(value.validate()).rejects.toThrow(/unsupported|inventory|capabilities/);
    }
  });

  it("resolves actual navigation locations and allocated seed references without querying a database", async () => {
    const value = await fixture(),
      id = "00000000-0000-4000-8000-000000000001";
    value.blueprint.seed = {
      mode: "demo-fixtures",
      documents: [
        {
          documentId: id,
          collection: "categories",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [],
          data: { name: "Synthetic", slug: "synthetic" },
          provenance: "demo",
        },
      ],
      media: [],
    };
    value.blueprint.navigation = [
      {
        location: "header",
        items: [
          {
            id: "term",
            type: "page",
            label: "Synthetic",
            collectionSlug: "categories",
            pageId: id,
          },
        ],
      },
    ];
    expect((await value.validate()).scope).toBe("declarations-only");
    value.blueprint.navigation[0].location = "invented";
    await expect(value.validate()).rejects.toThrow("navigation location");
    value.blueprint.navigation[0].location = "header";
    value.blueprint.seed.documents[0].data.password = "unknown-data";
    await expect(value.validate()).rejects.toThrow(/static.*schema/);
  });

  it("validates seed shapes without running ACLs, hooks, custom validation or admin conditions", async () => {
    const callback = vi.fn(() => true as const),
      hook = vi.fn();
    const value = await fixture({
      slug: "fixtures",
      labels: { singular: "Fixture", plural: "Fixtures" },
      access: { read: callback, create: callback },
      hooks: {
        beforeCreate: [
          ({ data }) => {
            hook();
            return data;
          },
        ],
      },
      fields: [
        {
          name: "title",
          type: "text",
          required: true,
          validate: callback,
          admin: { condition: callback },
        },
      ],
    });
    value.blueprint.seed = {
      mode: "demo-fixtures",
      documents: [
        {
          documentId: "00000000-0000-4000-8000-000000000001",
          collection: "fixtures",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [],
          data: { title: "Synthetic" },
          provenance: "demo",
        },
      ],
      media: [],
    };
    expect((await value.validate()).scope).toBe("declarations-only");
    expect(callback).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it("checks image props against observed public assets and collection props against actual declarations", async () => {
    const value = await fixture();
    const binding = value.set.directions[0].pageBindings[0];
    binding.blocks = [
      {
        id: "gallery",
        type: "image-gallery",
        props: {
          heading: "Synthetic",
          columns: 3,
          images: [{ src: "/hero.png", alt: "Synthetic" }],
        },
      },
      { id: "counter", type: "stats.counter", props: { collection: "posts", label: "Articles" } },
    ];
    await bindSelection(value.set, value.blueprint);
    expect((await value.validate()).scope).toBe("declarations-only");
    binding.blocks[1].props.collection = "uninstalled";
    await bindSelection(value.set, value.blueprint);
    await expect(value.validate()).rejects.toThrow("collection props");
    binding.blocks[1].props.collection = "posts";
    for (const image of [
      "/missing.png",
      "https://example.com/unobserved.png",
      "/../hero.png",
      "/%68ero.png",
    ]) {
      binding.blocks[0].props.images = [{ src: image, alt: "Synthetic" }];
      await bindSelection(value.set, value.blueprint);
      await expect(value.validate()).rejects.toThrow("observed local public assets");
    }
  });

  it("requires exact seed dependencies and staged media references before any seed execution", async () => {
    const value = await fixture({
      slug: "fixtures",
      labels: { singular: "Fixture", plural: "Fixtures" },
      fields: [
        { name: "target", type: "relationship", relationTo: "categories" },
        { name: "photo", type: "upload", relationTo: "media" },
      ],
    });
    const category = "00000000-0000-4000-8000-000000000001",
      document = "00000000-0000-4000-8000-000000000002",
      media = "00000000-0000-4000-8000-000000000003";
    value.blueprint.seed = {
      mode: "demo-fixtures",
      documents: [
        {
          documentId: category,
          collection: "categories",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [],
          data: { name: "Synthetic", slug: "synthetic" },
          provenance: "demo",
        },
        {
          documentId: document,
          collection: "fixtures",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [category],
          data: { target: category, photo: media },
          provenance: "demo",
        },
      ],
      media: [
        {
          mediaId: media,
          kind: "operator-supplied",
          materialization: "staged",
          sourceArtifactId: "synthetic-operator",
          stagedArtifactPath: ".nexpress/site/media/photo.png",
          contentHash: await npBuildFileDigest(
            "np.build-staged-artifact.v1",
            Buffer.from("synthetic image bytes"),
          ),
          mimeType: "image/png",
          byteSize: 21,
          rightsConfirmedBy: "synthetic-operator",
          provenanceNote: "Synthetic declaration; bytes are host-owned",
          alt: "Synthetic",
        },
      ],
    };
    expect((await value.validate()).scope).toBe("declarations-only");
    value.blueprint.seed.documents[1].dependsOnDocumentIds = [];
    await expect(value.validate()).rejects.toThrow("dependencies must exactly match");
    value.blueprint.seed.documents[1].dependsOnDocumentIds = [category];
    value.blueprint.seed.media = [
      {
        mediaId: media,
        kind: "placeholder",
        materialization: "reference-only",
        placeholderId: "not-uploaded",
        provenanceNote: "No media bytes",
        alt: "Synthetic",
      },
    ];
    await expect(value.validate()).rejects.toThrow("reference-only entries cannot be persisted");
  });
});
