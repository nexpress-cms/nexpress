import { describe, expect, it } from "vitest";
import { deriveSiteBuildFixturePreviewContextV1 } from "./fixture-preview-context.js";

const digest = `npkg1:sha256:${"A".repeat(43)}`;
function fixture(forum = false, member = false) {
  const page = {
    pageId: "detail",
    documentId: "00000000-0000-4000-8000-000000000001",
    collection: forum ? "communityPosts" : "pages",
    route: forum ? "/ko/community/general/post" : "/ko/about",
    locale: "ko",
    audience: member ? "member" : "public",
    ...(forum
      ? {
          sessionRequired: member ? "member" : "none",
          anonymousWithholdingRequired: member,
          routeOwner: {
            kind: "forum-post-detail",
            package: "@nexpress/plugin-forum",
            contentDigest: digest,
            pattern: "/community/:boardKey/:postId",
          },
        }
      : {}),
  };
  return {
    schemaVersion: "np.configured-build-render-fixture.v1",
    theme: { package: "@nexpress/theme-community" },
    pageDocuments: [page],
    documents: [{ documentId: page.documentId, collection: page.collection, data: {} }],
    navigation: [{ location: "header", items: [{ label: "About", url: "/ko/about" }] }],
  };
}
function observe(value: ReturnType<typeof fixture>) {
  return deriveSiteBuildFixturePreviewContextV1({
    fixture: value,
    renderer: { packages: [{ name: "@nexpress/plugin-forum", contentDigest: digest }] },
    pageId: "detail",
    route: value.pageDocuments[0].route,
    locale: "ko",
  });
}
describe("source-owned preview expectations", () => {
  it("keeps the ordinary page path and uses actual projected header navigation", () => {
    expect(observe(fixture())).toMatchObject({
      headerNavigation: "present",
      metadata: { owner: "page", canonicalPath: "/ko/about", structuredData: "optional" },
    });
    const empty = fixture();
    empty.navigation = [];
    expect(observe(empty).headerNavigation).toBe("empty");
  });
  it("preserves the normal public and member Forum metadata privacy behavior", () => {
    expect(observe(fixture(true))).toMatchObject({
      metadata: {
        owner: "forum-public",
        canonicalPath: "/community/general/post",
        structuredData: "required",
      },
    });
    expect(observe(fixture(true, true))).toMatchObject({
      metadata: {
        owner: "forum-member",
        canonicalPath: "/community",
        structuredData: "forbidden",
      },
    });
    const missingWithholding = fixture(true, true);
    missingWithholding.pageDocuments[0].anonymousWithholdingRequired = false;
    expect(() => observe(missingWithholding)).toThrow();
    const wrongOwner = fixture(true);
    wrongOwner.pageDocuments[0].routeOwner!.contentDigest = digest.replace("A", "B");
    expect(() => observe(wrongOwner)).toThrow();
  });
  it("rejects duplicate or mismatched route/document projections", () => {
    const duplicate = fixture();
    duplicate.pageDocuments.push(duplicate.pageDocuments[0]);
    expect(() => observe(duplicate)).toThrow();
    const wrongDocument = fixture();
    wrongDocument.documents[0].collection = "posts";
    expect(() => observe(wrongDocument)).toThrow();
    const member = fixture(false, true);
    expect(() => observe(member)).toThrow();
  });
  it("accepts the ordinary Forum projection's colon parameters", () => {
    const value = fixture(true, true);
    value.pageDocuments[0].routeOwner!.pattern = "/boards/:boardKey/:postId";
    value.pageDocuments[0].route = "/ko/boards/members/00000000-0000-4000-8000-000000000004";
    expect(observe(value).metadata).toEqual({
      owner: "forum-member",
      canonicalPath: "/boards",
      descriptionRequired: true,
      structuredData: "forbidden",
    });
  });
  it("rejects patterns outside the normal Forum route contract", () => {
    const value = fixture(true, true);
    value.pageDocuments[0].routeOwner!.pattern = "/community/[boardKey]/[postId]";
    expect(() => observe(value)).toThrow();
    value.pageDocuments[0].routeOwner!.pattern = "/community/:postId/:boardKey";
    expect(() => observe(value)).toThrow();
  });
});
