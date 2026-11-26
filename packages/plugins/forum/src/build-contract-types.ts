import type { NpCollectionConfig, NpPageTemplateRenderProps } from "@nexpress/core";
import type { NpRouteRenderProps } from "@nexpress/next";
import type { ReactElement } from "react";

type DetailComponent = (props: NpRouteRenderProps) => Promise<ReactElement>;

export interface NpForumBuildRouteOwnerV1 {
  readonly kind: "forum-post-detail";
  readonly pluginId: "forum";
  readonly route: { pattern: string; component: DetailComponent };
  readonly routeComponent: DetailComponent;
  readonly routePattern: string;
  readonly routeMetadata: unknown;
  readonly templateId: "detail";
  readonly template: {
    label: string;
    component: (
      props: NpPageTemplateRenderProps<Record<string, unknown>, NpRouteRenderProps["blockCtx"]>,
    ) => ReturnType<DetailComponent>;
  };
  readonly templateComponent: NpForumBuildRouteOwnerV1["template"]["component"];
  readonly boardCollection: NpCollectionConfig;
  readonly postCollection: NpCollectionConfig;
  readonly postBoardField: "board";
  readonly boardKeyField: "key";
  readonly boardSkinField: "skin";
  readonly skinIds: readonly string[];
  /** Host-only opt-in; ordinary pageRoutes and templates remain unchanged. */
  readonly createReadOnlyPreviewAdapter: () => NpForumBuildPreviewAdapterV1;
}

export interface NpForumBuildPreviewAdapterV1 {
  readonly scope: "forum-build-preview-analytics-only";
  readonly owner: NpForumBuildRouteOwnerV1;
  readonly route: NpForumBuildRouteOwnerV1["route"];
  readonly template: NpForumBuildRouteOwnerV1["template"];
  readonly renderRoute: DetailComponent;
  readonly renderTemplate: NpForumBuildRouteOwnerV1["template"]["component"];
}
