import { SiteBuildError } from "./artifact-io.js";
import {
  createSiteBuildBrowserPreviewProgramV1,
  path,
  type NpSiteBuildBrowserPreviewInputV1,
} from "./browser-preview-probes.js";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SiteBuildError("input");
  return value as Record<string, unknown>;
};

/**
 * Internal owner for the native worker's actual configured fixture projection.
 * The driver calls this after that worker succeeds. An authored fixture or this
 * function's return value alone is never execution or route-owner provenance.
 * Expectations follow the ordinary page/article and Forum metadata owners.
 */
export function deriveSiteBuildFixturePreviewContextV1(input: {
  fixture: unknown;
  pageId: string;
  route: string;
  locale: string;
  renderer: unknown;
}): Omit<NpSiteBuildBrowserPreviewInputV1, "phase"> {
  const fail = (): never => {
    throw new SiteBuildError("input");
  };
  const fixture = record(input.fixture);
  if (
    fixture.schemaVersion !== "np.configured-build-render-fixture.v1" ||
    !Array.isArray(fixture.pageDocuments) ||
    !Array.isArray(fixture.documents) ||
    !Array.isArray(fixture.navigation) ||
    fixture.pageDocuments.length > 200
  )
    return fail();
  const matches = fixture.pageDocuments.filter((value) => record(value).pageId === input.pageId);
  if (matches.length !== 1) return fail();
  const page = record(matches[0]);
  if (page.route !== input.route || (page.locale !== null && page.locale !== input.locale))
    return fail();
  const documents = fixture.documents.filter(
    (value) => record(value).documentId === page.documentId,
  );
  if (documents.length !== 1) return fail();
  const document = record(documents[0]);
  if (document.collection !== page.collection) return fail();
  const data = record(document.data);
  let metadata: NpSiteBuildBrowserPreviewInputV1["metadata"];
  if (page.routeOwner !== undefined) {
    const owner = record(page.routeOwner);
    const packages = record(input.renderer).packages;
    if (
      owner.kind !== "forum-post-detail" ||
      owner.package !== "@nexpress/plugin-forum" ||
      typeof owner.pattern !== "string" ||
      !Array.isArray(packages) ||
      packages.filter((value) => {
        const installed = record(value);
        return installed.name === owner.package && installed.contentDigest === owner.contentDigest;
      }).length !== 1 ||
      !owner.pattern.endsWith("/:boardKey/:postId")
    )
      return fail();
    const base = path(owner.pattern.slice(0, -"/:boardKey/:postId".length));
    const prefix = `/${input.locale}`;
    const route = input.route.startsWith(prefix + "/")
      ? input.route.slice(prefix.length)
      : input.route;
    if (!route.startsWith(base + "/")) return fail();
    if (page.audience === "member") {
      if (page.sessionRequired !== "member" || page.anonymousWithholdingRequired !== true)
        return fail();
      metadata = {
        owner: "forum-member",
        canonicalPath: base,
        descriptionRequired: true,
        structuredData: "forbidden",
      };
    } else if (page.audience === "public" && page.sessionRequired === "none") {
      metadata = {
        owner: "forum-public",
        canonicalPath: path(route),
        descriptionRequired: true,
        structuredData: "required",
      };
    } else return fail();
  } else {
    if (page.audience !== "public" || !["pages", "posts"].includes(String(page.collection)))
      return fail();
    metadata = {
      owner: "page",
      canonicalPath: path(input.route),
      descriptionRequired:
        page.collection === "pages" ||
        (typeof data.excerpt === "string" && data.excerpt.trim().length > 0) ||
        (typeof data.seoMetaDescription === "string" && data.seoMetaDescription.trim().length > 0),
      structuredData: page.collection === "posts" ? "required" : "optional",
    };
  }
  const header = fixture.navigation.filter((value) => record(value).location === "header");
  if (header.length > 1) return fail();
  const items = header.length ? record(header[0]).items : [];
  if (!Array.isArray(items)) return fail();
  const result: Omit<NpSiteBuildBrowserPreviewInputV1, "phase"> = {
    themePackage: String(record(fixture.theme).package),
    origin: "http://127.0.0.1:18080",
    route: input.route,
    locale: input.locale,
    headerNavigation: items.length ? "present" : "empty",
    metadata,
  };
  // Reuse the same closed transport owner as the actual isolated-world programs.
  createSiteBuildBrowserPreviewProgramV1({ ...result, phase: "document" });
  return result;
}
