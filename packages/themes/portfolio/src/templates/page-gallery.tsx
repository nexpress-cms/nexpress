import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Gallery template — renders the page title centered, then
 * arranges the page's blocks in a two-column responsive grid.
 *
 * Block components themselves don't know about the grid; the
 * template just wraps them so individual `image` blocks share
 * row space. For richer arrangements, themes can branch on
 * the block type — but the simplest case is "drop blocks in,
 * grid takes care of it".
 */
export function PageGalleryTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <section className="np-portfolio-gallery">
      {title ? <h1>{title}</h1> : null}
      <div className="np-portfolio-gallery-grid">
        {blocks ? renderBlocks(blocks, { ctx: blockCtx }) : null}
      </div>
    </section>
  );
}
