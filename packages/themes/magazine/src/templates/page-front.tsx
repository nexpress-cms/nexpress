import { findDocuments } from "@nexpress/core";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import type { MagazinePostCardDoc } from "../components/post-card.js";
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
 * Operators who want a marketing-style home page just pick a different
 * template (e.g. the default `pages.default` template) from the admin
 * picker — the seeded home page ships with `template: "front"` so the
 * design renders out of the box.
 */
export async function PageFrontTemplate(props: NpTemplateRenderProps) {
  const result = await findDocuments<MagazinePostCardDoc>("posts", {
    where: { status: "published" },
    sort: "-publishedAt",
    limit: 20,
  });
  const docs = result.docs;
  const fauxDoc = { docs };
  return PostListTemplate({ doc: fauxDoc, blockCtx: props.blockCtx });
}
