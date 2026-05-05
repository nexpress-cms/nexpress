import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Magazine default page — narrow centered column with the
 * magazine type ramp. Uses the same `.np-page` baseline so
 * cross-theme content primitives (links, images, headings)
 * inherit correctly.
 */
export function PageDefaultTemplate({ doc }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <article className="np-page np-magazine-default">
      {title ? <h1>{title}</h1> : null}
      {blocks ? renderBlocks(blocks) : null}
    </article>
  );
}
