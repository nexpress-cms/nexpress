import { describe, expect, it, vi } from "vitest";
import { getRegisteredBlockMetadata } from "@nexpress/blocks";
import { npBuildCanonicalDigest, npBuildFileDigest } from "@nexpress/core/agent-contract";
import type { NpCollectionConfig } from "@nexpress/core";
import { defaultCollections } from "../config-defaults/index.js";
import {
  bindSelection,
  createSiteBuildValidationFixture,
  prepareSiteBuildValidationFixture,
  rawHash,
} from "./__fixtures__/site-build-validation.js";

let defaultFixture: ReturnType<typeof prepareSiteBuildValidationFixture> | undefined;

async function fixture(extraCollection?: NpCollectionConfig) {
  const prepared = extraCollection
    ? await prepareSiteBuildValidationFixture({ extraCollection })
    : await (defaultFixture ??= prepareSiteBuildValidationFixture());
  return createSiteBuildValidationFixture(prepared);
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
