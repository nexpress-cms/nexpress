import {
  npRequireAgentBuildDirectionRendererV1,
  type NpAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { requireSiteBuildBrowserRequestPolicyV1 } from "./browser-request-policy.js";

/** Only a fresh installed route projection may supply these finite synthetic read targets. */
export function observeSiteBuildForumReadRequestsV1(
  projection: unknown,
  rendererValue: NpAgentBuildDirectionRendererV1,
): string[] {
  const renderer = npRequireAgentBuildDirectionRendererV1(rendererValue);
  if (projection === null || typeof projection !== "object" || Array.isArray(projection))
    throw new SiteBuildError("input");
  const body = projection as Record<string, unknown>;
  if (
    body.schemaVersion !== "np.configured-build-render-fixture.v1" ||
    !Array.isArray(body.pageDocuments) ||
    body.pageDocuments.length > 200
  )
    throw new SiteBuildError("input");
  const requests = new Set<string>();
  for (const value of body.pageDocuments) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new SiteBuildError("input");
    const row = value as Record<string, unknown>;
    if (row.routeOwner === undefined) {
      if (row.audience !== "public") throw new SiteBuildError("input");
      continue;
    }
    if (
      row.routeOwner === null ||
      typeof row.routeOwner !== "object" ||
      Array.isArray(row.routeOwner)
    )
      throw new SiteBuildError("input");
    const owner = row.routeOwner as Record<string, unknown>;
    if (
      owner.kind !== "forum-post-detail" ||
      owner.package !== "@nexpress/plugin-forum" ||
      renderer.packages.filter(
        (entry) => entry.name === owner.package && entry.contentDigest === owner.contentDigest,
      ).length !== 1 ||
      typeof row.collection !== "string" ||
      typeof row.documentId !== "string" ||
      !["public", "member"].includes(String(row.audience)) ||
      row.sessionRequired !== (row.audience === "member" ? "member" : "none") ||
      row.anonymousWithholdingRequired !== (row.audience === "member")
    )
      throw new SiteBuildError("input");
    const target = `targetType=${row.collection}&targetId=${row.documentId}`;
    requests.add("/api/members/me");
    requests.add("/api/notifications?count=1");
    requests.add(
      `/api/collections/${row.collection}/${row.documentId}/comments?order=oldest&limit=20&offset=0`,
    );
    requests.add(`/api/reactions?${target}&kind=like`);
    requests.add(`/api/follows/check?${target}`);
    requests.add(`/api/engagement?${target}`);
    requests.add(`/api/community/events?scope=document&${target}`);
  }
  const readRequests = [...requests].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return requireSiteBuildBrowserRequestPolicyV1({
    documentPaths: [],
    imagePaths: [],
    imageWidths: [],
    imageQualities: [],
    readRequests,
  }).readRequests!;
}
