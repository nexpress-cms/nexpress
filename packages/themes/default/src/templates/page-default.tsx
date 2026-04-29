import { renderBlocks } from "@nexpress/blocks";
import type { NxPageBlocks } from "@nexpress/blocks";

import type { NxTemplateRenderProps } from "@nexpress/theme";

/**
 * Default page template — the historical NexPress page render.
 * Wraps the page's blocks (or a fallback heading) in
 * `<div className="nx-page">`. Used when a `pages` document
 * doesn't pick a specific template, or as the fallback when
 * the chosen template id doesn't resolve.
 */
export function PageDefaultTemplate({ doc }: NxTemplateRenderProps) {
  const blocks = (doc as { blocks?: NxPageBlocks }).blocks;
  const title = (doc as { title?: string }).title;
  return (
    <div className="nx-page nx-page-default">
      {blocks ? renderBlocks(blocks) : <h1>{title ?? "Untitled"}</h1>}
    </div>
  );
}
