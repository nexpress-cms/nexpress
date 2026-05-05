import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";

import type { NpTemplateRenderProps } from "@nexpress/theme";

/**
 * Default page template — the historical NexPress page render.
 * Wraps the page's blocks (or a fallback heading) in
 * `<div className="np-page">`. Used when a `pages` document
 * doesn't pick a specific template, or as the fallback when
 * the chosen template id doesn't resolve.
 */
export function PageDefaultTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const blocks = (doc as { blocks?: NpPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <div className="np-page np-page-default">
      {blocks ? renderBlocks(blocks, { ctx: blockCtx }) : <h1>{title ?? "Untitled"}</h1>}
    </div>
  );
}
