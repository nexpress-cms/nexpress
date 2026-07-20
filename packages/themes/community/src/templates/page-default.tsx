import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";
import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageDefaultTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const page = doc as { title?: string; blocks?: NpPageBlocks };
  return (
    <main className="np-community-page np-community-page-default">
      <div className="np-community-container">
        <header className="np-community-page-header">
          <span>COMMUNITY PAGE</span>
          <h1>{page.title ?? "제목 없는 페이지"}</h1>
        </header>
        <div className="np-community-page-body">
          {page.blocks && page.blocks.length > 0
            ? renderBlocks(page.blocks, { ctx: blockCtx })
            : null}
        </div>
      </div>
    </main>
  );
}
