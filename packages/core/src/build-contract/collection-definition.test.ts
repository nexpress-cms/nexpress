import { describe, expect, it } from "vitest";
import {
  npProjectBuildCollectionDefinitionV1,
  npRequireAgentBuildCollectionDefinitionV1,
  npBuildCanonicalDigest,
  npRequireBuildBlueprintForBriefV1,
  npRequireAgentSiteBlueprintV1,
} from "./index.js";
import vectors from "./__fixtures__/canonical-v1.json" with { type: "json" };

const capsule = `nb1:sha256:${"A".repeat(43)}`;
const configuration = () => ({
  slug: "notes",
  labels: { singular: "Note", plural: "Notes" },
  fields: [{ name: "title", type: "text", required: true }],
});

describe("source-bound collection definition owner", () => {
  it("preserves ACL, hook, validator and SEO slots without invoking or serializing executable functions", async () => {
    let calls = 0;
    const callback = () => {
      calls++;
      throw new Error("must not execute");
    };
    const config = {
      ...configuration(),
      access: { read: callback, create: callback },
      hooks: { beforeCreate: [callback] },
      seo: { urlPath: callback },
      fields: [{ name: "title", type: "text", validate: callback, admin: { condition: callback } }],
    };
    const definition = npProjectBuildCollectionDefinitionV1(config, capsule);
    expect(definition.callbacks).toEqual([
      "/access/create",
      "/access/read",
      "/fields/0/admin/condition",
      "/fields/0/validate",
      "/hooks/beforeCreate/0",
      "/seo/urlPath",
    ]);
    expect(definition.configuration.access).toEqual({ create: null, read: null });
    expect(definition.sourceCapsuleDigest).toBe(capsule);
    expect(
      npRequireAgentBuildCollectionDefinitionV1(JSON.parse(JSON.stringify(definition))),
    ).toEqual(definition);
    expect(calls).toBe(0);
    const changed = { ...definition, sourceCapsuleDigest: `nb1:sha256:${"B".repeat(42)}A` };
    expect(await npBuildCanonicalDigest("np.build-collection-definition.v1", changed)).not.toBe(
      await npBuildCanonicalDigest("np.build-collection-definition.v1", definition),
    );
  });

  it("reuses actual authoring validation and rejects forged, missing or non-callback pointers", () => {
    const pure = npProjectBuildCollectionDefinitionV1(configuration(), capsule);
    expect(pure.sourceCapsuleDigest).toBeNull();
    expect(pure.callbacks).toEqual([]);
    expect(() =>
      npProjectBuildCollectionDefinitionV1(
        { ...configuration(), fields: [{ name: "id", type: "text" }] },
        capsule,
      ),
    ).toThrow();
    expect(() =>
      npProjectBuildCollectionDefinitionV1({ ...configuration(), access: { read: true } }, capsule),
    ).toThrow();
    expect(() =>
      npProjectBuildCollectionDefinitionV1(
        {
          ...configuration(),
          fields: [{ name: "title", type: "text", defaultValue: () => "hidden code" }],
        },
        capsule,
      ),
    ).toThrow();
    const bound = npProjectBuildCollectionDefinitionV1(
      { ...configuration(), access: { read: () => true } },
      capsule,
    );
    expect(() =>
      npRequireAgentBuildCollectionDefinitionV1({ ...bound, sourceCapsuleDigest: null }),
    ).toThrow();
    expect(() =>
      npRequireAgentBuildCollectionDefinitionV1({
        ...bound,
        callbacks: ["/fields/0/defaultValue"],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentBuildCollectionDefinitionV1({ ...bound, callbacks: ["/hooks/beforeCreate/0"] }),
    ).toThrow();
    expect(() => npRequireAgentBuildCollectionDefinitionV1({ ...bound, callbacks: [] })).toThrow();
  });

  it("rejects accessors and hidden cycles before touching their values, while detaching ordinary shared metadata", () => {
    let reads = 0;
    const accessor = configuration();
    Object.defineProperty(accessor, "access", {
      enumerable: true,
      get() {
        reads++;
        return { read: () => true };
      },
    });
    expect(() => npProjectBuildCollectionDefinitionV1(accessor, capsule)).toThrow();
    expect(reads).toBe(0);
    const shared = { width: "50%" };
    const result = npProjectBuildCollectionDefinitionV1(
      {
        ...configuration(),
        fields: [
          { name: "title", type: "text", admin: shared },
          { name: "summary", type: "text", admin: shared },
        ],
      },
      capsule,
    );
    shared.width = "100%";
    expect(JSON.stringify(result)).not.toContain("100%");
    const cycle: Record<string, unknown> = configuration();
    cycle.extra = cycle;
    expect(() => npProjectBuildCollectionDefinitionV1(cycle, capsule)).toThrow();
  });

  it("requires blueprint collection slug and definition hash to bind the exact owning artifact", async () => {
    const brief = JSON.parse(vectors.structured[0].canonical);
    const blueprint = npRequireAgentSiteBlueprintV1(JSON.parse(vectors.structured[1].canonical));
    blueprint.briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", brief);
    const definition = npProjectBuildCollectionDefinitionV1(configuration(), capsule);
    blueprint.collections = [
      {
        id: "notes",
        action: "create",
        slug: "notes",
        sourcePath: "src/collections/notes.ts",
        expectedSourceHash: null,
        definition,
        definitionHash: await npBuildCanonicalDigest(
          "np.build-collection-definition.v1",
          definition,
        ),
        migrationClass: "additive",
      },
    ];
    // A source write must still be declared by the existing blueprint file-plan owner.
    const staged = blueprint.filePlan[0];
    if (staged.source !== "staged") throw new Error("Expected a staged fixture");
    blueprint.filePlan.push({
      ...staged,
      path: "src/collections/notes.ts",
      owner: "collection",
      stagedArtifactPath: ".nexpress/site/files/notes.ts",
    });
    expect((await npRequireBuildBlueprintForBriefV1(brief, blueprint)).collections).toHaveLength(1);
    blueprint.collections[0].slug = "foreign";
    await expect(npRequireBuildBlueprintForBriefV1(brief, blueprint)).rejects.toThrow();
    blueprint.collections[0].slug = "notes";
    blueprint.collections[0].definitionHash = capsule;
    await expect(npRequireBuildBlueprintForBriefV1(brief, blueprint)).rejects.toThrow();
  });
});
