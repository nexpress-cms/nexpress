import type { NpCollectionConfig } from "@nexpress/core";
import { createSiteScopedBlockRenderContext, getSiteMember } from "@nexpress/next";
import { notFound } from "next/navigation";
import { requireForumPostDetailBuildPreviewRoute } from "./routes/forum-post-detail.js";
import { findForumBoardById, isForumPostId, type NpForumRuntime } from "./runtime.js";

import type {
  NpForumBuildPreviewAdapterV1,
  NpForumBuildRouteOwnerV1,
} from "./build-contract-types.js";
import {
  isForumBuildRouteOwnerUnchanged,
  registerForumBuildPreviewAdapter,
  registerForumBuildRouteOwner,
} from "./build-identity.js";

export { npIsForumBuildRouteOwnerV1, npIsForumBuildPreviewAdapterV1 } from "./build-contract.js";
export type {
  NpForumBuildRouteOwnerV1,
  NpForumBuildPreviewAdapterV1,
} from "./build-contract-types.js";
type DetailComponent = NpForumBuildRouteOwnerV1["routeComponent"];

/** Internal factory over this createForum instance's actual normal route and collections. */
export function createForumBuildRouteOwnerV1(
  runtime: NpForumRuntime,
  route: NpForumBuildRouteOwnerV1["route"],
  boardCollection: NpCollectionConfig,
  postCollection: NpCollectionConfig,
): NpForumBuildRouteOwnerV1 {
  const detail = route.component;
  const renderTemplate = async (
    { doc, blockCtx }: Parameters<NpForumBuildRouteOwnerV1["template"]["component"]>[0],
    handler: DetailComponent,
  ) => {
    if (!isForumPostId(doc.id) || !isForumPostId(doc.board)) notFound();
    const member = await getSiteMember();
    const board = await findForumBoardById(runtime, doc.board, member?.id ?? null);
    if (!board) notFound();
    // The existing normal handler re-reads the document and applies its actual
    // board, lifecycle, session and audience gates. This is no preview bypass.
    return handler({
      params: { boardKey: board.key, postId: doc.id },
      searchParams: {},
      blockCtx: blockCtx ?? (await createSiteScopedBlockRenderContext()),
    });
  };
  const component: NpForumBuildRouteOwnerV1["template"]["component"] = (props) =>
    renderTemplate(props, detail);
  const owner: NpForumBuildRouteOwnerV1 = Object.freeze({
    kind: "forum-post-detail",
    pluginId: "forum",
    route,
    routeComponent: detail,
    routePattern: route.pattern,
    routeMetadata: Reflect.get(route, "metadata"),
    templateId: "detail",
    template: { label: "Forum post detail", component },
    templateComponent: component,
    boardCollection,
    postCollection,
    postBoardField: "board",
    boardKeyField: "key",
    boardSkinField: "skin",
    skinIds: Object.freeze([...runtime.skins.keys()].sort()),
    createReadOnlyPreviewAdapter: () => {
      if (!isForumBuildRouteOwnerUnchanged(owner))
        throw new Error("Forum build preview source owner changed.");
      const preview = requireForumPostDetailBuildPreviewRoute(detail);
      const renderRoute: DetailComponent = async (props) => {
        if (!isForumBuildRouteOwnerUnchanged(owner))
          throw new Error("Forum build preview source owner changed.");
        return await preview(props);
      };
      const adapter: NpForumBuildPreviewAdapterV1 = Object.freeze({
        scope: "forum-build-preview-analytics-only",
        owner,
        route,
        template: owner.template,
        renderRoute,
        renderTemplate: (props: Parameters<NpForumBuildRouteOwnerV1["template"]["component"]>[0]) =>
          renderTemplate(props, renderRoute),
      });
      registerForumBuildPreviewAdapter(adapter);
      return adapter;
    },
  });
  registerForumBuildRouteOwner(owner);
  return owner;
}
