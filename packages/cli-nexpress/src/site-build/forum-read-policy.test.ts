import { describe, expect, it } from "vitest";
import vector from "../../../core/src/build-contract/__fixtures__/renderer-v1.json" with { type: "json" };
import { npRequireAgentBuildDirectionRendererV1 } from "@nexpress/core/agent-contract";
import { observeSiteBuildForumReadRequestsV1 } from "./forum-read-policy.js";
import {
  isSiteBuildBrowserRequestAllowedV1,
  requireSiteBuildBrowserRequestPolicyV1,
} from "./browser-request-policy.js";

const renderer = npRequireAgentBuildDirectionRendererV1(JSON.parse(vector.structured[0].canonical));
renderer.packages.push({
  name: "@nexpress/plugin-forum",
  version: "0.4.6",
  contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
});
renderer.packages.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
const fixture = () => ({
  schemaVersion: "np.configured-build-render-fixture.v1",
  pageDocuments: [
    {
      collection: "communityPosts",
      documentId: "00000000-0000-4000-8000-000000000001",
      audience: "member",
      sessionRequired: "member",
      anonymousWithholdingRequired: true,
      routeOwner: {
        kind: "forum-post-detail",
        package: "@nexpress/plugin-forum",
        contentDigest: `npkg1:sha256:${"A".repeat(43)}`,
      },
    },
  ],
});
describe("projected Forum read inventory", () => {
  it("binds exact synthetic targets to the installed owner without adding mutation or arbitrary API authority", () => {
    const readRequests = observeSiteBuildForumReadRequestsV1(fixture(), renderer);
    expect(readRequests).toHaveLength(7);
    const policy = requireSiteBuildBrowserRequestPolicyV1({
      documentPaths: [],
      imagePaths: [],
      imageWidths: [],
      imageQualities: [],
      readRequests,
    });
    for (const request of readRequests) {
      expect(
        isSiteBuildBrowserRequestAllowedV1(request, "GET", "http://127.0.0.1:18080", [], policy),
      ).toBe(true);
      expect(
        isSiteBuildBrowserRequestAllowedV1(request, "POST", "http://127.0.0.1:18080", [], policy),
      ).toBe(false);
    }
    expect(
      isSiteBuildBrowserRequestAllowedV1(
        "/api/admin/users",
        "GET",
        "http://127.0.0.1:18080",
        [],
        policy,
      ),
    ).toBe(false);
  });
  it("rejects unbound package, malformed target and missing member withholding instead of broadening the policy", () => {
    const wrong = fixture();
    wrong.pageDocuments[0].routeOwner.contentDigest = `npkg1:sha256:${"B".repeat(43)}`;
    expect(() => observeSiteBuildForumReadRequestsV1(wrong, renderer)).toThrow();
    const target = fixture();
    target.pageDocuments[0].collection = "communityPosts&private=value";
    expect(() => observeSiteBuildForumReadRequestsV1(target, renderer)).toThrow();
    const withholding = fixture();
    withholding.pageDocuments[0].anonymousWithholdingRequired = false;
    expect(() => observeSiteBuildForumReadRequestsV1(withholding, renderer)).toThrow();
  });
});
