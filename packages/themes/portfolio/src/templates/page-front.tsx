import { fetchFrontListPosts } from "@nexpress/next";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import { ProjectIndexTemplate } from "./project-index.js";

/**
 * Portfolio front-page template.
 *
 * Pages doc with `template: "front"` (typically the home `/`) renders
 * the studio front page — hero + filter tablist + 12-col asymmetric
 * grid + studio strip + contact strip — pulling projects from the
 * server at request time. Delegates to `ProjectIndexTemplate` after
 * fetching so both `/work` (post-list route) and `/` (page-with-front-
 * template) share one source of truth for the visual.
 *
 * Scoped to `kind: "project"` so a multi-theme install that also has
 * magazine's `kind: "article"` posts doesn't surface them in the
 * studio grid. Today's single-active-theme install is fine either
 * way; the filter keeps the layout correct as soon as cross-kind
 * installs land.
 *
 * Operators who want a marketing-style home page just pick a different
 * template (e.g. the default `pages.default` template) from the admin
 * picker — the seeded home page ships with `template: "front"` so the
 * design renders out of the box.
 */
export async function PageFrontTemplate(props: NpTemplateRenderProps) {
  const docs = await fetchFrontListPosts({ kind: "project", limit: 24 });
  return ProjectIndexTemplate({ doc: { docs }, blockCtx: props.blockCtx });
}
