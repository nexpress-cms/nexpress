import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Landing-page template — full-bleed hero from the doc's first
 * block, then the rest of the blocks render edge-to-edge so each
 * one (Hero / FeatureGrid / CTA / Pricing) can use the full
 * viewport width. The page's `title` and `seoDescription` form a
 * fallback hero when the doc has no blocks yet.
 *
 * For pages where the operator wants a single max-width column
 * and a sticky table of contents, pick the "default" template
 * instead.
 */
export function PageLandingTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title ?? "Untitled";
  const intro = (doc as { seoDescription?: string }).seoDescription;

  return (
    <div className="np-page np-page-landing">
      {blocks && blocks.length > 0 ? (
        <div className="np-page-landing-blocks">{renderBlocks(blocks, { ctx: blockCtx })}</div>
      ) : (
        <section className="np-page-landing-hero">
          <h1>{title}</h1>
          {intro ? <p className="np-page-landing-intro">{intro}</p> : null}
        </section>
      )}
    </div>
  );
}
