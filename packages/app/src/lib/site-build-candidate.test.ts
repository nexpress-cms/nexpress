import { describe, expect, it, vi } from "vitest";
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
import {
  npCaptureDefaultBuildCandidateOwnersV1,
  npObserveConfiguredBuildCandidateBaselineV1,
  npValidateConfiguredBuildCandidateV1,
  type NpSiteBuildCandidateSourceDeltaV1,
} from "./site-build-candidate.js";

const rawHash = (value: string) => npBuildFileDigest("np.build-source-file.v1", Buffer.from(value));
// Representative private runtime-reference bytes, not actual build/lease evidence.
const metadataHash = (runtimeDigest: "a" | "b") =>
  rawHash(
    JSON.stringify({
      schemaVersion: "np.site-build-runtime-reference.v1",
      runtimeRoots: ["."],
      runtimeExcluded: [".np-build-runtime.json", ".nexpress/site/tmp/render-input.json"],
      runtimeFilesDigest: runtimeDigest.repeat(64),
      moduleGraph: { schemaVersion: "np.build-capsule-module-graph.v1", roots: [], instances: [] },
    }),
  );
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
          path: ".np-build-runtime.json",
          kind: "file",
          mode: "100644",
          digest: await metadataHash("a"),
        },
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
      expectedSourceHash: capsule.projectSources.files.find(
        (row) => row.path === "nexpress.config.ts",
      )!.digest,
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

async function candidateFixture(options: { addStatic?: boolean; customCallback?: boolean } = {}) {
  const callback = vi.fn();
  const custom: NpCollectionConfig = {
    slug: "custom",
    labels: { singular: "Custom", plural: "Custom" },
    fields: [{ name: "title", type: "text" }],
    access: {
      read: () => {
        callback();
        return true;
      },
    },
  };
  const value = await fixture(options.customCallback ? custom : undefined);
  const article: NpCollectionConfig = {
    slug: "articles",
    labels: { singular: "Article", plural: "Articles" },
    fields: [{ name: "title", type: "text", required: true }],
  };
  if (options.addStatic !== false) {
    const definition = {
      schemaVersion: "np.agent-build-collection-definition.v1" as const,
      configuration: {
        slug: article.slug,
        labels: article.labels,
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
        contentHash: await rawHash("planned collection\n"),
        rationale: "Declare collection",
      },
      {
        path: "nexpress.config.ts",
        action: "update",
        owner: "config",
        source: "staged",
        stagedArtifactPath: ".nexpress/site/files/config.ts",
        generatedByCommandId: null,
        expectedHash: value.capsule.projectSources.files.find(
          (row) => row.path === "nexpress.config.ts",
        )!.digest,
        contentHash: await rawHash("planned registration\n"),
        rationale: "Register collection",
      },
    );
    value.blueprint.seed = {
      mode: "demo-fixtures",
      media: [],
      documents: [
        {
          documentId: "00000000-0000-4000-8000-000000000001",
          collection: "articles",
          locale: null,
          translationGroupId: null,
          dependsOnDocumentIds: [],
          data: { title: "Explicit static article seed" },
          provenance: "demo",
        },
      ],
    };
  }
  const baselineCapture = await npCaptureDefaultBuildCandidateOwnersV1(value.capsule);
  const validation = await value.validate();
  const baseline = await npObserveConfiguredBuildCandidateBaselineV1({
    capture: baselineCapture,
    config: value.config,
    validation,
  });
  const renderer = structuredClone(value.capsule);
  const changes: NpSiteBuildCandidateSourceDeltaV1["changes"] = [];
  for (const row of value.blueprint.filePlan) {
    const before = renderer.projectSources.files.find((file) => file.path === row.path);
    changes.push({
      path: row.path,
      before: before ? { mode: before.mode, digest: before.digest } : null,
      after: { mode: before?.mode ?? "100644", digest: row.contentHash },
    });
    if (before) before.digest = row.contentHash;
    else
      renderer.projectSources.files.push({
        path: row.path,
        kind: "file",
        mode: "100644",
        digest: row.contentHash,
      });
  }
  renderer.projectSources.files.sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
  changes.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (changes.length)
    renderer.projectSources.files.find((row) => row.path === ".np-build-runtime.json")!.digest =
      await metadataHash("b");
  const capture = await npCaptureDefaultBuildCandidateOwnersV1(renderer);
  const config: NpConfig = {
    ...value.config,
    collections: [...value.config.collections, ...(options.addStatic !== false ? [article] : [])],
  };
  const sourceDelta: NpSiteBuildCandidateSourceDeltaV1 = {
    schemaVersion: "np.site-build-candidate-source-delta.v1",
    scope: "render-profile-filtered",
    originalSource: {
      ...structuredClone(value.capsule.projectSources),
      files: structuredClone(
        value.capsule.projectSources.files.filter((row) => row.path !== ".np-build-runtime.json"),
      ),
    },
    baselineRendererFingerprint: await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      value.capsule,
    ),
    candidateRendererFingerprint: await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      renderer,
    ),
    runtimeMetadata: {
      schemaVersion: "np.site-build-candidate-runtime-metadata-derivation.v1",
      owner: "np.site-build-runtime-reference.v1",
      path: ".np-build-runtime.json",
      before: {
        rendererFingerprint: await npBuildCanonicalDigest(
          "np.build-direction-renderer.v1",
          value.capsule,
        ),
        sourceFile: structuredClone(
          value.capsule.projectSources.files.find((row) => row.path === ".np-build-runtime.json")!,
        ),
      },
      after: {
        rendererFingerprint: await npBuildCanonicalDigest(
          "np.build-direction-renderer.v1",
          renderer,
        ),
        sourceFile: structuredClone(
          renderer.projectSources.files.find((row) => row.path === ".np-build-runtime.json")!,
        ),
      },
    },
    changes,
  };
  const input = {
    baseline,
    capture,
    config,
    renderer,
    brief: directionVectors.brief,
    sealedDirections: value.set,
    blueprint: value.blueprint,
    sourceDelta,
  };
  return {
    ...value,
    validation,
    baselineCapture,
    baseline,
    article,
    callback,
    input,
    check: () => npValidateConfiguredBuildCandidateV1(input),
  };
}

describe("post-apply configured Build candidate", () => {
  it("retains public scaffold Forum/Shop owners through the built candidate entry", async () => {
    const candidate = await import("@nexpress/app/lib/site-build-candidate");
    const value = await fixture();
    const capture = await candidate.npCaptureDefaultBuildCandidateOwnersV1(value.capsule);
    const validation = await value.validate();
    const baseline = await candidate.npObserveConfiguredBuildCandidateBaselineV1({
      capture,
      config: value.config,
      validation,
    });

    expect(baseline.catalog).toEqual(validation.catalog);
    expect(baseline.expectedCollectionDefinitions).toEqual(
      validation.expectedCollectionDefinitions,
    );
    expect(baseline.catalog.plugins.map((plugin) => plugin.declaration.id)).toEqual(
      expect.arrayContaining(["forum", "shop"]),
    );
    expect(baseline.callbackOwners.length).toBeGreaterThan(4);
    expect(
      baseline.callbackOwners.every(
        (owner) => owner.owner === "@nexpress/app/config-defaults.defaultCollections",
      ),
    ).toBe(true);
  });

  it("validates a real static collection registration while retaining separate baseline/current catalog evidence", async () => {
    const value = await candidateFixture();
    const originalSet = structuredClone(value.set),
      originalBlueprint = structuredClone(value.blueprint);
    const result = await value.check();
    expect(result.scope).toBe("post-apply-declarations-only");
    expect(result.baselineDiscoveryFingerprint).toBe(value.baseline.fingerprint);
    expect(result.currentDiscoveryFingerprint).not.toBe(result.baselineDiscoveryFingerprint);
    expect(result.catalog.sourceCapsule).toEqual(value.input.renderer);
    expect(
      result.actualCollectionDefinitions.some((row) => row.configuration.slug === "articles"),
    ).toBe(true);
    expect(result.callbackOwners.length).toBeGreaterThan(4);
    expect(
      result.callbackOwners.every(
        (row) => row.owner === "@nexpress/app/config-defaults.defaultCollections",
      ),
    ).toBe(true);
    expect(result.candidateDraft.discoveryFingerprint).toBe(result.currentDiscoveryFingerprint);
    expect(
      result.candidateDraft.directions.every((direction) => !("previewArtifact" in direction)),
    ).toBe(true);
    expect(result.seedValidation).toBe("exact-actual-definitions-match-validated-baseline");
    expect(value.blueprint.seed.documents[0].data.title).toBe("Explicit static article seed");
    expect(result.sourceValidationScope).toBe("host-observed-render-profile-manifests");
    expect(result.originalRawSourceCas).toBe("required-from-host");
    expect(result.runtimeMetadataObservation).toBe("host-live-byte-owner-required");
    expect(result.runtimeMetadataDerivation).toEqual(value.input.sourceDelta.runtimeMetadata);
    expect(result.runtimeMetadataDerivation.before.sourceFile.digest).not.toBe(
      result.runtimeMetadataDerivation.after.sourceFile.digest,
    );
    expect(result.catalog.sourceCapsule.projectSources.files).toContainEqual(
      result.runtimeMetadataDerivation.after.sourceFile,
    );
    expect(value.input.sourceDelta.changes).toHaveLength(2);
    expect(result.runtimeEvidence).toBe("unverified");
    expect(value.set).toEqual(originalSet);
    expect(value.blueprint).toEqual(originalBlueprint);
    expect(value.callback).not.toHaveBeenCalled();
  });

  it("supports an unchanged exact source capsule without fabricating a new fingerprint", async () => {
    const value = await candidateFixture({ addStatic: false });
    const result = await value.check();
    expect(result.currentDiscoveryFingerprint).toBe(result.baselineDiscoveryFingerprint);
    expect(result.currentRendererFingerprint).toBe(result.baselineRendererFingerprint);
  });

  it("requires the host derivation descriptor and an actually present current metadata row", async () => {
    const value = await candidateFixture();
    const absent = structuredClone(value.input.sourceDelta);
    Reflect.deleteProperty(absent, "runtimeMetadata");
    await expect(
      npValidateConfiguredBuildCandidateV1({ ...value.input, sourceDelta: absent }),
    ).rejects.toThrow(/record fields/);
    const renderer = structuredClone(value.input.renderer);
    renderer.projectSources.files = renderer.projectSources.files.filter(
      (row) => row.path !== ".np-build-runtime.json",
    );
    const sourceDelta = structuredClone(value.input.sourceDelta);
    sourceDelta.candidateRendererFingerprint = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      renderer,
    );
    sourceDelta.runtimeMetadata.after.rendererFingerprint =
      sourceDelta.candidateRendererFingerprint;
    await expect(
      npValidateConfiguredBuildCandidateV1({
        ...value.input,
        renderer,
        sourceDelta,
        capture: await npCaptureDefaultBuildCandidateOwnersV1(renderer),
      }),
    ).rejects.toThrow(/both exact complete renderer rows/);
  });

  it("rejects tampered metadata rows and either renderer binding", async () => {
    const value = await candidateFixture();
    for (const side of ["before", "after"] as const) {
      const sourceDelta = structuredClone(value.input.sourceDelta);
      sourceDelta.runtimeMetadata[side].sourceFile.digest = await rawHash(
        "different metadata bytes",
      );
      await expect(
        npValidateConfiguredBuildCandidateV1({ ...value.input, sourceDelta }),
      ).rejects.toThrow(/both exact complete renderer rows/);
      sourceDelta.runtimeMetadata[side] = structuredClone(
        value.input.sourceDelta.runtimeMetadata[side],
      );
      sourceDelta.runtimeMetadata[side].rendererFingerprint = `nb1:sha256:${"A".repeat(43)}`;
      await expect(
        npValidateConfiguredBuildCandidateV1({ ...value.input, sourceDelta }),
      ).rejects.toThrow(/both exact complete renderer rows/);
    }
  });

  it("does not let metadata derivation exempt an extra path or executable file", async () => {
    const value = await candidateFixture();
    await expect(
      npValidateConfiguredBuildCandidateV1({
        ...value.input,
        sourceDelta: {
          ...value.input.sourceDelta,
          runtimeMetadata: {
            ...value.input.sourceDelta.runtimeMetadata,
            path: ".np-build-runtime-extra.json",
          },
        },
      }),
    ).rejects.toThrow(/exact fixed derivation profile/);
    const sourceDelta = structuredClone(value.input.sourceDelta);
    sourceDelta.runtimeMetadata.after.sourceFile.path = "unplanned.ts";
    await expect(
      npValidateConfiguredBuildCandidateV1({ ...value.input, sourceDelta }),
    ).rejects.toThrow(/only the fixed non-executable runtime metadata/);
    sourceDelta.runtimeMetadata.after.sourceFile.path = ".np-build-runtime.json";
    sourceDelta.runtimeMetadata.after.sourceFile.mode = "100755";
    await expect(
      npValidateConfiguredBuildCandidateV1({ ...value.input, sourceDelta }),
    ).rejects.toThrow(/only the fixed non-executable runtime metadata/);
  });

  it("rejects reusing old metadata after an authored source change", async () => {
    const value = await candidateFixture();
    const renderer = structuredClone(value.input.renderer);
    const row = renderer.projectSources.files.find((row) => row.path === ".np-build-runtime.json")!;
    row.digest = value.input.sourceDelta.runtimeMetadata.before.sourceFile.digest;
    const sourceDelta = structuredClone(value.input.sourceDelta);
    sourceDelta.candidateRendererFingerprint = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      renderer,
    );
    sourceDelta.runtimeMetadata.after = {
      rendererFingerprint: sourceDelta.candidateRendererFingerprint,
      sourceFile: structuredClone(row),
    };
    await expect(
      npValidateConfiguredBuildCandidateV1({
        ...value.input,
        renderer,
        sourceDelta,
        capture: await npCaptureDefaultBuildCandidateOwnersV1(renderer),
      }),
    ).rejects.toThrow(/freshly derived runtime metadata/);
  });

  it("keeps runtime metadata out of the original authored manifest and file plan", async () => {
    const value = await candidateFixture();
    const sourceDelta = structuredClone(value.input.sourceDelta);
    sourceDelta.originalSource.files.unshift(
      structuredClone(sourceDelta.runtimeMetadata.before.sourceFile),
    );
    await expect(
      npValidateConfiguredBuildCandidateV1({ ...value.input, sourceDelta }),
    ).rejects.toThrow(/original source and baseline renderer/);
    const blueprint = structuredClone(value.input.blueprint);
    blueprint.filePlan.push({
      ...blueprint.filePlan[1],
      path: ".np-build-runtime.json",
      expectedHash: sourceDelta.runtimeMetadata.before.sourceFile.digest,
      contentHash: sourceDelta.runtimeMetadata.after.sourceFile.digest,
    });
    await expect(
      npValidateConfiguredBuildCandidateV1({ ...value.input, blueprint }),
    ).rejects.toThrow(/runtime-owned metadata cannot be an authored/);
  });

  it("rejects missing, extra and altered actual registrations even when source hashes match the file plan", async () => {
    const value = await candidateFixture();
    for (const kind of ["missing", "extra", "altered"] as const) {
      value.input.config.collections = [...value.config.collections, value.article];
      if (kind === "missing") value.input.config.collections = [...value.config.collections];
      if (kind === "extra")
        value.input.config.collections.push({ ...value.article, slug: "unexpected" });
      if (kind === "altered")
        value.input.config.collections[value.input.config.collections.length - 1] = {
          ...value.article,
          fields: [{ name: "title", type: "number", required: true }],
        };
      await expect(value.check()).rejects.toThrow(/actual candidate collection registration/);
    }
  });

  it("rejects a callback replacement in the same valid slot without invoking it or inspecting its body", async () => {
    const value = await candidateFixture();
    const index = value.input.config.collections.findIndex((row) => row.slug === "posts");
    const original = value.input.config.collections[index];
    const invoked = vi.fn(),
      toString = vi.fn();
    const injected = () => {
      invoked();
      return true;
    };
    injected.toString = () => {
      toString();
      throw new Error("must not inspect source");
    };
    value.input.config.collections[index] = {
      ...original,
      access: { ...original.access, read: injected },
    };
    await expect(value.check()).rejects.toThrow(/callback executable ownership changed/);
    expect(invoked).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  it("detects mutation of captured export static properties and function references", async () => {
    const value = await candidateFixture();
    const collection = defaultCollections.find((row) => row.slug === "posts")!;
    const labels = collection.labels,
      title = labels.singular;
    try {
      labels.singular = "Injected";
      await expect(value.check()).rejects.toThrow(/captured static declaration/);
    } finally {
      labels.singular = title;
    }
    const access = collection.access!,
      read = access.read;
    try {
      access.read = () => true;
      await expect(value.check()).rejects.toThrow(/captured static declaration/);
    } finally {
      access.read = read;
    }
    await expect(value.check()).resolves.toMatchObject({ runtimeEvidence: "unverified" });
  });

  it("detects actual package theme/component mutations even if the catalog would omit executable differences", async () => {
    const value = await candidateFixture();
    const theme = defaultThemes[0];
    const impl: unknown = Object.getOwnPropertyDescriptor(theme, "impl")?.value;
    if (!impl || typeof impl !== "object") throw new Error("Missing actual theme implementation");
    const descriptor = Object.getOwnPropertyDescriptor(impl, "shell")!;
    try {
      Object.defineProperty(impl, "shell", { ...descriptor, value: vi.fn(() => null) });
      await expect(value.check()).rejects.toThrow(/captured static declaration/);
    } finally {
      Object.defineProperty(impl, "shell", descriptor);
    }
  });

  it("detects nested component static-data mutation without reading a function body", async () => {
    const impl: unknown = Object.getOwnPropertyDescriptor(defaultThemes[0], "impl")?.value;
    if (!impl || typeof impl !== "object") throw new Error("Missing actual theme implementation");
    const component: unknown = Object.getOwnPropertyDescriptor(impl, "shell")?.value;
    if (typeof component !== "function") throw new Error("Missing actual shell component");
    const key = "npCandidateTestStaticData",
      data = { label: "original" };
    expect(Object.hasOwn(component, key)).toBe(false);
    Object.defineProperty(component, key, { value: data, configurable: true, enumerable: true });
    try {
      const value = await candidateFixture();
      data.label = "injected";
      await expect(value.check()).rejects.toThrow(/captured static declaration/);
    } finally {
      Reflect.deleteProperty(component, key);
    }
  });

  it("requires exact whole package equality and the capture's actual renderer", async () => {
    const value = await candidateFixture();
    const renderer = structuredClone(value.input.renderer);
    renderer.packages.find((row) => row.name === "react-dom")!.contentDigest =
      `npkg1:sha256:${"B".repeat(42)}A`;
    value.input.renderer = renderer;
    await expect(value.check()).rejects.toThrow(/capture must bind/);
    value.input.capture = await npCaptureDefaultBuildCandidateOwnersV1(renderer);
    await expect(value.check()).rejects.toThrow(/all observed installed package instances/);
  });

  it("rejects unplanned full source changes, missing delta rows and mode escalation", async () => {
    const value = await candidateFixture();
    const original = structuredClone(value.input.sourceDelta);
    value.input.sourceDelta.changes.pop();
    await expect(value.check()).rejects.toThrow(/complete source delta/);
    value.input.sourceDelta = structuredClone(original);
    value.input.sourceDelta.changes[0].after.mode = "100755";
    await expect(value.check()).rejects.toThrow(/complete source delta/);
    value.input.sourceDelta = structuredClone(original);
    const renderer = structuredClone(value.input.renderer);
    renderer.projectSources.files.push({
      path: "unexpected.ts",
      kind: "file",
      mode: "100644",
      digest: await rawHash("extra source"),
    });
    value.input.renderer = renderer;
    value.input.capture = await npCaptureDefaultBuildCandidateOwnersV1(renderer);
    value.input.sourceDelta.candidateRendererFingerprint = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      renderer,
    );
    value.input.sourceDelta.runtimeMetadata.after.rendererFingerprint =
      value.input.sourceDelta.candidateRendererFingerprint;
    await expect(value.check()).rejects.toThrow(/complete source delta/);
  });

  it("rejects an exact reported but unplanned chmod and source deletion", async () => {
    const value = await candidateFixture();
    const row = value.input.renderer.projectSources.files.find(
      (file) => file.path === "nexpress.config.ts",
    )!;
    row.mode = "100755";
    value.input.sourceDelta.changes[0].after.mode = "100755";
    value.input.sourceDelta.candidateRendererFingerprint = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      value.input.renderer,
    );
    value.input.sourceDelta.runtimeMetadata.after.rendererFingerprint =
      value.input.sourceDelta.candidateRendererFingerprint;
    value.input.capture = await npCaptureDefaultBuildCandidateOwnersV1(value.input.renderer);
    await expect(value.check()).rejects.toThrow(/preserved mode/);
    value.input.renderer.projectSources.files = value.input.renderer.projectSources.files.filter(
      (file) => file.path !== "public/hero.png",
    );
    value.input.sourceDelta.candidateRendererFingerprint = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      value.input.renderer,
    );
    value.input.sourceDelta.runtimeMetadata.after.rendererFingerprint =
      value.input.sourceDelta.candidateRendererFingerprint;
    value.input.capture = await npCaptureDefaultBuildCandidateOwnersV1(value.input.renderer);
    await expect(value.check()).rejects.toThrow(/source removal/);
  });

  it("does not replace original preconditions with a build-derived baseline", async () => {
    const value = await candidateFixture();
    value.input.sourceDelta.originalSource.files[0].digest = await rawHash(
      "actual original raw config before preparation",
    );
    await expect(value.check()).rejects.toThrow(/original source and baseline renderer/);
  });

  it("requires the explicit filtered profile and rejects credentials or authored site state in renderer manifests", async () => {
    const value = await candidateFixture();
    await expect(
      npValidateConfiguredBuildCandidateV1({
        ...value.input,
        sourceDelta: { ...value.input.sourceDelta, scope: "raw-repository" },
      }),
    ).rejects.toThrow(/exact bounded v1 profile/);
    for (const path of [
      ".env.production",
      ".codex/settings.json",
      ".nexpress/site/blueprint.json",
    ]) {
      const renderer = structuredClone(value.input.renderer);
      renderer.projectSources.files.push({
        path,
        kind: "file",
        mode: "100644",
        digest: await rawHash("must be omitted"),
      });
      renderer.projectSources.files.sort((a, b) =>
        Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
      );
      await expect(
        npValidateConfiguredBuildCandidateV1({
          ...value.input,
          renderer,
          capture: await npCaptureDefaultBuildCandidateOwnersV1(renderer),
        }),
      ).rejects.toThrow(/render-profile/);
    }
  });

  it("fails closed on source-changing project callbacks", async () => {
    const changed = await candidateFixture({ customCallback: true });
    await expect(changed.check()).rejects.toThrow(/source-changing custom callback/);
    expect(changed.callback).not.toHaveBeenCalled();
  });

  it("retains the existing source-capsule binding for unchanged custom callbacks", async () => {
    const unchanged = await candidateFixture({ customCallback: true, addStatic: false });
    await expect(unchanged.check()).resolves.toMatchObject({ runtimeEvidence: "unverified" });
    expect(unchanged.callback).not.toHaveBeenCalled();
  });

  it("rejects fabricated handles, expected inventories, blueprint seed changes and relabeled sealed evidence", async () => {
    const value = await candidateFixture();
    const capture = value.input.capture;
    value.input.capture = { schemaVersion: "np.site-build-candidate-owner-capture.v1" };
    await expect(value.check()).rejects.toThrow(/capture from this process/);
    value.input.capture = capture;
    await expect(
      npObserveConfiguredBuildCandidateBaselineV1({
        capture: value.baselineCapture,
        config: value.config,
        validation: { ...value.validation, expectedCollectionDefinitions: [] },
      }),
    ).rejects.toThrow(/complete validated collection plan/);
    const baseline = structuredClone(value.baseline);
    baseline.expectedCollectionDefinitions.pop();
    await expect(
      npValidateConfiguredBuildCandidateV1({ ...value.input, baseline }),
    ).rejects.toThrow(/exact validated collection plan/);
    value.input.blueprint = structuredClone(value.blueprint);
    value.input.blueprint.seed.documents[0].data.title = "Changed after baseline validation";
    await expect(value.check()).rejects.toThrow(/exact baseline-validated blueprint/);
    value.input.blueprint = value.blueprint;
    value.input.sealedDirections = structuredClone(value.set);
    value.input.sealedDirections.discoveryFingerprint = "fixture:invented-current";
    await expect(value.check()).rejects.toThrow();
  });

  it("rejects getter/proxy config without executing a getter", async () => {
    const value = await candidateFixture();
    const getter = vi.fn(() => value.input.config.collections);
    const config = { ...value.input.config };
    Object.defineProperty(config, "collections", { get: getter, enumerable: true });
    value.input.config = config;
    await expect(value.check()).rejects.toThrow(/accessor declarations/);
    expect(getter).not.toHaveBeenCalled();
    value.input.config = new Proxy(value.config, {});
    await expect(value.check()).rejects.toThrow(/proxy declarations/);
  });
});
