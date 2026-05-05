import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Wide page template — drops the centered max-width
 * container so blocks render edge-to-edge. Useful for
 * landing pages, hero-led marketing pages, embedded media
 * grids.
 *
 * The `np-page-wide` class is what the CSS hooks into to
 * remove the default `np-page`'s max-width constraint;
 * theme CSS sets `.np-page-wide { max-width: none }` so
 * the rule is theme-owned (a different theme's wide variant
 * could use a different breakpoint).
 */
export function PageWideTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <div className="np-page np-page-wide">
      {blocks ? renderBlocks(blocks, { ctx: blockCtx }) : <h1>{title ?? "Untitled"}</h1>}
    </div>
  );
}
