import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import { defineTheme, type NpTheme } from "@nexpress/theme";
import {
  npBuildCanonicalDigest,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  type NpAgentBuildDirectionRendererV1,
  type NpAgentBuildRenderFixtureV1,
  type NpAgentDesignDirectionDraftSetV1,
  type NpAgentSiteBriefV1,
} from "@nexpress/core/agent-contract";
import type { NpCollectionConfig, NpConfig } from "@nexpress/core";
import { DEFAULT_THEME } from "@nexpress/core/theme";
import { createForum } from "@nexpress/plugin-forum";
import {
  npCollectConfiguredBuildCatalogV1,
  type NpSiteBuildOwnerBindingV1,
} from "./site-build-catalog.js";
import { npPrepareConfiguredBuildRenderFixtureV1 } from "./site-build-render-fixture.js";
import { pagesCollection } from "../collections/pages.js";

const ids = {
  category: "00000000-0000-4000-8000-000000000001",
  home: "00000000-0000-4000-8000-000000000002",
  about: "00000000-0000-4000-8000-000000000003",
  translation: "00000000-0000-4000-8000-000000000004",
};
const blocks = [{ id: "hero-1", type: "fixture.hero", props: { title: "Direction heading" } }];
const brief: NpAgentSiteBriefV1 = {
  schemaVersion: "np.agent-site-brief.v1",
  project: {
    name: "Synthetic ordinary site",
    summary: "Fixture projection without services",
    primaryGoal: "Read pages",
    successSignals: ["Find pages"],
  },
  audience: [{ name: "Readers", needs: ["Read pages"], priority: "primary" }],
  content: [],
  pages: [{ name: "Home", purpose: "Introduce project", priority: "required" }],
  features: [],
  locales: ["en", "ko"],
  design: { adjectives: ["clear"], avoid: [], references: [], accessibility: "AA" },
  operations: { target: "local", expectedEditors: null, expectedMembers: 0, agentOperation: false },
  constraints: [],
  assumptions: [],
  unresolved: [],
};

async function fixture() {
  const callback = vi.fn(() => true as const);
  const component = vi.fn(() => null);
  const render = vi.fn(() => createElement("div"));
  const setup = vi.fn();
  const theme = defineTheme({
    manifest: { id: "fixture", name: "Fixture", version: "0.4.6" },
    impl: {
      templates: {
        pages: { default: { label: "Default", component } },
        posts: { detail: { label: "Detail", component } },
        articles: { detail: { label: "Detail", component } },
      },
      blocks: [
        {
          type: "fixture.hero",
          label: "Hero",
          defaultProps: { title: "Direction heading" },
          propsSchema: [
            { name: "title", label: "Title", type: "text", required: true, translatable: true },
          ],
          render,
        },
      ],
      patterns: [{ id: "fixture.home", label: "Home", blocks }],
    },
  });
  const plugin = {
    manifest: {
      apiVersion: "1" as const,
      id: "fixture",
      name: "Fixture",
      version: "0.4.6",
      capabilities: [],
    },
    setup,
  };
  const owners: NpSiteBuildOwnerBindingV1[] = [
    { package: "@fixture/theme", value: theme },
    { package: "@fixture/plugin", value: plugin },
  ];
  const config: NpConfig = {
    site: { name: "Synthetic site", url: "http://127.0.0.1:61000" },
    db: { connectionString: "postgres://synthetic:synthetic@127.0.0.1:61001/build_fixture" },
    collections: [
      {
        slug: "categories",
        labels: { singular: "Category", plural: "Categories" },
        fields: [{ name: "name", type: "text", required: true }],
      },
      {
        slug: "pages",
        labels: { singular: "Page", plural: "Pages" },
        slugField: { useField: "title", unique: true },
        i18n: true,
        access: { read: callback },
        hooks: {
          beforeCreate: [
            ({ data }) => {
              callback();
              return data;
            },
          ],
        },
        fields: [
          { name: "title", type: "text", required: true, validate: callback },
          { name: "template", type: "text" },
          { name: "blocks", type: "blocks" },
          { name: "category", type: "relationship", relationTo: "categories" },
          {
            name: "summary",
            type: "text",
            admin: { condition: callback },
          },
        ],
      },
      {
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        slugField: { useField: "title", unique: true },
        fields: [
          { name: "title", type: "text", required: true },
          { name: "kind", type: "select", options: [{ label: "Article", value: "article" }] },
          { name: "template", type: "text" },
          { name: "content", type: "json" },
        ],
      },
      {
        slug: "articles",
        labels: { singular: "Article", plural: "Articles" },
        fields: [
          { name: "title", type: "text" },
          { name: "template", type: "text" },
        ],
      },
    ],
    themes: [theme],
    plugins: [plugin],
    i18n: { locales: ["en", "ko"], defaultLocale: "en" },
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
      .map((name) => ({ name, version: "0.4.6", contentDigest: `npkg1:sha256:${"A".repeat(43)}` })),
  };
  const { catalog, fingerprint } = await npCollectConfiguredBuildCatalogV1(config, capsule, owners);
  const briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", brief);
  const direction = (index: number): NpAgentDesignDirectionDraftSetV1["directions"][number] => ({
    schemaVersion: "np.agent-design-direction-draft.v1",
    id: `direction-${index}`,
    name: `Direction ${index}`,
    rationale: "Same synthetic content",
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
        blocks: structuredClone(blocks),
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
          purpose: "Read",
          audience: "public",
          locale: null,
          fixtureIds: ["home-sample"],
        },
      ],
      sampleContent: [
        {
          id: "home-sample",
          pageId: "home",
          locale: null,
          label: "Synthetic home",
          data: {
            schemaVersion: "np.agent-build-render-fixture-ref.v1",
            stagedArtifactPath: ".nexpress/site/fixtures/home.json",
            digest: `nb1:file-sha256:${"A".repeat(43)}`,
            pageDocumentId: ids.home,
          },
        },
      ],
      previewPageIds: ["home"],
      projectionInputs: {
        discoveryFingerprint: fingerprint,
        themeBaseIds: ["@fixture/theme"],
        patternIds: ["fixture.home"],
        templateIds: ["articles.detail", "pages.default", "posts.detail"],
        blockDefinitionFingerprints: (await npBuildInstalledBlockDefinitionFingerprintsV1(catalog))
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
  const body: NpAgentBuildRenderFixtureV1 = {
    schemaVersion: "np.agent-build-render-fixture.v1",
    documents: [
      {
        documentId: ids.category,
        collection: "categories",
        locale: null,
        translationGroupId: null,
        dependsOnDocumentIds: [],
        data: { name: "Synthetic category" },
        provenance: "demo",
      },
      {
        documentId: ids.home,
        collection: "pages",
        locale: "en",
        translationGroupId: ids.translation,
        dependsOnDocumentIds: [ids.category],
        data: { title: "Preserved authored title", slug: "/", category: ids.category },
        provenance: "demo",
      },
    ],
    navigation: [
      {
        location: "header",
        items: [{ id: "home", type: "page", pageId: ids.home, label: "Home" }],
      },
    ],
  };
  const fixtures: Array<{ sampleId: string; body: NpAgentBuildRenderFixtureV1 }> = [
    { sampleId: "home-sample", body },
  ];
  const rebind = async () => {
    set.comparisonInputsDigest = await npBuildCanonicalDigest(
      "np.build-design-comparison-inputs.v1",
      set.comparisonInputs,
    );
    for (const direction of set.directions)
      direction.comparisonInputsDigest = set.comparisonInputsDigest;
  };
  const prepare = async () => {
    await rebind();
    return npPrepareConfiguredBuildRenderFixtureV1(
      config,
      capsule,
      owners,
      brief,
      set,
      "direction-1",
      fixtures,
    );
  };
  const reobserve = async () => {
    const observed = await npCollectConfiguredBuildCatalogV1(config, capsule, owners);
    set.discoveryFingerprint = observed.fingerprint;
    set.comparisonInputs.projectionInputs.discoveryFingerprint = observed.fingerprint;
    set.comparisonInputs.projectionInputs.blockDefinitionFingerprints = (
      await npBuildInstalledBlockDefinitionFingerprintsV1(observed.catalog)
    )
      .map((item) => item.fingerprint)
      .sort();
    for (const direction of set.directions) direction.discoveryFingerprint = observed.fingerprint;
  };
  return {
    config,
    capsule,
    owners,
    set,
    body,
    fixtures,
    prepare,
    rebind,
    reobserve,
    callback,
    component,
    render,
    setup,
  };
}

function authoredDefaults(collection: NpCollectionConfig) {
  const result: Record<string, unknown> = {};
  for (const field of collection.fields)
    if (
      "name" in field &&
      field.name &&
      "defaultValue" in field &&
      field.defaultValue !== undefined
    )
      result[field.name] = structuredClone(field.defaultValue);
  return result;
}

async function forumFixture() {
  const value = await fixture(),
    forum = createForum();
  value.config.collections.push(...forum.collections);
  value.config.plugins?.push(forum.plugin);
  value.owners.push({
    package: "@nexpress/plugin-forum",
    value: forum.plugin,
    routes: [forum.buildRouteOwner],
  });
  value.capsule.packages.push({
    name: "@nexpress/plugin-forum",
    version: "0.4.6",
    contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
  });
  value.capsule.packages.sort((left, right) => left.name.localeCompare(right.name));
  const body = {
    version: 1,
    document: {
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [
          {
            type: "paragraph",
            version: 1,
            direction: null,
            format: "",
            indent: 0,
            children: [
              {
                type: "text",
                version: 1,
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Synthetic protected forum body",
              },
            ],
          },
        ],
      },
    },
  };
  value.body.documents = [
    {
      documentId: ids.category,
      collection: forum.collections[0].slug,
      locale: null,
      translationGroupId: null,
      dependsOnDocumentIds: [],
      data: {
        ...authoredDefaults(forum.collections[0]),
        name: "Members",
        key: "members",
        slug: "members",
        visibility: "public",
        audience: "members",
        categories: [],
      },
      provenance: "demo",
    },
    {
      documentId: ids.home,
      collection: forum.collections[1].slug,
      locale: null,
      translationGroupId: null,
      dependsOnDocumentIds: [ids.category],
      data: {
        ...authoredDefaults(forum.collections[1]),
        board: ids.category,
        boardKey: "members",
        title: "Synthetic protected forum post",
        body,
        visibility: "public",
        audience: "members",
        attachments: [],
      },
      provenance: "demo",
    },
  ];
  value.body.navigation = [];
  value.set.comparisonInputs.informationArchitecture[0].audience = "member";
  value.set.comparisonInputs.informationArchitecture[0].route = `/boards/members/${ids.home}`;
  value.set.comparisonInputs.projectionInputs.templateIds.push("forum-posts.detail");
  value.set.comparisonInputs.projectionInputs.templateIds.sort();
  for (const direction of value.set.directions)
    direction.pageBindings[0] = {
      pageId: "home",
      source: "custom",
      patternId: null,
      overrides: null,
      templateId: "forum-posts.detail",
      blocks: [],
    };
  await value.reobserve();
  return { ...value, forum };
}

describe("configured ordinary Build render fixture projection", () => {
  it("preserves authored content, materializes selected blocks/template and detaches without callbacks or registry changes", async () => {
    const value = await fixture();
    const before = structuredClone(value.body);
    const registry = getRegisteredBlockMetadata();
    const result = await value.prepare();
    expect(result.documents.map((document) => document.documentId)).toEqual([
      ids.category,
      ids.home,
    ]);
    expect(result.documents[1].data).toEqual({
      title: "Preserved authored title",
      slug: "/",
      category: ids.category,
      blocks,
      template: "default",
    });
    expect(result.theme).toEqual({ id: "fixture", package: "@fixture/theme", tokens: {} });
    expect(result.frontPageId).toBe(ids.home);
    expect(result.pageDocuments).toEqual([
      {
        pageId: "home",
        documentId: ids.home,
        collection: "pages",
        route: "/",
        locale: "en",
        audience: "public",
        templateId: "default",
      },
    ]);
    expect(value.body).toEqual(before);
    result.documents[1].data.title = "Detached";
    result.navigation[0].items[0].label = "Detached";
    expect(value.body).toEqual(before);
    expect(getRegisteredBlockMetadata()).toEqual(registry);
    for (const callback of [value.callback, value.component, value.render, value.setup])
      expect(callback).not.toHaveBeenCalled();
  });

  it("uses the actual pattern materialization with no implicit template selection", async () => {
    const value = await fixture();
    for (const direction of value.set.directions)
      direction.pageBindings[0] = {
        pageId: "home",
        source: "pattern",
        patternId: "fixture.home",
        overrides: {},
        templateId: null,
        blocks: structuredClone(blocks),
      };
    expect((await value.prepare()).documents[1].data.template).toBeNull();
  });

  it("requires complete exact sample inventory and one unambiguous primary per IA page", async () => {
    const missing = await fixture();
    missing.fixtures.length = 0;
    await expect(missing.prepare()).rejects.toThrow("complete comparison sample inventory");
    const extra = await fixture();
    extra.fixtures.push({ sampleId: "extra", body: extra.body });
    await expect(extra.prepare()).rejects.toThrow("complete comparison sample inventory");
    const ambiguous = await fixture();
    ambiguous.set.comparisonInputs.sampleContent.push({
      ...structuredClone(ambiguous.set.comparisonInputs.sampleContent[0]),
      id: "other-sample",
    });
    ambiguous.set.comparisonInputs.informationArchitecture[0].fixtureIds.push("other-sample");
    ambiguous.fixtures.push({ sampleId: "other-sample", body: ambiguous.body });
    await expect(ambiguous.prepare()).rejects.toThrow("exactly one primary sample");
  });

  it("allows identical complete shared fixture documents and rejects conflicting duplicate allocated ids", async () => {
    const value = await fixture();
    value.body.documents.push({
      ...structuredClone(value.body.documents[1]),
      documentId: ids.about,
      data: { title: "About", slug: "about", category: ids.category },
    });
    value.set.comparisonInputs.informationArchitecture.push({
      pageId: "about",
      route: "/about",
      purpose: "Read",
      audience: "public",
      locale: null,
      fixtureIds: ["about-sample"],
    });
    value.set.comparisonInputs.sampleContent.push({
      id: "about-sample",
      pageId: "about",
      locale: null,
      label: "About",
      data: {
        ...value.set.comparisonInputs.sampleContent[0].data,
        stagedArtifactPath: ".nexpress/site/fixtures/about.json",
        pageDocumentId: ids.about,
      },
    });
    for (const direction of value.set.directions) {
      direction.pageBindings.push({
        ...structuredClone(direction.pageBindings[0]),
        pageId: "about",
      });
      direction.pageBindings.sort((left, right) => left.pageId.localeCompare(right.pageId));
    }
    value.fixtures.push({ sampleId: "about-sample", body: structuredClone(value.body) });
    expect((await value.prepare()).documents).toHaveLength(3);
    value.fixtures[1].body.documents[0].data.name = "Conflict";
    await expect(value.prepare()).rejects.toThrow("identical complete data");
  });

  it("rejects unknown or mismatched collection references and undeclared dependency edges", async () => {
    const wrong = await fixture();
    wrong.body.documents[1].data.category = ids.home;
    await expect(wrong.prepare()).rejects.toThrow("allocated matching collections");
    const absent = await fixture();
    absent.body.documents[1].data.category = ids.about;
    await expect(absent.prepare()).rejects.toThrow("allocated matching collections");
    const missing = await fixture();
    missing.body.documents[1].dependsOnDocumentIds = [];
    await expect(missing.prepare()).rejects.toThrow("exactly match configured document references");
    const unknown = await fixture();
    unknown.body.documents[0].collection = "not-configured";
    await expect(unknown.prepare()).rejects.toThrow();
  });

  it("rejects route, locale and authored blocks/template contradictions", async () => {
    const slug = await fixture();
    slug.body.documents[1].data.slug = "wrong";
    await expect(slug.prepare()).rejects.toThrow("slug must exactly match");
    const locale = await fixture();
    locale.body.documents[1].locale = "ko";
    await expect(locale.prepare()).rejects.toThrow("document locale must match");
    const authoredBlocks = await fixture();
    authoredBlocks.body.documents[1].data.blocks = [];
    await expect(authoredBlocks.prepare()).rejects.toThrow("blocks must not contradict");
    const template = await fixture();
    template.body.documents[1].data.template = "another";
    await expect(template.prepare()).rejects.toThrow("template must not contradict");
  });

  it("resolves an explicit configured locale prefix to the exact stored page slug", async () => {
    const value = await fixture();
    value.set.comparisonInputs.informationArchitecture[0].route = "/ko/about";
    value.set.comparisonInputs.informationArchitecture[0].locale = "ko";
    value.set.comparisonInputs.sampleContent[0].locale = "ko";
    value.body.documents[1].locale = "ko";
    value.body.documents[1].data.slug = "about";
    const result = await value.prepare();
    expect(result.pageDocuments[0]).toMatchObject({ route: "/ko/about", locale: "ko" });
    expect(result.frontPageId).toBeNull();
  });

  it("rejects fixture metadata smuggling, invalid field shape and implicit configured defaults", async () => {
    const metadata = await fixture();
    metadata.body.documents[1].data.siteId = "claimed-site";
    await expect(metadata.prepare()).rejects.toThrow("must not override seed metadata");
    const invalid = await fixture();
    invalid.body.documents[1].data.title = 5;
    await expect(invalid.prepare()).rejects.toThrow("static field schemas");
    const defaults = await fixture();
    defaults.config.collections[0].fields.push({ name: "count", type: "number", defaultValue: 3 });
    await defaults.reobserve();
    await expect(defaults.prepare()).rejects.toThrow("explicitly supply defaulted fields");
  });

  it("accepts the actual framework pages collection shape without replacing its hooks or authoring fields", async () => {
    const value = await fixture();
    value.config.collections[1] = pagesCollection;
    value.body.documents = [value.body.documents[1]];
    value.body.documents[0].dependsOnDocumentIds = [];
    delete value.body.documents[0].data.category;
    await value.reobserve();
    const result = await value.prepare();
    expect(result.documents[0].data).toEqual({
      title: "Preserved authored title",
      slug: "/",
      template: "default",
      blocks,
    });
    expect(value.config.collections[1]).toBe(pagesCollection);
  });

  it("validates navigation locations and all allocated page/collection references", async () => {
    const location = await fixture();
    location.body.navigation[0].location = "invented";
    await expect(location.prepare()).rejects.toThrow("location must belong");
    const reference = await fixture();
    reference.body.navigation[0].items = [
      { id: "missing", type: "page", pageId: ids.about, label: "Missing" },
    ];
    await expect(reference.prepare()).rejects.toThrow("navigation page references");
    const collection = await fixture();
    collection.body.navigation[0].items = [
      { id: "missing", type: "collection", collection: "missing", label: "Missing" },
    ];
    await expect(collection.prepare()).rejects.toThrow("navigation collection references");
  });

  it("fails closed when a pages document claims a dedicated framework route or no known custom route owner exists", async () => {
    const pages = await fixture();
    pages.set.comparisonInputs.informationArchitecture[0].route = "/blog/article";
    pages.body.documents[1].data.slug = "blog/article";
    await expect(pages.prepare()).rejects.toThrow("framework-owned dedicated route");
    for (const route of ["/members/login", "/members/register"]) {
      const members = await fixture();
      members.set.comparisonInputs.informationArchitecture[0].route = route;
      members.body.documents[1].data.slug = route.slice(1);
      await expect(members.prepare()).rejects.toThrow("framework-owned dedicated route");
    }
    for (const route of ["/login", "/ko/members/login"]) {
      const ordinary = await fixture();
      ordinary.set.comparisonInputs.informationArchitecture[0].route = route;
      ordinary.body.documents[1].data.slug = route.replace(/^\/ko/u, "").slice(1);
      if (route.startsWith("/ko/")) {
        ordinary.set.comparisonInputs.informationArchitecture[0].locale = "ko";
        ordinary.set.comparisonInputs.sampleContent[0].locale = "ko";
        ordinary.body.documents[1].locale = "ko";
      }
      expect((await ordinary.prepare()).pageDocuments[0].route).toBe(route);
    }
    const custom = await fixture();
    custom.body.documents = [
      {
        documentId: ids.home,
        collection: "articles",
        locale: null,
        translationGroupId: null,
        dependsOnDocumentIds: [],
        data: { title: "Article" },
        provenance: "demo",
      },
    ];
    custom.body.navigation = [];
    for (const direction of custom.set.directions)
      direction.pageBindings[0] = {
        pageId: "home",
        source: "custom",
        patternId: null,
        overrides: null,
        templateId: "articles.detail",
        blocks: [],
      };
    await expect(custom.prepare()).rejects.toThrow("explicit supported route owner");
  });

  it("does not claim member preview support from a cookie requirement, pattern or private visibility", async () => {
    for (const source of ["custom", "pattern"] as const) {
      const value = await fixture();
      value.set.comparisonInputs.informationArchitecture[0].audience = "member";
      value.body.documents[1].data.visibility = "private";
      if (source === "pattern")
        for (const direction of value.set.directions)
          direction.pageBindings[0] = {
            pageId: "home",
            source: "pattern",
            patternId: "fixture.home",
            overrides: {},
            templateId: null,
            blocks: structuredClone(blocks),
          };
      const before = structuredClone(value.body);
      await expect(value.prepare()).rejects.toThrow(
        "explicitly supported session-aware route owner",
      );
      expect(value.body).toEqual(before);
      for (const callback of [value.callback, value.component, value.render, value.setup])
        expect(callback).not.toHaveBeenCalled();
    }
  });

  it("rejects private or member-only primary content on the ordinary public route owner", async () => {
    const privatePage = await fixture();
    privatePage.body.documents[1].data.visibility = "private";
    await expect(privatePage.prepare()).rejects.toThrow("require public visibility and audience");
    const audience = await fixture();
    const pages = audience.config.collections[1];
    pages.community = { audience: true };
    pages.fields.push({
      name: "audience",
      type: "select",
      required: true,
      defaultValue: "public",
      options: [
        { label: "Public", value: "public" },
        { label: "Members", value: "members" },
        { label: "Private", value: "private" },
      ],
    });
    audience.body.documents[1].data.audience = "members";
    await audience.reobserve();
    await expect(audience.prepare()).rejects.toThrow("require public visibility and audience");
    audience.body.documents[1].data.audience = "public";
    expect((await audience.prepare()).pageDocuments[0].audience).toBe("public");
  });

  it("projects ordinary article detail data while preserving content and requiring the real template field", async () => {
    const value = await fixture();
    value.set.comparisonInputs.informationArchitecture[0].route = "/blog/article";
    value.body.documents = [
      {
        documentId: ids.home,
        collection: "posts",
        locale: null,
        translationGroupId: null,
        dependsOnDocumentIds: [],
        data: { title: "Article", slug: "article", kind: "article", content: { synthetic: true } },
        provenance: "demo",
      },
    ];
    value.body.navigation = [];
    for (const direction of value.set.directions)
      direction.pageBindings[0] = {
        pageId: "home",
        source: "custom",
        patternId: null,
        overrides: null,
        templateId: "posts.detail",
        blocks: [],
      };
    expect((await value.prepare()).documents[0].data).toEqual({
      title: "Article",
      slug: "article",
      kind: "article",
      content: { synthetic: true },
      template: "detail",
    });
  });

  it("rejects accessors before reading fixture bodies", async () => {
    const value = await fixture();
    const read = vi.fn(() => value.body);
    Object.defineProperty(value.fixtures[0], "body", { get: read, enumerable: true });
    await expect(value.prepare()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("binds a real Forum detail owner to its primary/board fixtures and declares actual member session checks", async () => {
    const value = await forumFixture(),
      before = structuredClone(value.body);
    const result = await value.prepare();
    expect(result.documents).toEqual(value.body.documents);
    expect(result.pageDocuments[0]).toEqual({
      pageId: "home",
      documentId: ids.home,
      collection: "forum-posts",
      route: `/boards/members/${ids.home}`,
      locale: null,
      audience: "member",
      templateId: "detail",
      sessionRequired: "member",
      anonymousWithholdingRequired: true,
      routeOwner: {
        kind: "forum-post-detail",
        package: "@nexpress/plugin-forum",
        contentDigest: value.capsule.packages.find(
          (entry) => entry.name === "@nexpress/plugin-forum",
        )!.contentDigest,
        pattern: "/boards/:boardKey/:postId",
        boardDocumentId: ids.category,
      },
    });
    expect(result.documents[1].data).not.toHaveProperty("template");
    expect(value.body).toEqual(before);
    expect(value.callback).not.toHaveBeenCalled();
    expect(value.component).not.toHaveBeenCalled();
  });

  it("rejects Forum route ids, board scope, visibility/audience, body and selected-block mismatches", async () => {
    for (const change of ["id", "board", "audience", "private", "body", "blocks"] as const) {
      const value = await forumFixture();
      if (change === "id")
        value.set.comparisonInputs.informationArchitecture[0].route = `/boards/members/${ids.about}`;
      if (change === "board") value.body.documents[1].data.board = ids.about;
      if (change === "audience") value.body.documents[1].data.audience = "public";
      if (change === "private") value.body.documents[1].data.visibility = "private";
      if (change === "body") delete value.body.documents[1].data.body;
      if (change === "blocks")
        value.set.directions[0].pageBindings[0].blocks = structuredClone(blocks);
      await expect(value.prepare()).rejects.toThrow(
        /Forum primary|Forum fixtures|actual rich-text body/,
      );
    }
  });

  it("requires a host-minted Forum descriptor and rejects pages/theme/plugin route shadowing", async () => {
    const missing = await forumFixture();
    missing.owners.find((entry) => entry.value === missing.forum.plugin)!.routes = [];
    await expect(missing.prepare()).rejects.toThrow("session-aware route owner");
    const copied = await forumFixture();
    copied.owners.find((entry) => entry.value === copied.forum.plugin)!.routes = [
      { ...copied.forum.buildRouteOwner },
    ];
    await expect(copied.prepare()).rejects.toThrow("exact source-owned");
    const shadow = await forumFixture();
    shadow.body.documents.push({
      documentId: ids.about,
      collection: "pages",
      locale: "en",
      translationGroupId: ids.translation,
      dependsOnDocumentIds: [],
      data: { title: "Shadow", slug: `boards/members/${ids.home}` },
      provenance: "demo",
    });
    await expect(shadow.prepare()).rejects.toThrow("auxiliary pages document");
    const theme = await forumFixture();
    (theme.config.themes![0] as NpTheme).impl.routes = [
      { pattern: "/boards/:boardKey/:postId", component: () => null },
    ];
    await theme.reobserve();
    await expect(theme.prepare()).rejects.toThrow("selected theme route");
    const plugin = await forumFixture();
    Object.assign(plugin.config.plugins![0], {
      pageRoutes: [{ pattern: "/boards/:boardKey/:postId", component: () => null }],
    });
    await plugin.reobserve();
    await expect(plugin.prepare()).rejects.toThrow("plugin route collision");
    const template = await forumFixture();
    (template.config.themes![0] as NpTheme).impl.templates = {
      ...(template.config.themes![0] as NpTheme).impl.templates,
      "forum-posts": { detail: { label: "Different owner", component: () => null } },
    };
    await template.reobserve();
    await expect(template.prepare()).rejects.toThrow("session-aware route owner");
  });
});
