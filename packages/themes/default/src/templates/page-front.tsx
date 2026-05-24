import { fetchFrontListPosts } from "@nexpress/next";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import { createDefaultPostListDoc, PostListTemplate } from "./post-list.js";

/**
 * Default theme front page.
 *
 * The seeded `/` page uses this template so a fresh install lands on
 * the Equilibrium writing index from the design handoff instead of a
 * framework marketing page. `/blog` delegates to the same post-list
 * template through the framework route, keeping both surfaces aligned.
 */
export async function PageFrontTemplate(props: NpTemplateRenderProps) {
  const docs = await fetchFrontListPosts({ kind: "article", limit: 20 });
  return PostListTemplate({
    doc: createDefaultPostListDoc(docs) as Record<string, unknown>,
    blockCtx: props.blockCtx,
  });
}
