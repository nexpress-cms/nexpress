import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageDefaultTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <article className="np-page np-portfolio-page">
      {title ? <h1>{title}</h1> : null}
      {blocks ? renderBlocks(blocks, { ctx: blockCtx }) : null}
    </article>
  );
}
