import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";
import type { NpTemplateRenderProps } from "@nexpress/theme";

export function StorefrontPageDefault({ doc, blockCtx }: NpTemplateRenderProps) {
  const page = doc as { title?: string; blocks?: NpPageBlocks };
  return (
    <main className="np-storefront-container np-storefront-page">
      {page.title ? <h1>{page.title}</h1> : null}
      {page.blocks ? renderBlocks(page.blocks, { ctx: blockCtx }) : null}
    </main>
  );
}
