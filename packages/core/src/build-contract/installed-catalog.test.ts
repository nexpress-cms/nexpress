import { describe, expect, it } from "vitest";
import { npBuildCanonicalDigest } from "./contract.js";
import { npProjectBuildCollectionDefinitionV1 } from "./collection-definition.js";
import vectors from "./__fixtures__/renderer-v1.json" with { type: "json" };
import executionVectors from "./__fixtures__/execution-v1.json" with { type: "json" };
import {
  npBuildInstalledCatalogDigestV1,
  npBuildInstalledCatalogBytesV1,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  npParseBuildInstalledCatalogJsonV1,
  npRequireAgentBuildInstalledCatalogV1,
  type NpAgentBuildInstalledCatalogV1,
} from "./installed-catalog.js";

const catalog = (): NpAgentBuildInstalledCatalogV1 => ({
  schemaVersion: "np.agent-build-installed-catalog.v1",
  observation: "configured-declarations",
  sourceCapsule: {
    schemaVersion: "np.agent-build-direction-renderer.v1",
    implementation: "np.site-build.v1",
    projectSources: { schemaVersion: "np.agent-build-source-tree.v1", files: [] },
    packages: [
      "@nexpress/app",
      "@nexpress/blocks",
      "@nexpress/cli",
      "@nexpress/core",
      "@nexpress/theme",
      "react",
      "react-dom",
    ].map((name) => ({ name, version: "1.0.0", contentDigest: `npkg1:sha256:${"A".repeat(43)}` })),
  },
  collections: [],
  themes: [
    {
      id: "fixture",
      package: "@nexpress/theme",
      version: "1.0.0",
      tokens: {},
      templates: [],
      navigationLocations: [],
      blocks: [],
      patterns: [],
    },
  ],
  plugins: [],
  locales: [],
  defaultLocale: null,
});

describe("installed Build catalog owning transport and identity", () => {
  it("binds each block definition to its exact source-owned catalog and theme", async () => {
    const input = npParseBuildInstalledCatalogJsonV1(
      executionVectors.blockDefinition.catalogCanonical,
    );
    const result = await npBuildInstalledBlockDefinitionFingerprintsV1(input);
    expect(result).toEqual([
      {
        themePackage: "@nexpress/theme",
        blockType: "fixture",
        fingerprint: executionVectors.blockDefinition.fingerprint,
      },
    ]);
    const changed = structuredClone(input);
    changed.themes[0].tokens = { colors: { primary: "#112233" } };
    expect((await npBuildInstalledBlockDefinitionFingerprintsV1(changed))[0].fingerprint).not.toBe(
      result[0].fingerprint,
    );
    const changedPackage = structuredClone(input);
    changedPackage.sourceCapsule.packages[0].contentDigest = `npkg1:sha256:${"B".repeat(42)}A`;
    expect(
      (await npBuildInstalledBlockDefinitionFingerprintsV1(changedPackage))[0].fingerprint,
    ).not.toBe(result[0].fingerprint);
  });
  it("reproduces the independent Python discovery-profile vector", async () => {
    expect(
      new TextDecoder().decode(
        (
          await npBuildInstalledCatalogBytesV1(
            npParseBuildInstalledCatalogJsonV1(vectors.catalog.canonical),
          )
        ).canonicalJsonUtf8,
      ),
    ).toBe(vectors.catalog.canonical);
    expect(
      await npBuildInstalledCatalogDigestV1(
        npParseBuildInstalledCatalogJsonV1(vectors.catalog.canonical),
      ),
    ).toBe(vectors.catalog.digest);
  });
  it("rejects raw duplicate keys, unknown owners, invalid locales and arbitrary callback capsule hashes", async () => {
    const original = catalog();
    expect(npParseBuildInstalledCatalogJsonV1(JSON.stringify(original))).toEqual(original);
    expect(() =>
      npParseBuildInstalledCatalogJsonV1(
        JSON.stringify(original).replace('"plugins":[]', '"plugins":[],"plugins":[]'),
      ),
    ).toThrow();
    for (const modify of [
      (value: NpAgentBuildInstalledCatalogV1) => {
        value.themes[0].package = "missing-owner";
      },
      (value: NpAgentBuildInstalledCatalogV1) => {
        value.defaultLocale = "ko";
      },
      (value: NpAgentBuildInstalledCatalogV1) => {
        value.locales = ["ko"];
      },
    ]) {
      const changed = structuredClone(original);
      modify(changed);
      expect(() => npRequireAgentBuildInstalledCatalogV1(changed)).toThrow();
    }
    const digest = await npBuildCanonicalDigest(
      "np.build-direction-renderer.v1",
      original.sourceCapsule,
    );
    const projected = npProjectBuildCollectionDefinitionV1(
      {
        slug: "examples",
        labels: { singular: "Example", plural: "Examples" },
        fields: [{ name: "title", type: "text" }],
        access: { read: () => true },
      },
      digest,
    );
    original.collections.push(projected);
    await expect(npBuildInstalledCatalogDigestV1(original)).resolves.toMatch(/^ndc1:sha256:/u);
    projected.sourceCapsuleDigest = `nb1:sha256:${"A".repeat(43)}`;
    await expect(npBuildInstalledCatalogDigestV1(original)).rejects.toThrow();
  });
  it("changes discovery identity when installed file identity or declaration content changes", async () => {
    const original = catalog(),
      first = await npBuildInstalledCatalogDigestV1(original);
    expect(await npBuildInstalledCatalogDigestV1(JSON.parse(JSON.stringify(original)))).toBe(first);
    original.sourceCapsule.packages[0].contentDigest = `npkg1:sha256:${"B".repeat(42)}A`;
    expect(await npBuildInstalledCatalogDigestV1(original)).not.toBe(first);
    original.themes[0].navigationLocations = ["header"];
    expect(await npBuildInstalledCatalogDigestV1(original)).not.toBe(first);
  });
});
