import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/direction-v1.json" with { type: "json" };
import {
  npBuildCanonicalDigest,
  npBuildCanonicalBytes,
  npBuildDirectionProjectionV1,
  npBuildDesignDirectionDraftSetBytesV1,
  npParseAgentDesignDirectionDraftSetV1,
  npRequireAgentDesignComparisonInputsV1,
  npRequireAgentDesignDirectionDraftSetV1,
  npRequireAgentDesignDirectionSetV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildRenderReceiptBindingsV1,
  npRequireAgentDesignDirectionProjectionV1,
} from "./index.js";

const draft = () => npRequireAgentDesignDirectionDraftSetV1(structuredClone(fixture.draftSet));
const sealed = () => npRequireAgentDesignDirectionSetV1(structuredClone(fixture.set));

describe("Build comparable direction proposals", () => {
  it("transports drafts in stable key order without accepting sealed evidence", () => {
    const original = draft();
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    expect(npBuildDesignDirectionDraftSetBytesV1(reordered)).toEqual(
      npBuildDesignDirectionDraftSetBytesV1(original),
    );
    expect(() => npBuildDesignDirectionDraftSetBytesV1(fixture.set)).toThrow();
  });
  it("binds exactly three drafts to one complete comparison and resolved brief, without image provenance", async () => {
    const value = draft();
    expect(await npRequireBuildDirectionSetForBriefV1(fixture.brief, value, "draft")).toEqual(
      value,
    );
    expect(await npRequireBuildDirectionSetForBriefV1(fixture.brief, sealed(), "sealed")).toEqual(
      sealed(),
    );
    const invalid = structuredClone(fixture.draftSet);
    Reflect.set(
      invalid.directions[0],
      "previewArtifact",
      fixture.set.directions[0].previewArtifact,
    );
    expect(() => npRequireAgentDesignDirectionDraftSetV1(invalid)).toThrow();
    value.directions[2].id = value.directions[0].id;
    expect(() => npRequireAgentDesignDirectionDraftSetV1(value)).toThrow();
    await expect(
      npRequireBuildDirectionSetForBriefV1(
        { ...fixture.brief, unresolved: ["Author model?"] },
        draft(),
        "draft",
      ),
    ).rejects.toThrow();
  });

  it("rejects missing/foreign/incorrectly localized fixtures, IA pages and binding inventories", () => {
    const fixtures = draft().comparisonInputs;
    fixtures.sampleContent[0].pageId = "foreign";
    expect(() => npRequireAgentDesignComparisonInputsV1(fixtures)).toThrow();
    const value = draft();
    value.directions[0].pageBindings[0].pageId = "foreign";
    expect(() => npRequireAgentDesignDirectionDraftSetV1(value)).toThrow();
    value.directions[0].pageBindings[0].pageId = "home";
    value.comparisonInputs.sampleContent[0].locale = "en";
    expect(() => npRequireAgentDesignDirectionDraftSetV1(value)).toThrow();
    value.comparisonInputs.sampleContent[0].locale = null;
    value.directions[0].pageBindings[0].templateId = "undeclared";
    expect(() => npRequireAgentDesignDirectionDraftSetV1(value)).toThrow();
  });

  it("preserves ordinary registered rich-text envelopes inside direction and set wrappers", () => {
    const value = draft();
    const content = {
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
                  text: "한국어와 English fixture",
                },
              ],
            },
          ],
        },
      },
    };
    for (const direction of value.directions)
      direction.pageBindings[0].blocks = [
        { id: "rich-text", type: "rich-text", props: { content: structuredClone(content) } },
      ];
    const parsed = npRequireAgentDesignDirectionDraftSetV1(value);
    expect(
      npParseAgentDesignDirectionDraftSetV1(
        new TextDecoder().decode(npBuildDesignDirectionDraftSetBytesV1(value)),
      ),
    ).toEqual(parsed);
    expect(parsed.directions[0].pageBindings[0].blocks[0].props).toEqual({ content });
    const projection = npBuildDirectionProjectionV1(parsed.directions[0]);
    for (const direction of parsed.directions)
      direction.pageBindings[0].blocks = [
        { id: "section", type: "section", props: {}, children: direction.pageBindings[0].blocks },
      ];
    expect(() =>
      npBuildCanonicalBytes(
        "np.build-design-direction-projection.v1",
        npBuildDirectionProjectionV1(parsed.directions[0]),
      ),
    ).not.toThrow();
    expect(
      npParseAgentDesignDirectionDraftSetV1(
        new TextDecoder().decode(npBuildDesignDirectionDraftSetBytesV1(parsed)),
      ),
    ).toEqual(parsed);
    let nested: unknown = "too deep";
    for (let i = 0; i < 30; i++) nested = { child: nested };
    expect(() =>
      npRequireAgentDesignDirectionProjectionV1({
        ...projection,
        pageBindings: [
          {
            ...projection.pageBindings[0],
            blocks: [{ id: "deep", type: "rich-text", props: { content: nested } }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects stale comparison digests and changed projections independently of the stored hashes", async () => {
    const value = draft();
    value.comparisonInputs.sampleContent[0].data.title = "Changed sample";
    await expect(
      npRequireBuildDirectionSetForBriefV1(fixture.brief, value, "draft"),
    ).rejects.toThrow();
    const final = sealed();
    final.directions[0].layout.density = "spacious";
    await expect(
      npRequireBuildDirectionSetForBriefV1(fixture.brief, final, "sealed"),
    ).rejects.toThrow();
    const projection = npBuildDirectionProjectionV1(draft().directions[0]);
    expect(
      await npBuildCanonicalDigest("np.build-design-direction-projection.v1", projection),
    ).toBe(sealed().directions[0].projectionDigest);
  });

  it("rejects cross-direction, reused, wrongly sized montage bindings and expired lifetime shapes", () => {
    const value = sealed();
    value.directions[0].previewArtifact.mobile.directionId = value.directions[1].id;
    expect(() => npRequireAgentDesignDirectionSetV1(value)).toThrow();
    const duplicate = sealed();
    duplicate.directions[1].previewArtifact.mobile.relativePath =
      duplicate.directions[0].previewArtifact.mobile.relativePath;
    expect(() => npRequireAgentDesignDirectionSetV1(duplicate)).toThrow();
    const viewport = sealed();
    viewport.directions[0].previewArtifact.mobile.viewport.width = 1440;
    expect(() => npRequireAgentDesignDirectionSetV1(viewport)).toThrow();
    const ttl = sealed();
    ttl.directions[0].previewArtifact.desktop.expiresAt = "2026-10-22T00:00:00.000Z";
    expect(() => npRequireAgentDesignDirectionSetV1(ttl)).toThrow();
  });

  it("matches exact source/receipt digests while retaining their diagnostic-only authority", async () => {
    expect(await npRequireBuildRenderReceiptBindingsV1(fixture.source, fixture.record)).toEqual(
      fixture.record,
    );
    const source = structuredClone(fixture.source);
    source.rendererFingerprint = "nb1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
    await expect(npRequireBuildRenderReceiptBindingsV1(source, fixture.record)).rejects.toThrow();
    const record = structuredClone(fixture.record);
    record.body.viewportName = "mobile";
    await expect(npRequireBuildRenderReceiptBindingsV1(fixture.source, record)).rejects.toThrow();
  });

  it("rejects accessors before reading projection properties", () => {
    const direction = draft().directions[0];
    let reads = 0;
    Object.defineProperty(direction, "id", {
      get() {
        reads++;
        return "secret";
      },
      enumerable: true,
    });
    expect(() => npBuildDirectionProjectionV1(direction)).toThrow();
    expect(reads).toBe(0);
  });

  it("supports 200 IA pages and 1000 fixtures with exact three-way binding coverage", async () => {
    const value = draft();
    value.comparisonInputs.informationArchitecture = Array.from({ length: 200 }, (_, index) => {
      const pageId = `page-${index.toString().padStart(3, "0")}`;
      return {
        pageId,
        route: `/${pageId}`,
        purpose: "Demo",
        audience: "public",
        locale: null,
        fixtureIds: Array.from({ length: 5 }, (_, i) => `${pageId}-fixture-${i}`),
      };
    });
    value.comparisonInputs.sampleContent = value.comparisonInputs.informationArchitecture.flatMap(
      (page) =>
        page.fixtureIds.map((id) => ({
          id,
          pageId: page.pageId,
          locale: null,
          label: "Demo",
          data: { title: "Demo" },
        })),
    );
    value.comparisonInputs.previewPageIds = [
      value.comparisonInputs.informationArchitecture[0].pageId,
    ];
    value.comparisonInputsDigest = await npBuildCanonicalDigest(
      "np.build-design-comparison-inputs.v1",
      value.comparisonInputs,
    );
    for (const direction of value.directions) {
      direction.comparisonInputsDigest = value.comparisonInputsDigest;
      direction.pageBindings = value.comparisonInputs.informationArchitecture.map((page) => ({
        pageId: page.pageId,
        source: "custom",
        patternId: null,
        overrides: null,
        templateId: "home",
        blocks: [],
      }));
    }
    expect(
      (await npRequireBuildDirectionSetForBriefV1(fixture.brief, value, "draft")).directions,
    ).toHaveLength(3);
    value.comparisonInputs.informationArchitecture.push({
      ...value.comparisonInputs.informationArchitecture[0],
      pageId: "extra",
      route: "/extra",
    });
    expect(() => npRequireAgentDesignDirectionDraftSetV1(value)).toThrow();
  });
});
