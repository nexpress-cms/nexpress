import { renderBlocks } from "@nexpress/blocks";
import type { NxPageBlocks } from "@nexpress/blocks";

import type { NxTemplateRenderProps } from "@nexpress/theme";

export function PageDefaultTemplate({ doc }: NxTemplateRenderProps) {
  const blocks = (doc as { blocks?: NxPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <article className="nx-page nx-portfolio-page">
      {title ? <h1>{title}</h1> : null}
      {blocks ? renderBlocks(blocks) : null}
    </article>
  );
}
