import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import { defineTheme } from "@nexpress/theme";
import { DEFAULT_THEME } from "@nexpress/core/theme";
import {
  npBuildCanonicalDigest,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  type NpAgentBuildDirectionRendererV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentSiteBriefV1,
} from "@nexpress/core/agent-contract";
import { npCollectConfiguredBuildCatalogV1 } from "./site-build-catalog.js";
import { npValidateConfiguredBuildDirectionSetV1 } from "./site-build-proposal.js";

const brief: NpAgentSiteBriefV1 = {
  schemaVersion: "np.agent-site-brief.v1",
  project: {
    name: "Demo",
    summary: "Synthetic installed-proposal fixture",
    primaryGoal: "Publish articles",
    successSignals: ["Readers find articles"],
  },
  audience: [{ name: "Readers", needs: ["Find information"], priority: "primary" }],
  content: [],
  pages: [{ name: "Home", purpose: "Introduce the project", priority: "required" }],
  features: [],
  locales: ["en", "ko"],
  design: { adjectives: ["clear"], avoid: [], references: [], accessibility: "AA" },
  operations: {
    target: "local",
    expectedEditors: null,
    expectedMembers: 0,
    agentOperation: false,
  },
  constraints: [],
  assumptions: [],
  unresolved: [],
};

async function rebind(set: NpAgentDesignDirectionDraftSetV1): Promise<void> {
  set.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    set.comparisonInputs,
  );
  for (const direction of set.directions) {
    direction.comparisonInputsDigest = set.comparisonInputsDigest;
    direction.discoveryFingerprint = set.discoveryFingerprint;
  }
}

async function fixture() {
  const render = vi.fn(() => createElement("div"));
  const component = vi.fn(() => null);
  const callback = vi.fn(() => true);
  const setup = vi.fn();
  const theme = (id: string, template: string) =>
    defineTheme({
      manifest: { id, name: id, version: "0.4.6" },
      impl: {
        templates: { pages: { [template]: { label: template, component } } },
        blocks: [
          {
            type: `${id}.hero`,
            label: "Hero",
            defaultProps: { title: "Demo", count: 2 },
            propsSchema: [
              {
                name: "title",
                label: "Title",
                type: "text",
                required: true,
                translatable: true,
              },
              { name: "count", label: "Count", type: "number", min: 2, max: 6, step: 2 },
            ],
            render,
          },
        ],
        patterns: [
          {
            id: `${id}.pattern`,
            label: "Hero",
            blocks: [{ id: "hero-1", type: `${id}.hero`, props: { title: "Demo", count: 2 } }],
          },
        ],
      },
    });
  const first = theme("fixture", "default");
  const second = theme("alternate", "alternate");
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
  const owners = [
    { package: "@fixture/theme", value: first },
    { package: "@fixture/alternate-theme", value: second },
    { package: "@fixture/plugin", value: plugin },
  ];
  const config = {
    site: { name: "Synthetic Build fixture", url: "http://127.0.0.1:61000" },
    db: { connectionString: "postgres://synthetic:synthetic@127.0.0.1:61001/build_fixture" },
    collections: [
      {
        slug: "pages",
        labels: { singular: "Page", plural: "Pages" },
        fields: [{ name: "title", type: "text" }],
        access: { read: callback },
      },
    ],
    themes: [first, second],
    plugins: [plugin],
    i18n: { locales: ["en"], defaultLocale: "en" },
  };
  const capsule: NpAgentBuildDirectionRendererV1 = {
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
      ...owners.map((owner) => owner.package),
    ]
      .sort()
      .map((name) => ({
        name,
        version: "0.4.6",
        contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
      })),
  };
  const { catalog, fingerprint } = await npCollectConfiguredBuildCatalogV1(config, capsule, owners);
  const briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", brief);
  const direction = (number: number): NpAgentDesignDirectionDraftSetV1["directions"][number] => ({
    schemaVersion: "np.agent-design-direction-draft.v1",
    id: `direction-${number}`,
    name: `Demo ${number}`,
    rationale: "Synthetic declarations, no rendered evidence",
    themeBase: "@fixture/theme",
    tokens: {},
    typography: {
      heading: DEFAULT_THEME.typography.fontHeading,
      body: DEFAULT_THEME.typography.fontBody,
      mono: null,
    },
    layout: { density: "theme-native", contentWidth: "theme-native", navigation: "theme-native" },
    pageBindings: [
      {
        pageId: "home",
        source: "custom",
        patternId: null,
        overrides: null,
        templateId: "pages.default",
        blocks: [{ id: "hero-1", type: "fixture.hero", props: { title: "Demo", count: 2 } }],
      },
    ],
    tradeoffs: [],
    comparisonInputsDigest: `nb1:sha256:${"A".repeat(43)}`,
    discoveryFingerprint: fingerprint,
  });
  const set: NpAgentDesignDirectionDraftSetV1 = {
    schemaVersion: "np.agent-design-direction-draft-set.v1",
    briefHash,
    discoveryFingerprint: fingerprint,
    comparisonInputsDigest: `nb1:sha256:${"A".repeat(43)}`,
    comparisonInputs: {
      schemaVersion: "np.agent-design-comparison-inputs.v1",
      briefHash,
      informationArchitecture: [
        {
          pageId: "home",
          route: "/",
          purpose: "Read a synthetic sample",
          audience: "public",
          locale: null,
          fixtureIds: [],
        },
      ],
      sampleContent: [],
      previewPageIds: ["home"],
      projectionInputs: {
        discoveryFingerprint: fingerprint,
        themeBaseIds: ["@fixture/theme"],
        patternIds: ["fixture.pattern"],
        templateIds: ["pages.default"],
        blockDefinitionFingerprints: (await npBuildInstalledBlockDefinitionFingerprintsV1(catalog))
          .filter((item) => item.themePackage === "@fixture/theme")
          .map((item) => item.fingerprint)
          .sort(),
      },
      viewports: {
        desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
        mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
      },
    },
    directions: [direction(1), direction(2), direction(3)],
  };
  await rebind(set);
  const validate = () =>
    npValidateConfiguredBuildDirectionSetV1(config, capsule, owners, brief, set, "draft");
  return { config, capsule, owners, catalog, set, validate, render, component, callback, setup };
}

describe("installed Build direction proposals", () => {
  it("rejects unapplied layout and font claims while resolving explicit font overlays", async () => {
    const value = await fixture();
    const direction = value.set.directions[0];
    direction.layout.contentWidth = "72rem";
    await expect(value.validate()).rejects.toThrow("layout overrides");
    direction.layout.contentWidth = "theme-native";
    direction.typography.heading = "Synthetic Bundled Font";
    await expect(value.validate()).rejects.toThrow("typography");
    direction.tokens.typography = { fontHeading: "Synthetic Bundled Font" };
    await expect(value.validate()).resolves.toMatchObject({ set: value.set });
    direction.typography.mono = "Unapplied Mono";
    await expect(value.validate()).rejects.toThrow("typography");
  });
  it("validates all three directions against live installed schemas and materializes exact pattern overrides", async () => {
    const before = getRegisteredBlockMetadata();
    const value = await fixture();
    value.set.directions[0].pageBindings[0] = {
      pageId: "home",
      source: "pattern",
      patternId: "fixture.pattern",
      templateId: null,
      overrides: {
        schemaVersion: "np.pattern-overrides.v1",
        blocks: [{ id: "hero-1", props: { title: "Changed", count: 4 } }],
      },
      blocks: [{ id: "hero-1", type: "fixture.hero", props: { title: "Changed", count: 4 } }],
    };
    const proposal = structuredClone(value.set);
    expect((await value.validate()).set).toEqual(proposal);
    expect(value.set).toEqual(proposal);
    expect(getRegisteredBlockMetadata()).toEqual(before);
    for (const fn of [value.render, value.component, value.callback, value.setup]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("rejects a structurally rebound proposal after installed catalog or definition bindings change", async () => {
    const value = await fixture();
    value.capsule.packages[0].contentDigest = `npkg1:sha256:${"B".repeat(42)}A`;
    await expect(value.validate()).rejects.toThrow("catalog fingerprint");
    const missing = await fixture();
    missing.set.comparisonInputs.projectionInputs.blockDefinitionFingerprints.pop();
    await rebind(missing.set);
    await expect(missing.validate()).rejects.toThrow("block definition fingerprints");
  });

  it("rejects invented theme, pattern and template inventories even when comparison digests are recomputed", async () => {
    for (const inventory of ["themeBaseIds", "patternIds", "templateIds"] as const) {
      const value = await fixture();
      value.set.comparisonInputs.projectionInputs[inventory].push("uninstalled");
      value.set.comparisonInputs.projectionInputs[inventory].sort();
      await rebind(value.set);
      await expect(value.validate()).rejects.toThrow(
        /declared theme|declared pattern|declared template/,
      );
    }
  });

  it("requires templates and patterns to belong to the selected theme, not merely another installed theme", async () => {
    const value = await fixture();
    const inputs = value.set.comparisonInputs.projectionInputs;
    inputs.themeBaseIds = ["@fixture/alternate-theme", "@fixture/theme"];
    inputs.templateIds = ["pages.alternate", "pages.default"];
    inputs.blockDefinitionFingerprints = (
      await npBuildInstalledBlockDefinitionFingerprintsV1(value.catalog)
    )
      .map((item) => item.fingerprint)
      .sort();
    value.set.directions[0].pageBindings[0].templateId = "pages.alternate";
    await rebind(value.set);
    await expect(value.validate()).rejects.toThrow(
      "template is unavailable for its selected theme",
    );
    inputs.patternIds = ["alternate.pattern", "fixture.pattern"];
    value.set.directions[0].pageBindings[0] = {
      pageId: "home",
      source: "pattern",
      patternId: "alternate.pattern",
      templateId: null,
      overrides: {},
      blocks: [{ id: "hero-1", type: "alternate.hero", props: { title: "Demo", count: 2 } }],
    };
    await rebind(value.set);
    await expect(value.validate()).rejects.toThrow("pattern is unavailable for its selected theme");
  });

  it("rejects actual numeric constraints, stale-prop warnings and pattern output mismatches before rendering", async () => {
    for (const props of [
      { title: "Demo", count: 3 },
      { title: "Demo", count: 2, stale: true },
    ]) {
      const value = await fixture();
      value.set.directions[2].pageBindings[0].blocks[0].props = props;
      await expect(value.validate()).rejects.toThrow("exact selected installed definitions");
    }
    const value = await fixture();
    value.set.directions[1].pageBindings[0] = {
      pageId: "home",
      source: "pattern",
      patternId: "fixture.pattern",
      templateId: null,
      overrides: {},
      blocks: [{ id: "hero-1", type: "fixture.hero", props: { title: "Different", count: 2 } }],
    };
    await expect(value.validate()).rejects.toThrow(
      "exact materialized installed pattern overrides",
    );
  });

  it("rejects an IA locale allowed by the brief but absent from the actual project", async () => {
    const value = await fixture();
    value.set.comparisonInputs.informationArchitecture[0].locale = "ko";
    await rebind(value.set);
    await expect(value.validate()).rejects.toThrow("locale is not configured");
  });
});
