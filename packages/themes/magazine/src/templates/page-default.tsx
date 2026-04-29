import { renderBlocks } from "@nexpress/blocks";
import type { NxPageBlocks } from "@nexpress/blocks";

import type { NxTemplateRenderProps } from "@nexpress/theme";

/**
 * Magazine default page — narrow centered column with the
 * magazine type ramp. Uses the same `.nx-page` baseline so
 * cross-theme content primitives (links, images, headings)
 * inherit correctly.
 */
export function PageDefaultTemplate({ doc }: NxTemplateRenderProps) {
  const blocks = (doc as { blocks?: NxPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <article className="nx-page nx-magazine-default">
      {title ? <h1>{title}</h1> : null}
      {blocks ? renderBlocks(blocks) : null}
    </article>
  );
}
