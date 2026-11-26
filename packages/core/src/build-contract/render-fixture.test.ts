import { describe, expect, it } from "vitest";
import {
  npRequireAgentBuildRenderFixtureV1,
  npRequireAgentBuildRenderFixtureRefV1,
} from "./index.js";
const id = "00000000-0000-4000-8000-000000000001";
const document = {
  documentId: id,
  collection: "pages",
  locale: null,
  translationGroupId: null,
  dependsOnDocumentIds: [],
  data: { title: "합성 문서", slug: "/" },
  provenance: "demo",
};
const fixture = () => ({
  schemaVersion: "np.agent-build-render-fixture.v1",
  documents: [structuredClone(document)],
  navigation: [],
});

describe("synthetic render fixture owners", () => {
  it("accepts detached demo datasets and exact local byte-bound references", () => {
    const original = fixture();
    const parsed = npRequireAgentBuildRenderFixtureV1(original);
    parsed.documents[0].data.title = "Detached";
    expect(original.documents[0].data.title).toBe("합성 문서");
    const reference = {
      schemaVersion: "np.agent-build-render-fixture-ref.v1",
      stagedArtifactPath: ".nexpress/site/fixtures/shared.json",
      digest: `nb1:file-sha256:${"A".repeat(43)}`,
      pageDocumentId: id,
    };
    expect(npRequireAgentBuildRenderFixtureRefV1(reference)).toEqual(reference);
    for (const path of [
      ".env",
      ".nexpress/site/fixtures/../secret.json",
      ".nexpress/site/fixtures/data.js",
      ".nexpress/site/fixtures/.env.json",
    ])
      expect(() =>
        npRequireAgentBuildRenderFixtureRefV1({ ...reference, stagedArtifactPath: path }),
      ).toThrow();
  });
  it("rejects unsupported ownership, live provenance and incomplete/cyclic document dependencies", () => {
    for (const data of [
      { ...fixture(), extra: true },
      { ...fixture(), documents: [{ ...document, provenance: "live" }] },
      { ...fixture(), documents: [{ ...document, dependsOnDocumentIds: [id] }] },
      {
        ...fixture(),
        documents: [
          { ...document, dependsOnDocumentIds: ["00000000-0000-4000-8000-000000000002"] },
        ],
      },
      { ...fixture(), documents: [document, document] },
      { ...fixture(), documents: [{ ...document, data: { related: { $ref: "other" } } }] },
    ])
      expect(() => npRequireAgentBuildRenderFixtureV1(data)).toThrow();
  });
});
