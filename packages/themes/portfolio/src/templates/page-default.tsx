import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageDefaultTemplate({ doc }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <article className="nx-page nx-portfolio-page">
      {title ? <h1>{title}</h1> : null}
      {blocks ? renderBlocks(blocks) : null}
    </article>
  );
}
