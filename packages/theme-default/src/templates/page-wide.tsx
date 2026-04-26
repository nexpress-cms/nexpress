import { renderBlocks } from "@nexpress/blocks";
import type { NxPageBlocks } from "@nexpress/blocks";

import type { NxTemplateRenderProps } from "@nexpress/theme";

/**
 * Wide page template — drops the centered max-width
 * container so blocks render edge-to-edge. Useful for
 * landing pages, hero-led marketing pages, embedded media
 * grids.
 *
 * The `nx-page-wide` class is what the CSS hooks into to
 * remove the default `nx-page`'s max-width constraint;
 * theme CSS sets `.nx-page-wide { max-width: none }` so
 * the rule is theme-owned (a different theme's wide variant
 * could use a different breakpoint).
 */
export function PageWideTemplate({ doc }: NxTemplateRenderProps) {
  const blocks = (doc as { blocks?: NxPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <div className="nx-page nx-page-wide">
      {blocks ? renderBlocks(blocks) : <h1>{title ?? "Untitled"}</h1>}
    </div>
  );
}
