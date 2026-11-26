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
import directionVectors from "../../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import canonicalVectors from "../../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import {
  defaultCollections,
  defaultPlugins,
  defaultThemes,
  npGetDefaultBuildOwnerBindingsV1,
} from "../../config-defaults/index.js";
import { i18nConfig } from "../../i18n-config.js";
import { npCollectConfiguredBuildCatalogV1 } from "../site-build-catalog.js";
import { npValidateConfiguredBuildBlueprintV1 } from "../site-build-blueprint.js";

export const rawHash = (value: string) =>
  npBuildFileDigest("np.build-source-file.v1", Buffer.from(value));
export async function bindSelection(
  set: NpAgentDesignDirectionSetV1,
  blueprint: NpAgentSiteBlueprintV1,
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
export async function prepareSiteBuildValidationFixture({
  extraCollection,
  runtimeMetadataDigest,
}: {
  extraCollection?: NpCollectionConfig;
  runtimeMetadataDigest?: string;
} = {}) {
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
  const configSourceHash = capsule.projectSources.files[0].digest;
  if (runtimeMetadataDigest) {
    capsule.projectSources.files.unshift({
      path: ".np-build-runtime.json",
      kind: "file",
      mode: "100644",
      digest: runtimeMetadataDigest,
    });
  }
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
      expectedSourceHash: configSourceHash,
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
  return { config, owners, evidence: { capsule, set, blueprint } };
}

export function createSiteBuildValidationFixture(
  prepared: Awaited<ReturnType<typeof prepareSiteBuildValidationFixture>>,
) {
  const { owners } = prepared;
  const config = { ...prepared.config, collections: [...prepared.config.collections] };
  const { capsule, set, blueprint } = structuredClone(prepared.evidence);
  const validate = () =>
    npValidateConfiguredBuildBlueprintV1(
      config,
      capsule,
      owners,
      directionVectors.brief,
      set,
      blueprint,
    );
  return { config, capsule, set, blueprint, validate };
}
