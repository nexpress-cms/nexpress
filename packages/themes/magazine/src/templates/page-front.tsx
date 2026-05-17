import { fetchFrontListPosts } from "@nexpress/next";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import { PostListTemplate } from "./post-list.js";

/**
 * Magazine front-page template.
 *
 * Pages doc with `template: "front"` (typically the home `/`) renders
 * the editorial index — lead + 3-up + dispatches + archive + subscribe
 * — pulling posts from the server at request time. Delegates to
 * `PostListTemplate` after fetching so both `/blog` (route-driven post
 * list) and `/` (page-with-front-template) share one source of truth
 * for the visual.
 *
 * Scoped to `kind: "article"` so a multi-theme install that also has
 * portfolio's `kind: "project"` posts doesn't surface them in the
 * editorial layout. Today's single-active-theme install is fine
 * either way; the filter keeps the layout correct as soon as
 * cross-kind installs land.
 *
 * Operators who want a marketing-style home page just pick a different
 * template (e.g. the default `pages.default` template) from the admin
 * picker — the seeded home page ships with `template: "front"` so the
 * design renders out of the box.
 */
export async function PageFrontTemplate(props: NpTemplateRenderProps) {
  const docs = await fetchFrontListPosts({ kind: "article", limit: 20 });
  return PostListTemplate({ doc: { docs }, blockCtx: props.blockCtx });
}
